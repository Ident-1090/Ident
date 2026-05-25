# Aircraft trails

A trail is the recent path an aircraft has flown. Ident keeps a rolling trail for
every aircraft it currently sees and draws it on the map behind the icon.

Each point in a trail carries what the map and the inspector need to draw and
explain it: a position and timestamp, the altitude at that moment, whether the
aircraft was on the ground, and a leg id that groups the point with the rest of
the same flight. Points that share a leg id are drawn as one connected line.

## In memory, with a cache for restarts

Trails are recent context for the live map rather than long-term history, so
`identd` holds them in memory. It keeps a rolling window, two hours by default,
and samples each aircraft at most once every few seconds. Both the window and the
sample interval are configurable. Sampling, rather than keeping every frame,
bounds memory use and keeps a chatty decoder from inflating a trail.

To avoid a blank map after a restart, `identd` writes the in-memory trails to
disk now and then and reloads them on startup. The snapshot is only a cache: if
it cannot be read back, `identd` starts fresh and rebuilds trails from the live
feed.

## Legs

A single aircraft address is reused flight after flight. Drawing every position
ever received for one address as a single connected line would join an arrival to
the next day's departure, so Ident groups a trail's points into legs and gives
each leg its own line.

The live `aircraft.json` feed does not say where one leg ends and the next
begins (see [Producer normalization](/backend/producer-normalization) for why
Ident reads that file rather than a richer one), so Ident infers leg boundaries
from the data it has. The current approach keys off the decoder's on-ground
signal: when an aircraft stays on the ground for roughly a minute, the next
flight is treated as a new leg, and brief noise in the on-ground signal is
smoothed so a single stray reading does not start or end a leg on its own.

This is one of the less settled parts of the system. A few other signals were
considered, and each has a case it gets wrong:

- Treating any gap in reception as a leg break splits a cruising aircraft that
  briefly leaves radio range.
- Treating a low altitude after a gap as a landing misreads high-elevation
  airports and aircraft that cruise low.
- Treating little distance covered as a stop misreads pattern and circuit
  flights, which stay airborne with little net movement.

The on-ground approach avoids those particular cases, but it has its own limit:
it depends on the decoder reporting a ground state at all, and not every receiver
sees one for every aircraft. An aircraft whose transponder goes quiet at the gate
may never produce a ground sample. This logic is likely to keep changing.

::: info Computed in two places today
Leg ids are worked out in the backend and, for points that arrive live, again in
the browser, using the same one-minute rule so the two stay consistent. Holding
two copies of the same logic is something we would rather reduce to one; that has
not happened yet.
:::

## Relationship to replay

[Replay](/backend/replay) is a separate, opt-in system that records history to
disk. Trails and replay read the same live feed but do not depend on each other.
One practical consequence shows up here: recorded replay does not store leg ids,
so when the frontend rebuilds trails while scrubbing replay, it groups points by
continuity in the recorded data instead of by a stored leg id. That playback path
is described in [Trails and replay playback](/frontend/trails-replay).
