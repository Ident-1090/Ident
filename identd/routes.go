package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// Route lookup cache. The cache accepts callsigns seen in aircraft.json
// frames, coalesces them into ~250 ms batches, and posts them to the
// upstream routeset endpoint (adsb.im by default). Results are cached
// for the life of the callsign plus a TTL grace window (default 5 min
// after the callsign was last seen), so bursts of requests for the same
// flight coalesce to a single upstream call.
//
// Upstream fetches are only performed while at least one WebSocket
// client is connected; otherwise queued lookups are held and flushed
// when a client arrives.

const (
	defaultRouteTTL         = 5 * time.Minute
	defaultRouteBatchDelay  = 250 * time.Millisecond
	routeJanitorInterval    = 30 * time.Second
	defaultRouteUpstreamURL = "https://adsb.im/api/0/routeset"
	routeBatchMaxSize       = 100
	routeHTTPTimeout        = 15 * time.Second
)

type RouteResult struct {
	Origin      string
	Destination string
	Route       string
	// Known is true when the upstream gave us an affirmative answer (even
	// if that answer was "no route"); false while the entry only records
	// that we've seen the callsign and are waiting on a fetch.
	Known bool
	// NoRoute is the "we asked, upstream didn't know" sentinel — used to
	// skip repeat fetches until TTL eviction.
	NoRoute bool
}

type routeEntry struct {
	result     RouteResult
	fetchedAt  time.Time
	lastSeenAt time.Time
}

type routePublisher interface {
	PublishRoute(env []byte)
	ClientCount() int
}

// RouteCache stores the known routes and drives upstream fetching.
type RouteCache struct {
	mu      sync.Mutex
	entries map[string]*routeEntry
	pending map[string]struct{} // callsigns waiting to be fetched

	ttl         time.Duration
	batchDelay  time.Duration
	upstreamURL string

	hub    routePublisher
	client *http.Client
	now    func() time.Time
}

type RouteCacheOptions struct {
	TTL         time.Duration
	BatchDelay  time.Duration
	UpstreamURL string
	HTTPClient  *http.Client
	Now         func() time.Time
}

func NewRouteCache(hub routePublisher, opts RouteCacheOptions) *RouteCache {
	if opts.TTL <= 0 {
		opts.TTL = defaultRouteTTL
	}
	if opts.BatchDelay <= 0 {
		opts.BatchDelay = defaultRouteBatchDelay
	}
	if opts.UpstreamURL == "" {
		opts.UpstreamURL = defaultRouteUpstreamURL
	}
	if opts.HTTPClient == nil {
		opts.HTTPClient = &http.Client{Timeout: routeHTTPTimeout}
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &RouteCache{
		entries:     map[string]*routeEntry{},
		pending:     map[string]struct{}{},
		ttl:         opts.TTL,
		batchDelay:  opts.BatchDelay,
		upstreamURL: opts.UpstreamURL,
		hub:         hub,
		client:      opts.HTTPClient,
		now:         opts.Now,
	}
}

// Track records that the given callsigns were just seen in an aircraft
// frame. Unknown callsigns are queued for upstream lookup; known ones
// have their lastSeenAt refreshed so the janitor leaves them alone.
func (c *RouteCache) Track(callsigns []string) {
	if len(callsigns) == 0 {
		return
	}
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, raw := range callsigns {
		cs := normalizeCallsign(raw)
		if cs == "" {
			continue
		}
		if e, ok := c.entries[cs]; ok {
			e.lastSeenAt = now
			continue
		}
		c.pending[cs] = struct{}{}
	}
}

func normalizeCallsign(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// RouteSnapshots returns the single snapshot envelope ({"type":"routes",
// "data":[…]}) containing every currently-known affirmative route in
// deterministic (sorted by callsign) order. Used for snapshot-on-connect.
// Returns an empty slice when the cache has nothing to send so the server
// doesn't queue a no-op.
func (c *RouteCache) RouteSnapshots() [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	keys := make([]string, 0, len(c.entries))
	for k, e := range c.entries {
		if !e.result.Known || e.result.NoRoute {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return nil
	}
	entries := make([]routeEnvEntry, 0, len(keys))
	for _, k := range keys {
		entries = append(entries, routeEnvEntryFromResult(k, c.entries[k].result))
	}
	return [][]byte{buildRoutesEnvelope(entries, c.now())}
}

// Run starts the batch fetcher and janitor goroutines; both exit when
// ctx is cancelled. Safe to call exactly once per cache.
func (c *RouteCache) Run(ctx context.Context) {
	go c.runFetcher(ctx)
	go c.runJanitor(ctx)
}

func (c *RouteCache) runFetcher(ctx context.Context) {
	t := time.NewTicker(c.batchDelay)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.tickFetch(ctx)
		}
	}
}

func (c *RouteCache) tickFetch(ctx context.Context) {
	if c.hub.ClientCount() == 0 {
		return
	}
	batch := c.drainPending()
	if len(batch) == 0 {
		return
	}
	c.fetchBatch(ctx, batch)
}

func (c *RouteCache) drainPending() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.pending) == 0 {
		return nil
	}
	out := make([]string, 0, len(c.pending))
	for cs := range c.pending {
		out = append(out, cs)
		if len(out) >= routeBatchMaxSize {
			break
		}
	}
	for _, cs := range out {
		delete(c.pending, cs)
	}
	sort.Strings(out)
	return out
}

