package main

import (
	"testing"
)

func TestHubSnapshot(t *testing.T) {
	h := NewHub([]string{"aircraft", "receiver"})
	if len(h.Snapshots()) != 0 {
		t.Fatalf("empty hub should have no snapshots")
	}
	h.Publish("aircraft", []byte(`{"ok":1}`))
	snaps := h.Snapshots()
	if len(snaps) != 1 {
		t.Fatalf("expected 1 snapshot, got %d", len(snaps))
	}
	got := string(snaps[0])
	want := `{"type":"aircraft","data":{"ok":1}}`
	if got != want {
		t.Fatalf("snapshot = %q, want %q", got, want)
	}
}

func TestHubSnapshotOrder(t *testing.T) {
	h := NewHub([]string{"aircraft", "receiver", "stats", "outline"})
	// publish in reverse of declared order
	h.Publish("outline", []byte(`{"o":1}`))
	h.Publish("stats", []byte(`{"s":1}`))
	h.Publish("receiver", []byte(`{"r":1}`))
	h.Publish("aircraft", []byte(`{"a":1}`))
	snaps := h.Snapshots()
	if len(snaps) != 4 {
		t.Fatalf("expected 4 snapshots, got %d", len(snaps))
	}
	if string(snaps[0]) != `{"type":"aircraft","data":{"a":1}}` {
		t.Fatalf("[0] = %s", snaps[0])
	}
	if string(snaps[3]) != `{"type":"outline","data":{"o":1}}` {
		t.Fatalf("[3] = %s", snaps[3])
	}
}

func TestHubSlowClientDropped(t *testing.T) {
	h := NewHub([]string{"aircraft"})
	c := &Client{send: make(chan []byte, defaultQueueDepth)}
	h.Add(c)

	for i := 0; i < defaultQueueDepth; i++ {
		h.Publish("aircraft", []byte{'{', byte('a' + i), ':', '1', '}'})
	}
	if h.ClientCount() != 1 {
		t.Fatalf("client should still be connected after filling queue")
	}

	h.Publish("aircraft", []byte(`{"overflow":1}`))

	if h.ClientCount() != 0 {
		t.Fatalf("slow client not dropped; clients=%d", h.ClientCount())
	}
}

func TestWrapEnvelope(t *testing.T) {
	got := wrapEnvelope("stats", []byte(`{"now":1}`))
	want := `{"type":"stats","data":{"now":1}}`
	if string(got) != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}
