# Diagnostics

Ident's backend surfaces operational conditions that an operator might want to
act on (stale statistics, a malformed producer file, a configuration that does
not parse, an available update) and shows them in a notification bell in the
UI. Each condition is a structured diagnostic with a severity, a short message,
and an optional action link. The operator can snooze or hide ones they have
already seen. This page describes how those conditions are tracked and why the
design looks the way it does.

## A condition is an identity, not an event

The natural way to report a problem is to send a message every time a watcher
notices it. A polling loop that checks for stale stats every few seconds would,
under that approach, produce a fresh notification on every tick a problem
persists. The operator would see the same condition stack up dozens of times and
have no way to tell whether one thing is wrong or many.

Ident treats a condition as a thing with an identity rather than a stream of
events. The identity is a small tuple of three parts: the channel the condition
belongs to (statistics, aircraft, config, replay, an update check, and so on), a
code naming the specific condition, and an optional scope that distinguishes
separate instances of the same condition. Re-emitting the same identity updates
the one live entry in place instead of adding a duplicate. The store holds the
current set of active conditions, not a log of everything that has ever fired.

The mutable parts of an entry, its severity, its human-readable message, and its
action link, can change on every re-emission without disturbing the identity.
A message that recomputes a duration or a count on each tick still maps to the
same entry. This stability is what makes snooze and hide work: the frontend
decides whether an operator has dismissed a condition by looking only at the
identity tuple, so a message whose wording shifts from one moment to the next
does not reappear as something new and does not lose its dismissed state. If the
identity changed whenever the text did, every refreshed count would resurface a
condition the operator had already chosen to silence.

Scope is the lever that decides how finely conditions are split. Leaving it off
makes a condition a singleton for its channel and code: there is one "the
config is invalid" regardless of how many times it is noticed. Setting it to a
per-instance value, such as the identifier of a single replay block or the name
of a malformed file, lets several instances coexist and keeps the notification
count honest about how many distinct things are affected. Choosing the scope is
a real design decision. Too coarse, and "one block failed to decode" becomes
indistinguishable from "the whole archive is unreadable"; fine enough, and the
operator can see exactly which entities are in trouble.

## Entries expire on their own

The store is backed by time-to-live rather than explicit clearing. An entry
that is not re-emitted before its TTL elapses is dropped. This fits a
poll-driven condition well: a watcher that fires on a short cadence keeps an
active problem alive, and once the underlying state resolves the watcher simply
stops emitting, so the entry disappears on its own within a window. No subsystem
has to remember to retract a condition it raised.

A few tiers of TTL cover different rhythms:

- A short tier, on the order of tens of seconds, for transient conditions
  backed by a fast polling loop, such as staleness.
- A longer tier, on the order of minutes, for one-time events like a single
  failed read of a malformed file, where there is no continuous loop to keep
  the entry fresh.
- A tier of several minutes for conditions derived from the receiver
  configuration, which changes rarely and is refreshed by a heartbeat rather
  than a tight loop.
- A process-lifetime tier for conditions that will not resolve on their own,
  used for unrecoverable errors that should stay visible until restart.

The exact durations are tuning choices and are likely to move; the tiers
themselves reflect the different cadences at which conditions are produced.

## Delivery is a separate channel from status

Backend diagnostics travel to the browser on their own channel over the same
websocket hub that carries the rest of the live state, distinct from the channel
that carries producer status. The store publishes a full snapshot of the current
set whenever its contents change, and coalesces bursts of changes into a single
publish so a flurry of re-emissions does not turn into a flurry of messages.
The browser can add local diagnostics for conditions only it observes, such as a
frontend decode failure or a metric that was present and then stops arriving.

An earlier option was to attach diagnostics directly to the status message, so
that a status update and the conditions explaining it would always arrive
together. The drawback is coupling. The diagnostic store serves several
subsystems (statistics, aircraft, replay, the update check, trails) and not
all of them produce a status update when their condition changes. An update
check has nothing to do with the producer status cycle, for instance. A
standalone channel lets any subsystem raise a condition on its own schedule
without waiting for an unrelated cycle to come around, and the frontend merges
the two streams as they arrive. The cost is that the UI now reconciles two
sources instead of reading one combined message.

## Code naming

A condition's code follows a `channel.layer.condition` shape: the channel it
belongs to, the layer or producer responsible, and the condition itself. The
middle segment is deliberately specific. A code that says the adapter layer
failed to parse a producer's file tells an operator something different from one
that says the channel is misconfigured, even though both live on the same
channel. Producer-specific codes were chosen for the same reason: the point of a
code is to let an operator know what to do about it, and a code that names the
responsible piece is more actionable than a generic one.

## Startup conditions

Configuration problems, such as an upstream type the backend does not recognize
or an override that disagrees with the detected setup, are raised as soon as
there is enough information to identify the problem. Producer identification can
use receiver, aircraft, statistics, or outline files, so a setup with generic
receiver metadata may stay unknown until another file provides enough evidence.
Ident gives startup a short observation window before warning that the producer
is unknown, because the first file to arrive is often incomplete evidence. An
unknown or ambiguous producer is a diagnostic condition rather than a stream of
per-file warnings.

Because receiver and producer-identification conditions are event-driven and may
not change for hours, heartbeats re-raise active startup conditions so a stable
misconfiguration does not quietly expire between file changes.
Producer-identification conditions use a shorter heartbeat because startup
classification can resolve quickly once more files arrive; receiver
configuration conditions use a slower one. Both are deduplicated through the
same condition identity rules as every other diagnostic, so refreshing a
condition does not create a second notification.

## Expiry must not be mistaken for success

A consequence of the TTL design is that an entry vanishing looks the same
whether the condition resolved or simply stopped being re-emitted. For most
conditions that is the intended behavior. For a long-running operation it is a
trap: if an in-progress condition is allowed to lapse by TTL, a process that has
quietly stopped working looks identical to one that finished cleanly. The
principle the design holds to is that completion and failure are explicit states
with their own codes, never the absence of a still-running one. An operation
that can fail must raise a distinct failure condition rather than letting its
in-progress entry expire.

The design does not fully live up to this everywhere. Some one-shot conditions,
notably a malformed-file report from a single bad read, rely on the
minutes-long event tier rather than continuous re-emission. If a producer writes
one bad file and then stops writing altogether, that condition expires while the
underlying problem remains. Closing the gap would mean periodically re-reading
and re-validating the file, or having the producer emit something that refreshes
the entry. It is a known limitation. In practice a producer that freezes also
trips a staleness condition through the normal polling path, so the operator is
usually warned by another route, but that is a mitigation rather than a fix.

## Bounded storage

The store holds a capped number of entries. When it would overflow, the oldest
entry is evicted and a self-describing meta-diagnostic appears to say that
eviction is happening. That meta-entry is itself exempt from eviction, so the
capacity warning stays visible no matter how many entries arrive after it.
