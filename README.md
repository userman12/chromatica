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

## Using it

Open **[userman12.github.io/chromatica](https://userman12.github.io/chromatica/)**.
Nothing needs to be configured and nothing is behind a click: the default state is
the whole collection at once, 7,094 paintings and 32,350 measured colours, 1309 to
1910. Everything below is optional.

### Four things to try first

| | |
|---|---|
| **Click any particle** | Opens the painting it was measured from, with its full palette, the clicked colour marked, and a link to the museum that holds it. |
| **Press CHROMATIC PLANE** | The same colours restack by hue instead of by date. Nothing is refiltered — the cloud morphs, which is the point: one set of measurements read two ways. |
| **Press TIMELAPSE, then drag the strip** | Time stops being a position and becomes a weight. The field thins to one period and walks through six centuries. |
| **Open a painting and press COLOURS LIKE THIS ONE** | The nearest two dozen paintings *by colour* — across schools and across centuries. See below. |

### The controls

- **FIND** — type a title or an artist. It **dims rather than filters**: everything
  that does not answer fades to 22% instead of disappearing, so you read the answer
  against the collection it came out of. Terms match in any order and accents are
  folded, so `cezanne` finds Cézanne. Matching works get a thin ring on the field
  *and* are named in a list beside the box.
- **COLOURS LIKE THIS ONE** — the question the field can answer that no amount of
  typing can reach. From an open painting, it ranks every other work by how near
  its closest measured colour comes to the one you clicked — straight-line distance
  in CIE L\*a\*b\*, lightness included — and returns the nearest 24. The answer
  arrives through exactly the same machinery as a text search: same rings, same
  named list, same walk with Enter. The list header states the colour it was given
  and the ΔE it actually had to reach, which is the number that says whether "like
  this" is a strong claim here or a weak one. Across the collection that reach is
  usually about **2.2**, roughly the threshold of perception — so those two dozen
  works genuinely share a colour.
- **SCHOOL** — narrows the field to one tradition's own colour rather than
  averaging it into everyone else's. The chroma curve under the field follows it.
- **The strip along the bottom** — works per year as bars (the collection is ~60×
  denser in the 1870s than the 1350s, and this is the only place that is visible),
  with mean chroma drawn over them as a line. The three dots on that line are its
  own extremes: highest, lowest, and where the field ends. Hover one to name it,
  click one to open the timelapse there.
- **RESET** puts everything back. **?** opens the method notes.

### Keyboard

| | |
|---|---|
| `Enter` / `Shift+Enter` | walk the search results forwards and back |
| `←` `→` | ±1 year in the timelapse (`Shift` for ±10) |
| `PageUp` / `PageDown` | ±50 years |
| `Home` / `End` | first and last year |
| `Space` | play / pause the timelapse |
| `Escape` | close a panel; in the FIND box, clear it |

### Any view can be linked

The URL always describes what is on screen, so a reading of the field can be
handed to someone: `?y=1600` opens the timelapse at a year, paused · `?plane=1` on
the chromatic plane · `?nat=3` narrowed to one school · `?q=rembrandt` with a
search standing · `?w=met.437240.2` with one painting open · `?near=met.437240.2`
with that painting's colour being asked about. Written with `replaceState`, so
the back button leaves the page rather than walking back through every year you
scrubbed past. Details under
[The optional second layer](#the-optional-second-layer).

### Running it locally

The app is static — no build step, no dependencies, no bundler. But it uses ES
modules and `fetch`, so it needs to be *served*; opening `index.html` from the
filesystem will not work.

```bash
git clone https://github.com/userman12/chromatica && cd chromatica/app
python3 -m http.server 8765
# then open http://localhost:8765
```

That is the whole app: `app/index.html`, four JS modules, one stylesheet, one
1.2 MB JSON and 7,094 committed thumbnails (249 MB). **It never contacts a museum** — the
images were fetched and resized once, offline, by the pipeline.

To rebuild the data from the sources instead, see [Pipeline](#pipeline). It takes
about 25 minutes and re-downloads ~7,500 images, so it is only worth doing if you
are changing how colour is measured.

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
   against uniform seamless, which injects cells that belong to a photographer,
   not a painter. Detected via a border ring that is near-neutral and mostly
   uniform. The hard part is the dark case, and the first version of this got it
   wrong: it rejected every dark ring as "the painting's own ground", which is
   true of Zurbarán and false of a gothic gable shot on black. That cost 607
   works a fake near-black cluster — 100% of them carried one, against a 66% base
   rate, and because shaped supports are medieval the damage ran 24.7% of
   14th-century works against 6.1% of 19th-century ones, flattening the very
   chroma decline this project is about.

   What separates the two is flatness, not darkness. Studio and letterbox black
   is near-perfectly flat (median ring deviation **2.8** of 255, and 494 of 610
   rings sit at literally `(0,0,0)`); painted darkness carries brushwork,
   craquelure and varnish and measures **9–15**. The gap between 5 and 8 is
   empty, so that is where the threshold sits. Two further tests were needed
   because flatness alone still caught the tenebrists: neutrality judged against
   how dark the ring is (8 points of spread is 6% of a light seamless and 40% of
   a near-black edge — a warm brown `(25,18,17)` was reading as neutral), and
   removal by **border-connected region rather than by colour**, since a surround
   is not a colour but the part of that colour continuous with the edge — which
   is what lets a sitter's black coat survive while the black around a gable does
   not.

   That still left the shaped supports, and for a reason worth recording: the
   ring test asks what the *median* of the border is, so it can only see a
   surround that dominates the border. A gable, an arched triptych or a cross is
   black in the corners and painting everywhere else, and at the 160 px k-means
   actually runs on, those borders measure as the painting — median `(108,70,30)`,
   uniformity 0.23. So a **second pass** runs where the first declines: find
   near-black pixels, keep the connected components that reach the edge, and
   judge that region rather than the border average. Two numbers separate it
   cleanly. *Blackness*, the region's median distance from `(0,0,0)`, is **0.00**
   for every one of the shaped panels, because letterboxing and seamless black
   are mathematically exact, against **5.15** for painted grounds. And *size*:
   real surrounds run 3.8% of the frame and up, while the near-black a painting
   happens to have touching its edge stays under 2.3%. Zurbarán, Tintoretto and
   Sargent have no such region at all; a panel portrait inset on black has a
   large one at blackness 2.45, and blackness is what excludes it.

   Validated over all 7,094: 839 caught by the ring, 236 by the corner pass, and
   **not one** of 481 painted dark grounds wrongly stripped — the single control
   that tripped turned out on inspection to be an arched triptych genuinely shot
   on black, so it was the control set that was wrong. Zurbarán, Sargent and the
   Clouet portrait come out of the whole intervention byte-identical to what they
   were before any of it. Exact `#000000` survives in **4** palettes, down from
   265.
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
python3 -m venv .venv && .venv/bin/pip install pillow numpy scipy scikit-learn
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
| 03 palettes | **7,105 usable** · 377 dropped as greyscale · 22 empty · 11 failed to fetch |
| 04 build | 7,094 paintings · 32,350 measured colours · 1309–1910 · 1.2 MB |
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

The 32,350 colours are **particles in a field**, one per (painting, cluster).
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
32,350 colours, 1309 to 1910, every painting weighted the same. That is the
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

**Canvas 2D**, flat typed arrays, no per-frame allocation. The cloud is built in
two passes — a low-resolution glow bed scaled up, then the crisp pass — into a
canvas that is *held*, and each frame blits that and strokes the marks over it.
Why it is split that way is below.

The table is the browser measurement, taken **before** the cloud was split out, at
32,438 particles and dpr 2 on an M-series Mac, driving the real page through the
timelapse and back. It is left as measured rather than restated, because it is
what motivated the split and the figures after it are simulated rather than
observed in a browser:

| | Safari 26 · 2880×1266 | Firefox 140 · 2682×970 |
|---|---|---|
| settled, whole span | **58.8 fps**, 14% of frames drew | **60 fps**, 22% of frames drew |
| timelapse playing, chronology | **58.8 fps**, every frame drew | **30 fps**, every frame drew |
| timelapse playing, chromatic plane | **58.8 fps**, every frame drew | **30 fps**, every frame drew |

So the 60 fps claim holds in Safari at the full field, and **does not hold in
Firefox while the field is in motion** — there a full-field draw costs 34–36 ms,
which is a 30 fps frame on its own. Worse, it is self-sustaining: at 30 fps each
frame's drift is twice as far, which clears the redraw threshold below, which
guarantees another full draw. Safari's own figure for that draw is 1–2 ms, but
that number cannot be read literally — Safari defers canvas work and flushes it
at the next entry into JS, where it lands on the following frame's `step`. Frame
interval is the only figure the two engines can be compared on, and it is also
the only one the viewer feels.

`step()` is the part that is engine-independent, and it is **0.65 ms per frame**
for the whole field, measured in node against the real dataset — up from 0.57 ms
on the 11,728-particle build for 2.8× the particles, which is the two
optimisations below doing their work. A standing search costs nothing: 0.645 ms
with one, 0.647 ms without.

**Append `?perf=1`** to re-check any of this rather than inherit it. An overlay
appears carrying frame interval, `step()` and draw cost as p50 and p95 over a
rolling three seconds, and the share of frames that reached a draw at all — that
last one is the number that says whether the retained canvas and the cloud/marks
split below are still earning their keep. Note that DRAW now covers both kinds of
frame, so its p50 is a blit and its p95 is a cloud rebuild; the gap between them
is the split working. Percentiles rather than means, because a 16.7 ms mean is
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
  0.25 px — measured at 14% of frames in Safari and 22% in Firefox on a settled
  whole span, so most frames cost nothing at all — for a picture that is identical
  to within a quarter of a pixel on particles several pixels wide. The timelapse
  reweights every particle on every frame, so there it always redraws.
- **The cloud and the marks over it run on separate clocks**, which is the single
  largest thing here. A full cloud render is **113,560 arcs and 64,619 `fillStyle`
  writes**, nearly every one of them a distinct colour string, and it depends only
  on where the particles are. The marks — the thin rings on search results, the
  ring on the selected work — are at most a couple of hundred strokes and change
  the instant you point at something. Sharing one clock meant that running the eye
  down the results list repainted every colour in the collection, once per row, to
  move one ring.

  So the cloud is rendered into a held canvas on the motion threshold above, and a
  frame that only needs new marks blits it 1:1 in device pixels and strokes over
  it. Measured against the real field with a counting canvas stub: a rebuild is
  113,560 arcs, a marks-only frame is **1 arc, 1 stroke, 1 `drawImage` and no
  colour parsing at all**. What that is worth, simulated over the real field at
  the draw costs the table above measured, while running the eye down a list of
  results:

  | | before | after |
  |---|---|---|
  | Safari, 60 Hz | 1.60 ms/frame | **0.49** |
  | Firefox, 60 Hz | 35.00 ms/frame | **5.90** |
  | Safari, 120 Hz | 1.60 ms/frame | **0.32** |
  | Firefox, 120 Hz | 35.00 ms/frame | **2.03** |

  Firefox goes from one repaint costing more than an entire 60 fps frame to
  fitting inside a 120 fps one. The idle case moves by 0.03 ms/frame, which is the
  point: an earlier attempt at smoothness traded the idle optimisation away and
  made the app slower, and the split is deliberately not a second version of that.
  It costs one full-size backing store, ~50 MB at dpr 2 on a large display.
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

Colour is the one thing not optimised. 30,244 of the 32,350 particles are a
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

**The sheet is filled only once its picture can be painted with it.** Setting
`img.src` beside the text meant the words changed on the frame you clicked and the
painting arrived whenever its file did, so choosing a second work showed you its
title over the previous one's picture. Fast, and it still read as lag, because two
halves of one description had come apart. Now the click's own answer is immediate
— the ring closes on the particle, the timelapse stops, the URL updates — and only
the sheet waits, until the thumbnail has decoded; then everything lands in one
write. A file already in cache skips the wait entirely and fills in the same tick,
since an async function runs synchronously until its first `await` and there is no
`await` to reach. Three things had to come with it: a token, so clicking faster
than the network shows the work asked for last rather than the file that arrived
last (`hideDetail` bumps it too, or a slow picture reopens a panel you have
already clicked away); a 140 ms cap, so a cold file shows its words rather than
looking like the click missed; and the intrinsic size written with the source,
because `height: auto` alone lays the figure out at nothing, paints, then
relayouts once the file reports its height — which is what made the sheet jump.
Thumbnails already looked at are held decoded, capped at 48, and pointing at a row
in the results list fetches its painting then, so the click has nothing left to
wait for.

**The selection ring closes onto its particle** over 170 ms rather than appearing
on it, ending at exactly the radius and opacity it always had — the resting
picture is unchanged and only the arrival is new. It says *which* of twelve
thousand blobs under the cursor was the one taken, which a ring that is simply
there from one frame to the next does not. It is affordable only because of the
split above: the cloud beneath it is a held picture, so an animating ring costs
one blit and one stroke instead of 113,560 arcs a frame.
A school filter narrows the field to one tradition's own colour rather than
averaging it into everyone else's. A second filter that put two schools on the
field together, each with its own chroma curve in the strip, was built and then
pulled back out — on the field it read as one filter or the other, not as a
comparison, so it is hidden for now rather than shipped half-understood. The
plumbing (`nat2` in the state, the URL param, the dashed curve) is still there
for whenever it gets a form people can actually read at a glance.

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
numbers.

A count, though, says how many answered and not which. At 22% the rest of the
field is still thousands of blobs, and five Caravaggios inside it are unfindable
by eye, so the search answers in three places at once. Every matching work gets a
thin ring on its largest visible patch — rings rather than a brighter or larger
particle, because opacity is weight and radius is the colour's share of its
painting, and bending either to answer a search would be drawing a number the
data does not hold. Beside the box the matches are *named*: year, title, artist,
in chronological order, which is the half a field of colour cannot say. Pointing
at a row rings its work on the field without opening anything; clicking opens it;
Enter and shift+Enter walk the list from the keyboard, and the count becomes your
position in it. Rings, list and stepping are one array filled by the pass that
computes the weights, so they cannot disagree about what matched, and all three
follow the visible set: with a year window on, a work outside it is not listed,
because a ring around something that has faded out identifies nothing. Past 200
matches the rings would be a texture rather than marks, so the list carries it
alone. Keyboard, in the timelapse: arrows ±1 year,
Shift ±10, PageUp/Down ±50, Home/End, space plays and pauses; Escape closes a
panel.

**And a second way of asking the same question.** Text reaches a painting you can
already name. But what this field measures is colour, not names, and *what else
looks like this* is the question the data answers best and the one no amount of
typing could reach — it finds works that have a colour in common with each other
and nothing else, across schools and across centuries. It is offered from the
panel a particle opened, on the swatch you actually clicked.

What it deliberately does **not** do is build a second mechanism. It fills the
same match array the text search fills, so the answer arrives as the same thin
rings, the same named list, the same walk with Enter. Only the way the array is
filled is different, which is why the two can never disagree about what an answer
looks like.

Distance is Euclidean in CIE L\*a\*b\* with lightness included — a pale rose and a
deep crimson are not the same colour, and dropping L\* to match "hue" would say
they were. It is ΔE76 rather than ΔE2000: the finer formula matters when grading
print, and here it would only reorder works already indistinguishable. A
painting's distance is its **nearest cluster's**, not its palette's average,
because the question is whether the work *contains* this colour rather than
whether the whole canvas is in this key — and that same cluster is the one that
gets the ring, so the mark lands on the colour that was matched instead of on the
work's largest patch. The source painting is excluded: it is the thing being
asked about, and its own remaining clusters would otherwise take the first places
in a list of what else is out there.

A **count, not a threshold**, and that is a real choice. An ordinary brown has
thousands of neighbours inside any radius worth calling close; a saturated cyan
has four. A radius therefore answers a different question depending on where you
click, while the nearest handful answers the same kind of question everywhere and
then reports how far it had to reach. Measured over 400 sampled colours, that
reach is a median of **2.2** — about the threshold of perception, so the two dozen
works that come back genuinely share a colour rather than merely a colour family.
The ΔE ceiling exists for the tail: it bites on 2 of those 400, both highly
saturated, where returning ten or twenty works is honest and reaching further
would not be.
The list header prints the reach so the strength of the claim is visible rather
than implied. One click costs 1.1 ms over 32,350 particles.

The header also carries its own dismissal, because nothing else can: a text
question is put away in the box that holds it, and binding a colour question to
the panel it was asked from would end it every time you clicked past a particle —
including on the way to reading one of its own answers. It survives an empty
result too, which is reachable rather than theoretical: narrow to a small school,
then ask about a colour, and the nearest two dozen are all real and none are in
view.

**Nothing in the interface moves.** The field is a canvas that fills whatever box
the two bars leave it, so any control that changes size changes the picture: the
play button appearing on TIMELAPSE used to shorten the field by 43 px, and
CHROMATIC PLANE, five characters longer than CHRONOLOGY, used to shove every
button beside it. Controls that belong to one mode are hidden with `visibility`
rather than `hidden`, keeping their space while leaving the tab order; every
label that changes text is shown each of its variants once at boot and pinned to
the widest — measured, not computed in `ch`, because the face is whatever the
machine has. The stage is watched with a `ResizeObserver` rather than the window,
since a footer that grows is not a window resize and the canvas would otherwise
be stretched from a stale backing store, which is also what put the selection
ring above the pointer. Verified by clicking through every mode in a real browser
and diffing the rectangle of each control: across all switches, zero pixels.

**The view is in the URL**, so a reading of the field can be handed to someone:
`?y=1600` opens the timelapse at a year, paused, `?plane=1` on the chromatic
plane, `?nat=3` narrowed to one school, `?q=rembrandt` with a search standing,
and `?w=met.437240.2` with a particular
painting open — collection, catalogue number, and which cluster of its palette
was clicked, rather than a particle index that the next rebuild of the dataset
would invalidate. `?near=met.437240.2` names the same thing for the colour
question, so "everything that looks like *this* colour of *that* Vermeer" is a
link; it is read last at boot, because a colour question and a text question
cannot both stand and a URL carrying one meant the one it names. Written with
`replaceState`, never `pushState`: the back button
should leave the page, not walk back through every year you scrubbed past.
Nothing is written mid-timelapse — the URL says where you stopped, not which
frame was on screen — and anything else already in the query string survives, so
`?perf=1` holds through a scrub.

### What the field actually shows

Worth recording because it contradicts the obvious story, and worth re-measuring
after the collection nearly tripled: it survived. The figures below are the chroma
curve's own extremes — the marks the strip draws and labels, so anything quoted
here can be checked by hovering them in the app rather than taken on trust.

The **late Middle Ages are the most chromatic period here** — chroma **27.0**
around 1339, which is gold ground, vermilion and ultramarine, not mud. Saturation
then falls for three centuries without interruption to a minimum of **14.7**
around 1673, **54% of the medieval peak**: tenebrism, not archaism. Only after
1700 does the curve turn back up, and it does not recover its 14th-century value
before the field ends — 1910 stands at **16.9**, a little under two thirds of the
1339 figure.

Two corrections to what this section said before. The numbers have moved, because
the studio-backdrop fix above removed **468** fake near-black particles
concentrated in exactly the centuries this claim is about: the medieval peak rose
1.4 and the trough deepened from 57% to 54% of it, so the artefact had been
flattening the argument from both ends at once. And the survey's **brightest**
point is no longer 1910 — with the black stripped off the gold-ground panels,
1384 now reads brighter (mean L\* 45.6 against 44.9). The earlier figures in this
paragraph were also not reproducible from the committed dataset by any weighting
tried, so they are best read as having gone stale across an earlier rebuild;
these are stated with their method attached so the same cannot happen quietly
again.

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
against a fixed 10–30 axis, so switching schools cannot make a thin one look
richer just by rescaling.

The curve's own extremes are marked on it: the highest year, the lowest, and
where it ends. They are measured off the line being drawn rather than copied from
the numbers above, because they follow the school filter too — filter to the
Dutch and the highest mark moves to 1891, which is that school's peak and not the
collection's. Hovering one names it, and clicking one opens the timelapse there,
which is what clicking anywhere on the strip already did; the mark only makes the
landing exact. The label gives the smoothing window beside the year for the same
reason the curve is smoothed at all — at the medieval peak that window is 19
years wide, so the highest point names a neighbourhood, not a date, and says so.

## Attribution

Images and metadata, all CC0 1.0:

- [The Metropolitan Museum of Art Open Access](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access) — 2,544 paintings
- [National Gallery of Art Open Data](https://github.com/NationalGalleryOfArt/opendata) — 2,689 paintings
- [Art Institute of Chicago API](https://api.artic.edu/docs/) — 1,070 paintings
- [Cleveland Museum of Art Open Access](https://openaccess-api.clevelandart.org/) — 791 paintings

Every work links back to its page at the museum that holds it — required practice
regardless of the licence.
