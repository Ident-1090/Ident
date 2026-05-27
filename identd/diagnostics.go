package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// Diagnostic identity is the (channel, code, scope) tuple. Re-emission with
// the same identity refreshes TTL and updates the mutable fields
// (severity, message, actionLabel, actionUrl).
//
// Lifecycle: TTL-refreshed-by-re-emission. Stop emitting → TTL expires → entry
// removed. A TTL of zero means the entry never expires until the process
// restarts.

const (
	// Default storage cap. When exceeded, FIFO eviction removes the oldest
	// entry and a self-describing meta-diagnostic is emitted.
	defaultDiagnosticStoreCap = 200

	// Default debounce window for publishing snapshots after store mutations.
	defaultDiagnosticDebounce = 100 * time.Millisecond

	// Default TTLs by category. Callers pick the category that matches their
	// re-emission cadence via WithTTL or rely on these defaults.
	defaultDiagnosticConditionTTL = 30 * time.Second
	defaultDiagnosticEventTTL     = 5 * time.Minute
	defaultDiagnosticMetaTTL      = 5 * time.Minute
	// receiverConditionTTL covers diagnostics whose underlying state is
	// receiver.json. receiver.json is event-driven (the file may not
	// change for hours), so the heartbeat in main.go re-emits active
	// conditions every reemitReceiverInterval to refresh the window. TTL
	// is set comfortably above the heartbeat interval so a single missed
	// tick (load spike, GC pause) doesn't drop the entry; condition truly
	// resolving still drops the entry within ~TTL of the last re-emit.
	receiverConditionTTL            = 15 * time.Minute
	reemitReceiverInterval          = 5 * time.Minute
	producerSelectionReemitInterval = 30 * time.Second

	diagnosticSweepInterval = time.Second
)

type diagnosticSeverity string

const (
	severityInfo    diagnosticSeverity = "info"
	severityWarning diagnosticSeverity = "warning"
	severityError   diagnosticSeverity = "error"
)

type diagnosticKey struct {
	channel string
	code    string
	scope   string
}

type diagnosticEntry struct {
	key       diagnosticKey
	severity  diagnosticSeverity
	message   string
	action    *diagnosticAction
	ttl       time.Duration
	seenAt    time.Time
	expiresAt time.Time
	order     uint64
}

// diagnosticAction is an atomic label+URL pair. The two fields only make sense
// together: a label without a URL is unclickable, a URL without a label can't
// describe itself. Pairing them in a single nullable pointer prevents
// partially-populated states on the wire and in the store.
type diagnosticAction struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

// diagnostic is the on-wire shape used inside the diagnostics envelope.
// Identity fields (channel, code, scope) are first; mutable fields (severity,
// message, action) follow. scope is omitted from the wire when empty so
// single-instance diagnostics stay clean.
type diagnostic struct {
	Severity      diagnosticSeverity `json:"severity"`
	Channel       string             `json:"channel"`
	Code          string             `json:"code"`
	Scope         string             `json:"scope,omitempty"`
	Message       string             `json:"message"`
	Action        *diagnosticAction  `json:"action,omitempty"`
	SeenAtEpochMs int64              `json:"seenAtEpochMs"`
}

type diagnosticOptions struct {
	ttl       time.Duration
	scope     string
	action    *diagnosticAction
	hasTTL    bool
	hasAction bool
}

// DiagnosticOpt configures one Note call. Options are independent; callers
// can mix and match WithTTL, WithScope, and WithActionLink.
type DiagnosticOpt func(*diagnosticOptions)

// WithTTL overrides the default TTL for an emission. A TTL of zero means the
// entry never expires until the process restarts.
func WithTTL(ttl time.Duration) DiagnosticOpt {
	return func(o *diagnosticOptions) {
		o.ttl = ttl
		o.hasTTL = true
	}
}

// WithScope attaches a per-instance scope to the identity. Two diagnostics
// with the same channel+code but different scopes coexist; re-emitting one
// scope does not displace the other.
func WithScope(scope string) DiagnosticOpt {
	return func(o *diagnosticOptions) {
		o.scope = scope
	}
}

// WithActionLink attaches a user-facing action label and URL. Empty strings
// for both fields clear any previously-attached link on re-emission.
func WithActionLink(label, url string) DiagnosticOpt {
	return func(o *diagnosticOptions) {
		o.hasAction = true
		if label == "" && url == "" {
			o.action = nil
			return
		}
		o.action = &diagnosticAction{Label: label, URL: url}
	}
}

