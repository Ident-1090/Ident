# Install

Ident runs as one service, `identd`, beside the decoder and feeder software you
already run. It reads the live `aircraft.json` your decoder writes and serves a
display from it. The simplest way to install it depends on what you are already
running, so start by finding your setup below.

::: tip Set up with an AI assistant
If you would rather be walked through it, an AI assistant can guide the install
for your setup. It does not know what Ident is on its own, so the prompt below
points it at these docs. If your assistant can open links, paste the prompt as
is; if it cannot, use the "Copy as Markdown" control near the top of the page to
paste the install and [Configuration](/getting-started/configuration) pages in
alongside it.

<AiSetupPrompt :also="['architecture.md', 'getting-started/configuration.md']" />

LLMs make mistakes. Review what it tells you to run, especially anything
destructive.
:::

::: tip Docker Compose is the tested path
The maintainers run and test Ident with Docker Compose, so it is the recommended
way to install it. The Debian package and the standalone binary are built and
published too, and they should work, but the project is small and does not have
the capacity to test every install route on every receiver setup. Treat those two
as best effort. Automatically testing the recommended Compose setup is something
we want to add later.
:::

## Find your setup

Ident needs one thing from your stack: read-only access to the directory where a
decoder writes `aircraft.json`. The wiring is always the same: share that
directory with Ident and point `IDENT_DATA_DIR` at it. What changes between stacks
is the path, and which component produces the JSON.

The recipes below were checked against each project's documentation, but paths
move between versions, so treat them as a starting point and confirm where your
decoder actually writes `aircraft.json`.

Decoders normally keep this JSON on `tmpfs`, in RAM, to avoid writing to a flash
card about once a second. The container recipes use a `tmpfs`-backed Docker volume
so the files stay in RAM while still being visible to Ident. See
[Aircraft trails](/backend/trails) for why that matters on flash-backed hosts.

<details class="details custom-block" open>
<summary>balena-ads-b (Ident already included)</summary>

The [balena-ads-b](https://github.com/ketilmo/balena-ads-b) project ships Ident as
a first-class service you turn on through its `ENABLED_SERVICES` setting. As far as
we know it is the only third-party stack that integrates Ident directly, so there
you enable Ident rather than wiring it up yourself.

</details>

::: details ultrafeeder
`ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder` bundles readsb and writes
`aircraft.json` to `/run/readsb`, which is also Ident's default, so no
`IDENT_DATA_DIR` change is needed. Share that directory with Ident:

```yaml
services:
  ultrafeeder:
    image: ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder:latest
    # ...your existing ultrafeeder configuration...
    volumes:
      - receiver-json:/run/readsb

  ident:
    image: ghcr.io/ident-1090/ident:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - receiver-json:/run/readsb:ro

volumes:
  receiver-json:
    driver_opts:
      type: tmpfs
      device: tmpfs
```
:::

::: details PiAware (FlightAware install)
A [PiAware install](https://www.flightaware.com/adsb/piaware/install) is a package
on Raspberry Pi OS, running on the bare-metal Pi rather than in Docker. Its
decoder, dump1090-fa, writes the live JSON to `/run/dump1090-fa`.

The natural fit here is to install Ident on the same Pi instead of running a
container. Use the Debian package from [Other install methods](#other-install-methods),
then point it at that directory in `/etc/ident/identd.env`:

```sh
IDENT_ADDR=:8090
IDENT_DATA_DIR=/run/dump1090-fa
```

PiAware's own SkyAware page already uses port `8080`, so this moves Ident to
`8090`; open it at `http://receiver.local:8090/`. The Debian package is a
best-effort install path rather than the tested one (that is Docker Compose), but
it is what suits a bare-metal PiAware box.
:::

## Any other stack

If your decoder is not listed above, the wiring is the same; only the path
differs. When the decoder runs in Compose, share the directory it writes
`aircraft.json` to with Ident over a `tmpfs`-backed volume:

```yaml
services:
  receiver:
    # Your existing decoder service.
    volumes:
      - receiver-json:/run/readsb   # the path this decoder writes aircraft.json to

  ident:
    image: ghcr.io/ident-1090/ident:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      IDENT_DATA_DIR: "/run/readsb"  # match the decoder's path
    volumes:
      - receiver-json:/run/readsb:ro

volumes:
  receiver-json:
    driver_opts:
      type: tmpfs
      device: tmpfs
```

When the decoder writes its JSON on the host instead of in Compose, bind-mount that
directory into Ident read-only at the same path and set `IDENT_DATA_DIR` to match.

Start it and open `http://receiver.local:8080/` from another device on the
network (use the host's name or IP if it is not `receiver.local`):

```sh
docker compose up -d
```

### Point Ident at your receiver data

If you are not sure where your decoder writes `aircraft.json`, the common paths
are `/run/readsb`, `/run/dump1090-fa`, and `/run/skyaware978`. Check the host:

```sh
ls /run/readsb/aircraft.json
ls /run/dump1090-fa/aircraft.json
ls /run/skyaware978/aircraft.json
```

Use the path that exists as `IDENT_DATA_DIR`. When it is unset, `identd` looks in
those common paths. The rest of the settings are in
[Configuration](/getting-started/configuration).

## Other install methods

These are published and should work, but are not part of the regularly tested
path. If you can use Compose, prefer it.

### Debian package

For a Debian-based receiver host. The script reads the host architecture and
downloads the matching `.deb`, covering `amd64`, `arm64`, and 32-bit Raspberry
Pi OS `armhf` installs.

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

Start it:

```sh
sudo systemctl enable --now identd
```

The package binds to localhost by default, reachable at `http://localhost:8080/`
on the receiver itself. To reach Ident from another device, and to point it at
the receiver data if it is not auto-detected, edit `/etc/ident/identd.env`:

```sh
IDENT_ADDR=:8080
IDENT_DATA_DIR=/run/readsb
```

Then restart and open `http://receiver.local:8080/` from another device:

```sh
sudo systemctl restart identd
```

### Standalone binary

For manual installs, non-Debian systems, and testing. The script reads the
current OS and CPU, downloads the matching archive, and runs the binary directly.

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

Use `--addr 127.0.0.1:8080` when Ident is behind a same-host reverse proxy, and
`--addr 0.0.0.0:8080` when other devices on the LAN should connect directly.
