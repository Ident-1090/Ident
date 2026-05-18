package main

import (
	"encoding/json"
	"fmt"
	"testing"
)

func BenchmarkNormalizeProducerAircraft(b *testing.B) {
	ac := producerAircraft{
		Hex:            "abc123",
		Type:           "adsb_icao",
		Flight:         "TEST123 ",
		Registration:   "N12345",
		TypeDesignator: "B738",
		Desc:           "Test aircraft",
		Operator:       "Example Air",
		Category:       "A3",
		Lat:            float64Ptr(34.1),
		Lon:            float64Ptr(-118.2),
		SeenPos:        float64Ptr(1.5),
		AltBaro:        json.RawMessage(`34000`),
		AltGeom:        float64Ptr(34200),
		GS:             float64Ptr(440),
		Track:          float64Ptr(275),
		BaroRate:       float64Ptr(128),
		WindSpeed:      float64Ptr(42),
		WindDir:        float64Ptr(250),
		OAT:            float64Ptr(-45),
		Squawk:         "1200",
		NavQNH:         float64Ptr(1013.25),
		NavAltMCP:      float64Ptr(36000),
		Version:        intPtr(2),
		Messages:       float64Ptr(42),
		Seen:           float64Ptr(0.2),
		RSSI:           float64Ptr(-18.5),
		DBFlags:        uint16Ptr(1),
		MLAT:           []string{"lat", "lon"},
		TISB:           []string{"callsign"},
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, _, ok := normalizeProducerAircraft(ac); !ok {
			b.Fatal("normalize failed")
		}
	}
}

func BenchmarkIngestAircraftJSONWithFrame(b *testing.B) {
	n := NewProducerStatusNormalizer()
	n.IngestReceiverJSON([]byte(`{"version":"dump1090-fa 10.2"}`))
	body := benchmarkAircraftFrameJSON(250)

	b.ReportAllocs()
	b.SetBytes(int64(len(body)))
	for i := 0; i < b.N; i++ {
		if _, frame := n.IngestAircraftJSONWithFrame(body); frame == nil || len(frame.Aircraft) != 250 {
			b.Fatal("missing normalized frame")
		}
	}
}

func benchmarkAircraftFrameJSON(count int) []byte {
	type benchAircraft struct {
		Hex       string   `json:"hex"`
		Type      string   `json:"type"`
		Flight    string   `json:"flight"`
		Lat       float64  `json:"lat"`
		Lon       float64  `json:"lon"`
		AltBaro   float64  `json:"alt_baro"`
		AltGeom   float64  `json:"alt_geom"`
		GS        float64  `json:"gs"`
		Track     float64  `json:"track"`
		SeenPos   float64  `json:"seen_pos"`
		RSSI      float64  `json:"rssi"`
		Messages  int      `json:"messages"`
		MLAT      []string `json:"mlat,omitempty"`
		DBFlags   uint16   `json:"dbFlags,omitempty"`
		Alert     int      `json:"alert,omitempty"`
		SPI       int      `json:"spi,omitempty"`
		UAT       int      `json:"uat_version,omitempty"`
		NavAltMCP int      `json:"nav_altitude_mcp,omitempty"`
	}
	frame := struct {
		Now      float64         `json:"now"`
		Messages int             `json:"messages"`
		Aircraft []benchAircraft `json:"aircraft"`
	}{
		Now:      1_700_000_000,
		Messages: count * 10,
		Aircraft: make([]benchAircraft, 0, count),
	}
	for i := 0; i < count; i++ {
		frame.Aircraft = append(frame.Aircraft, benchAircraft{
			Hex:       fmt.Sprintf("%06x", i+1),
			Type:      "adsb_icao",
			Flight:    fmt.Sprintf("TEST%03d", i),
			Lat:       34 + float64(i%20)/100,
			Lon:       -118 - float64(i%20)/100,
			AltBaro:   1000 + float64(i*100),
			AltGeom:   1100 + float64(i*100),
			GS:        120 + float64(i%80),
			Track:     float64(i % 360),
			SeenPos:   float64(i % 5),
			RSSI:      -30 + float64(i%10),
			Messages:  i * 3,
			MLAT:      []string{"lat", "lon"},
			DBFlags:   uint16(i % 2),
			Alert:     i % 2,
			SPI:       (i + 1) % 2,
			UAT:       i % 4,
			NavAltMCP: 30000,
		})
	}
	body, err := json.Marshal(frame)
	if err != nil {
		panic(err)
	}
	return body
}

func intPtr(v int) *int {
	return &v
}

func uint16Ptr(v uint16) *uint16 {
	return &v
}
