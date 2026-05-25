# Ident

Ident is a fast, modern display for your own ADS-B receiver: a map, traffic list,
aircraft inspector, receiver status, and replay, in one screen. It runs beside the
decoder and feeder software you already use, so the receiver keeps hearing and
sharing aircraft the same way it does today.

These pages explain how Ident works and the thinking behind it. They are written
for two readers: an operator deciding how to run Ident next to a receiver, and a
contributor who wants to understand the system before changing it.

## Start here

- [Install](/getting-started/install): run Ident next to your receiver, as a
  Debian package, a container, or a standalone binary.
- [Configuration](/getting-started/configuration): point it at the receiver data
  and tune trails, replay, and the reverse proxy.
- [System architecture](/architecture): the map of the whole system, the two
  programs, the data flow between them, and a pointer to each subsystem.

## Backend

How `identd` turns receiver files into a live picture:

- [Producer normalization](/backend/producer-normalization): the one boundary
  where different decoders become Ident's own types.
- [Live transport](/backend/live-transport): the websocket that pushes updates to
  the browser.
- [Aircraft trails](/backend/trails): the in-memory recent paths and how they
  survive a restart.
- [Replay history](/backend/replay): the opt-in, bounded on-disk record.
- [Diagnostics](/backend/diagnostics): how problems become notifications.

## Frontend

What the browser does with that data:

- [Map and rendering](/frontend/map-rendering): the custom map layers and day and
  night theming.
- [Trails and replay playback](/frontend/trails-replay): buffering live trails and
  rebuilding them while scrubbing recorded history.

## Operations

Running it next to a receiver:

- [Deployment](/operations/deployment): how Ident is packaged and how it sits
  beside an existing receiver stack.
- [Security](/operations/security): the network posture and what to put in front
  of it.

## Bundling Ident

For building Ident into a larger product or stack:

- [The container image](/bundling/container-image): the contract for wrapping or
  deriving the published image without reverse-engineering it.

## Development

For working on Ident itself:

- [Development guide](/development): run it locally, the checks to run, and how to
  build a release.
