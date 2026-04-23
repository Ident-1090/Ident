package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	dir      string
	name     string
	debounce time.Duration
	onChange func([]byte)
}

func NewWatcher(path string, debounce time.Duration, onChange func([]byte)) *Watcher {
	return &Watcher{
		dir:      filepath.Dir(path),
		name:     filepath.Base(path),
		debounce: debounce,
		onChange: onChange,
	}
}

func (w *Watcher) path() string { return filepath.Join(w.dir, w.name) }

func (w *Watcher) Run(ctx context.Context) error {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer fw.Close()

	if err := fw.Add(w.dir); err != nil {
		return err
	}

	if b, err := os.ReadFile(w.path()); err == nil {
		w.onChange(b)
	}

	var timer *time.Timer
	fire := func() {
		b, err := os.ReadFile(w.path())
		if err != nil {
			return
		}
		w.onChange(b)
	}
	schedule := func() {
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(w.debounce, fire)
	}

	for {
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return nil
		case err := <-fw.Errors:
			log.Printf("watcher %s: %v", w.name, err)
		case ev, ok := <-fw.Events:
			if !ok {
				return nil
			}
			if filepath.Base(ev.Name) != w.name {
				continue
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Chmod) != 0 {
				schedule()
			}
			if ev.Op&fsnotify.Rename != 0 {
				schedule()
			}
		}
	}
}
