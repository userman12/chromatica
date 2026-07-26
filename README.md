# CHROMATICA

**[userman12.github.io/chromatica](https://userman12.github.io/chromatica/)**

Six centuries of painting, reduced to the colours they are actually made of.

Every cell on the tape is a real colour, extracted by k-means clustering from
the photograph of one real painting in the Metropolitan Museum of Art's public
domain collection. Nothing is decorative: no colour was chosen, corrected or
invented, and every cell is clickable back to the work it came from.

---

## Phase 1 — what the data actually allows

Findings that constrained everything downstream. All numbers are measured, not
assumed.

### The search API cannot be used for a census

`/search` requires a non-empty `q`, and full-text matching distorts any count you
try to build from it: `q=*` → 2,669 results, `q=painting` → 2,667, `q=a` → 2,619.
Date filtering is worse — `1600–1609` returned 9 works, which is implausible.
**The Open Access CSV is the source of truth instead**; the API is used only to
resolve image URLs, which the CSV does not carry.

### `MetObjects.csv` is a Git LFS pointer

The file in `metmuseum/openaccess` is a 134-byte pointer. The real 317 MB file is
at `media.githubusercontent.com/media/metmuseum/openaccess/master/MetObjects.csv`.

### The API rejects bursts hard

8 concurrent workers: 388 of 474 requests lost to HTTP 403. 4 workers: 20 of 24
lost. **2 workers plus an explicit `User-Agent`: 24 of 24, ~4.7 req/s.** The
pipeline paces every request through a single global slot allocator with
exponential backoff, and sustains ~1.2–1.5 req/s in practice once backoff is
counted. Images (`images.metmuseum.org`) tolerate more: 4 workers, ~9 img/s.

### Coverage is extremely uneven, and there is a hard copyright ceiling

Eligible pool after filtering: **2,862 paintings, 1300–1910** — which happens to
land inside the requested 2,000–3,000 sample, so nothing is sampled away.

| century | works |
|---|---|
| 1300s | 93 |
| 1400s | 260 |
| 1500s | 286 |
| 1600s | 416 |
| 1700s | 555 |
| 1800s | 1,211 |
| 1900s | 41 |

Density varies ~60× between decades (4 works in the 1350s, 245 in the 1870s).
Fixed decade columns would therefore produce mostly empty ones, so the axis is
**ordinal with adaptive bins** of ~60 works each; each column reports its real
span, and the overview strip reports works *per year* so the unevenness stays
visible instead of being hidden by the layout.

**The twentieth century cannot be shown.** Public domain effectively ends around
1910 — "Modern and Contemporary Art" contributes only 14 public-domain paintings.
The tape stops at a copyright boundary, and the interface says so rather than
implying art history stopped there.

### There is no usable "artistic movement" field

`period` is almost always empty for paintings, and `tags` are iconographic
subjects (*Madonna*, *horses*), not movements. Artist **nationality** is used as
an honest proxy, normalised to the leading demonym; schools under 25 works
collapse into `Other / unattributed`.

### Three contamination sources found by inspecting output, and removed

1. **Black-and-white reproductions** — ~7.5% of Met painting images are
   monochrome archive photographs (the filenames carry a `.bw.` marker). They
   contribute a fake neutral grey ramp. Separation is unambiguous: true B&W scans
   measure mean chroma of *exactly* 0.0, while the least saturated colour
   reproduction measured 13.6. These paintings are **dropped entirely** (7.3%
   rejected in production, matching the estimate).
2. **Studio backdrops** — small panels and shaped altarpieces are photographed
   against uniform light-neutral seamless, which injected grey cells that belong
   to a photographer, not a painter. Detected via a border ring that is
   near-neutral *and* light *and* mostly uniform; deliberately calibrated so it
   will **not** strip a painting's own dark ground, which is real content.
3. **Ivory portrait miniatures** — 719 works whose palettes are dominated by the
   ivory support and flesh tones, concentrated in 1790–1840. Excluded by medium.

### Assumptions, stated explicitly

- Western traditions only; Asian and Islamic Art departments are excluded,
  because merging independent colour traditions into one chronological grid would
  misrepresent all of them.
- `objectBeginDate` is trusted when `objectEndDate − objectBeginDate ≤ 25`; wider
  attributions are too vague to place on a time axis.
- A deliberately *loose* artist-lifespan sanity check (only 2 rejections): the
  Met's `Artist Begin/End Date` sometimes holds *active* dates rather than
  birth/death, and "after Donatello, 1770" entries are correctly dated copies.
- A photograph's colour is treated as the painting's colour. Museum photography
  is consistent but not colorimetric, and varnish, age and lighting are all in
  there. This is a survey of one museum's photographs of its public-domain
  holdings — not of art history.

---

## Pipeline

Runs offline, once, and emits a static JSON plus thumbnails. **Production never
touches the Met's servers** — images are fetched and resized exactly once here.

```bash
python3 -m venv .venv && .venv/bin/pip install pillow numpy scikit-learn
bash pipeline/00_download_csv.sh      # 317 MB, via the LFS media host
.venv/bin/python pipeline/01_select.py            # CSV -> 2,862 candidates
.venv/bin/python pipeline/02_fetch_image_urls.py  # resolve primaryImageSmall
.venv/bin/python pipeline/03_palettes.py          # k-means + thumbnails
.venv/bin/python pipeline/04_build.py             # -> app/data/chromatica.json
.venv/bin/python pipeline/05_thumbs.py            # thumbnails at THUMB_PX only
```

Stages 02, 03 and 05 append to JSONL and are resumable — re-running skips
finished IDs, which matters because 02 takes ~40 minutes at the rate the API
permits.

Stage 05 exists because 03 writes thumbnails as a side effect of measuring
palettes: raising `THUMB_PX` cannot be applied by re-running 03, whose resume log
skips everything it has already measured, and forcing it would re-run k-means over
the whole set to rewrite palettes that are already correct. Stage 05 records the
size each thumbnail was written at, so a size change redoes exactly the stale
ones and nothing else.

Colour extraction runs k-means in **CIE L\*a\*b\*** so clusters are perceptually
grouped rather than grouped by raw RGB distance, and each cluster is represented
by the **median in RGB** rather than its centroid, which avoids the muddy
averages a centroid produces across a wide cluster. Clusters below 4% of pixels
are dropped and near-duplicates merged, leaving 3–5 colours per painting.

Images are processed **entirely in memory**: the web-size file is decoded, used
for both k-means and the thumbnail, then discarded. Nothing full-size is written
to disk.

### What the run actually produced

| Stage | Result |
| --- | --- |
| 01 select | 2,862 candidates from the CSV |
| 02 image URLs | 2,856 resolved · 6 without an image · 0 failed |
| 03 palettes | **2,555 usable** · 243 dropped as greyscale · 14 with no stable palette |
| 04 build | 2,555 paintings · 11,728 colour cells · 40 columns · 1311–1910 · 420 KB |
| 05 thumbs | 2,555 rendered · 0 failed · 596–625 px long edge · 111 MB committed |

Stage 02 lost 80 works to rate-limit failures on its first pass; re-running the
script recovered all 80 at the same 4.2 req/s. That is what the append-and-skip
design is for — those failures were transient, not structural.

The 243 greyscale rejections are the single largest loss and they are the right
loss: they are black-and-white archive photographs of paintings, and their
"palette" would have been a run of neutrals invented by the reproduction rather
than by the painter.

## App

`app/` is plain static files — no bundler, no build step, no dependencies. The
GitHub Actions workflow uploads the directory as-is.

The 11,728 cells are not laid out as a flat field. They are wound onto a tape
19 rows tall and 638 columns long, and the tape is drawn on a drum: only about a
fifth of it is on screen at once, the rest curving away into black at both sides.
You wind it by dragging or scrolling, and the strip along the bottom is both the
only view of the whole span and the scrubber for it.

- **The drum's axis is vertical.** That is the decision the rest of the renderer
  rests on: the perspective factor then depends only on the column, so every cell
  stays an axis-aligned rectangle drawn with one `fillRect`, and both of its
  boundaries can be rounded in projected space — which is what keeps the curving
  surface borderless and edge-to-edge, with no stroke and no gutter anywhere.
- **The arc is 46°, chosen by measurement.** A cell runs 14 px at the crown and
  compresses to 6.3 px at the rim, so nothing on the visible surface falls under
  the 6 px floor the panel look depends on. Past ~52° the edge turns to smear;
  past ~66° the projection folds back on itself.
- **Columns outside the arc must be culled before drawing.** `sin()` is periodic,
  so their projected x re-enters the viewport with a plausible-looking but wrong
  value. This is enforced in one place, `visibleCols()`.
- **Columns per bin vary.** Bins carry 169–342 cells, so sizing every bin to the
  widest would punch black holes through roughly a fifth of the tape. Each bin
  gets `ceil(cells / rows)` columns instead, and the surface stays solid.
- Cells are stored **column-major within a bin**, which makes one painting's cells
  a single contiguous run. Both the hover lift and the selection outline are
  therefore O(k) in the palette, with no search.
- Hit testing inverts the projection in closed form (bisection on a monotonic
  term), so it is exact rather than a scan over cells.
- **Canvas 2D**, not DOM and not WebGL: ~12,000 cells is far too many for
  elements and comfortable for `fillRect`.
- Transitions between discrete states are a **CRT-style scan-line refresh**: the
  new frame is composed offscreen and swept in over the standing one band by
  band. Scrolling, zooming and hovering redraw immediately instead — a wipe there
  would read as lag.
- Highlighting **never tints a measured colour.** A hovered or selected work is
  lifted off the drum — its own cells, redrawn larger about their centre — and
  framed in the single UI accent. The accent never fills a cell.

Selecting a work opens it at 300 CSS px beside a technical sheet: date, school,
the column's real span and work count, object id, how many of the five requested
clusters survived the 4% floor, and the extracted colours with their hex values.
Thumbnails are committed to the repo (stage 05) and land at 596–625 px on the long
edge, median 624 — the target is set above the Met's web-size ceiling on purpose,
so nothing is upscaled and nothing is discarded. The browser never requests an
image from the Met.

## Attribution

Images and metadata: The Metropolitan Museum of Art Open Access, CC0 1.0. Every
work links back to its page on metmuseum.org — required practice regardless of
the licence.
