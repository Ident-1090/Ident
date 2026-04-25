package main

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

const defaultQueueDepth = 8

// Hub multiplexes multiple named channels over a shared client set.
// Each channel keeps its latest pre-wrapped envelope for snapshot-on-connect.
// Frames are delivered as text WebSocket messages to all connected clients.
//
// Channels come in two flavors:
//   - "single" channels (aircraft/receiver/stats/outline) keep one latest
//     envelope. Publishing overwrites; snapshot-on-connect sends that one.
//   - "provider" channels (routes/trails) accept pre-built envelopes one at
//     a time and expose snapshots through pluggable providers.
type Hub struct {
	mu        sync.RWMutex
	clients   map[*Client]struct{}
	channels  map[string][]byte // single-channel: name -> latest envelope bytes
	providers []func() [][]byte
	// Order channels are emitted in on snapshot-on-connect (deterministic).
	order []string
}

type Client struct {
	conn *websocket.Conn
	send chan []byte
}

func NewHub(channels []string) *Hub {
	return &Hub{
		clients:  map[*Client]struct{}{},
		channels: map[string][]byte{},
		order:    append([]string(nil), channels...),
	}
}

// Publish wraps fileBytes in a {"type":name,"data":fileBytes} envelope,
// stores it as the channel's latest snapshot, and broadcasts to all clients.
// fileBytes must already be valid JSON (we don't validate).
func (h *Hub) Publish(name string, fileBytes []byte) {
	if len(fileBytes) == 0 {
		return
	}
	env := wrapEnvelope(name, fileBytes)

	h.mu.Lock()
	h.channels[name] = env
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()

	for _, c := range clients {
		select {
		case c.send <- env:
		default:
			log.Printf("hub: dropping slow client on channel %q (send buffer full)", name)
			h.drop(c)
		}
	}
}

// Snapshots returns the latest envelope for each known channel in declared
// order, followed by provider snapshots. Used to seed newly connected clients.
func (h *Hub) Snapshots() [][]byte {
	h.mu.RLock()
	providers := append([]func() [][]byte(nil), h.providers...)
	out := make([][]byte, 0, len(h.order))
	for _, name := range h.order {
		if env, ok := h.channels[name]; ok {
			out = append(out, append([]byte(nil), env...))
		}
	}
	h.mu.RUnlock()

	for _, provider := range providers {
		for _, env := range provider() {
			out = append(out, append([]byte(nil), env...))
		}
	}
	return out
}

// SetRouteProvider registers a snapshot provider for the `routes`
// multi-envelope channel. Must be called before any client connects.
func (h *Hub) SetRouteProvider(fn func() [][]byte) {
	h.AddSnapshotProvider(fn)
}

func (h *Hub) AddSnapshotProvider(fn func() [][]byte) {
	if fn == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.providers = append(h.providers, fn)
}

// PublishRoute broadcasts a pre-built route envelope (`{"type":"route",
// ...}`) to all connected clients. Unlike Publish, nothing is cached in
// the Hub itself — the RouteCache is the snapshot source of truth via
// SetRouteProvider.
func (h *Hub) PublishRoute(env []byte) {
	h.PublishEnvelope(env, "route")
}

func (h *Hub) PublishEnvelope(env []byte, label string) {
	if len(env) == 0 {
		return
	}
	h.mu.Lock()
	clients := make([]*Client, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.Unlock()

	for _, c := range clients {
		select {
		case c.send <- env:
		default:
			log.Printf("hub: dropping slow client on %s publish (send buffer full)", label)
			h.drop(c)
		}
	}
}

func (h *Hub) Add(c *Client) {
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) Remove(c *Client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
}

func (h *Hub) drop(c *Client) {
	h.Remove(c)
	if c.conn != nil {
		_ = c.conn.Close()
	}
}

func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// wrapEnvelope produces `{"type":"<name>","data":<fileBytes>}` without
// parsing fileBytes — cheap on the relay, trusts the watched file is JSON.
func wrapEnvelope(name string, fileBytes []byte) []byte {
	prefix := []byte(`{"type":"` + name + `","data":`)
	out := make([]byte, 0, len(prefix)+len(fileBytes)+1)
	out = append(out, prefix...)
	out = append(out, fileBytes...)
	out = append(out, '}')
	return out
}
