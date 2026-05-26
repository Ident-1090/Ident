package main

import (
	"bytes"
	"image/png"
	"testing"
)

func TestCardRenderProducesPNG(t *testing.T) {
	r, err := newCardRenderer(func() CardStats {
		return CardStats{
			Station:     "TESTSTN",
			MessageRate: 418,
			HasRate:     true,
			Aircraft:    17,
			MaxRangeNM:  250,
			HasRange:    true,
		}
	})
	if err != nil {
		t.Fatalf("newCardRenderer: %v", err)
	}
	b, err := r.render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("decode rendered png: %v", err)
	}
	if img.Bounds().Dx() != cardW || img.Bounds().Dy() != cardH {
		t.Fatalf("size = %v, want %dx%d", img.Bounds(), cardW, cardH)
	}
}

func TestCardRenderWithoutStationOrRange(t *testing.T) {
	r, err := newCardRenderer(func() CardStats { return CardStats{Aircraft: 3} })
	if err != nil {
		t.Fatalf("newCardRenderer: %v", err)
	}
	if _, err := r.render(); err != nil {
		t.Fatalf("render: %v", err)
	}
}

func TestStatusLineOmitsMissingFields(t *testing.T) {
	got := statusLine(CardStats{Aircraft: 5})
	if got != "5 aircraft" {
		t.Fatalf("statusLine = %q, want %q", got, "5 aircraft")
	}
	got = statusLine(CardStats{HasRate: true, MessageRate: 100, Aircraft: 9, HasRange: true, MaxRangeNM: 240})
	if got != "100 msg/s · 9 aircraft · 240 nm" {
		t.Fatalf("statusLine = %q", got)
	}
}
