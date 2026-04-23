package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestWatcherInPlaceWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var got [][]byte
	w := NewWatcher(path, 20*time.Millisecond, func(b []byte) {
		mu.Lock()
		got = append(got, append([]byte(nil), b...))
		mu.Unlock()
	})
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()

	time.Sleep(60 * time.Millisecond)

	if err := os.WriteFile(path, []byte("world"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond)

	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if len(got) < 2 {
		t.Fatalf("expected >=2 callbacks, got %d", len(got))
	}
	if string(got[len(got)-1]) != "world" {
		t.Fatalf("final bytes = %q, want world", got[len(got)-1])
	}
}

func TestWatcherAtomicReplace(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "b.txt")
	if err := os.WriteFile(path, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var got [][]byte
	w := NewWatcher(path, 20*time.Millisecond, func(b []byte) {
		mu.Lock()
		got = append(got, append([]byte(nil), b...))
		mu.Unlock()
	})
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	time.Sleep(60 * time.Millisecond)

	tmp := filepath.Join(dir, "b.tmp")
	if err := os.WriteFile(tmp, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(tmp, path); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)

	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	found := false
	for _, b := range got {
		if string(b) == "v2" {
			found = true
		}
	}
	if !found {
		t.Fatalf("v2 never observed; got=%q", got)
	}
}

func TestWatcherDebounce(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "c.txt")
	if err := os.WriteFile(path, []byte("0"), 0o644); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var mu sync.Mutex
	var calls int
	w := NewWatcher(path, 80*time.Millisecond, func(_ []byte) {
		mu.Lock()
		calls++
		mu.Unlock()
	})
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	time.Sleep(60 * time.Millisecond)

	mu.Lock()
	calls = 0
	mu.Unlock()

	for i := 0; i < 5; i++ {
		if err := os.WriteFile(path, []byte{byte('0' + i)}, 0o644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond)

	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	if calls > 2 {
		t.Fatalf("expected debounced calls <=2, got %d", calls)
	}
	if calls == 0 {
		t.Fatalf("expected at least one callback")
	}
}
