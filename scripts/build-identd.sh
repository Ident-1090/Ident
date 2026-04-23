#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

cd "$ROOT/ident"
pnpm install --frozen-lockfile
pnpm build

mkdir -p "$ROOT/identd/web"
rsync -a --delete --exclude .keep "$ROOT/ident/dist/" "$ROOT/identd/web/"
touch "$ROOT/identd/web/.keep"

VERSION=${IDENT_VERSION:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}
if [ -z "${IDENT_VERSION:-}" ]; then
  VERSION="$(sh "$ROOT/scripts/resolve-build-metadata.sh" | sed -n 's/^version=//p')"
fi
COMMIT=${IDENT_COMMIT:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}
BUILD_DATE=${IDENT_BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}
LDFLAGS="-s -w -X main.version=$VERSION -X main.commit=$COMMIT -X main.buildDate=$BUILD_DATE"

mkdir -p "$ROOT/dist"
cd "$ROOT/identd"
go build -tags embed -trimpath -ldflags "$LDFLAGS" -o "$ROOT/dist/identd" .
