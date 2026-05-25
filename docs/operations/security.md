# Security posture

Ident is a receiver-local display. `identd` reads the files a local decoder
writes and streams that data to browsers over a websocket. It does not write to
the receiver, does not send anything to aircraft, and is not a feeder, decoder,
or MLAT client. The questions worth asking about it are narrow as a result: who
can reach the service, what a request can make it read or do, and what it
contacts on the network.

## Default bind address

By default `identd` listens on all interfaces on a fixed port (`IDENT_ADDR`,
`:8080`). This suits the common install, where the operator runs the binary on a
receiver host and immediately opens a browser from another device on the same
network. Direct LAN access is the usual case, so it is the default, with the
cost that anything on the same network segment can reach the service without
further setup.

The other common arrangement is a reverse proxy on the same host. There the
proxy is the only thing that should be reachable, so the README and install
guides point operators to bind `identd` to localhost at the standalone-binary
step. That keeps the service off the LAN and routes all access through the
proxy. The proxy case opts into localhost; it is not the default because it is
the less common starting point.

::: warning No built-in authentication
Ident has no authentication of its own. It expects a reverse proxy to provide
it. Anyone who can reach the port can see the receiver data. Do not expose Ident
beyond a trusted network, or to LAN users who should not see your data,
without a proxy enforcing authentication in front of it.
:::

## Read-only receiver access

`identd` only reads from the directory where the decoder writes its live feed,
and it never writes back into that directory. The files it does write are its
own, the trail restart cache and, when replay is enabled, recorded replay
blocks, in directories it owns. The Docker Compose examples mount the receiver
volume read-only, and package and service installs are expected to scope the
service account the same way. A compromise of the browser-facing surface still
cannot alter what the receiver produces.

## Replay block serving

When replay is enabled, finalized blocks are served from disk by name under a
fixed endpoint prefix. Two checks stand between a request and the filesystem.
The requested name must match the exact shape `identd` gives its own blocks (a
plain numeric pattern with a fixed extension, no path separators or relative
segments), and a name that passes that check must also be present in the
in-memory index of blocks `identd` has actually written. A crafted name aimed at
escaping the blocks directory fails the first check; a well-formed name for a
file `identd` never produced fails the second. Both paths return a not-found
result before any filesystem path is built from caller input. Tests cover a
traversal attempt against this endpoint.

## Outbound network access

The live display needs no outbound calls; it reads local files. The integrations
that do reach the network are optional and under the operator's control, and
they split by who makes the call:

- Map tiles for some map styles are fetched by the browser from a tile provider.
  `identd` is not involved.
- Route hints, when enabled, are looked up by `identd` against a route service to
  annotate callsigns. This is off by default.
- Aircraft photos, when enabled, are fetched by the browser from a photo
  provider. `identd` is not in that path.
- Update checks are made by `identd`, which polls a release API about once a day
  and relays the result to connected browsers. The browser does not contact the
  release source directly. Checks can be turned off (`IDENT_UPDATE_CHECK`) or
  pointed at a fork (`IDENT_UPDATE_REPO`).

Each of these can be disabled or repointed by the operator.

## Operator data privacy

Ident does not collect receiver data or send it to third parties. When sharing
configuration for troubleshooting, keep operator-specific details such as feeder
credentials, exact coordinates, and private hostnames out of public reports and
use placeholders in their place.

## Vulnerability reporting

Report security issues through GitHub's private vulnerability reporting for the
repository rather than in public issues:

[https://github.com/Ident-1090/Ident/security/advisories/new](https://github.com/Ident-1090/Ident/security/advisories/new)

If private reporting is unavailable, open a minimal public issue asking for a
secure contact path, without exploit details or station specifics. Maintainers
aim to acknowledge valid reports within seven days, and security fixes are
applied to the latest stable release.
