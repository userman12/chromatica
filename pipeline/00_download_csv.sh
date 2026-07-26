#!/usr/bin/env bash
# Stage 0 — fetch the two bulk catalogues.
#
# The Met (~317 MB) and the National Gallery of Art (~210 MB across four files)
# publish no search API worth using, so their whole catalogue is downloaded and
# filtered locally. The Art Institute and Cleveland are queried live in stage 1
# and need nothing here.
#
# The Met file in metmuseum/openaccess is a Git LFS pointer, so the raw.github
# URL returns 134 bytes of metadata instead of the CSV. The media host serves
# the real object.
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

# National Gallery of Art. Plain files, no LFS. objects and published_images are
# the catalogue and the licence signal; the two constituent files exist only to
# recover artist nationality, which the object row does not carry.
NGA=https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data
for f in objects published_images constituents objects_constituents; do
  curl -fL --progress-bar -o "data/nga_$f.csv" "$NGA/$f.csv"
  echo "ok: data/nga_$f.csv ($(wc -c < "data/nga_$f.csv") bytes)"
done
