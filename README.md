# Ident

Live traffic from your own ADS-B receiver, in a fast modern display for desktop,
tablet, and phone.

<p align="center">
<img width="864" height="498" alt="demo" src="https://github.com/user-attachments/assets/3cc415d3-63b8-4214-bcf2-63d4a1dd30c8" />
</p>

Ident gives a local receiver a clearer day-to-day screen: map, traffic list,
aircraft details, receiver status, and range overlays in one place. It runs
beside the decoder and feeder software you already use, so your receiver can
keep hearing and sharing aircraft the same way it does today.

<!-- Screenshot placeholder:

Add desktop and mobile screenshots for the release page.

Suggested layout:
- Desktop map with traffic list and aircraft inspector open.
- Mobile map with bottom sheet or drawer visible.

-->

## What You Get

- A modern ADS-B traffic screen built around your receiver data.
- Omnibar search and filters for flights, registrations, squawks, aircraft
  types, altitude bands, and route hints.
- Day and night themes with map labels, panels, and telemetry tuned for each
  mode.
- First-class mobile views with the same map, filters, and aircraft details as
  desktop.
- Aircraft inspector for live telemetry, signal quality, message age, route
  context, photos, and raw receiver fields.
- One embedded `identd` service for Docker, systemd, packages, and standalone
  binary installs.

Ident is a display and operator console. It is not a radio decoder, feeder
client, or MLAT client.

## Receiver Compatibility

Ident is built for common self-hosted ADS-B receiver stacks.

| Stack | Support |
| --- | --- |
| readsb | Live aircraft, receiver metadata, stats, and range outline. |
| ultrafeeder | readsb-compatible live aircraft, receiver metadata, stats, and range outline. |
| dump1090-fa | Live aircraft display from JSON output. Optional metadata depends on the install. |
| PiAware | Installs that expose dump1090-fa JSON output. |

The basic requirement is read-only access to the directory where your receiver
writes `aircraft.json`. If optional files are missing, Ident still shows live
traffic with fewer receiver details.

## Install

Ident ships as `identd`, a single local service that serves the web app and
streams receiver updates to browsers. Release builds embed the web UI into the
Go binary with `go:embed`.

Pick the install style that matches how you manage the receiver today:

- **Debian package** for PiAware, readsb, and other Debian/Raspberry Pi OS
  receiver boxes.
- **Docker Compose** when your receiver stack already runs in containers.
- **Standalone binary** for manual installs, non-Debian systems, and testing.

### Debian Package

Run this on the receiver host to download the latest `.deb` for its CPU and
install it:

```sh
set -eu
case "$(dpkg --print-architecture)" in
  amd64) ident_arch=linux-amd64 ;;
  arm64) ident_arch=linux-arm64 ;;
  armhf) ident_arch=linux-armv7 ;;
  *)
    echo "Unsupported Debian architecture: $(dpkg --print-architecture)" >&2
    exit 1
    ;;
esac

curl -fL \
  "https://github.com/Ident-1090/Ident/releases/latest/download/identd-${ident_arch}.deb" \
  -o identd.deb
sudo apt install ./identd.deb
```

This covers `amd64`, `arm64`, and 32-bit Raspberry Pi OS `armhf` installs.

Start Ident:

```sh
sudo systemctl enable --now identd
```

Then open this from another device on the same network:

```text
http://receiver.local:8080/
```

If your receiver is not named `receiver.local`, use its hostname or IP address.

Most readsb and PiAware-style installs need no config change. If Ident cannot
find traffic, edit `/etc/ident/identd.env` and set the receiver JSON directory:

```sh
IDENT_DATA_DIR=/run/readsb
```

Then restart:

```sh
sudo systemctl restart identd
```

### Docker Compose

For Docker installs, use Compose so the service starts again after reboot and
keeps the receiver data mount in one place.

If the decoder writes JSON on the host, mount that directory read-only:

```yaml
services:
  ident:
    image: ghcr.io/ident-1090/ident:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      IDENT_ADDR: ":8080"
      IDENT_DATA_DIR: "/run/readsb"
    volumes:
      - /run/readsb:/run/readsb:ro
```

The left side of the volume is the path on the receiver host. The right side is
the path inside the Ident container, and should match `IDENT_DATA_DIR`.
Recent trails are kept by `identd`; Docker's writable container layer preserves
the compressed trail cache across a normal `docker restart`.

If Ident is being added to an existing Compose stack, share the same receiver
JSON volume with the decoder service:

