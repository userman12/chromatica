# CHROMATICA

**[userman12.github.io/chromatica](https://userman12.github.io/chromatica/)**

Six centuries of painting, reduced to the colours they are actually made of.

Every particle in the field is a real colour, extracted by k-means clustering
from the photograph of one real painting in the Metropolitan Museum of Art's
public domain collection. Nothing is decorative: no colour was chosen, corrected
or invented, and every particle is clickable back to the work it came from.

Drag the year. The whole field recomposes.

Built by [@userluke_](https://x.com/userluke_).

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
This is why time is a **weighted window rather than a bin**: the app widens the
window where the collection thins, until it holds enough works to be a period's
palette instead of an accident. Three paintings are not a decade. The track under
the year plots works *per year* on a linear axis, so the unevenness stays visible
instead of being smoothed away by the thing that compensates for it. (The pipeline
also emits ~60-work bins; the app does not use them, and they are kept only
because the JSON schema is shared.)

**The twentieth century cannot be shown.** Public domain effectively ends around
1910 — "Modern and Contemporary Art" contributes only 14 public-domain paintings.
The page stops at a copyright boundary, and the interface says so rather than
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
  because merging independent colour traditions into one chronological survey
  would misrepresent all of them.
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
| 04 build | 2,555 paintings · 11,728 measured colours · 1311–1910 · 420 KB |
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

The 11,728 colours are **particles in a field**, one per (painting, cluster).
There is no grid, no row, no cell and no border: only colour against black. The
whole interface is a year and the track it slides on.

### Position is the colour space itself

A particle sits at its own **CIE L\*a\*b\* chromatic coordinate**: a\* left to
right, b\* bottom to top (flipped, so yellow is above blue). Neutrals fall in the
middle, saturated colours reach the rim, hue runs around as angle. Colours that
look alike land near each other because that is what the space means — the regions
in the cloud are not drawn, they are what the measurement does on its own.

**Lightness is given no axis on purpose.** Against near-black it is already
visible as the particle's own brightness, and inventing a direction for it would
put a made-up axis into a picture whose whole claim is that no axis is made up. A
dim cloud is a dark century.

### Density, without a bar

The plane is histogrammed on a 6-unit Lab lattice, and each particle is pushed out
from its exact coordinate in proportion to the share of the period's colour that
falls in its cell — spread ∝ √(share), so a heavily used region swells and
thickens while a rare one stays a few sparks. Displacement is measured in **cells,
never in a fraction of the viewport**: the first version scaled it to the short
side, ~558 px against a ~41 px cell, and dispersion swamped the chromatic geography
into a featureless ball. Share is normalised within the period, so scrubbing
changes the *shape* of the cloud instead of merely inflating it wherever the museum
owns more paintings. Particle radius follows the cluster's rank within its own
painting.

### The year

Every painting is weighted by a Gaussian on its distance from the cursor, so the
field is a moving window, not a bin, and it recomposes by exponential easing rather
than snapping. σ is adaptive: the window grows until it holds ~110 works, between 9
and 44 years. Unattended, the year drifts on its own; the first touch ends that
drift permanently, so no second control is needed to stop it.

### Rendering

**Canvas 2D**, two passes, flat typed arrays, no per-frame allocation — 11,728
particles at 60 fps, `step()` in 0.33 ms.

- A **glow bed** at 0.34 resolution, drawn back full-size: the upscale *is* the
  blur, far cheaper than a real one, and it carries the atmosphere.
- A crisp pass of **skirt plus core**. One filled disc at a readable alpha has a
  visible rim, and 12,000 rims read as bokeh — a scatter of sequins you can count
  — instead of as a mist. Two radii is the cheapest falloff that kills the edge.
- **`source-over` only, never `lighter`.** Additive blending looks spectacular and
  lies: overlapping colours converge on white, so a dense region of deep Venetian
  red would render as a pink glare. With source-over, stacking one colour
  approaches that colour — density reads as solidity, and every point of the cloud
  stays a colour some painter actually mixed.
- Draw order is sorted **darkest first**, so where two particles overlap the
  brighter measurement survives instead of punching a black hole in its
  neighbour's glow. No colour is altered either way.
- Jitter comes from a deterministic hash, never `Math.random()`, so a particle
  keeps its place across frames and reloads.
- The only accent-coloured mark inside the field is the 1 px ring around a
  selected particle. Nothing tints a measured colour.

The track under the year plots works per year on a **linear** axis, log-scaled in
height, with the active window lit — the one place the real, ~60×-uneven shape of
the collection is visible.

### The optional second layer

Clicking a particle opens the painting it was measured from at 300 CSS px beside a
technical sheet: date, school, object id, how many of the five requested clusters
survived the 4% floor, and the palette with hex values, the clicked one marked.
Thumbnails are committed to the repo (stage 05) and land at 596–625 px on the long
edge, median 624 — the target is set above the Met's web-size ceiling on purpose,
so nothing is upscaled and nothing is discarded. The browser never requests an
image from the Met. Keyboard: arrows ±1 year, Shift ±10, PageUp/Down ±50,
Home/End, Escape closes. `?y=1600` deep-links a year.

### What the field actually shows

Worth recording because it contradicts the obvious story. Weighted the same way
the app weights them, the **late Middle Ages are the most chromatic period in this
collection** — mean chroma 25.9 around 1340, which is gold ground, vermilion and
ultramarine, not mud. The darkest and least saturated stretch is the **Baroque,
~1600–1620** (mean L\* 29.5, mean chroma 14.9): tenebrism, not archaism. 1905 is
the brightest (mean L\* 41.6). The visualisation was not tuned to make the
expected narrative come out.

## Attribution

Images and metadata: The Metropolitan Museum of Art Open Access, CC0 1.0. Every
work links back to its page on metmuseum.org — required practice regardless of
the licence.