func (c *RouteCache) requeue(callsigns []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, cs := range callsigns {
		// Only requeue if we don't have an affirmative entry already.
		if e, ok := c.entries[cs]; ok && e.result.Known {
			continue
		}
		c.pending[cs] = struct{}{}
	}
}

type routePlaneReq struct {
	Callsign string `json:"callsign"`
}

type routePayload struct {
	Planes []routePlaneReq `json:"planes"`
}

func (c *RouteCache) fetchBatch(ctx context.Context, callsigns []string) {
	body, err := json.Marshal(routePayload{Planes: func() []routePlaneReq {
		p := make([]routePlaneReq, 0, len(callsigns))
		for _, cs := range callsigns {
			p = append(p, routePlaneReq{Callsign: cs})
		}
		return p
	}()})
	if err != nil {
		c.requeue(callsigns)
		return
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.upstreamURL, bytes.NewReader(body))
	if err != nil {
		log.Printf("routes: build request: %v", err)
		c.requeue(callsigns)
		return
	}
	req.Header.Set("Content-Type", "application/json; charset=UTF-8")
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		log.Printf("routes: upstream %s unreachable (%d callsigns requeued): %v", c.upstreamURL, len(callsigns), err)
		c.requeue(callsigns)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// Upstream replied "don't know" — cache the negative so we skip.
		c.storeBatch(callsigns, map[string]RouteResult{})
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Transient (4xx other than 404, 5xx) — retry next tick.
		log.Printf("routes: upstream %s returned HTTP %d (%d callsigns requeued)", c.upstreamURL, resp.StatusCode, len(callsigns))
		c.requeue(callsigns)
		return
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("routes: reading upstream body: %v", err)
		c.requeue(callsigns)
		return
	}
	results := parseRoutesetResponse(raw, callsigns)
	c.storeBatch(callsigns, results)
}

// storeBatch writes fetch results, emits a single batched envelope for
// affirmative answers, and stores a "known-no-route" sentinel for
// callsigns missing from the response.
func (c *RouteCache) storeBatch(callsigns []string, results map[string]RouteResult) {
	now := c.now()
	entries := make([]routeEnvEntry, 0, len(callsigns))

	c.mu.Lock()
	for _, cs := range callsigns {
		r, ok := results[cs]
		if !ok {
			r = RouteResult{Known: true, NoRoute: true}
		} else {
			r.Known = true
		}
		entry := c.entries[cs]
		if entry == nil {
			entry = &routeEntry{lastSeenAt: now}
			c.entries[cs] = entry
		}
		entry.result = r
		entry.fetchedAt = now
		if entry.lastSeenAt.IsZero() {
			entry.lastSeenAt = now
		}
		if !r.NoRoute {
			entries = append(entries, routeEnvEntryFromResult(cs, r))
		}
	}
	c.mu.Unlock()

	if len(entries) > 0 {
		c.hub.PublishRoute(buildRoutesEnvelope(entries, now))
	}
}

