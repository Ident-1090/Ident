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
	publishConfigEnvelope(hub, Config{StationName: "Home Receiver"}, nil)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string `json:"type"`
		Data struct {
			Station string `json:"station"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Type != "config" {
		t.Fatalf("type = %q, want config", env.Type)
	}
	if env.Data.Station != "Home Receiver" {
		t.Fatalf("station = %q, want Home Receiver", env.Data.Station)
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
}

func TestPublishConfigEnvelopeIncludesLineOfSight(t *testing.T) {
	hub := NewHub([]string{"config"})
	publishConfigEnvelope(
		hub,
		Config{StationName: "Home Receiver"},
		[]byte(`{"rings":[{"alt":3048,"points":[[1,2],[3,4],[5,6]]}]}`),
	)

	snaps := hub.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	var env struct {
		Type string `json:"type"`
		Data struct {
			Station     string `json:"station"`
			LineOfSight struct {
				Rings []struct {
					Alt int `json:"alt"`
				} `json:"rings"`
			} `json:"line_of_sight"`
		} `json:"data"`
	}
	if err := json.Unmarshal(snaps[0], &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.Station != "Home Receiver" {
		t.Fatalf("station = %q", env.Data.Station)
	}
	if len(env.Data.LineOfSight.Rings) != 1 || env.Data.LineOfSight.Rings[0].Alt != 3048 {
		t.Fatalf("line_of_sight = %#v", env.Data.LineOfSight)
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
