# Configuration

Most installs only need an address and a receiver data directory. The settings
below are read from the environment, so they fit `/etc/ident/identd.env` for a
package install, the `environment` block for Compose, or the matching command
flags for the standalone binary.

## Address and data directory

```sh
IDENT_ADDR=127.0.0.1:8080
```

When `IDENT_DATA_DIR` is unset, `identd` looks for `aircraft.json` in common
receiver runtime directories such as `/run/readsb` and `/run/dump1090-fa`. Set
`IDENT_DATA_DIR` when your receiver writes JSON somewhere else.

## Receiver file names

Receiver file names are configurable for stacks that use a different layout.

```sh
IDENT_DATA_DIR=/run/readsb
IDENT_AIRCRAFT_FILE=aircraft.json
IDENT_RECEIVER_FILE=receiver.json
IDENT_STATS_FILE=stats.json
IDENT_OUTLINE_FILE=outline.json
```

Set `IDENT_DATA_DIR` to the directory where your decoder writes `aircraft.json`
when it is not one of the paths Ident already checks.

## Upstream type

Ident usually detects the upstream type from the contents of the receiver data
directory. Explicit receiver metadata is used when present, and aircraft or
statistics files can also provide enough evidence for stacks whose receiver file
is generic. If automatic detection is insufficient or ambiguous, the UI shows a
diagnostic notification instead of guessing.

If a receiver setup needs an explicit selection, set `IDENT_UPSTREAM_TYPE` or
pass `--upstream-type`.

```sh
IDENT_UPSTREAM_TYPE=dump1090-fa
```

Supported values are `readsb`, `dump1090-fa`, and `skyaware978`. The aliases
`piaware`, `dump978-fa`, and `dump978` are also accepted. An invalid value is
ignored and surfaced as a diagnostic notification while Ident falls back to
automatic detection. A valid override wins over automatic detection, but a
diagnostic is still raised when the observed files appear to describe a
different supported upstream.

## Station identity and overlays

Optional. These show up in the UI and as part of the Line-of-Sight overlay
when present.

```sh
IDENT_STATION_NAME="My Station"
IDENT_HEYWHATSTHAT_PANORAMA_ID=YOUR_PANORAMA_ID
IDENT_HEYWHATSTHAT_ALTS=1000,3000,10000
```

`IDENT_HEYWHATSTHAT_PANORAMA_ID` points at a panorama you generated on
[heywhatsthat.com](https://heywhatsthat.com). `IDENT_HEYWHATSTHAT_ALTS` is a
comma-separated list of altitudes for the rings; leave it unset for a single
40,000 ft (12,192 m) ring.

## Share card

On by default. Ident serves an OpenGraph card so a link to your instance
shows a preview — the station name with the current message rate, aircraft count,
and range over a small radar — when posted to chat apps or social sites. The page
stays `noindex`, so this affects shared links, not search engines.

```sh
IDENT_PUBLIC_CARD=true
IDENT_PUBLIC_URL=https://radar.example.test
```

The card image needs an absolute URL. Ident derives it from the request,
honoring a reverse proxy's `X-Forwarded-Proto` / `X-Forwarded-Host`; set
`IDENT_PUBLIC_URL` to your instance's external base URL when the derived value
is wrong, such as behind a proxy that does not forward those headers. Set
`IDENT_PUBLIC_CARD=false` to omit the card and its metadata entirely.

## Trails

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

## Replay

Replay is opt-in because it writes longer-lived history blocks. When enabled,
`identd` samples live `aircraft.json`, closes one compressed block every five
minutes, writes cache manifests, and prunes old blocks by byte budget. The byte
budget is mandatory so a misconfigured receiver cannot fill the host disk.

```sh
IDENT_REPLAY_ENABLE=true
IDENT_REPLAY_DIR=/var/lib/ident/replay
IDENT_REPLAY_MAX_BYTES=524288000
IDENT_REPLAY_CLEANUP_LOW_WATERMARK=0.90
IDENT_REPLAY_CACHE_REINDEX=true
IDENT_REPLAY_SAMPLE_INTERVAL_SEC=5
```

With the example above, Ident treats 500 MiB as the high watermark. When the
estimated finalized replay size exceeds that value, it may delete oldest cached
blocks until the estimate falls below 90% of the byte budget. The currently open
block is not listed or served until it rolls over, so the smallest replay unit is
five minutes. See [Replay history](/backend/replay) for how blocks are recorded
and served.

## Serving replay blocks through a reverse proxy

`identd` can serve replay artifacts itself through `/api/replay/blocks/*`.
Replay blocks are JSON compressed with zstd, while `manifest.cache.json` files
are ordinary JSON. For busy public displays, put the replay `blocks` directory
behind the reverse proxy and let the proxy serve finalized artifacts directly:

```text
handle_path /api/replay/blocks/* {
	root * /var/lib/ident/replay/blocks

	@zstd_block {
		path *.zst
		file
	}
	header @zstd_block Content-Type application/octet-stream
	header @zstd_block Cache-Control "public, max-age=31536000, immutable"

	@accepts_zstd {
		path *.zst
		file
		header Accept-Encoding *zstd*
	}
	header @accepts_zstd Content-Type application/json
	header @accepts_zstd Content-Encoding zstd

	file_server
}

reverse_proxy 127.0.0.1:8080
```

The proxy has to reproduce the `Accept-Encoding` negotiation that `identd`
performs: a client that accepts zstd receives the stored block as-is with
`Content-Encoding: zstd`, and any other client must get the bytes labeled in a
way it can read. The matcher above keys off the request's `Accept-Encoding`
header and sets the response headers to match, which is why both the
`Content-Type` and `Content-Encoding` lines are conditional.

Keep the normal `identd` reverse proxy for `/api/replay/manifest.json` and
`/api/ws`; the browser uses the local manifest to discover finalized block
URLs. The block URLs are relative to the current Ident mount path, so the same
setup works at `/` or behind a prefix such as `/ident`. See
[Deployment](/operations/deployment) for the surrounding proxy setup.

## Base path

Ident serves at the URL root by default. If your reverse proxy passes a path
prefix through to `identd`, set the same prefix on the service:

```sh
IDENT_BASE_PATH=/ident
```

If your reverse proxy strips the prefix before forwarding, leave
`IDENT_BASE_PATH` unset. Do not both strip the prefix and set `IDENT_BASE_PATH`.
