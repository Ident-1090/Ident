#!/bin/sh
set -eu

prepare_writable_dir() {
  dir="$1"
  if [ -z "$dir" ]; then
    return
  fi
  mkdir -p "$dir"
  if ! su-exec ident test -w "$dir"; then
    chown -R ident:ident "$dir"
  fi
}

if [ "$(id -u)" = "0" ]; then
  prepare_writable_dir "${IDENT_TRAILS_RESTART_CACHE_DIR:-/var/cache/ident}"
  prepare_writable_dir "${IDENT_REPLAY_DIR:-}"
  exec su-exec ident "$@"
fi

exec "$@"