```yaml
services:
  receiver:
    # Your existing readsb, dump1090-fa, or ultrafeeder service.
    volumes:
      - receiver-json:/run/readsb

  ident:
    image: ghcr.io/ident-1090/ident:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      IDENT_ADDR: ":8080"
      IDENT_DATA_DIR: "/run/readsb"
    volumes:
      - receiver-json:/run/readsb:ro

volumes:
  receiver-json:
```

In that layout, the decoder writes `aircraft.json` into the shared volume and
Ident reads the same files without needing direct access to the host filesystem.

Start it:

```sh
docker compose up -d
```

Then open it from the receiver host or another device on the same network:

```text
http://receiver.local:8080/
```

### Standalone Binary

For manual installs, download the latest binary archive for the current OS and
CPU:

```sh
set -eu

case "$(uname -s)" in
  Linux) ident_os=linux ;;
  Darwin) ident_os=darwin ;;
  FreeBSD) ident_os=freebsd ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ident_arch=amd64 ;;
  aarch64|arm64) ident_arch=arm64 ;;
  armv7l|armv7*) ident_arch=armv7 ;;
  *)
    echo "Unsupported CPU: $(uname -m)" >&2
    exit 1
    ;;
esac

curl -fL \
  "https://github.com/Ident-1090/Ident/releases/latest/download/identd-${ident_os}-${ident_arch}.tar.gz" \
  -o identd.tar.gz
tar -xzf identd.tar.gz

./identd \
  --addr 0.0.0.0:8080 \
  --data-dir /run/readsb
```

Use `--addr 127.0.0.1:8080` when Ident is behind a same-host reverse proxy. Use
`--addr 0.0.0.0:8080` when other devices on your LAN should connect directly.

### Finding Receiver Data

Ident needs read-only access to the directory containing `aircraft.json`.
Common paths are:

```text
/run/readsb
/run/dump1090-fa
```

Check the receiver host:

```sh
ls /run/readsb/aircraft.json
ls /run/dump1090-fa/aircraft.json
```

Use the path that exists as `IDENT_DATA_DIR` or `--data-dir`.

## Configuration

Most installs only need an address and a receiver data directory.

```sh
IDENT_ADDR=127.0.0.1:8080
```

When `IDENT_DATA_DIR` is unset, `identd` looks for `aircraft.json` in common
receiver runtime directories such as `/run/readsb` and `/run/dump1090-fa`. Set
`IDENT_DATA_DIR` when your receiver writes JSON somewhere else.

Ident serves at the URL root by default. If your reverse proxy passes a path
prefix through to `identd`, set the same prefix on the service:

```sh
IDENT_BASE_PATH=/ident
```

If your reverse proxy strips the prefix before forwarding, leave
`IDENT_BASE_PATH` unset. Do not both strip the prefix and set `IDENT_BASE_PATH`.

Receiver file names are configurable for stacks that use a different layout.

```sh
IDENT_DATA_DIR=/run/readsb
IDENT_AIRCRAFT_FILE=aircraft.json
IDENT_RECEIVER_FILE=receiver.json
IDENT_STATS_FILE=stats.json
IDENT_OUTLINE_FILE=outline.json
```

For PiAware and dump1090-fa, set `IDENT_DATA_DIR` to the directory where
`aircraft.json` is written.

### Trails

Ident keeps recent aircraft trails inside `identd` instead of requiring a
separate history producer. The defaults retain two hours, sample each aircraft
at most once every five seconds, and write a compressed restart cache once a
minute.

```sh
IDENT_TRAILS_MEMORY_WINDOW_SEC=7200
IDENT_TRAILS_SAMPLE_INTERVAL_SEC=5
IDENT_TRAILS_RESTART_CACHE=true
IDENT_TRAILS_RESTART_CACHE_DIR=/var/cache/ident
IDENT_TRAILS_RESTART_CACHE_INTERVAL_SEC=60
```

Disabling the restart cache keeps trails memory-only; they will be lost when
`identd` exits.

### Replay

Replay is opt-in because it writes longer-lived history blocks. When enabled,
`identd` samples live `aircraft.json`, closes one compressed block every five
minutes, writes an index, and prunes old blocks by both age and byte budget.
The byte budget is mandatory so a misconfigured receiver cannot fill the host
disk.

```sh
IDENT_REPLAY_ENABLE=true
IDENT_REPLAY_DIR=/var/lib/ident/replay
IDENT_REPLAY_RETENTION_SEC=259200
IDENT_REPLAY_MAX_BYTES=524288000
IDENT_REPLAY_BLOCK_SEC=300
IDENT_REPLAY_SAMPLE_INTERVAL_SEC=5
```

With the example above, Ident keeps up to three days of replay data and never
keeps more than 500 MiB of finalized blocks. The currently open block is not
listed or served until it rolls over, so the smallest replay unit is five
minutes.

