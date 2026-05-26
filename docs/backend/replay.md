# Replay history

Replay is an opt-in system that records what the receiver saw to disk so a
viewer can scrub back through past time. It is off unless an operator turns it
on. When enabled, `identd` samples the live aircraft feed at a fixed interval,
gathers those samples into fixed-length compressed blocks, and writes the blocks
to a directory it manages.

Replay is separate from [trails](/backend/trails). Trails are the recent path of
each aircraft held in memory for the live map; replay is on-disk history of every
visible aircraft over arbitrary past time. Both read the same live feed, but
neither feeds the other and neither falls back to the other. Turning replay off
does not change trails, and the reverse holds too. The two also differ in what
they record: replay does not store the leg ids that trails use, so a viewer
rebuilding trails from replay has to infer leg boundaries from the recorded data.

## Sampling and blocks

`identd` takes a snapshot of the aircraft present at most once per sample
interval and appends it to an in-memory block that covers a fixed span of time,
five minutes. A snapshot holds a timestamp and the set of aircraft visible at
that moment. Empty snapshots still matter because they prove the receiver was
being sampled even when no aircraft were visible. When a sample arrives that
belongs to a later span, the open block is finalized and written, and a new one
starts.

The block currently being filled is not listed and not served until it rolls
over. The smallest thing a viewer can load is therefore one finalized block. The
sample interval is configurable; the block duration is fixed so storage paths,
cache metadata, and frontend loading all agree about the same time grid.

## On-disk layout

Blocks are grouped by UTC day instead of all living in one directory. Each
finalized block is one zstd-compressed JSON file whose name encodes the time
range it covers. The grouping is for filesystem fanout and static serving; it is
not a time-retention policy.

Replay keeps cache manifests next to the blocks. The root cache is intentionally
small: it records the covered days and the overall range, not every block. Each
day cache records the blocks for that day. A valid cache lets startup avoid
walking the full tree and statting every historical file, which matters on small
receiver hosts. If the cache is missing or unreadable, an operator-controlled
reindex setting decides whether `identd` scans filenames to rebuild the cache or
starts with replay unavailable and records a diagnostic.

The normal startup path trusts cache metadata. It does not decompress every block
to validate it; the file name and size are enough to publish availability, and
decompressing the whole corpus on a cold boot would dominate startup time on
modest hardware. A block is only read from disk when a viewer asks for it. If a
cached block is missing, the cache is corrected for that day and a diagnostic is
recorded instead of leaving the stale coverage in place. Browser-side decode
failures stay browser-side: they raise diagnostics for the operator, but they do
not ask the server to mutate cache state.

## Retention

Replay is bounded by a byte budget. The operator sets the high watermark for
finalized blocks. When the estimated size rises above that watermark, `identd`
removes the oldest cached blocks until usage falls below a lower target.

Using two watermarks avoids deleting a single old block every time a new block
rolls over near the limit. The tradeoff is that a cleanup pass can remove a
batch of history at once. That is deliberate: it reduces metadata churn on
storage that may be SD-card-backed. There is no separate age cap in this storage
version, so a quiet receiver can keep old history as long as it fits inside the
byte budget.

## Serving blocks

Replay exposes a dynamic manifest endpoint plus a static artifact subtree. The
manifest tells the frontend which finalized blocks are available for playback.
The artifact subtree contains immutable block files and cache manifests that can
be served directly by a reverse proxy. Dynamic repair endpoints live outside
that subtree so a deployment can hand static replay artifacts to the proxy
without hiding the `identd` APIs that still need application logic.

When `identd` serves a block itself, it checks that the requested name has the
date-partitioned shape that replay writes and that the block is present in its
current cache. A name that does not match replay's own storage shape is rejected
before it can become a filesystem lookup.

### Why blocks are negotiated, not decompressed

Blocks are stored as raw zstd and the server never decompresses them. Decoding on
the server would let a single request force `identd` to expand a large block in
memory, which is an unwanted amplification path for an endpoint that may be
reachable without authentication.

That choice runs into a browser limitation. A browser speaking plain HTTP rather
than HTTPS will refuse to decode a response marked as zstd-encoded and fail the
request outright. A receiver on a home network often runs without TLS, so a
server that always marked blocks as zstd-encoded would fail to load any block in
that common case.

The server resolves this by content negotiation. When the request says it accepts
zstd, the server sets the encoding header and ships the raw bytes; the browser
decompresses them natively and JavaScript receives JSON. When the request does
not say so, the server ships the same raw bytes with no encoding header, and the
frontend decompresses them itself. The frontend decides which path applies by
inspecting the first few bytes of the body for the zstd frame signature rather
than trusting a response header, because a browser strips the encoding header
once it has decoded a response and a cache may surface either form for the same
URL. The frontend caps the size it will expand a block to, and a decode failure
shows up as a diagnostic in the notification area rather than a silent blank.

Treating a wildcard or an explicit request for no encoding as "does not accept
zstd" is deliberate: a wildcard only says unlisted encodings are acceptable, not
that the client can actually decode zstd, and sending raw zstd to such a client
would recreate the failure this path exists to avoid.