// parseSeverity narrows a wire-string severity to the typed enum. Returns
// (zero, false) when the input is not a recognized severity literal so the
// caller can decide whether to fall back, log, or skip.
func parseSeverity(raw string) (diagnosticSeverity, bool) {
	switch diagnosticSeverity(raw) {
	case severityInfo:
		return severityInfo, true
	case severityWarning:
		return severityWarning, true
	case severityError:
		return severityError, true
	default:
		return "", false
	}
}

// DiagnosticPublisher receives the wire envelope when the store decides to
// publish a snapshot. The store debounces calls; the publisher receives at
// most one envelope per debounce window.
type DiagnosticPublisher func([]byte)

// DiagnosticStoreOptions configures the store. All fields have defaults; the
// zero value is usable.
type DiagnosticStoreOptions struct {
	// Cap bounds the in-memory entry count. Exceeding the cap triggers FIFO
	// eviction and a meta-diagnostic. Zero uses defaultDiagnosticStoreCap.
	Cap int

	// Debounce coalesces bursty Note calls into a single publish. Zero uses
	// defaultDiagnosticDebounce. A negative value disables debouncing
	// (every Note that changes state publishes immediately).
	Debounce time.Duration

	// DefaultTTL is applied when a Note call omits WithTTL. Zero uses
	// defaultDiagnosticConditionTTL so conditions re-emitted on a polling
	// cadence behave correctly without per-call configuration.
	DefaultTTL time.Duration

	// MetaTTL controls how long the capacity-exceeded meta-diagnostic
	// remains visible after each eviction event.
	MetaTTL time.Duration

	// Publish is invoked when the store decides to broadcast. May be nil
	// during tests; callers can drive publishing through Snapshot directly.
	Publish DiagnosticPublisher

	// Now overrides the clock used for TTL bookkeeping. Tests inject this
	// to drive deterministic expiry without sleeping.
	Now func() time.Time
}

// DiagnosticStore is the single source of truth for live diagnostics in
// identd. It enforces identity-based replacement, TTL expiry, and bounded
// storage with loud eviction, then publishes the full snapshot through a
// debounced channel.
type DiagnosticStore struct {
	mu         sync.Mutex
	entries    map[diagnosticKey]*diagnosticEntry
	cap        int
	debounce   time.Duration
	defaultTTL time.Duration
	metaTTL    time.Duration
	publish    DiagnosticPublisher
	now        func() time.Time
	nextOrder  uint64

	debounceTimer *time.Timer
	dirty         bool
	stopCh        chan struct{}
	stopOnce      sync.Once
	// stopped short-circuits Note / schedulePublish after Stop. Background
	// goroutines (update poller, receiver heartbeat) racing a Note() after
	// Stop would otherwise re-arm the debounce timer and push one more
	// envelope through the hub after the final flush.
	stopped bool
}

// NewDiagnosticStore constructs a store with the supplied options. The
// caller is responsible for calling Run with a context if it wants
// background TTL sweeping; otherwise expiry happens lazily on every
// Snapshot / Note call.
func NewDiagnosticStore(opts DiagnosticStoreOptions) *DiagnosticStore {
	store := &DiagnosticStore{
		entries:    map[diagnosticKey]*diagnosticEntry{},
		cap:        opts.Cap,
		debounce:   opts.Debounce,
		defaultTTL: opts.DefaultTTL,
		metaTTL:    opts.MetaTTL,
		publish:    opts.Publish,
		now:        opts.Now,
		stopCh:     make(chan struct{}),
	}
	if store.cap <= 0 {
		store.cap = defaultDiagnosticStoreCap
	}
	if store.debounce == 0 {
		store.debounce = defaultDiagnosticDebounce
	}
	if store.defaultTTL <= 0 {
		store.defaultTTL = defaultDiagnosticConditionTTL
	}
	if store.metaTTL <= 0 {
		store.metaTTL = defaultDiagnosticMetaTTL
	}
	if store.now == nil {
		store.now = time.Now
	}
	return store
}

