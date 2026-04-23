#!/bin/sh
set -eu

created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
requested_version="${REQUESTED_VERSION:-}"
event_name="${GITHUB_EVENT_NAME:-}"
ref="${GITHUB_REF:-}"
ref_name="${GITHUB_REF_NAME:-}"
ref_type="${GITHUB_REF_TYPE:-}"
commit="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
commit_short="$(printf '%s' "$commit" | cut -c1-12)"

is_release=false
publish_image=false

if [ -n "$requested_version" ]; then
  case "$requested_version" in
    v*) ;;
    *)
      echo "workflow_dispatch release versions must start with v" >&2
      exit 1
      ;;
  esac
  version="$requested_version"
  package_version="${requested_version#v}"
  is_release=true
  publish_image=true
elif [ "$ref_type" = "tag" ] && [ -n "$ref_name" ]; then
  version="$ref_name"
  package_version="${ref_name#v}"
  is_release=true
  publish_image=true
else
  version="$commit_short"
  package_version="0.0.0~git.${commit_short}"
  if [ "$event_name" != "pull_request" ] && [ "$ref" = "refs/heads/main" ]; then
    publish_image=true
  fi
fi

printf 'created=%s\n' "$created"
printf 'commit=%s\n' "$commit"
printf 'commit_short=%s\n' "$commit_short"
printf 'is_release=%s\n' "$is_release"
printf 'package_version=%s\n' "$package_version"
printf 'publish_image=%s\n' "$publish_image"
printf 'version=%s\n' "$version"
