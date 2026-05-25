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
five minutes by default. A snapshot holds a timestamp and the set of aircraft
visible at that moment. When a sample arrives that belongs to a later span, the
open block is finalized and written, and a new one starts.

The block currently being filled is not listed and not served until it rolls
over. The smallest thing a viewer can load is therefore one finalized block. Both
the block length and the sample interval are configurable, with the block length
bounded below at one minute so a block always spans more than a single sample.

## On-disk layout

Blocks live in a single flat directory. Each finalized block is one
zstd-compressed JSON file whose name encodes the time range it covers. An index
file sits beside that directory and caches the list of blocks between restarts.

At startup `identd` reads the index, scans the directory, and merges the two,
preferring what the scan actually finds on disk. It does not decompress every
block to validate it; the file name and size are enough to build the in-memory
list, and decompressing the whole corpus on a cold boot would dominate startup
time on modest hardware. A block is only read from disk when a viewer asks for
it. If the index is missing, unreadable, or written in a version this build does
not recognize, `identd` falls back to the directory scan and records a diagnostic
rather than refusing to start.

The block format carries its own version. A block whose version this build does
not support is skipped, not deleted. Earlier behavior deleted mismatched blocks
and could silently destroy recorded history across an upgrade or downgrade, so
the current code never deletes a block on the basis of its version.

## Retention

Two limits bound disk use, and both are required when replay is enabled:

- A byte budget caps the total size of finalized blocks. When the total would
  exceed it, the oldest blocks are removed first until the total fits. This is
  checked both before writing a new block and after.
- An age cap sets the oldest a block may be. Blocks past that age are removed
  regardless of how much room the byte budget has left.

The two cover different failure modes. A byte budget alone does not bound how old
data gets: on a quiet receiver the budget might never fill, leaving stale history
around indefinitely. An age cap alone does not protect against disk exhaustion
when traffic is unexpectedly heavy. Together the byte budget is the hard ceiling
on space and the age cap sets the history window.

## Serving blocks

Two endpoints make replay available to the frontend. One returns a manifest: the
enabled flag, the time range covered, the block length, and the list of finalized
blocks with their URLs and sizes. The other serves a single block file by name,
after checking the requested name against the expected pattern so a request
cannot reach outside the blocks directory. Finalized blocks are served as
cacheable and immutable, since a block's contents are fixed once its time range
has passed.

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
not say so — the plain-HTTP browser being the case that matters — the server
ships the same raw bytes with no encoding header, and the frontend decompresses
them itself.
 It decides which path applies by inspecting the first few bytes of
the body for the zstd frame signature rather than trusting a response header,
because a browser strips the encoding header once it has decoded a response and a
cache may surface either form for the same URL. The frontend caps the size it
will expand a block to, and a decode failure shows up as a diagnostic in the
notification area rather than a silent blank.

Treating a wildcard or an explicit request for no encoding as "does not accept
zstd" is deliberate: a wildcard only says unlisted encodings are acceptable, not
that the client can actually decode zstd, and sending raw zstd to such a client
would recreate the failure this path exists to avoid.
