# The container image

Ident is published as a container image, `ghcr.io/ident-1090/ident`. If you bundle
Ident into something larger, such as a turnkey ADS-B image, a multi-container
appliance, or a platform that turns services on and off, most of what you need is
the stock image with the right environment variables and volumes. You only wrap or
derive from the image when you have to run something of your own before identd
starts.

This page points out the things worth knowing before you do that, especially the
ones that are easy to get wrong. It is orientation, not a full specification: read
the image's Dockerfile and entrypoint for the exact paths and behavior.

## What the image gives you

- It is Alpine-based and already includes CA certificates, so identd's own
  outbound HTTPS, such as the update check, works without you adding anything.
- It creates an unprivileged `ident` user and pre-creates the trail cache and
  replay directories owned by that user.
- Its entrypoint is the image's startup script and its command is `identd`, which
  is on `PATH`. Configuration is read from `IDENT_*` environment variables (see
  [Configuration](/getting-started/configuration)); a derived image can bake
  defaults with `ENV`.

## Running something before identd

To run a step before identd starts, such as an opt-in gate or a platform check,
override the entrypoint, do your work, then hand back to the image's own startup
with `identd` as its argument:

```sh
exec docker-entrypoint.sh identd
```

That keeps the image's directory preparation and privilege handling intact instead
of replacing them.

## Let the image drop privileges

The startup script, when it runs as root, prepares the writable cache and replay
directories and then drops to the `ident` user on its own. Let it.

Do not set `USER ident` in a derived image, and do not start the entrypoint as a
non-root user. Starting unprivileged makes the script skip the directory
preparation. With the default cache and replay paths this still works, because
those are owned by `ident` at build time. But as soon as you point the cache or
replay directory at a custom path or a bind-mounted host directory, an
unprivileged start leaves it unwritable. If you do need to run unprivileged, you
are then responsible for making those directories writable by the `ident` user.

## Forward signals

identd shuts down gracefully on `SIGINT` and `SIGTERM`: it finishes its HTTP
shutdown and flushes the trail restart cache. Make sure your wrapper forwards
signals so identd actually receives them. Use `exec` so identd is the process that
gets the signal, or run it under a small init such as tini.

## Mount receiver data read-only

Ident only reads the decoder's `aircraft.json` and never writes there. Mount that
directory read-only. See [Install](/getting-started/install#find-your-setup) for
the path each stack uses.
