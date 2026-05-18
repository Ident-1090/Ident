package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
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
	Addr                       string
	BasePath                   string
	DataDir                    string
	AircraftFile               string
	ReceiverFile               string
	StatsFile                  string
	OutlineFile                string
	UpstreamType               string
	DebounceMs                 int
	RouteUpstreamURL           string
	RouteTTL                   time.Duration
	RouteBatchDelay            time.Duration
	StationName                string
	LineOfSightPanoramaID      string
	LineOfSightAlts            string
	UpdateCheck                bool
	UpdateRepo                 string
	UpdateAPIBase              string
	UpdateInterval             time.Duration
	UpdateTimeout              time.Duration
	TrailsMemoryWindow         time.Duration
	TrailsSampleInterval       time.Duration
	TrailsRestartCache         bool
	TrailsRestartCacheDir      string
	TrailsRestartCacheInterval time.Duration
	ReplayEnable               bool
	ReplayDir                  string
	ReplayRetention            time.Duration
	ReplayMaxBytes             int64
	ReplayBlockDuration        time.Duration
	ReplaySampleInterval       time.Duration
}

func main() {
	cfg, err := loadConfigFrom(os.Args[1:], os.Getenv)
	if err != nil {
		slog.Error("config", "err", err)
		os.Exit(1)
	}
	slog.Info("identd", "addr", cfg.Addr, "data", cfg.DataDir)

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)

	if err := run(context.Background(), cfg, sigs); err != nil {
		slog.Error("run", "err", err)
		os.Exit(1)
	}
}

