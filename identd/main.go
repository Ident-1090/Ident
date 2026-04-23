package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type channelSpec struct {
	name string
	file string
}

var defaultReceiverDataDirs = []string{
	"/run/readsb",
	"/run/dump1090-fa",
	"/run/adsbexchange-feed",
	"/run/dump1090",
	"/run/dump1090-mutability",
	"/run/skyaware978",
	"/run/shm",
}

type Config struct {
	Addr                  string
	DataDir               string
	HistoryDataDir        string
	AircraftFile          string
	ReceiverFile          string
	StatsFile             string
	OutlineFile           string
	DebounceMs            int
	RouteUpstreamURL      string
	RouteTTL              time.Duration
	RouteBatchDelay       time.Duration
	StationName           string
	LineOfSightPanoramaID string
	LineOfSightAlts       string
	UpdateCheck           bool
	UpdateRepo            string
	UpdateAPIBase         string
	UpdateInterval        time.Duration
	UpdateTimeout         time.Duration
}

func main() {
	cfg, err := loadConfigFrom(os.Args[1:], os.Getenv)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	log.Printf("identd addr=%s data=%s history=%s", cfg.Addr, cfg.DataDir, cfg.HistoryDataDir)

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	if err := run(context.Background(), cfg, sigs); err != nil {
		log.Fatalf("run: %v", err)
	}
}

func run(parent context.Context, cfg Config, sigs chan os.Signal) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	channels := []channelSpec{
		{"aircraft", cfg.AircraftFile},
		{"receiver", cfg.ReceiverFile},
		{"stats", cfg.StatsFile},
		{"outline", cfg.OutlineFile},
	}

	// `config` is a hub channel too — one snapshot envelope published once at
	// startup and cached for snapshot-on-connect. Not file-watched.
	hubNames := make([]string, 0, len(channels)+1)
	hubNames = append(hubNames, "config")
	for _, c := range channels {
		hubNames = append(hubNames, c.name)
	}
	hub := NewHub(hubNames)

	lineOfSightCache := NewLOSCache(LOSOptions{
		PanoramaID: cfg.LineOfSightPanoramaID,
		Alts:       cfg.LineOfSightAlts,
	})
	lineOfSight, err := lineOfSightCache.Load(ctx)
	if err != nil {
		log.Printf("line_of_sight: %v", err)
	}

	publishConfigEnvelope(hub, cfg, lineOfSight)

	routes := NewRouteCache(hub, RouteCacheOptions{
		TTL:         cfg.RouteTTL,
		BatchDelay:  cfg.RouteBatchDelay,
		UpstreamURL: cfg.RouteUpstreamURL,
	})
	hub.SetRouteProvider(routes.RouteSnapshots)
	routes.Run(ctx)

	srv := NewServerWithOptions(ctx, hub, ServerOptions{
		DataDir:        cfg.DataDir,
		HistoryDataDir: cfg.HistoryDataDir,
		Web:            bundledWeb(),
		UpdateChecker:  NewUpdateChecker(updateCheckerOptions(cfg)),
	})
	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0,
	}

	var wg sync.WaitGroup
	debounce := time.Duration(cfg.DebounceMs) * time.Millisecond

	readiness := make(chan string, len(channels))
	for _, c := range channels {
		c := c
		path := filepath.Join(cfg.DataDir, c.file)
		w := NewWatcher(path, debounce, func(b []byte) {
			hub.Publish(c.name, b)
			if c.name == "aircraft" {
				if cs := extractAircraftCallsigns(b); len(cs) > 0 {
					routes.Track(cs)
				}
			}
			select {
			case readiness <- c.name:
			default:
			}
		})
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := w.Run(ctx); err != nil {
				log.Printf("watcher %s: %v", c.name, err)
			}
		}()
	}

	// Mark ready as soon as any channel has produced a snapshot.
	go func() {
		for range readiness {
			srv.SetReady(true)
			return
		}
	}()

	go func() {
		log.Printf("listening on %s", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("http: %v", err)
		}
	}()

	select {
	case <-sigs:
		log.Printf("shutdown signal")
	case <-ctx.Done():
	}

	cancel()
	time.Sleep(200 * time.Millisecond)

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	_ = httpSrv.Shutdown(shutdownCtx)

	wg.Wait()
	return nil
}

func loadConfig() Config {
	cfg, err := loadConfigFrom(nil, os.Getenv)
	if err != nil {
		panic(err)
	}
	return cfg
}

