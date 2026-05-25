# Deployment and packaging

Ident runs beside an existing receiver stack without changing how that stack
works. This page explains why the deployment shape is what it is. For the
commands to install and run it, see [Install](/getting-started/install) and
[Configuration](/getting-started/configuration).

## One binary, three install styles

A release build is a single self-contained service: the web app is compiled
into the Go binary, so one process serves both the API and the frontend. There
is no separate asset server or static bundle to deploy alongside it, and nothing
to keep in version lockstep with the binary.

The same binary ships in three packaging formats. The split is not about what
the formats can do, since they are the same program with the same configuration,
but about matching how an operator already runs services on the receiver host. A
Debian package fits a host where the receiver is managed by the system service
manager and configured through an editable environment file. A container image
fits a host where the receiver stack already runs in containers and the operator
expects to add another service to the same composition. A standalone archive
covers everything else: non-Debian systems, manual process management, and
development. An operator picks the one that looks like the rest of their setup
rather than learning a new deployment model for Ident alone.

## Why Ident watches only the live feed

Ident reads a small, fixed set of files from the receiver's runtime directory.
Only the live aircraft feed is required; the receiver-metadata, statistics, and
range-outline files are optional and the UI degrades gracefully when any of them
is absent.

That live feed is the lowest common denominator across the supported decoders.
Every decoder Ident targets writes it, while only some also keep richer
per-aircraft trace files. Building on those richer files would quietly exclude the
stacks that do not produce them, so reading the one file every decoder produces is
what lets Ident sit in front of an unmodified receiver.

The cost of that choice surfaces in the trails system: the live feed does not
mark where one flight ends and the next begins, so Ident has to infer that
itself rather than read it from the source. See [Aircraft trails](/backend/trails)
for how leg detection follows from this constraint.

## The receiver feed and flash storage

A decoder rewrites the live aircraft feed roughly once a second. On a host
backed by an SD card or eMMC, common for a receiver, that continuous write
rate is a path to wearing the flash out. The data is also purely ephemeral: it
describes what the radio heard in the last second, not anything that needs to
survive a reboot.

The container examples in [Install](/getting-started/install) mount the shared
receiver-feed volume as RAM-backed tmpfs for that reason. The decoder writes the feed into RAM, Ident
reads it from there, and nothing in that high-frequency path touches the storage
medium. Losing the contents on reboot is acceptable because they are live state
that the decoder regenerates within a second of starting. This is a tradeoff the
example encodes rather than a hard requirement; an operator on durable storage,
or one who already points the decoder at a RAM disk, has less reason to mirror
it.

## Reverse proxies and a base path

Ident serves at the URL root by default. When it runs behind a reverse proxy
that forwards a path prefix without stripping it, a base-path option lets the
service mount everything under that same prefix, so a proxy can host Ident at a
subpath alongside other tools. The matching rule, covered in
[Configuration](/getting-started/configuration), is to either strip the prefix at
the proxy or set the base path on Ident, never both.
Doing both strips the prefix twice and breaks the paths. Block URLs that the
replay manifest hands out are relative to the current mount, so the same install
works at the root or behind a prefix without further configuration.

## Serving replay blocks from the proxy

Ident can serve finalized replay blocks itself. For a busy public display, those
files can instead be served straight from disk by the reverse proxy, taking that
I/O off Ident. This works because finalized blocks are immutable files on disk,
but it carries a constraint that is easy to miss.

The blocks are stored as raw zstd-compressed JSON, and Ident's own handler
negotiates how to deliver them. When a client advertises that it accepts zstd,
the bytes go out as-is with the zstd content-encoding header set. When a client
does not, the same raw bytes go out without that header, and the browser's own
decoder unpacks them. A proxy that serves these files has to reproduce that
negotiation. A static file server keyed on the file extension would set
the zstd encoding header unconditionally, which breaks every browser that has
not advertised zstd support, which is the case the in-browser fallback exists to
handle. The reverse-proxy example in [Configuration](/getting-started/configuration)
already encodes the conditional header so it serves the right thing to both kinds
of client. See [Replay](/backend/replay) for the block format and the client-side
decode path.