`identd` can serve replay blocks itself through `/api/replay/blocks/*`. Replay
blocks are JSON compressed with zstd. For busy public displays, put the replay
directory behind the reverse proxy and let the proxy serve finalized
`.json.zst` files directly:

```caddyfile
handle_path /api/replay/blocks/* {
	root * /var/lib/ident/replay/blocks
	header Content-Type application/json
	header Content-Encoding zstd
	header Cache-Control "public, max-age=31536000, immutable"
	file_server
}

reverse_proxy 127.0.0.1:8080
```

Keep the normal `identd` reverse proxy for `/api/replay/manifest.json` and
`/api/ws`; the browser uses the local manifest to discover finalized block
URLs. The block URLs are relative to the current Ident mount path, so the same
setup works at `/` or behind a prefix such as `/ident`.

## How It Works

```text
browser
  -> /              web UI
  -> /api/ws        live traffic, config, and routes
  -> /api/trails/*  recent trail seed
  -> /api/replay/*  replay manifest and finalized replay blocks
  -> /api/update.json
  -> /healthz       service health

identd
  -> serves the embedded web app
  -> watches receiver JSON files
  -> maintains recent aircraft trails
  -> optionally writes bounded compressed replay blocks
  -> sends typed updates to connected browsers
```

The browser talks to Ident endpoints under the current mount path. `identd`
handles receiver-specific paths and file names, so the web app does not need to
know where the decoder stores files on disk.

## Updates

Ident checks GitHub Releases through `identd` and shows a settings indicator
when a newer release is available. Browsers only call the local Ident service;
they do not call GitHub directly.

Ident does not replace the running binary, package, or container. Updates are
installed by the operator through the release artifact, package, or container
tag they choose.

Update checks can be disabled or pointed at a fork:

```sh
IDENT_UPDATE_CHECK=true
IDENT_UPDATE_REPO=Ident-1090/Ident
IDENT_UPDATE_INTERVAL_SEC=86400
```

## Network Access

Ident is meant to run on a private receiver network or behind your own reverse
proxy.

Core live traffic display only needs local receiver files. Optional integrations
may contact outside services:

- map tile providers for selected map styles
- route lookup services when route hints are enabled
- aircraft photo APIs when photo cards are enabled

Put authentication in front of Ident before exposing it outside a private
network.

## Development

Repository layout:

```text
ident/      React web UI
identd/     Go service and embedded release binary
packaging/  systemd, Docker, and package assets
docs/       install and compatibility notes
```

Development runs the frontend and service separately.

```sh
cd ident
pnpm install
pnpm dev

cd ../identd
go run .
```

For a self-contained Docker development stack with generated receiver data:

```sh
docker compose -f docker-compose.dev.yaml up --build
```

Then open:

```text
http://localhost:8080/
```

### Receiver Fixture

For UI work and end-to-end tests without a live decoder, generate readsb-style
receiver and trail history files into an ignored local directory:

```sh
node scripts/generate-receiver-fixture.mjs \
  --seed demo \
  --out fixtures/receiver-sample \
  --aircraft 150 \
  --frames 1
```

Point `identd` at those files:

```sh
cd identd
IDENT_DATA_DIR="../fixtures/receiver-sample" go run .
```

To keep aircraft moving while a browser is open, run the generator from the repo
root in another terminal:

```sh
node scripts/generate-receiver-fixture.mjs \
  --seed demo \
  --out fixtures/receiver-sample \
  --live \
  --interval-ms 1000
```

The default fixture uses synthetic movement with real aircraft identities, so
photo and registration lookups behave like they do with live receiver data.

Useful checks:

```sh
node --test scripts/*.test.mjs

cd ident
pnpm test
pnpm check
pnpm build

cd ../identd
go test ./...
```

Build the embedded release binary:

```sh
./scripts/build-identd.sh
```

The script builds the web app, stages it for `go:embed`, and writes
`dist/identd`.

Nix users can enter the development shell or run the build helpers:

```sh
nix develop
nix run .#build-identd
nix run .#package-identd
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening issues or pull requests.

## Security

Ident reads local receiver data and serves it to browsers that can reach the
service.

Default operating posture:

- bind `identd` to localhost by default, including when a same-host reverse
  proxy is used
- bind to a LAN interface only when direct LAN access or a proxy on another host
  is intentional
- mount receiver data read-only
- do not expose Ident publicly without authentication

Do not paste feeder credentials, private station details, or exact receiver
location information into public issues.

Report vulnerabilities through GitHub private vulnerability reporting:

https://github.com/Ident-1090/Ident/security/advisories/new