// Note records a diagnostic under the (channel, code, scope) identity. Empty
// channel or code is treated as a programmer error: it logs at error level
// and returns false without touching the store, so the zero-value key can't
// collide with real entries. Returns true when the snapshot changed (new
// identity, or mutable fields differ from the previous emission); false when
// re-emission produced the same content (TTL is still refreshed in that case).
func (s *DiagnosticStore) Note(channel, code string, severity diagnosticSeverity, message string, opts ...DiagnosticOpt) bool {
	if s == nil {
		return false
	}
	if channel == "" || code == "" {
		slog.Error("diagnostics: Note called with empty identity",
			"channel", channel,
			"code", code,
			"severity", string(severity),
			"message", message,
		)
		return false
	}
	cfg := diagnosticOptions{}
	for _, opt := range opts {
		opt(&cfg)
	}
	ttl := s.defaultTTL
	if cfg.hasTTL {
		ttl = cfg.ttl
	}
	key := diagnosticKey{channel: channel, code: code, scope: cfg.scope}
	entry := diagnosticEntry{
		key:      key,
		severity: severity,
		message:  message,
		action:   cfg.action,
		ttl:      ttl,
	}
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return false
	}
	changed := s.noteLocked(entry)
	s.mu.Unlock()
	if changed {
		s.schedulePublish()
	}
	return changed
}

func (s *DiagnosticStore) noteLocked(entry diagnosticEntry) bool {
	now := s.now()
	entry.seenAt = now
	if entry.ttl > 0 {
		entry.expiresAt = now.Add(entry.ttl)
	}
	s.nextOrder++
	entry.order = s.nextOrder
	s.pruneExpiredLocked(now)
	previous, existed := s.entries[entry.key]
	changed := !existed || !entrySnapshotEqual(previous, &entry)
	s.entries[entry.key] = &entry
	if !existed && len(s.entries) > s.cap {
		s.evictOldestLocked(now)
	}
	if changed {
		s.dirty = true
	}
	return changed
}

// evictOldestLocked removes the FIFO-oldest non-meta entry and refreshes the
// capacity meta-diagnostic. Meta is excluded from eviction by design so the
// capacity warning is always visible to operators; this means the live entry
// count can overshoot s.cap by 1 (cap real entries plus meta) which is the
// intended trade-off.
func (s *DiagnosticStore) evictOldestLocked(now time.Time) {
	metaKey := diagnosticKey{
		channel: "diagnostics",
		code:    "diagnostics.store.capacity_exceeded",
	}
	oldest := s.removeOldestLocked(metaKey)
	if oldest == nil {
		return
	}
	s.logEviction(now, oldest)
	s.writeCapacityMetaLocked(now, metaKey)
}

func (s *DiagnosticStore) removeOldestLocked(exclude diagnosticKey) *diagnosticEntry {
	var oldestKey diagnosticKey
	var oldest *diagnosticEntry
	for key, entry := range s.entries {
		if key == exclude {
			continue
		}
		if oldest == nil || entry.order < oldest.order {
			oldestKey = key
			oldest = entry
		}
	}
	if oldest == nil {
		return nil
	}
	delete(s.entries, oldestKey)
	return oldest
}

func (s *DiagnosticStore) logEviction(now time.Time, oldest *diagnosticEntry) {
	slog.Warn("diagnostics: cap reached, dropping oldest",
		"channel", oldest.key.channel,
		"code", oldest.key.code,
		"scope", oldest.key.scope,
		"severity", string(oldest.severity),
		"ageSec", now.Sub(oldest.seenAt).Seconds(),
	)
}

func (s *DiagnosticStore) writeCapacityMetaLocked(now time.Time, key diagnosticKey) {
	meta := diagnosticEntry{
		key:      key,
		severity: severityWarning,
		message:  "Diagnostic store at capacity; oldest entries are being dropped.",
		ttl:      s.metaTTL,
		seenAt:   now,
	}
	if meta.ttl > 0 {
		meta.expiresAt = now.Add(meta.ttl)
	}
	s.nextOrder++
	meta.order = s.nextOrder
	s.entries[meta.key] = &meta
	s.dirty = true
}

// Snapshot returns the current live diagnostics, sorted by identity for
// deterministic output. Expired entries are pruned as a side effect.
func (s *DiagnosticStore) Snapshot() []diagnostic {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneExpiredLocked(s.now())
	return s.snapshotLocked()
}

