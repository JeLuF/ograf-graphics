#!/usr/bin/env bash
# Creates one zip per OGraf animation (every directory containing a *.ograf.json manifest).
# Usage: ./build-zips.sh [animation ...]   (default: all animations)
# Output: dist/<animation>-<version>.ograf.zip, containing the animation folder plus
# a LICENSE and a generated README.md (name and description taken from the manifest(s)).
set -euo pipefail

cd "$(dirname "$0")"
OUT="dist"
mkdir -p "$OUT"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

if [ $# -gt 0 ]; then
  dirs=("${@%/}")
else
  mapfile -t dirs < <(find . -mindepth 2 -maxdepth 2 -name '*.ograf.json' -printf '%h\n' | sed 's|^\./||' | sort -u)
fi

for dir in "${dirs[@]}"; do
  # a folder may hold several manifests; the version comes from <folder>.ograf.json if present
  manifest="$dir/$(basename "$dir").ograf.json"
  [ -f "$manifest" ] || manifest=$(find "$dir" -maxdepth 1 -name '*.ograf.json' | sort | head -n 1)
  if [ -z "$manifest" ]; then
    echo "skip: $dir (no *.ograf.json manifest)" >&2
    continue
  fi
  version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)
  zipfile="$OUT/$dir${version:+-$version}.ograf.zip"
  rm -f "$zipfile"

  # stage a copy of the folder so LICENSE and README.md can be added without touching the sources
  rm -rf "$STAGE/$dir"
  mkdir -p "$STAGE/$dir"
  cp -a "$dir/." "$STAGE/$dir/"
  cp LICENSE "$STAGE/$dir/LICENSE"
  manifests=("$dir"/*.ograf.json)
  {
    if [ ${#manifests[@]} -eq 1 ]; then echo "# $(jq -r '.name' "$manifest")"; else echo "# $dir"; fi
    echo
    echo "This is an [EBU OGraf](https://ograf.ebu.io) graphics package. OGraf is an open standard for"
    echo "web-based broadcast graphics; load this folder into an OGraf-compatible renderer or"
    echo "control application (the entry point is the \`*.ograf.json\` manifest)."
    for m in "${manifests[@]}"; do
      echo
      if [ ${#manifests[@]} -gt 1 ]; then echo "## $(jq -r '.name' "$m")"; echo; fi
      jq -r '.description // empty' "$m"
    done
    echo
    echo "Licensed under the MIT License, see LICENSE."
  } > "$STAGE/$dir/README.md"

  (cd "$STAGE" && zip -rq "$OLDPWD/$zipfile" "$dir" -x '*/.*' '*~' '*.bak')
  echo "built: $zipfile"
done
