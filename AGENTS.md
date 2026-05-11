# AGENTS.md

This repository is public-facing. Treat every tracked file, issue template,
example, screenshot, and commit message as publishable.

## Privacy Rules

Do not include private receiver or station details in tracked content.

Avoid:

- feeder keys, claim tokens, or API credentials
- exact receiver coordinates
- home address or location hints
- private hostnames, tunnel URLs, or local network names
- local usernames, machine names, and absolute workstation paths
- screenshots that reveal private station details

Use placeholders such as `receiver.local`, `YOUR_LAT`, `YOUR_LON`, and
`YOUR_FEEDER_ID` when examples need concrete values.

## Documentation Rules

- Write for receiver owners first, then add technical detail.
- Keep install commands minimal and copyable.
- Mention optional network access when a feature calls outside the receiver.
- Do not compare Ident directly to other projects in public docs.
- Keep examples generic enough for readsb, ultrafeeder, dump1090-fa, and
  PiAware users. Use stack-specific examples only in stack-specific sections.

## Development Rules

- Keep changes focused.
- Add tests for behavior changes.
- Weigh per-frame and render-path cost. Prefer identity-stable selector
  outputs, avoid hot-loop allocations, and skip imperative updates (`setData`,
  GPU uploads) when inputs are unchanged.
- Update docs when configuration, install shape, privacy behavior, or network
  access changes.
- Do not choose or change the project license without maintainer approval.

## State and Data Rules

- Keep domain invariants in shared state and data helpers, not only in UI event
  handlers. UI guards are useful, but reducers and loaders must still protect
  the same contracts.
- Do not duplicate predicates or state-machine decisions across modules. Extract
  one helper when multiple call sites need the same meaning.
- Preserve user intent separately from data availability. If a user asks for a
  time range that partly lacks data, keep the requested range visible and show
  unavailable portions as unavailable instead of silently redefining the range.
- Treat words such as "now" according to user intent at the input boundary. If a
  typed expression is wall-clock-relative, resolve it against wall clock and let
  availability clamping happen as a separate step.
- Distinguish transient background failures from structural data failures.
  Background network misses may stay quiet, but malformed or corrupted data must
  produce a visible diagnostic.
- Do not clear user-visible errors as a side effect of unrelated successful
  work. Clear an error only when the action actually addresses that error.
- Reject invalid numeric input at the boundary. Do not let `NaN`, `Infinity`, or
  invalid zero-duration values flow into reducers where they can be silently
  converted into plausible state.
- Add reducer-level tests for state-machine invariants, not only component tests.
  Components can clamp or hide paths that other callers can still reach.
- Add multi-step tests for loops and schedulers. A single tick does not prove
  repeated playback, retry, or cleanup behavior.
