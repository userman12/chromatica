#!/usr/bin/env bash
# Stage 0 — fetch the Met Open Access catalogue (~317 MB).
#
# The file in metmuseum/openaccess is a Git LFS pointer, so the raw.github URL
# returns 134 bytes of metadata instead of the CSV. The media host serves the
# real object.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p data

curl -fL --progress-bar \
  -o data/MetObjects.csv \
  "https://media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv"

# A pointer file is ~134 bytes; the real catalogue is ~300 MB. Fail loudly rather
# than letting stage 01 parse LFS metadata as though it were data.
size=$(wc -c < data/MetObjects.csv)
if [ "$size" -lt 100000000 ]; then
  echo "error: got $size bytes — that is an LFS pointer, not the catalogue" >&2
  exit 1
fi
echo "ok: data/MetObjects.csv ($size bytes)"
