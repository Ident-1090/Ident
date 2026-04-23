#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PACKAGER=${1:-deb}

if [ -n "${IDENT_VERSION:-}" ]; then
  VERSION="$IDENT_VERSION"
  PACKAGE_VERSION="${IDENT_VERSION#v}"
else
  METADATA="$(sh "$ROOT/scripts/resolve-build-metadata.sh")"
  VERSION="$(printf '%s\n' "$METADATA" | sed -n 's/^version=//p')"
  PACKAGE_VERSION="$(printf '%s\n' "$METADATA" | sed -n 's/^package_version=//p')"
fi

if ! command -v nfpm >/dev/null 2>&1; then
  echo "nfpm is required: https://nfpm.goreleaser.com/docs/install/" >&2
  exit 1
fi

case "${IDENT_ARCH:-$(go env GOARCH)}" in
  amd64) ARCH=amd64 ;;
  arm64) ARCH=arm64 ;;
  arm)
    GOARM_VALUE=${GOARM:-$(go env GOARM)}
    ARCH=arm${GOARM_VALUE:-7}
    ;;
  386) ARCH=386 ;;
  *) ARCH=${IDENT_ARCH:-$(go env GOARCH)} ;;
esac

IDENT_VERSION=$VERSION IDENT_ARCH=$ARCH "$ROOT/scripts/build-identd.sh"
mkdir -p "$ROOT/dist/packages"
cd "$ROOT"
IDENT_VERSION=$PACKAGE_VERSION IDENT_ARCH=$ARCH nfpm package \
  --packager "$PACKAGER" \
  --config packaging/nfpm.yaml \
  --target dist/packages/