func run(parent context.Context, cfg Config, sigs chan os.Signal) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	producerFiles := []channelSpec{
		{"aircraft", cfg.AircraftFile},
		{"receiver", cfg.ReceiverFile},
		{"stats", cfg.StatsFile},
		{"outline", cfg.OutlineFile},
	}

	// Hub channels cache snapshot envelopes for new clients. Some are backed by
	// watched producer files; config and replay availability are published by
	// identd itself.
	hubNames := []string{"config", "capabilities", "status", "aircraft", "rangeOutline", "replay.availability"}
	hub := NewHub(hubNames)
	statusNormalizer := NewProducerStatusNormalizerWithUpstreamType(cfg.UpstreamType)

	lineOfSightCache := NewLOSCache(LOSOptions{
		PanoramaID: cfg.LineOfSightPanoramaID,
		Alts:       cfg.LineOfSightAlts,
	})
	lineOfSight, err := lineOfSightCache.Load(ctx)
	if err != nil {
		slog.Warn("lineOfSight", "err", err)
	}

	publishConfigEnvelope(hub, cfg, lineOfSight)

	routes := NewRouteCache(hub, RouteCacheOptions{
		TTL:         cfg.RouteTTL,
		BatchDelay:  cfg.RouteBatchDelay,
		UpstreamURL: cfg.RouteUpstreamURL,
	})
	hub.SetRouteProvider(routes.RouteSnapshots)
	routes.Run(ctx)

	startupDiagnostics := NewDiagnosticCollector()
	trails := NewTrailStore(TrailOptions{
		MemoryWindow:       cfg.TrailsMemoryWindow,
		SampleInterval:     cfg.TrailsSampleInterval,
		RestartCacheDir:    cfg.TrailsRestartCacheDir,
		StartupDiagnostics: startupDiagnostics,
	})
	if cfg.TrailsRestartCache {
		if err := trails.LoadRestartCache(); err != nil {
			slog.Warn("trails restart cache", "err", err, "path", cfg.TrailsRestartCacheDir)
		}
		go trails.RunRestartCacheWriter(ctx, cfg.TrailsRestartCacheInterval)
	}

	replay, err := NewReplayStore(ReplayOptions{
		Enabled:            cfg.ReplayEnable,
		Dir:                cfg.ReplayDir,
		Retention:          cfg.ReplayRetention,
		MaxBytes:           cfg.ReplayMaxBytes,
		BlockDuration:      cfg.ReplayBlockDuration,
		SampleInterval:     cfg.ReplaySampleInterval,
		StartupDiagnostics: startupDiagnostics,
		OnAvailability: func(manifest ReplayManifest) {
			publishReplayAvailabilityEnvelope(hub, manifest)
		},
	})
	if err != nil {
		return err
	}
	if err := replay.Load(); err != nil {
		return err
	}
	publishStartupDiagnostics(hub, statusNormalizer, startupDiagnostics.Drain())

	srv := NewServerWithOptions(ctx, hub, ServerOptions{
		BasePath: cfg.BasePath,
		Web:      bundledWeb(),
		Replay:   replay,
		Trails:   trails,
	})
	httpSrv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      srv.Handler(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0,
	}

	var wg sync.WaitGroup
	debounce := time.Duration(cfg.DebounceMs) * time.Millisecond

	readiness := make(chan string, len(producerFiles))
	for _, c := range producerFiles {
		c := c
		path := filepath.Join(cfg.DataDir, c.file)
		w := NewWatcher(path, debounce, func(b []byte) {
			aircraftFrame := publishProducerUpdate(hub, statusNormalizer, c.name, b)
			if c.name == "aircraft" {
				if aircraftFrame != nil {
					hub.PublishEnvelope(trails.IngestAircraftFrame(*aircraftFrame), "trails")
					replay.IngestAircraftFrame(*aircraftFrame)
					if cs := extractAircraftCallsignsFromFrame(*aircraftFrame); len(cs) > 0 {
						routes.Track(cs)
					}
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
				slog.Warn("watcher", "name", c.name, "path", path, "err", err)
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
		slog.Info("listening", "addr", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("http", "err", err, "addr", cfg.Addr)
		}
	}()

	if cfg.UpdateCheck {
		go runUpdateDiagnostics(ctx, hub, statusNormalizer, NewUpdateChecker(updateCheckerOptions(cfg)), cfg.UpdateInterval)
	}

	select {
	case <-sigs:
		slog.Info("shutdown signal")
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

func publishStartupDiagnostics(hub *Hub, normalizer *ProducerStatusNormalizer, diagnostics []diagnostic) {
	if len(diagnostics) == 0 {
		return
	}
	hub.PublishSnapshotEnvelope("status", normalizer.DiagnosticStatusEnvelope(diagnostics...))
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
		Addr:                       envOr(getenv, "IDENT_ADDR", ":8080"),
		BasePath:                   envOr(getenv, "IDENT_BASE_PATH", ""),
		DataDir:                    envOr(getenv, "IDENT_DATA_DIR", detectReceiverDataDir(defaultReceiverDataDirs)),
		AircraftFile:               envOr(getenv, "IDENT_AIRCRAFT_FILE", "aircraft.json"),
		ReceiverFile:               envOr(getenv, "IDENT_RECEIVER_FILE", "receiver.json"),
		StatsFile:                  envOr(getenv, "IDENT_STATS_FILE", "stats.json"),
		OutlineFile:                envOr(getenv, "IDENT_OUTLINE_FILE", "outline.json"),
		UpstreamType:               strings.TrimSpace(getenv("IDENT_UPSTREAM_TYPE")),
		DebounceMs:                 75,
		RouteUpstreamURL:           envOr(getenv, "IDENT_RELAY_ROUTE_UPSTREAM", defaultRouteUpstreamURL),
		RouteTTL:                   time.Duration(envInt(getenv, "IDENT_RELAY_ROUTE_TTL_SEC", 300)) * time.Second,
		RouteBatchDelay:            time.Duration(envInt(getenv, "IDENT_RELAY_ROUTE_BATCH_MS", 250)) * time.Millisecond,
		StationName:                strings.TrimSpace(getenv("IDENT_STATION_NAME")),
		LineOfSightPanoramaID:      strings.TrimSpace(getenv("IDENT_HEYWHATSTHAT_PANORAMA_ID")),
		LineOfSightAlts:            strings.TrimSpace(getenv("IDENT_HEYWHATSTHAT_ALTS")),
		UpdateCheck:                envBool(getenv, "IDENT_UPDATE_CHECK", true),
		UpdateRepo:                 envOr(getenv, "IDENT_UPDATE_REPO", defaultUpdateRepo),
		UpdateAPIBase:              envOr(getenv, "IDENT_UPDATE_API_URL", defaultUpdateAPIBase),
		UpdateInterval:             time.Duration(envInt(getenv, "IDENT_UPDATE_INTERVAL_SEC", int(defaultUpdateInterval/time.Second))) * time.Second,
		UpdateTimeout:              time.Duration(envInt(getenv, "IDENT_UPDATE_TIMEOUT_SEC", int(defaultUpdateTimeout/time.Second))) * time.Second,
		TrailsMemoryWindow:         time.Duration(envInt(getenv, "IDENT_TRAILS_MEMORY_WINDOW_SEC", 7200)) * time.Second,
		TrailsSampleInterval:       time.Duration(envInt(getenv, "IDENT_TRAILS_SAMPLE_INTERVAL_SEC", 5)) * time.Second,
		TrailsRestartCache:         envBool(getenv, "IDENT_TRAILS_RESTART_CACHE", true),
		TrailsRestartCacheDir:      envOr(getenv, "IDENT_TRAILS_RESTART_CACHE_DIR", "/var/cache/ident"),
		TrailsRestartCacheInterval: time.Duration(envInt(getenv, "IDENT_TRAILS_RESTART_CACHE_INTERVAL_SEC", 60)) * time.Second,
		ReplayEnable:               envBool(getenv, "IDENT_REPLAY_ENABLE", false),
		ReplayDir:                  strings.TrimSpace(getenv("IDENT_REPLAY_DIR")),
		ReplayRetention:            time.Duration(envInt(getenv, "IDENT_REPLAY_RETENTION_SEC", 0)) * time.Second,
		ReplayMaxBytes:             envInt64(getenv, "IDENT_REPLAY_MAX_BYTES", 0),
		ReplayBlockDuration:        time.Duration(envInt(getenv, "IDENT_REPLAY_BLOCK_SEC", 300)) * time.Second,
		ReplaySampleInterval:       time.Duration(envInt(getenv, "IDENT_REPLAY_SAMPLE_INTERVAL_SEC", 5)) * time.Second,
	}

	flags := flag.NewFlagSet("identd", flag.ContinueOnError)
	flags.StringVar(&cfg.Addr, "addr", cfg.Addr, "HTTP listen address")
	flags.StringVar(&cfg.BasePath, "base-path", cfg.BasePath, "URL path prefix for subpath deployments")
	flags.StringVar(&cfg.DataDir, "data-dir", cfg.DataDir, "receiver data directory")
	flags.StringVar(&cfg.AircraftFile, "aircraft-file", cfg.AircraftFile, "aircraft JSON file name")
	flags.StringVar(&cfg.ReceiverFile, "receiver-file", cfg.ReceiverFile, "receiver JSON file name")
	flags.StringVar(&cfg.StatsFile, "stats-file", cfg.StatsFile, "stats JSON file name")
	flags.StringVar(&cfg.OutlineFile, "outline-file", cfg.OutlineFile, "outline JSON file name")
	flags.StringVar(&cfg.UpstreamType, "upstream-type", cfg.UpstreamType, "receiver data upstream type")
	flags.StringVar(&cfg.StationName, "station-name", cfg.StationName, "display name for the receiver")
	flags.StringVar(&cfg.RouteUpstreamURL, "route-upstream", cfg.RouteUpstreamURL, "route lookup endpoint")
	flags.StringVar(&cfg.LineOfSightPanoramaID, "line-of-sight-panorama-id", cfg.LineOfSightPanoramaID, "HeyWhatsThat panorama ID for line-of-sight rings")
	flags.StringVar(&cfg.LineOfSightAlts, "line-of-sight-alts", cfg.LineOfSightAlts, "comma-separated line-of-sight altitudes")
	flags.BoolVar(&cfg.UpdateCheck, "update-check", cfg.UpdateCheck, "check GitHub Releases for update notifications")
	flags.StringVar(&cfg.UpdateRepo, "update-repo", cfg.UpdateRepo, "GitHub owner/repo used for update notifications")
	flags.StringVar(&cfg.UpdateAPIBase, "update-api-url", cfg.UpdateAPIBase, "GitHub API base URL for update notifications")
	flags.DurationVar(&cfg.TrailsMemoryWindow, "trails-memory-window", cfg.TrailsMemoryWindow, "duration of in-memory aircraft trails retained by identd")
	flags.DurationVar(&cfg.TrailsSampleInterval, "trails-sample-interval", cfg.TrailsSampleInterval, "minimum interval between retained trail samples per aircraft")
	flags.BoolVar(&cfg.TrailsRestartCache, "trails-restart-cache", cfg.TrailsRestartCache, "persist the in-memory trail cache for process/container restarts")
	flags.StringVar(&cfg.TrailsRestartCacheDir, "trails-restart-cache-dir", cfg.TrailsRestartCacheDir, "directory for the compressed trail restart cache")
	flags.DurationVar(&cfg.TrailsRestartCacheInterval, "trails-restart-cache-interval", cfg.TrailsRestartCacheInterval, "trail restart cache write interval")
	flags.BoolVar(&cfg.ReplayEnable, "replay-enable", cfg.ReplayEnable, "enable file-backed replay blocks")
	flags.StringVar(&cfg.ReplayDir, "replay-dir", cfg.ReplayDir, "directory for replay index and compressed blocks")
	flags.DurationVar(&cfg.ReplayRetention, "replay-retention", cfg.ReplayRetention, "maximum replay history retained on disk")
	flags.Int64Var(&cfg.ReplayMaxBytes, "replay-max-bytes", cfg.ReplayMaxBytes, "maximum bytes used by finalized replay blocks")
	flags.DurationVar(&cfg.ReplayBlockDuration, "replay-block-duration", cfg.ReplayBlockDuration, "duration per finalized replay block")
	flags.DurationVar(&cfg.ReplaySampleInterval, "replay-sample-interval", cfg.ReplaySampleInterval, "minimum interval between replay samples")
	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	basePath, err := normalizeBasePath(cfg.BasePath)
	if err != nil {
		return Config{}, err
	}
	cfg.BasePath = basePath
	return cfg, nil
}

type identReplayAvailability struct {
	Schema       string `json:"schema"`
	Enabled      bool   `json:"enabled"`
	FromEpochSec *int64 `json:"fromEpochSec,omitempty"`
	ToEpochSec   *int64 `json:"toEpochSec,omitempty"`
	BlockSec     int64  `json:"blockSec"`
	BlockCount   int    `json:"blockCount"`
}

func publishReplayAvailabilityEnvelope(hub *Hub, manifest ReplayManifest) {
	// Internal replay state tracks block timestamps in unix milliseconds for
	// historical reasons; the wire contract is integer seconds to match every
	// other Ident `*EpochSec` field. Sub-second precision is meaningless at
	// the sample rates we operate on — convert at the publish boundary.
	payload := identReplayAvailability{
		Schema:       "ident.replay.availability.v1",
		Enabled:      manifest.Enabled,
		FromEpochSec: epochMsToSecPtr(manifest.From),
		ToEpochSec:   epochMsToSecPtr(manifest.To),
		BlockSec:     manifest.BlockSec,
		BlockCount:   len(manifest.Blocks),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("replay availability: marshal", "err", err)
		return
	}
	hub.Publish("replay.availability", body)
}

func epochMsToSecPtr(ms *int64) *int64 {
	if ms == nil {
		return nil
	}
	sec := *ms / 1000
	return &sec
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

func runUpdateDiagnostics(ctx context.Context, hub *Hub, normalizer *ProducerStatusNormalizer, checker *UpdateChecker, interval time.Duration) {
	if checker == nil || interval <= 0 {
		return
	}
	for {
		status := checker.Status(ctx)
		var diagnostics []diagnostic
		if d, ok := status.Diagnostic(); ok {
			diagnostics = append(diagnostics, d)
		}
		if env := normalizer.SetExternalDiagnostics("update", diagnostics); env != nil {
			hub.PublishSnapshotEnvelope("status", env)
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// publishConfigEnvelope caches the one-shot runtime config snapshot on the
// hub so every connecting client receives it. Fields left blank are omitted
// so the client falls back to its own derivation logic.
type identConfig struct {
	Schema      string          `json:"schema"`
	Station     string          `json:"station,omitempty"`
	LineOfSight json.RawMessage `json:"lineOfSight,omitempty"`
}

func publishConfigEnvelope(hub *Hub, cfg Config, lineOfSight []byte) {
	payload := identConfig{
		Schema:      "ident.config.v1",
		Station:     cfg.StationName,
		LineOfSight: json.RawMessage(lineOfSight),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("config: marshal", "err", err)
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

func envInt64(getenv func(string) string, key string, def int64) int64 {
	if v := getenv(key); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
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

func extractAircraftCallsignsFromFrame(frame identAircraftFrame) []string {
	out := make([]string, 0, len(frame.Aircraft))
	for _, a := range frame.Aircraft {
		if cs := normalizeCallsign(a.Flight); cs != "" {
			out = append(out, cs)
		}
	}
	return out
}
