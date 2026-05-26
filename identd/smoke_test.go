package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSmoke(t *testing.T) {
	c := loadConfig()
	if c.Addr == "" {
		t.Fatalf("addr empty")
	}
}

func TestLoadConfigFromFlags(t *testing.T) {
	cfg, err := loadConfigFrom(
		[]string{
			"--addr", "127.0.0.1:9000",
			"--base-path", "/ident",
			"--data-dir", "/tmp/readsb",
			"--aircraft-file", "aircraft.json",
			"--receiver-file", "receiver.json",
			"--stats-file", "stats.json",
			"--outline-file", "outline.json",
		},
		func(string) string { return "" },
	)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Addr != "127.0.0.1:9000" {
		t.Fatalf("addr = %q", cfg.Addr)
	}
	if cfg.DataDir != "/tmp/readsb" {
		t.Fatalf("data dir = %q", cfg.DataDir)
	}
	if cfg.BasePath != "/ident" {
		t.Fatalf("base path = %q", cfg.BasePath)
	}
}

func TestLoadConfigFromNormalizesBasePathEnv(t *testing.T) {
	cfg, err := loadConfigFrom(nil, func(key string) string {
		switch key {
		case "IDENT_BASE_PATH":
			return "ident/"
		case "IDENT_DATA_DIR":
			return "/run/readsb"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.BasePath != "/ident" {
		t.Fatalf("base path = %q", cfg.BasePath)
	}
}

func TestLoadConfigFromReadsUpstreamTypeEnv(t *testing.T) {
	cfg, err := loadConfigFrom(nil, func(key string) string {
		switch key {
		case "IDENT_UPSTREAM_TYPE":
			return "dump1090-fa"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.UpstreamType != "dump1090-fa" {
		t.Fatalf("upstream type = %q", cfg.UpstreamType)
	}
}

func TestLoadConfigFromReadsReplayCacheControls(t *testing.T) {
	cfg, err := loadConfigFrom(nil, func(key string) string {
		switch key {
		case "IDENT_REPLAY_CACHE_REINDEX":
			return "false"
		case "IDENT_REPLAY_CLEANUP_LOW_WATERMARK":
			return "0.85"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ReplayCacheReindex {
		t.Fatalf("replay cache reindex = true, want false")
	}
	if cfg.ReplayCleanupLowWatermark != 0.85 {
		t.Fatalf("replay cleanup low watermark = %v, want 0.85", cfg.ReplayCleanupLowWatermark)
	}
}

func TestLoadConfigFromRejectsRemovedReplayFlags(t *testing.T) {
	for _, args := range [][]string{
		{"--replay-block-duration", "5m"},
		{"--replay-retention", "24h"},
	} {
		if _, err := loadConfigFrom(args, func(string) string { return "" }); err == nil {
			t.Fatalf("loadConfigFrom(%v) succeeded, want unknown flag error", args)
		}
	}
}

func TestDetectReceiverDataDirUsesFirstCandidateWithAircraftJSON(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "readsb")
	second := filepath.Join(root, "dump1090-fa")
	if err := os.MkdirAll(second, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(second, "aircraft.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := detectReceiverDataDir([]string{first, second})
	if got != second {
		t.Fatalf("data dir = %q, want %q", got, second)
	}
}

func TestDetectReceiverDataDirFallsBackToFirstCandidate(t *testing.T) {
	got := detectReceiverDataDir([]string{"/tmp/ident-missing-one", "/tmp/ident-missing-two"})
	if got != "/tmp/ident-missing-one" {
		t.Fatalf("data dir = %q", got)
	}
}

func TestPublishConfigEnvelopeIncludesStationName(t *testing.T) {
	hub := NewHub([]string{"config"})
	publishConfigEnvelope(hub, Config{StationName: "Demo Receiver"}, nil)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string `json:"type"`
		Data struct {
			Schema  string `json:"schema"`
			Station string `json:"station"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Type != "config" {
		t.Fatalf("type = %q, want config", env.Type)
	}
	if env.Data.Schema != "ident.config.v1" {
		t.Fatalf("schema = %q, want ident.config.v1", env.Data.Schema)
	}
	if env.Data.Station != "Demo Receiver" {
		t.Fatalf("station = %q, want Demo Receiver", env.Data.Station)
	}
}

func TestPublishConfigEnvelopeIncludesIdentBuild(t *testing.T) {
	prevVersion, prevCommit := version, commit
	t.Cleanup(func() {
		version, commit = prevVersion, prevCommit
	})
	version = "v1.2.3"
	commit = "abcdef1234567890"

	hub := NewHub([]string{"config"})
	publishConfigEnvelope(hub, Config{}, nil)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Data struct {
			Ident struct {
				Version     string `json:"version"`
				ShortCommit string `json:"shortCommit"`
			} `json:"ident"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.Ident.Version != "v1.2.3" {
		t.Fatalf("ident version = %q", env.Data.Ident.Version)
	}
	if env.Data.Ident.ShortCommit != "abcdef1" {
		t.Fatalf("ident shortCommit = %q", env.Data.Ident.ShortCommit)
	}
}

func TestPublishConfigEnvelopeOmitsEmptyStation(t *testing.T) {
	hub := NewHub([]string{"config"})
	publishConfigEnvelope(hub, Config{StationName: ""}, nil)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string                 `json:"type"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, hasStation := env.Data["station"]; hasStation {
		t.Fatalf("empty station should be omitted: %s", snaps[0])
	}
	if env.Data["schema"] != "ident.config.v1" {
		t.Fatalf("schema = %v, want ident.config.v1", env.Data["schema"])
	}
}

func TestPublishConfigEnvelopeIgnoresEmptyLineOfSight(t *testing.T) {
	hub := NewHub([]string{"config"})
	publishConfigEnvelope(hub, Config{StationName: "Receiver"}, []byte{})

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string                 `json:"type"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data["station"] != "Receiver" {
		t.Fatalf("station = %v, want Receiver", env.Data["station"])
	}
	if _, hasLineOfSight := env.Data["lineOfSight"]; hasLineOfSight {
		t.Fatalf("empty lineOfSight should be omitted: %s", snaps[0])
	}
}

func TestPublishConfigEnvelopeIncludesLineOfSight(t *testing.T) {
	hub := NewHub([]string{"config"})
	publishConfigEnvelope(
		hub,
		Config{StationName: "Demo Receiver"},
		[]byte(`{"rings":[{"alt":3048,"points":[[1,2],[3,4],[5,6]]}]}`),
	)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string `json:"type"`
		Data struct {
			Schema      string `json:"schema"`
			Station     string `json:"station"`
			LineOfSight struct {
				Rings []struct {
					Alt int `json:"alt"`
				} `json:"rings"`
			} `json:"lineOfSight"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.Schema != "ident.config.v1" {
		t.Fatalf("schema = %q, want ident.config.v1", env.Data.Schema)
	}
	if env.Data.Station != "Demo Receiver" {
		t.Fatalf("station = %q", env.Data.Station)
	}
	if len(env.Data.LineOfSight.Rings) != 1 || env.Data.LineOfSight.Rings[0].Alt != 3048 {
		t.Fatalf("lineOfSight = %#v", env.Data.LineOfSight)
	}
}

func TestDiagnosticStoreNotePublishesEnvelopeOnHub(t *testing.T) {
	hub := NewHub([]string{"diagnostics"})
	store := NewDiagnosticStore(DiagnosticStoreOptions{
		Debounce: -1,
		Publish: func(env []byte) {
			hub.PublishSnapshotEnvelope("diagnostics", env)
		},
	})

	store.Note("replay", "replay.cache.unreadable", severityWarning, "replay block could not be read", WithTTL(0))

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	diagnostics := findEnvelope(t, snaps, "diagnostics")
	if diagnostics["schema"] != "ident.diagnostics.v1" {
		t.Fatalf("schema = %#v", diagnostics["schema"])
	}
	rows := diagnostics["diagnostics"].([]any)
	if len(rows) != 1 {
		t.Fatalf("diagnostics = %#v", rows)
	}
	diag := rows[0].(map[string]any)
	if diag["code"] != "replay.cache.unreadable" || diag["channel"] != "replay" {
		t.Fatalf("diagnostic = %#v", diag)
	}
}

func TestPublishReplayAvailabilityEnvelopeIsVersioned(t *testing.T) {
	hub := NewHub([]string{"replay.availability"})
	from := int64(1000)
	to := int64(2000)
	publishReplayAvailabilityEnvelope(hub, ReplayManifest{
		Enabled:  true,
		From:     &from,
		To:       &to,
		BlockSec: 300,
		Blocks: []ReplayBlockIndex{
			{Name: "1000-2000.json.zst"},
		},
	})

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string `json:"type"`
		Data struct {
			Schema   string `json:"schema"`
			Enabled  bool   `json:"enabled"`
			From     *int64 `json:"fromEpochMs"`
			To       *int64 `json:"toEpochMs"`
			BlockSec int64  `json:"blockSec"`
			Blocks   int    `json:"blockCount"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Type != "replay.availability" {
		t.Fatalf("type = %q, want replay.availability", env.Type)
	}
	if env.Data.Schema != "ident.replay.availability.v1" {
		t.Fatalf("schema = %q, want ident.replay.availability.v1", env.Data.Schema)
	}
	if !env.Data.Enabled || env.Data.From == nil || *env.Data.From != from || env.Data.To == nil || *env.Data.To != to || env.Data.BlockSec != 300 || env.Data.Blocks != 1 {
		t.Fatalf("availability = %#v (want from=%v to=%v)", env.Data, from, to)
	}
}

func TestLoadConfigFromLoadsLineOfSightEnv(t *testing.T) {
	cfg, err := loadConfigFrom(nil, func(key string) string {
		switch key {
		case "IDENT_DATA_DIR":
			return "/run/readsb"
		case "IDENT_HEYWHATSTHAT_PANORAMA_ID":
			return "abc123"
		case "IDENT_HEYWHATSTHAT_ALTS":
			return "40000ft,3000m"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.LineOfSightPanoramaID != "abc123" {
		t.Fatalf("panorama id = %q", cfg.LineOfSightPanoramaID)
	}
	if cfg.LineOfSightAlts != "40000ft,3000m" {
		t.Fatalf("alts = %q", cfg.LineOfSightAlts)
	}
}
