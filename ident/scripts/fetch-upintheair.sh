#!/bin/sh
# Populate /srv/ident/data/upintheair.json from the HeyWhatsThat API
# when FEEDER_HEYWHATSTHAT_ID is configured. Any failure is non-fatal
# so the web container still starts without LOS data.

set -u

DEST_DIR=/srv/ident/data
DEST=${DEST_DIR}/upintheair.json
URL_FILE=${DEST_DIR}/upintheair.url

trim() {
    printf '%s' "$1" | awk '{$1=$1; print}'
}

parse_alt_entry() {
    raw=$(trim "$1")
    [ -n "$raw" ] || return 1

    case "$raw" in
        *km)
            value=${raw%km}
            unit=km
            ;;
        *ft)
            value=${raw%ft}
            unit=ft
            ;;
        *m)
            value=${raw%m}
            unit=m
            ;;
        *)
            value=$raw
            unit=ft
            ;;
    esac

    case "$value" in
        ''|*[!0-9.]*)
            return 1
            ;;
    esac

    case "$unit" in
        km)
            awk "BEGIN { printf \"%d\", ($value * 1000) + 0.5 }"
            ;;
        m)
            awk "BEGIN { printf \"%d\", ($value) + 0.5 }"
            ;;
        ft)
            awk "BEGIN { printf \"%d\", ($value / 3.28084) + 0.5 }"
            ;;
    esac
}

normalize_alts() {
    raw=${1:-12192m}
    old_ifs=$IFS
    IFS=','
    set -- $raw
    IFS=$old_ifs

    out=""
    for entry in "$@"; do
        meters=$(parse_alt_entry "$entry") || return 1
        if [ -n "$out" ]; then
            out="${out},${meters}"
        else
            out="$meters"
        fi
    done

    [ -n "$out" ] || return 1
    printf '%s' "$out"
}

if [ -z "${FEEDER_HEYWHATSTHAT_ID:-}" ]; then
    echo "fetch-upintheair: FEEDER_HEYWHATSTHAT_ID not set; skipping LOS fetch"
    exit 0
fi

alts=$(normalize_alts "${FEEDER_HEYWHATSTHAT_ALTS:-12192m}") || {
    echo "fetch-upintheair: invalid FEEDER_HEYWHATSTHAT_ALTS=${FEEDER_HEYWHATSTHAT_ALTS:-12192m}" >&2
    exit 0
}
url="http://www.heywhatsthat.com/api/upintheair.json?id=${FEEDER_HEYWHATSTHAT_ID}&refraction=0.25&alts=${alts}"

mkdir -p "$DEST_DIR"

if [ -s "$DEST" ] && [ -f "$URL_FILE" ] && [ "$(cat "$URL_FILE")" = "$url" ]; then
    echo "[ident-web] upintheair.json already present for ${alts}m, skipping fetch"
    exit 0
fi

tmp=$(mktemp "${DEST_DIR}/upintheair.XXXXXX") || {
    echo "fetch-upintheair: failed to create temp file" >&2
    exit 0
}

if curl -fsSL --max-time 30 -o "$tmp" "$url"; then
    mv "$tmp" "$DEST"
    printf '%s\n' "$url" > "$URL_FILE"
    echo "fetch-upintheair: wrote $DEST (panorama ${FEEDER_HEYWHATSTHAT_ID}, alts ${alts}m)"
else
    rc=$?
    rm -f "$tmp"
    echo "fetch-upintheair: curl exited ${rc}; LOS rings unavailable" >&2
fi

exit 0
