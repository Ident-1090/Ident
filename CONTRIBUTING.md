# Contributing to Ident

Ident is built for people running their own ADS-B receivers. Good contributions
keep that audience in mind: the app should be understandable for receiver
owners, predictable for operators, and straightforward to install on common
receiver hosts.

## Before You Open an Issue

Search existing issues and discussions first. If the problem is a security
issue, do not open a public issue; use the private reporting link in
[SECURITY.md](SECURITY.md).

Please do not include private station details in public issues.

Avoid sharing:

- feeder keys or claim tokens
- exact receiver coordinates
- home address or location hints
- private hostnames, tunnel URLs, or local network names
- screenshots that reveal private location details

Use placeholders such as `receiver.local`, `YOUR_LAT`, `YOUR_LON`, and
`YOUR_FEEDER_ID` when an example needs a value.

## Good Bug Reports

For install and compatibility issues, include:

- Ident version
- receiver JSON source: readsb native, dump1090-fa native including PiAware, or
  dump978-fa native including SkyAware978
- operating system and hardware model
- install method: binary, Docker, systemd, Debian package, or source
- path where `aircraft.json` is written
- which optional files exist, such as `receiver.json`, `stats.json`, or
  `outline.json`
- browser and device used for the UI
- relevant `identd` logs

For UI issues, screenshots are useful. Crop or redact anything that reveals a
private receiver location.

## Pull Requests

Keep pull requests focused. A small change with clear behavior, tests, and docs
is easier to review than a broad change that mixes unrelated work.

Expected baseline:

- include tests for behavior changes
- update docs when install, configuration, network access, or user-facing
  behavior changes
- avoid introducing new external services without documenting network access
- do not add station-specific examples or private deployment assumptions
- keep receiver data read-only by default; document and justify any write path

Before opening a pull request, run the checks that apply to your change.

```sh
cd ident
pnpm test
pnpm build

cd ../identd
go test ./...
```

If you cannot run a relevant check, say which check you skipped and why.

### Wire Schemas

Ident-owned WebSocket and HTTP payload schemas live in `schemas/ident/`. They
are generated from the Go wire structs with `github.com/google/jsonschema-go`.

Refresh schemas after changing a wire struct:

```sh
cd identd
IDENT_UPDATE_SCHEMAS=1 go test . -run TestIdentSchemasAreCurrent -count=1
go test . -run TestIdentSchemasAreCurrent -count=1
```

The normal Go test fails when a committed schema is stale, so CI and the local
pre-commit hook both enforce freshness.

### Pre-commit hook

The hook lives at `ident/.husky/pre-commit` and runs three checks: `gofmt`
against `identd/`, `pnpm check-ident-schemas` (the schema-freshness check
above), and `pnpm exec lint-staged` (biome formatting of staged JS/TS/JSON).
Husky installs the hook from `ident/package.json`'s `prepare` script, so you
need to have run `pnpm install` inside `ident/` at least once for the hook to
fire. If your commit fails with "gofmt would rewrite", run `gofmt -w identd/`
and re-stage.

## Development Notes

The release architecture is:

- `ident/`: React web UI
- `identd/`: Go service and embedded release binary
- `packaging/`: Docker, systemd, and package assets

Development can run the frontend and service separately. Release builds embed
the web UI into `identd`.

### Internal configuration

These environment variables exist for development, testing, and operator
overrides. They are intentionally kept out of the user-facing README so the
common installation flow stays short.

- `IDENT_RELAY_ROUTE_UPSTREAM` — base URL of the airline route lookup
  service (default: `https://adsb.im/api/0/routeset`)
- `IDENT_RELAY_ROUTE_TTL_SEC` — how long Ident caches a successful route
  lookup before re-querying (default: 5 minutes)
- `IDENT_RELAY_ROUTE_BATCH_MS` — debounce window for coalescing per-callsign
  lookups into one upstream request (default: 250 ms)
- `IDENT_UPDATE_API_URL` — GitHub-style releases endpoint Ident polls for
  update checks (default: `https://api.github.com`)
- `IDENT_UPDATE_TIMEOUT_SEC` — HTTP timeout for a single update check
  (default: 10 s)

### Diagnostics

`identd` keeps diagnostics in a TTL-backed store in `identd/diagnostics.go`.
Identity is `(channel, code, scope)` — re-emitting with the same identity
refreshes the entry's TTL and updates mutable fields (severity, message,
action) without producing a duplicate. The store publishes the full snapshot
on the `ident.diagnostics.v1` channel; the frontend replaces its local set
each time.

Operationally relevant behaviors:

- Capacity is bounded (200 entries by default). When the cap is reached, the
  oldest entry is evicted, the eviction is logged with `slog.Warn`
  (`diagnostics: cap reached, dropping oldest`, attributes `channel`, `code`,
  `scope`, `severity`, `ageSec`), and the store publishes a self-describing
  `diagnostics.store.capacity_exceeded` warning so the UI also shows the
  saturation.
- TTLs are picked at the emission site. Sustained conditions re-emit on a
  poll cadence and refresh their TTL; transient events use a 5-minute
  visibility window; persistent notices use `WithTTL(0)` and stay until
  process restart.
- Receiver-derived conditions (producer not classifiable, upstream-type
  override mismatch) re-emit every 5 minutes from
  `ReemitReceiverConditions` in `identd/producer_status.go` so a static but
  misconfigured `receiver.json` doesn't let the diagnostic age out of the
  15-minute window.

### Capability gating

`ident.capabilities.v1` reports which fields the current producer can supply
(`producer_provided`, `ident_derived`, or `unavailable`). The status bar omits
rows whose capability is `unavailable` rather than rendering them blank.
Observed capabilities are sticky across receiver reingest with the same
producer kind, and reset on a producer-kind transition — the merge rule is in
`producer_status.go:mergeStrongerCapabilities`. The intent is to avoid row
flicker when a single sample is missing a field; downgrade only happens when
the producer itself changes.

### Wire schemas

The eight Ident-owned wire envelopes are generated under `schemas/ident/`:
`ident.aircraft.v1`, `ident.status.v1`, `ident.capabilities.v1`,
`ident.diagnostics.v1`, `ident.rangeOutline.v1`, `ident.config.v1`,
`ident.routes.v1`, `ident.replay.availability.v1`. The `Refresh schemas after
changing a wire struct` section above is the source of truth for regenerating
them.

## Documentation Style

Write for receiver owners first, then add the technical detail maintainers need.

- prefer concrete receiver workflows over abstract feature language
- use placeholders for station-specific values
- mention when a feature depends on an optional file or outside service
- keep install commands minimal and copyable
- do not compare Ident directly to other projects in public docs
