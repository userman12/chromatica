# CHROMATICA

**[userman12.github.io/chromatica](https://userman12.github.io/chromatica/)**

Six centuries of painting, reduced to the colours they are actually made of.

Every particle in the field is a real colour, extracted by k-means clustering
from the photograph of one real painting in the open-access collections of the
Metropolitan Museum of Art, the Art Institute of Chicago, the Cleveland Museum
of Art and the National Gallery of Art. Nothing is decorative: no colour was
chosen, corrected or invented, and every particle is clickable back to the work
it came from, at the museum that holds it.

The whole collection is on screen at once. Switch on the timelapse and the field
recomposes century by century.

Built by [@userluke_](https://x.com/userluke_).

---

## Phase 1 — what the Met's data actually allows

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
  there. This is a survey of four museums' photographs of their public-domain
  holdings — not of art history.

---

## Phase 2 — three more collections

One museum is one museum's taste. The Met alone left the 15th century at a few
dozen works per bin, so three further open-access collections were added on
exactly the terms that made the Met usable: CC0, no API key, and a public-domain
flag in the data that can be trusted without reading a rights page per object.

Every record is keyed by a uid of the form `{source}:{id}` — ids are only
guaranteed unique inside their own museum — and thumbnails live at
`app/thumbs/{source}/{id}.webp`. Each source is one module under
`pipeline/sources/`, exposing `select()` and returning records through one shared
`make()` that applies the date, medium and year rules identically. Adding a fifth
collection is one file.

**Art Institute of Chicago** — one Elasticsearch query does the whole selection,
because their index already knows what is public domain, what is a `Painting` and
what has an image. Getting the results *out* is the awkward part: the endpoint
refuses `from + limit > 1000` outright, as an HTTP 403, while the result set is
~1,800. The date range is therefore split recursively into windows small enough
to page to the end — disjoint by construction, so nothing is collected twice and
nothing falls between two windows. Their IIIF server is behind Cloudflare and
returns a challenge page to an ordinary browser User-Agent; the documented
`AIC-User-Agent` header is what actually works. Nationality is not a field: it
lives inside the parenthetical of `artist_display`, and it is the *last*
semicolon-separated part — reading the first turns `Tintoretto (Jacopo Robusti;
Italian, 1518–1594)` into a school called "Jacopo Robusti".

**Cleveland** — plain REST, `cc0=1` does the licence filtering. Roughly two
thirds of their CC0 painting set is Mughal, Chinese, Japanese, Korean and
Himalayan: this is one of the great Asian collections, and it is excluded for
exactly the reason the Met's Asian Art department is. Cleveland catalogues by
`culture` rather than by department, so that boundary has to be written out as a
vocabulary. They also give a *place* where the other three give a demonym, so
`Italy` is translated to `Italian` or the school filter would list both. The one
case a lookup cannot settle is the Low Countries, where the split is temporal
rather than geographic: Netherlandish before the revolt, Dutch after, with 1580
as the line the other catalogues use.

**National Gallery of Art** — no API, four bulk CSVs joined locally: images
filtered to the primary view with `openaccess = 1` (that flag *is* the licence
signal), objects to `classification = Painting`, and the artist taken from the
lowest `displayorder` row with `roletype = artist`.

**Overlap** — a work held in more than one catalogue is counted once, matched on
normalised artist, title and year. Anonymous untitled works are never merged:
two unrelated `Untitled` panels by `Unattributed` in the same year are two
paintings, not one.

**One vocabulary from four** — the four museums spell the same school four ways.
Demonyms are folded (`English`/`Scottish`/`Welsh` → `British`), the National
Gallery's literal `Other` is emptied rather than becoming a school sitting beside
`Other / unattributed`, and everything under 25 works collapses into that bucket.

---

## Pipeline

Runs offline, once, and emits a static JSON plus thumbnails. **Production never
touches a museum's servers** — images are fetched and resized exactly once here.

```bash
python3 -m venv .venv && .venv/bin/pip install pillow numpy scikit-learn
bash pipeline/00_download_csv.sh      # Met + National Gallery bulk CSVs
.venv/bin/python pipeline/01_select.py            # all four sources -> 7,499 candidates
.venv/bin/python pipeline/02_fetch_image_urls.py  # Met only: resolve primaryImageSmall
.venv/bin/python pipeline/03_palettes.py          # k-means + thumbnails
.venv/bin/python pipeline/04_build.py             # -> app/data/chromatica.json
.venv/bin/python pipeline/05_thumbs.py            # thumbnails at THUMB_PX/THUMB_FORMAT
```

Stages 02, 03 and 05 append to JSONL and are resumable — re-running skips
finished IDs, which matters because 02 takes ~40 minutes at the rate the API
permits.

Stage 05 exists because 03 writes thumbnails as a side effect of measuring
palettes: raising `THUMB_PX` cannot be applied by re-running 03, whose resume log
skips everything it has already measured, and forcing it would re-run k-means over
the whole set to rewrite palettes that are already correct. Stage 05 records the
size *and format* each thumbnail was written at, so changing either redoes
exactly the stale ones and nothing else.

Thumbnails are **WebP q80, 640 px**, and the format was chosen by measurement
rather than by reputation. Over 24 works, against the uncompressed LANCZOS
resize, with 8×8 windowed SSIM: JPEG q74 came out 40.7 KB at mean 0.9477 / worst
0.9188, and WebP q80 came out 34.6 KB at mean 0.9537 / worst 0.9188. q80 is the
point where WebP stops losing in the *worst* block rather than merely on average
— at q76 the worst block drops to 0.9058, so the ~30% saving WebP is usually
quoted for is not free here. 15% smaller at strictly-no-worse fidelity, across
7,094 committed files: 290 MB → 247 MB. It was decided before the first large
commit on purpose, because these files are in git: re-rendering the set later
would leave both copies in history forever.

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
| 01 select | **7,499 candidates** · met 2,840 · nga 2,689 · aic 1,179 · cma 791, after cross-source dedup |
| 02 image URLs | 2,840 resolved from the Met API · the other three carry their URL from selection |
| 03 palettes | **7,105 usable** · 377 dropped as greyscale · 22 failed to fetch |
| 04 build | 7,094 paintings · 32,438 measured colours · 1309–1910 · 1.2 MB |
| 05 thumbs | 7,094 rendered · 0 failed · 596–640 px long edge · 247 MB committed |

Per source in the published field: the Met 2,544, the National Gallery 2,689,
the Art Institute 1,070, Cleveland 791.

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

The 32,438 colours are **particles in a field**, one per (painting, cluster).
There is no grid, no row, no cell and no border inside the field: only colour
against black. Every control lives in the two HUD bars, never on the surface.

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
from its exact coordinate in proportion to the share of the shown collection's
colour that falls in its cell — spread ∝ √(share), so a heavily used region swells and
thickens while a rare one stays a few sparks. Displacement is measured in **cells,
never in a fraction of the viewport**: the first version scaled it to the short
side, ~558 px against a ~41 px cell, and dispersion swamped the chromatic geography
into a featureless ball. Share is normalised within what is currently shown, so
filtering or scrubbing changes the *shape* of the cloud instead of merely inflating
it wherever the museum owns more paintings. Particle radius follows the cluster's
rank within its own painting.

### Time is a weight, not a position

**The default state is the whole collection at once** — all 7,094 paintings, all
32,438 colours, 1309 to 1910, every painting weighted the same. That is the
picture, and it is complete without touching anything.

**The timelapse is a mode you switch on.** It replaces the flat weight with a
Gaussian on each painting's distance from the cursor year, so the field is a moving
window rather than a bin, and it recomposes by exponential easing rather than
snapping. σ is adaptive: the window grows until it holds ~110 works, clamped
between 9 and 44 years, because coverage swings about sixtyfold between decades and
three paintings is not a period's palette. Both modes are the same loop — a `null`
year *is* the flat weight — so nothing about the rendering or the density mechanism
differs between them.

The strip along the bottom is works per year on a linear axis, log-scaled in
height: the only place the collection's real unevenness in time is visible, and the
way into the timelapse. In the timelapse the lit span is the window currently
contributing colour, so it visibly breathes open as the centuries thin.

Because the whole span puts roughly eight times more colour on the canvas than one
window does, a global alpha scale (~2,600 ÷ visible colours, clamped) keeps it a
cloud rather than a slab. It touches alpha only; no hue is altered.

### Rendering

**Canvas 2D**, two passes, flat typed arrays, no per-frame allocation. The
figures below were measured in headless Chrome at 1440×900, dpr 2, on the
11,728-particle build: `step()` cost 0.57 ms for the whole field and the draw was
the budget at ~14 ms, for **60 fps in both modes**. The field is now 32,438
particles — 2.8× denser — and those numbers have not been re-measured on a real
browser, so treat them as the design target rather than as the current reading.
The two optimisations below are what create the headroom for the increase.

**Append `?perf=1`** to check that claim rather than inherit it. An overlay
appears carrying frame interval, `step()` and draw cost as p50 and p95 over a
rolling three seconds, and the share of frames that reached a draw at all — that
last one is the number that says whether the retained-canvas optimisation below
is still working. Percentiles rather than means, because a 16.7 ms mean is
equally consistent with a steady 60 fps and with alternating 8 and 25 ms frames,
and only one of those is watchable. Without the flag the module exports `null`
and no timing call is made.

Three things had to be fixed to get there, and two of them were not the particles:

- **The readout and the 600-bar strip are only rewritten when a value changes.**
  Repainting four text nodes and 600 `fillRect`s every frame cost more than all
  11,728 particles of the earlier build did.
- **Canvas 2D is retained, so a frame in which nothing moved needs no draw call.**
  Once the whole collection has settled, the only motion left is the idle
  breathing — about 0.03 px per frame. `step()` reports the largest distance any
  particle travelled, and the field is redrawn when the unpainted total passes
  0.25 px: about 7 times a second instead of 60, for a picture that is identical
  to within a quarter of a pixel on particles several pixels wide. The timelapse
  reweights every particle on every frame, so there it always redraws.
- A global alpha scale, as above, so the eightfold denser default is still a cloud.
- **`step()` recomputes only what changed.** Two things in it did not depend on
  the clock and were being redone sixty times a second anyway. Which particles are
  present and how crowded each cell of the field is depend on the year and the
  filter, so that whole pass is keyed and skipped when neither moved. And the idle
  breathing, `sin(ωt + phase)` per particle, was 32,438 `Math.sin` calls a frame;
  holding cos and sin of each phase turns it into two sines a frame and a
  multiply-add per particle, by the angle-addition identity. Measured in node over
  the real dataset, 32,438 particles: the whole collection **1.37 → 0.61 ms**, a
  paused timelapse **0.42 → 0.07 ms**, one school **0.16 → 0.06 ms**, and a
  playing timelapse 0.37 → 0.35, which is the case the cache cannot help because
  the year changes every frame. Checked against the previous implementation over
  450 frames across every mode: weights, radii and readout identical, positions
  apart by at most 1.2 × 10⁻⁴ px — Float32 rounding in the identity, three orders
  of magnitude under the redraw threshold.

Colour is the one thing not optimised. 29,984 of the 32,438 particles are a
distinct hex, so `fillStyle` is re-parsed for nearly every particle. Quantising the palette would collapse that to a few hundred parses, and
would also mean the colours on screen are no longer the colours that were measured.
It stays.

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

- The scan lines are drawn **into the canvas**, not over it in CSS: the field is
  opaque, so a CSS overlay would have sat on top of the interface chrome as well.
  One 1 px line every 3 at 3.5% white, uniform, so it cannot make one measured
  colour look different from another.

### The optional second layer

Clicking a particle opens the painting it was measured from at 300 CSS px beside a
technical sheet: date, school, the museum that holds it, its catalogue id, how
many of the five requested clusters survived the 4% floor, and the palette with
hex values, the clicked one marked. Thumbnails are committed to the repo (stage
05) and land at 596–640 px on the long edge — the target is set above what the
sources actually carry, so nothing is upscaled and nothing is discarded. The
browser never requests an image from a museum. Hovering names the work and prints the hex under the cursor.
A school filter narrows the field to one tradition's own colour rather than
averaging it into everyone else's, and a second filter beside it puts two schools
on the field together — the comparison the data invites most is one tradition
against another over the same centuries, and one filter could only ever answer
half of it. Each school gets its own chroma curve in the strip, the first solid
and the second dashed, both in the same near-white and against the same fixed
axis so they are directly comparable. The Dutch sit at 14.3 in 1650 against the
Italians' 15.1, and the strip says so without either curve rescaling itself.

**Search dims rather than filters.** Typing a title or an artist into FIND fades
everything that does not answer to 22% instead of removing it, so the matches are
read against the collection they came out of — where in the six centuries they
sit, and how small a part of the field they are — rather than against black. The
field does not move while you type: density is accumulated on the undimmed
weight, so only alpha and radius change and the cloud you were looking at is
still the cloud you are looking at. Terms are matched accent-folded and in any
order, so `cezanne` finds Cézanne's 60 works and `virgin child` finds 91
regardless of how the title is phrased; dimmed particles stay clickable. The
count beside the box reads matches against works *shown*, not against the whole
dataset, because with a school or a year window on those are two different
numbers. Keyboard, in the timelapse: arrows ±1 year,
Shift ±10, PageUp/Down ±50, Home/End, space plays and pauses; Escape closes a
panel.

**The view is in the URL**, so a reading of the field can be handed to someone:
`?y=1600` opens the timelapse at a year, paused, `?plane=1` on the chromatic
plane, `?nat=3` narrowed to one school and `?nat2=5` against a second,
`?q=rembrandt` with a search standing, and `?w=met.437240.2` with a particular
painting open — collection, catalogue number, and which cluster of its palette
was clicked, rather than a particle index that the next rebuild of the dataset
would invalidate. Written with `replaceState`, never `pushState`: the back button
should leave the page, not walk back through every year you scrubbed past.
Nothing is written mid-timelapse — the URL says where you stopped, not which
frame was on screen — and anything else already in the query string survives, so
`?perf=1` holds through a scrub.

### What the field actually shows

Worth recording because it contradicts the obvious story, and worth re-measuring
after the collection nearly tripled: it survived. Weighted the same way the app
weights them, the **late Middle Ages are still the most chromatic period here** —
mean chroma 25.4 around 1340, which is gold ground, vermilion and ultramarine,
not mud. Saturation then falls for three centuries without interruption. The
darkest and least saturated stretch is the **later Baroque, ~1660–1680** (mean
L\* 32.4, mean chroma 14.8): tenebrism, not archaism. Only after 1700 does either
curve turn back up, and neither recovers its 14th-century value before the field
ends — 1910 is the brightest point in the whole survey (mean L\* 43.5) at a
chroma of 16.9, two thirds of the 1340 figure.

Three more collections moved the trough about half a century later and shaved
0.5 off the medieval peak; the shape did not change. The visualisation was not
tuned to make the expected narrative come out, and adding data was the honest
test of that.

This paragraph is now also drawn. The strip under the field carries mean chroma
per year as a line over the works-per-year bars, smoothed with the same adaptive
window the field itself uses — so the curve is blurred exactly as much as the
cloud above it, and for the same reason. It follows the school filter, and where
a filter leaves the window holding fewer than 30 works the line stops rather than
guessing — the Dutch curve, for instance, exists for 95 of the 602 years. Read
against a fixed 10–30 axis, so two schools cannot be made to look alike by each
rescaling to its own range.

## Attribution

Images and metadata, all CC0 1.0:

- [The Metropolitan Museum of Art Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access) — 2,544 paintings
- [National Gallery of Art Open Data](https://github.com/NationalGalleryOfArt/opendata) — 2,689 paintings
- [Art Institute of Chicago API](https://api.artic.edu/docs/) — 1,070 paintings
- [Cleveland Museum of Art Open Access](https://openaccess-api.clevelandart.org/) — 791 paintings

Every work links back to its page at the museum that holds it — required practice
regardless of the licence.