func (s *DiagnosticStore) snapshotLocked() []diagnostic {
	out := make([]diagnostic, 0, len(s.entries))
	for _, entry := range s.entries {
		out = append(out, diagnostic{
			Severity:      entry.severity,
			Channel:       entry.key.channel,
			Code:          entry.key.code,
			Scope:         entry.key.scope,
			Message:       entry.message,
			Action:        cloneDiagnosticAction(entry.action),
			SeenAtEpochMs: entry.seenAt.UnixMilli(),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Channel != out[j].Channel {
			return out[i].Channel < out[j].Channel
		}
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return out[i].Scope < out[j].Scope
	})
	return out
}

func cloneDiagnosticAction(action *diagnosticAction) *diagnosticAction {
	if action == nil {
		return nil
	}
	clone := *action
	return &clone
}

func (s *DiagnosticStore) pruneExpiredLocked(now time.Time) {
	for key, entry := range s.entries {
		if entry.ttl <= 0 {
			continue
		}
		if !entry.expiresAt.After(now) {
			delete(s.entries, key)
			s.dirty = true
		}
	}
}

// Tick prunes expired entries and publishes a snapshot if anything changed
// since the last publish. Called by the background sweeper but safe to call
// from tests directly.
func (s *DiagnosticStore) Tick() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.pruneExpiredLocked(s.now())
	changed := s.dirty
	s.mu.Unlock()
	if changed {
		s.schedulePublish()
	}
}

// Run drives background expiry-driven publishing. The store remains usable
// without Run; callers that skip Run get expiry only on Note/Snapshot.
func (s *DiagnosticStore) Run(ctx context.Context) {
	if s == nil {
		return
	}
	ticker := time.NewTicker(diagnosticSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.Tick()
		}
	}
}

// Stop cancels the background sweeper and flushes any pending publish so
// shutdown does not strand subscribers with a stale snapshot. The debounce
// timer is cancelled before the sync flush so a pending AfterFunc cannot
// publish concurrently with Stop and reorder the final snapshot.
func (s *DiagnosticStore) Stop() {
	if s == nil {
		return
	}
	s.stopOnce.Do(func() {
		close(s.stopCh)
	})
	s.mu.Lock()
	s.stopped = true
	if s.debounceTimer != nil {
		s.debounceTimer.Stop()
	}
	s.mu.Unlock()
	s.flushPublish()
}

func (s *DiagnosticStore) schedulePublish() {
	if s.publish == nil {
		return
	}
	if s.debounce <= 0 {
		s.flushPublish()
		return
	}
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	if s.debounceTimer == nil {
		s.debounceTimer = time.AfterFunc(s.debounce, s.flushPublish)
	} else {
		s.debounceTimer.Reset(s.debounce)
	}
	s.mu.Unlock()
}

func (s *DiagnosticStore) flushPublish() {
	s.mu.Lock()
	if !s.dirty || s.publish == nil {
		s.mu.Unlock()
		return
	}
	snapshot := s.snapshotLocked()
	if s.debounceTimer != nil {
		s.debounceTimer.Stop()
	}
	publish := s.publish
	s.mu.Unlock()
	env, err := marshalDiagnosticsEnvelope(snapshot)
	if err != nil {
		// Keep dirty=true so the next Tick retries the publish; clearing
		// the flag before a successful marshal would silently drop the
		// snapshot on transient marshal failure.
		slog.Error("diagnostics: marshal envelope", "err", err)
		return
	}
	s.mu.Lock()
	s.dirty = false
	s.mu.Unlock()
	publish(env)
}

func entrySnapshotEqual(a, b *diagnosticEntry) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.severity == b.severity &&
		a.message == b.message &&
		diagnosticActionEqual(a.action, b.action)
}

func diagnosticActionEqual(a, b *diagnosticAction) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Label == b.Label && a.URL == b.URL
}

// identDiagnostics is the wire envelope payload for ident.diagnostics.v1.
type identDiagnostics struct {
	Schema      string       `json:"schema"`
	Diagnostics []diagnostic `json:"diagnostics"`
}

func newIdentDiagnostics(diagnostics []diagnostic) identDiagnostics {
	if diagnostics == nil {
		diagnostics = []diagnostic{}
	}
	return identDiagnostics{
		Schema:      "ident.diagnostics.v1",
		Diagnostics: diagnostics,
	}
}

func marshalDiagnosticsEnvelope(diagnostics []diagnostic) ([]byte, error) {
	body, err := json.Marshal(newIdentDiagnostics(diagnostics))
	if err != nil {
		return nil, err
	}
	return wrapEnvelope("diagnostics", body), nil
}
