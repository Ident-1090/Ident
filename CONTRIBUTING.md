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
- receiver stack: readsb, ultrafeeder, dump1090-fa, PiAware, or other
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

## Development Notes

The release architecture is:

- `ident/`: React web UI
- `identd/`: Go service and embedded release binary
- `packaging/`: Docker, systemd, and package assets
- `docs/`: install and compatibility notes

Development can run the frontend and service separately. Release builds embed
the web UI into `identd`.

## Documentation Style

Write for receiver owners first, then add the technical detail maintainers need.

- prefer concrete receiver workflows over abstract feature language
- use placeholders for station-specific values
- mention when a feature depends on an optional file or outside service
- keep install commands minimal and copyable
- do not compare Ident directly to other projects in public docs
