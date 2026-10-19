#!/usr/bin/env bash
# Creates one zip per OGraf animation (every directory containing a *.ograf.json manifest).
# Usage: ./build-zips.sh [animation ...]   (default: all animations)
# Output: dist/<animation>-<version>.zip, containing the animation folder.
set -euo pipefail

cd "$(dirname "$0")"
OUT="dist"
mkdir -p "$OUT"

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
  zip -rq "$zipfile" "$dir" -x '*/.*' '*~' '*.bak'
  echo "built: $zipfile"
done
