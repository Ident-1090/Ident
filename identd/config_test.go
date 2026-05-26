package main

import "testing"

func TestPublicCardDefaultsOn(t *testing.T) {
	cfg, err := loadConfigFrom(nil, func(string) string { return "" })
	if err != nil {
		t.Fatalf("loadConfigFrom: %v", err)
	}
	if !cfg.PublicCard {
		t.Fatal("PublicCard should default to true")
	}
}

func TestPublicCardEnvDisable(t *testing.T) {
	getenv := func(k string) string {
		if k == "IDENT_PUBLIC_CARD" {
			return "false"
		}
		return ""
	}
	cfg, err := loadConfigFrom(nil, getenv)
	if err != nil {
		t.Fatalf("loadConfigFrom: %v", err)
	}
	if cfg.PublicCard {
		t.Fatal("IDENT_PUBLIC_CARD=false should disable PublicCard")
	}
}

func TestPublicCardFlagDisable(t *testing.T) {
	cfg, err := loadConfigFrom([]string{"-public-card=false"}, func(string) string { return "" })
	if err != nil {
		t.Fatalf("loadConfigFrom: %v", err)
	}
	if cfg.PublicCard {
		t.Fatal("-public-card=false should disable PublicCard")
	}
}