// runJanitor evicts stale entries (lastSeenAt older than TTL) every
// routeJanitorInterval and emits a drop envelope so clients can clear
// their own cache for the evicted callsign.
func (c *RouteCache) runJanitor(ctx context.Context) {
	t := time.NewTicker(routeJanitorInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c.sweep()
		}
	}
}

func (c *RouteCache) sweep() {
	now := c.now()
	cutoff := now.Add(-c.ttl)
	var dropped []string

	c.mu.Lock()
	for cs, e := range c.entries {
		if e.lastSeenAt.Before(cutoff) {
			dropped = append(dropped, cs)
			delete(c.entries, cs)
		}
	}
	c.mu.Unlock()

	if len(dropped) == 0 {
		return
	}
	sort.Strings(dropped)
	entries := make([]routeEnvEntry, 0, len(dropped))
	for _, cs := range dropped {
		entries = append(entries, routeEnvEntry{Callsign: cs, Dropped: true})
	}
	c.hub.PublishRoute(buildRoutesEnvelope(entries, now))
}

// routeEnvEntry is a single entry in a `routes` envelope's `data` array.
// Affirmative routes carry origin/destination (and optionally a route
// string); eviction entries carry only Callsign + Dropped=true.
type routeEnvEntry struct {
	Callsign    string `json:"callsign"`
	Origin      string `json:"origin,omitempty"`
	Destination string `json:"destination,omitempty"`
	Route       string `json:"route,omitempty"`
	Dropped     bool   `json:"dropped,omitempty"`
}

func routeEnvEntryFromResult(callsign string, r RouteResult) routeEnvEntry {
	return routeEnvEntry{
		Callsign:    callsign,
		Origin:      r.Origin,
		Destination: r.Destination,
		Route:       r.Route,
	}
}

func buildRoutesEnvelope(entries []routeEnvEntry, now time.Time) []byte {
	type routesEnv struct {
		Type string          `json:"type"`
		Now  int64           `json:"now"`
		Data []routeEnvEntry `json:"data"`
	}
	b, _ := json.Marshal(routesEnv{
		Type: "routes",
		Now:  now.Unix(),
		Data: entries,
	})
	return b
}

// parseRoutesetResponse mirrors the frontend's loose parser
// (ident/src/inspector/route.ts) — the upstream returns various shapes
// (top-level array, {routes:[]}, {planes:[]}, {_airports:[], <cs>:{...}},
// etc.), and we collect origin/destination/route codes where we can.
// Callsigns absent from the response map to "no route known".
func parseRoutesetResponse(raw []byte, callsigns []string) map[string]RouteResult {
	out := map[string]RouteResult{}
	wanted := map[string]struct{}{}
	for _, cs := range callsigns {
		wanted[cs] = struct{}{}
	}

	var asArray []map[string]any
	if err := json.Unmarshal(raw, &asArray); err == nil {
		for _, item := range asArray {
			collectRouteRecord(out, item, nil, "", wanted)
		}
		return out
	}

	var asObj map[string]any
	if err := json.Unmarshal(raw, &asObj); err != nil {
		return out
	}

	airports, _ := asObj["_airports"].([]any)
	collectRouteRecord(out, asObj, airports, "", wanted)

	for _, key := range []string{"routes", "planes", "results", "data"} {
		bucket, ok := asObj[key].([]any)
		if !ok {
			continue
		}
		for _, item := range bucket {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			collectRouteRecord(out, m, airports, "", wanted)
		}
	}

	for cs := range wanted {
		top, ok := asObj[cs].(map[string]any)
		if !ok {
			continue
		}
		collectRouteRecord(out, top, airports, cs, wanted)
	}

	return out
}