func loadConfigFrom(args []string, getenv func(string) string) (Config, error) {
	cfg := Config{
		Addr:                  envOr(getenv, "IDENT_ADDR", ":8080"),
		DataDir:               envOr(getenv, "IDENT_DATA_DIR", detectReceiverDataDir(defaultReceiverDataDirs)),
		HistoryDataDir:        envOr(getenv, "HISTORY_DATA_DIR", filepath.Join(envOr(getenv, "IDENT_DATA_DIR", detectReceiverDataDir(defaultReceiverDataDirs)), "chunks")),
		AircraftFile:          envOr(getenv, "IDENT_AIRCRAFT_FILE", "aircraft.json"),
		ReceiverFile:          envOr(getenv, "IDENT_RECEIVER_FILE", "receiver.json"),
		StatsFile:             envOr(getenv, "IDENT_STATS_FILE", "stats.json"),
		OutlineFile:           envOr(getenv, "IDENT_OUTLINE_FILE", "outline.json"),
		DebounceMs:            75,
		RouteUpstreamURL:      envOr(getenv, "IDENT_RELAY_ROUTE_UPSTREAM", defaultRouteUpstreamURL),
		RouteTTL:              time.Duration(envInt(getenv, "IDENT_RELAY_ROUTE_TTL_SEC", 300)) * time.Second,
		RouteBatchDelay:       time.Duration(envInt(getenv, "IDENT_RELAY_ROUTE_BATCH_MS", 250)) * time.Millisecond,
		StationName:           strings.TrimSpace(getenv("IDENT_STATION_NAME")),
		LineOfSightPanoramaID: strings.TrimSpace(getenv("IDENT_HEYWHATSTHAT_PANORAMA_ID")),
		LineOfSightAlts:       strings.TrimSpace(getenv("IDENT_HEYWHATSTHAT_ALTS")),
		UpdateCheck:           envBool(getenv, "IDENT_UPDATE_CHECK", true),
		UpdateRepo:            envOr(getenv, "IDENT_UPDATE_REPO", defaultUpdateRepo),
		UpdateAPIBase:         envOr(getenv, "IDENT_UPDATE_API_URL", defaultUpdateAPIBase),
		UpdateInterval:        time.Duration(envInt(getenv, "IDENT_UPDATE_INTERVAL_SEC", int(defaultUpdateInterval/time.Second))) * time.Second,
		UpdateTimeout:         time.Duration(envInt(getenv, "IDENT_UPDATE_TIMEOUT_SEC", int(defaultUpdateTimeout/time.Second))) * time.Second,
	}

	flags := flag.NewFlagSet("identd", flag.ContinueOnError)
	flags.StringVar(&cfg.Addr, "addr", cfg.Addr, "HTTP listen address")
	flags.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "receiver data directory")
	flags.StringVar(&cfg.HistoryDataDir, "history-data-dir", cfg.HistoryDataDir, "directory serving /chunks/* history files")
	flags.StringVar(&cfg.AircraftFile, "aircraft-file", cfg.AircraftFile, "aircraft JSON file name")
	flags.StringVar(&cfg.ReceiverFile, "receiver-file", cfg.ReceiverFile, "receiver JSON file name")
	flags.StringVar(&cfg.StatsFile, "stats-file", cfg.StatsFile, "stats JSON file name")
	flags.StringVar(&cfg.OutlineFile, "outline-file", cfg.OutlineFile, "outline JSON file name")
	flags.StringVar(&cfg.StationName, "station-name", cfg.StationName, "display name for the receiver")
	flags.StringVar(&cfg.RouteUpstreamURL, "route-upstream", cfg.RouteUpstreamURL, "route lookup endpoint")
	flags.StringVar(&cfg.LineOfSightPanoramaID, "line-of-sight-panorama-id", cfg.LineOfSightPanoramaID, "HeyWhatsThat panorama ID for line-of-sight rings")
	flags.StringVar(&cfg.LineOfSightAlts, "line-of-sight-alts", cfg.LineOfSightAlts, "comma-separated line-of-sight altitudes")
	flags.BoolVar(&cfg.UpdateCheck, "update-check", cfg.UpdateCheck, "check GitHub Releases for update notifications")
	flags.StringVar(&cfg.UpdateRepo, "update-repo", cfg.UpdateRepo, "GitHub owner/repo used for update notifications")
	flags.StringVar(&cfg.UpdateAPIBase, "update-api-url", cfg.UpdateAPIBase, "GitHub API base URL for update notifications")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func updateCheckerOptions(cfg Config) UpdateCheckerOptions {
	return UpdateCheckerOptions{
		Enabled: cfg.UpdateCheck,
		Repo:    cfg.UpdateRepo,
		APIBase: cfg.UpdateAPIBase,
		TTL:     cfg.UpdateInterval,
		Timeout: cfg.UpdateTimeout,
		Current: CurrentVersionInfo(),
	}
}

// publishConfigEnvelope caches the one-shot runtime config snapshot on the
// hub so every connecting client receives it. Fields left blank are omitted
// so the client falls back to its own derivation logic.
func publishConfigEnvelope(hub *Hub, cfg Config, lineOfSight []byte) {
	payload := struct {
		Station     string          `json:"station,omitempty"`
		LineOfSight json.RawMessage `json:"line_of_sight,omitempty"`
	}{
		Station:     cfg.StationName,
		LineOfSight: json.RawMessage(lineOfSight),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		log.Printf("config: marshal: %v", err)
		return
	}
	hub.Publish("config", body)
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(getenv func(string) string, key string, def int) int {
	if v := getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func envBool(getenv func(string) string, key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(getenv(key)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on", "enabled":
		return true
	case "0", "false", "no", "off", "disabled":
		return false
	default:
		return def
	}
}

func detectReceiverDataDir(candidates []string) string {
	for _, dir := range candidates {
		if _, err := os.Stat(filepath.Join(dir, "aircraft.json")); err == nil {
			return dir
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return "/run/readsb"
}

// extractAircraftCallsigns parses just the `.aircraft[].flight` field out
// of a readsb aircraft.json payload. Parse errors / missing fields return
// an empty slice — the route cache tolerates noise. Blank flight values
// and whitespace-only entries are skipped.
func extractAircraftCallsigns(b []byte) []string {
	var frame struct {
		Aircraft []struct {
			Flight string `json:"flight"`
		} `json:"aircraft"`
	}
	if err := json.Unmarshal(b, &frame); err != nil {
		return nil
	}
	out := make([]string, 0, len(frame.Aircraft))
	for _, a := range frame.Aircraft {
		if cs := normalizeCallsign(a.Flight); cs != "" {
			out = append(out, cs)
		}
	}
	return out
}