func collectRouteRecord(
	out map[string]RouteResult,
	record map[string]any,
	airports []any,
	fallbackCallsign string,
	wanted map[string]struct{},
) {
	recordAirports := airports
	if list, ok := record["_airports"].([]any); ok {
		recordAirports = list
	}

	var cs string
	for _, key := range []string{"callsign", "flight", "ident", "callsign_icao"} {
		if v, ok := record[key].(string); ok && strings.TrimSpace(v) != "" {
			cs = normalizeCallsign(v)
			break
		}
	}
	if cs == "" {
		cs = normalizeCallsign(fallbackCallsign)
	}
	if cs == "" {
		return
	}
	if _, ok := wanted[cs]; !ok {
		return
	}

	routeCodes := extractRouteCodes(record, recordAirports)
	origin := resolveAirport(lookupAny(record, "origin", "from", "departure", "dep", "airport1"), recordAirports)
	destination := resolveAirport(lookupAny(record, "destination", "to", "arrival", "arr", "airport2"), recordAirports)

	var route string
	if len(routeCodes) > 0 {
		route = strings.Join(routeCodes, "-")
	} else if origin != "" && destination != "" {
		route = origin + "-" + destination
	} else if origin != "" {
		route = origin
	} else if destination != "" {
		route = destination
	}

	firstCode := ""
	lastCode := ""
	if len(routeCodes) > 0 {
		firstCode = routeCodes[0]
		lastCode = routeCodes[len(routeCodes)-1]
	}
	if origin == "" && destination == "" && firstCode == "" && lastCode == "" {
		return
	}
	if origin == "" {
		if firstCode != "" {
			origin = firstCode
		} else {
			origin = "—"
		}
	}
	if destination == "" {
		if lastCode != "" {
			destination = lastCode
		} else {
			destination = "—"
		}
	}

	out[cs] = RouteResult{Origin: origin, Destination: destination, Route: route}
}

func lookupAny(record map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := record[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func extractRouteCodes(record map[string]any, airports []any) []string {
	var src []any
	if list, ok := record["_airports"].([]any); ok && len(list) > 0 {
		src = list
	} else if list, ok := record["airports"].([]any); ok && len(list) > 0 {
		src = list
	} else {
		src = airports
	}
	codes := make([]string, 0, len(src))
	for _, a := range src {
		if c := formatAirport(a); isUsableRouteCode(c) {
			codes = append(codes, c)
		}
	}
	if len(codes) > 0 {
		return codes
	}

	for _, key := range []string{"_airport_codes_iata", "airport_codes"} {
		if v, ok := record[key].(string); ok {
			parts := strings.Split(v, "-")
			out := make([]string, 0, len(parts))
			for _, p := range parts {
				up := strings.ToUpper(strings.TrimSpace(p))
				if isUsableRouteCode(up) {
					out = append(out, up)
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return nil
}

func resolveAirport(value any, airports []any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case float64:
		idx := int(v)
		if float64(idx) == v && idx >= 0 && idx < len(airports) {
			return formatAirport(airports[idx])
		}
		return ""
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return ""
		}
		if allDigits(s) {
			var idx int
			for _, ch := range s {
				idx = idx*10 + int(ch-'0')
			}
			if idx >= 0 && idx < len(airports) {
				return formatAirport(airports[idx])
			}
		}
		up := strings.ToUpper(s)
		if isUsableRouteCode(up) {
			return up
		}
		return ""
	case map[string]any:
		return formatAirport(v)
	}
	return ""
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}

func formatAirport(value any) string {
	m, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	for _, key := range []string{"iata", "icao", "code"} {
		if v, ok := m[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.ToUpper(strings.TrimSpace(v))
		}
	}
	return ""
}

func isUsableRouteCode(s string) bool {
	if s == "" {
		return false
	}
	return !strings.EqualFold(s, "unknown")
}
