/* CHROMATICA — the colour field.
 *
 * Every extracted colour of every painting is one particle. There is no grid, no
 * cell and no sorting: a particle's place is always two measured quantities read
 * off two axes. Which two is the one thing the viewer chooses.
 *
 *  - CHRONO, the default reading. Horizontal is the year the painting is dated to,
 *    linearly from the first work to the last. Vertical is L*, its lightness: dark
 *    at the floor, light at the ceiling. Six centuries unrolled side by side, so
 *    the collection's colour can be read across time in one picture instead of
 *    being piled into one cloud. The 19th century is a wall and the 14th a few
 *    sparks — that is what the museum owns, shown rather than evened out.
 *  - LAB, the second reading. Horizontal is a*, vertical is b*: the CIE L*a*b*
 *    chromatic plane itself, so neutrals fall in the middle, saturated colours
 *    reach the rim, and hue runs around as angle. Colours that look alike land
 *    near each other because that is what the space means. Here lightness gets no
 *    axis — against near-black it is already visible as the particle's own
 *    luminance, and a dim cloud is a dark century.
 *
 * Neither layout invents a direction: all four axes are measurements. Time is a
 * weight as well, and in CHRONO it is a weight and a position at once. The default
 * state weights every painting equally, the whole collection in one frame. Turning
 * the timelapse on replaces that flat weight with a Gaussian on the distance from
 * each painting's year to the cursor, and the weight drives opacity, size and how
 * far the particle is pushed out from its exact coordinate. That last part is the
 * density mechanism: when many paintings share a region of the field, the
 * particles there cannot all occupy one point, so the region swells and thickens.
 * Area and solidity are the statistic. Nothing is normalised into a bar.
 */

/* ---------- sRGB → CIE L*a*b* (D65) ---------- */

const LINEAR = new Float32Array(256);
for (let v = 0; v < 256; v++) {
  const c = v / 255;
  LINEAR[v] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// D65 white point, the reference the Met's photography is balanced to.
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);

/** @returns {[number, number, number]} L* 0..100, a*, b* */
export function rgbToLab(r, g, b) {
  const R = LINEAR[r], G = LINEAR[g], B = LINEAR[b];
  const x = f((R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / XN);
  const y = f((R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / YN);
  const z = f((R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / ZN);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const hex = (s) => [
  parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16),
];

/* ---------- tuning ----------
   Every number here is a viewing decision, not a measurement, and is kept in one
   place so it can be argued with. */

const CELL_LAB = 6;        // density-histogram cell in the Lab layout, in L*a*b* units
/* The chrono layout needs its own histogram: density has to be counted in the
   space the particles are actually standing in, or the blobs would swell for
   crowding that is not there on screen. A cell is a decade by four points of L*. */
const CELL_YEARS = 10;
const CELL_LUM = 4;
const MIN_WEIGHT = 0.035;  // below this a particle is not drawn at all
const WINDOW_WORKS = 110;  // paintings the temporal window tries to hold (see sigmaAt)
const SIGMA_MIN = 9;       // years — the tightest the window ever gets
const SIGMA_MAX = 44;      // years — the widest, in the emptiest stretches
const SEARCH_MAX = 110;    // how far sigmaAt looks for those works, in years
/* A cell's blob is measured in cells, never in screen fractions. Scaling the
   spread to the viewport instead let a dense century swell until dispersion
   swamped the coordinate, and the field collapsed into one round ball with its
   hue geography smeared out of it. Position has to keep winning over density. */
const SPREAD_FLOOR = 0.42; // blob radius for an average-density cell, in cells
const MIN_SUPPORT = 30;    // works a window must hold before its chroma is drawn
/* Width in L* of the band inside which draw order is randomised rather than
   strictly darkest-first. Five is a few times the just-noticeable difference and
   far below anything these blurred blobs communicate, so the arrangement still
   reads as light-over-dark — it just stops being chronological where lightness
   has nothing left to say. Exported because anything walking `order` on the
   assumption that it is sorted by lightness needs to know the slack. */
export const ORDER_BAND = 5;
/* Chroma is read against a fixed axis rather than a per-filter one: the whole
   collection spans 14.5 to 25.6, so 10–30 shows the shape without the curve
   rescaling itself under a filter and making two schools look alike. */
export const CHROMA_AXIS = [10, 30];
/* What a work that does not match the search is worth. Not zero: removing the
   others would answer "show me Caravaggio" with a handful of dots in a void, and
   the question is where he sits inside the collection's colour. At 0.22 the rest
   of the field is still there, still the same shape, and no longer competing —
   and still above the 0.12 the picker needs, so a dimmed painting can be clicked. */
const SEARCH_DIM = 0.22;
/* "Colours like this one": how many works come back, and how far away the
   farthest of them is allowed to be.

   A count rather than a threshold, because a threshold answers a different
   question depending on where you click. An ordinary brown has thousands of
   neighbours inside any radius worth calling close; a saturated cyan has four.
   Asking for the nearest handful gives the same kind of answer everywhere, and
   the answer says how far it had to reach — the list prints the ΔE it actually
   spanned rather than implying they are all the same colour.

   The ceiling is the one thing the count cannot do on its own: without it an
   isolated colour would return its 24 nearest anyway, at distances where
   "like this" is no longer true. 16 is well past the point where two colours
   read as versions of each other, so it only ever bites on the outliers. */
const NEAR_WORKS = 24;
const NEAR_CEILING = 16;
const SPREAD_GAIN = 0.85;  // how much a cell's blob grows with its share
const SPREAD_CAP = 2.1;    // no blob ever reaches further than this, in cells
const EASE = 0.075;        // per-frame approach to the target position: fluid, not snapped
const DRIFT_PX = 5.5;      // amplitude of the idle breathing
const DRIFT_HZ = 0.055;
const RANK_MASS = [1, 0.86, 0.74, 0.64, 0.56]; // k-means clusters come largest-share first

export class Field {
  /** @param {object} data the built chromatica.json */
  constructor(data) {
    const paintings = this.paintings = data.paintings;
    let n = 0;
    for (const p of paintings) n += p.k.length;

    // Flat typed arrays throughout: 12k particles at 60fps leaves no room for
    // per-particle objects or per-frame allocation.
    this.n = n;
    this.lx = new Float32Array(n);      // a* — the plane coordinate, fixed forever
    this.ly = new Float32Array(n);      // b*
    this.lum = new Float32Array(n);     // L*, kept for the readout only
    this.year = new Int16Array(n);
    this.owner = new Int32Array(n);     // index into data.paintings
    this.natOf = new Int16Array(n);     // school, copied down for the filter
    this.mass = new Float32Array(n);    // from the cluster's rank in the palette
    this.css = new Array(n);            // the measured colour, as given
    this.jx = new Float32Array(n);      // unit direction of this particle's offset
    this.jy = new Float32Array(n);
    this.jr = new Float32Array(n);      // 0..1, sqrt-distributed for even blob fill
    this.phase = new Float32Array(n);
    /* The breathing is sin(ωt + phase), which is 32,350 Math.sin calls a frame and
       was the single most expensive thing in step(). Held as cos and sin of the
       phase instead, the angle-addition identity turns it into two sines a frame
       and a multiply-add per particle. Same number, arrived at by algebra. */
    this.pcos = new Float32Array(n);
    this.psin = new Float32Array(n);

    this.x = new Float32Array(n);       // live position, CSS px
    this.y = new Float32Array(n);
    this.w = new Float32Array(n);       // current temporal weight, 0..1
    this.rad = new Float32Array(n);

    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    let minL = Infinity, maxL = -Infinity;
    let i = 0;
    for (let pi = 0; pi < paintings.length; pi++) {
      const p = paintings[pi];
      for (let k = 0; k < p.k.length; k++) {
        const [r, g, b] = hex(p.k[k]);
        const [L, A, B] = rgbToLab(r, g, b);
        this.lx[i] = A; this.ly[i] = B; this.lum[i] = L;
        this.year[i] = p.y;
        this.owner[i] = pi;
        this.natOf[i] = p.n ?? -1;
        this.mass[i] = RANK_MASS[Math.min(k, RANK_MASS.length - 1)];
        this.css[i] = p.k[k];
        // A deterministic offset direction and radius. Deterministic matters: a
        // particle must land in the same spot every time you scrub back to a year,
        // otherwise the field would shimmer instead of recompose.
        const a = hash01(i * 2 + 1) * Math.PI * 2;
        this.jx[i] = Math.cos(a);
        this.jy[i] = Math.sin(a);
        this.jr[i] = Math.sqrt(hash01(i * 2 + 2));
        this.phase[i] = hash01(i * 7 + 3) * Math.PI * 2;
        this.pcos[i] = Math.cos(this.phase[i]);
        this.psin[i] = Math.sin(this.phase[i]);
        if (A < minA) minA = A; if (A > maxA) maxA = A;
        if (B < minB) minB = B; if (B > maxB) maxB = B;
        if (L < minL) minL = L; if (L > maxL) maxL = L;
        i++;
      }
    }

    this.bounds = { minA, maxA, minB, maxB, minL, maxL };

    /* Draw order, darkest first.
     *
     * Compositing is source-over, so wherever two particles overlap the later one
     * wins — and with painting order (chronological) a dark particle landing on a
     * bright neighbour punched a black hole in the cloud, which read as damage
     * rather than as measurement. Going darkest-first means the brighter of two
     * overlapping measurements is the one that survives, which is also what the
     * eye expects of light against black. No colour is altered either way.
     *
     * What that rule decided too much of, though, is contests it had no business
     * deciding. 32,350 colours over a 100-point scale is a median gap of 0.0016
     * L* between neighbours in the order, so overlapping particles of visually
     * identical lightness were still strictly ranked — by a difference no viewer
     * can see, and on the 2,106 exact ties by construction order, which is
     * chronological. Jittering the key by ORDER_BAND makes those a coin toss
     * while leaving the arrangement intact at any distance the eye can read.
     *
     * It is a small correction and worth saying so: it changes who wins only
     * between particles within 5 L* of each other. A colour is not rescued from
     * under a much lighter neighbour by this, and should not be — that is what
     * the mat in nebula.js is for.
     *
     * The jitter is hashed from the index, not drawn from Math.random, for the
     * same reason the offsets above are: the field must recompose identically
     * every time you scrub back to a year. */
    this.order = new Int32Array(n);
    for (let j = 0; j < n; j++) this.order[j] = j;
    const key = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      key[j] = this.lum[j] + (hash01(j * 11 + 5) - 0.5) * ORDER_BAND;
    }
    this.order.sort((a, b) => key[a] - key[b]);

    // Density histogram over the plane, rebuilt every frame from the live weights.
    this.gw = Math.max(1, Math.ceil((maxA - minA) / CELL_LAB) + 1);
    this.gh = Math.max(1, Math.ceil((maxB - minB) / CELL_LAB) + 1);
    this.cell = new Int32Array(n);
    for (let j = 0; j < n; j++) {
      // Clamped, not trusted: the bounds were measured in double precision and the
      // coordinates are stored as float32, so a value at the very edge can round
      // just outside its own range and index one cell off the end of the grid.
      const cx = clampInt(Math.floor((this.lx[j] - minA) / CELL_LAB), this.gw - 1);
      const cy = clampInt(Math.floor((this.ly[j] - minB) / CELL_LAB), this.gh - 1);
      this.cell[j] = cy * this.gw + cx;
    }
    this.density = new Float32Array(this.gw * this.gh);

    // Works per year, for the adaptive window and for the scrubber's track texture.
    const [y0, y1] = data.meta.yearRange;
    this.y0 = y0; this.y1 = y1;
    this.perYear = new Int32Array(y1 - y0 + 1);
    for (const p of paintings) this.perYear[p.y - y0]++;

    // The chrono layout's own histogram, over the plane it actually draws in:
    // decades across, four points of L* up.
    this.gwT = Math.max(1, Math.ceil((y1 - y0) / CELL_YEARS) + 1);
    this.ghT = Math.max(1, Math.ceil((maxL - minL) / CELL_LUM) + 1);
    this.cellT = new Int32Array(n);
    for (let j = 0; j < n; j++) {
      const cx = clampInt(Math.floor((this.year[j] - y0) / CELL_YEARS), this.gwT - 1);
      const cy = clampInt(Math.floor((this.lum[j] - minL) / CELL_LUM), this.ghT - 1);
      this.cellT[j] = cy * this.gwT + cx;
    }
    this.densityT = new Float32Array(this.gwT * this.ghT);

    this.view = { ox: 0, oy: 0, scale: 1, short: 1 };
    this.tview = { sx: 1, sy: 1, ox: 0, oy: 0, maxL: 100 };
    this.chrono = true;   // the reading the field opens on
    this.placed = false;
    this.stats = { works: 0, colours: 0, from: y0, to: y1, sigma: 0, matched: 0 };
    // Counting distinct works per frame without allocating a Set each frame:
    // a stamp per painting, compared against the frame's own stamp.
    this.seenStamp = 0;
    this.seenAt = new Int32Array(paintings.length);
    /* One particle per matching work, refilled by the same pass that computes the
       weights. `markN` is how much of it is live; the array is never reallocated. */
    this.marks = new Int32Array(paintings.length);
    this.markN = 0;
    this.searchKey = "";
  }

  /**
   * Fit the chromatic plane into the viewport. The scale is one number for both
   * axes: a* and b* are the same unit, and stretching them independently would
   * make "close in colour" mean something different horizontally and vertically.
   */
  resize(cssW, cssH) {
    const { minA, maxA, minB, maxB, minL, maxL } = this.bounds;
    const pad = 0.055;   // the blob spread supplies the rest of the margin
    const short = Math.min(cssW, cssH);
    const usable = short * (1 - pad * 2);
    // The plane is squarish; fit its longer side into the viewport's shorter side
    // and let the blob spread use the rest of the room.
    const scale = usable / Math.max(maxA - minA, maxB - minB);
    this.view = {
      scale, short,
      ox: cssW / 2 - ((minA + maxA) / 2) * scale,
      // b* runs blue-negative to yellow-positive; screen y runs downward, so it is
      // flipped to put yellow above blue the way every colour picker does.
      oy: cssH / 2 + ((minB + maxB) / 2) * scale,
    };

    /* The chrono view. Unlike the chromatic plane, the two axes are different
       units — years and L* — so they get different scales; there is nothing to
       distort, because no distance across them means anything jointly. Time is
       linear on purpose, matching the works-per-year strip below the field bar for
       bar, so the wall the 19th century makes here stands over its own histogram
       instead of being rescaled into fairness. */
    const padX = cssW * 0.045, padY = cssH * 0.085;
    const sx = (cssW - padX * 2) / Math.max(1, this.y1 - this.y0);
    const sy = (cssH - padY * 2) / Math.max(1, maxL - minL);
    this.tview = { sx, sy, ox: padX, oy: padY, maxL };

    this.cssW = cssW; this.cssH = cssH;
  }

  /** Where a particle sits on screen in the current layout, before any density offset. */
  baseX(i) {
    return this.chrono
      ? this.tview.ox + (this.year[i] - this.y0) * this.tview.sx
      : this.view.ox + this.lx[i] * this.view.scale;
  }

  baseY(i) {
    // Both layouts flip: screen y runs downward, and light belongs above dark for
    // the same reason yellow belongs above blue.
    return this.chrono
      ? this.tview.oy + (this.tview.maxL - this.lum[i]) * this.tview.sy
      : this.view.oy - this.ly[i] * this.view.scale;
  }

  /**
   * Mean chroma — sqrt(a*² + b*²), how far a colour sits from grey — per year.
   *
   * This is the piece's own argument, and until now it was only ever stated in
   * the README: colour is at its most saturated around 1340, collapses to its
   * minimum in the 1670s, and the nineteenth century climbs back to about two
   * thirds of the medieval figure while getting much lighter. The field shows
   * every colour and none of that; a line does the reverse.
   *
   * Smoothed with sigmaAt's own window, so the curve is blurred exactly as much
   * as the field is at that year and for the same reason — three paintings are
   * not a period's palette. Where a filter leaves the window holding fewer than
   * MIN_SUPPORT works the curve is not drawn at all, which is the same rule
   * applied honestly rather than a gap in the data.
   *
   * The mean is unweighted across palette entries: a painting's fifth cluster
   * counts as much as its first. Weighting by cluster share would make the curve
   * track how much canvas a colour covers rather than which colours were reached
   * for, and the second is the question.
   *
   * @param {number} nat school index, or -1 for all
   * @returns {{v: Float32Array, ok: Uint8Array}} chroma per year, and where it means anything
   */
  chromaCurve(nat = -1) {
    // Cached per school rather than for the last one asked: the curve depends
    // on nothing but the school, so switching back to one already computed
    // should cost nothing, and a single slot would recompute on every change.
    this._curves ??= new Map();
    const hit = this._curves.get(nat);
    if (hit) return hit;
    const N = this.perYear.length;
    const sum = new Float64Array(N), cnt = new Float64Array(N);
    for (let i = 0; i < this.n; i++) {
      if (nat >= 0 && this.natOf[i] !== nat) continue;
      const idx = this.year[i] - this.y0;
      sum[idx] += Math.hypot(this.lx[i], this.ly[i]);
      cnt[idx] += 1;
    }

    const v = new Float32Array(N), ok = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const sigma = this.sigmaAt(this.y0 + i);
      const reach = Math.ceil(sigma * 3);
      const twoSigmaSq = 2 * sigma * sigma;
      let num = 0, den = 0;
      for (let j = Math.max(0, i - reach); j < Math.min(N, i + reach + 1); j++) {
        if (cnt[j] === 0) continue;
        const g = Math.exp(-((j - i) ** 2) / twoSigmaSq);
        num += g * sum[j];
        den += g * cnt[j];
      }
      if (den > 0) v[i] = num / den;
      // den counts colours, MIN_SUPPORT counts works: PALETTE_MAX is 5, so this
      // is the weighted equivalent of roughly MIN_SUPPORT paintings in view.
      ok[i] = den >= MIN_SUPPORT * 5 ? 1 : 0;
    }

    const curve = { v, ok };
    this._curves.set(nat, curve);
    return curve;
  }

  /**
   * The points the chroma curve singles out on its own: its highest, its lowest,
   * and where it ends.
   *
   * The piece's argument was drawn as a line and then left unlabelled — you had
   * to read the README to learn that the medieval peak is the highest colour in
   * six centuries and that the Baroque trough is the lowest. These are the marks
   * that say so on the strip itself.
   *
   * Measured off the curve rather than written down from the README, and taken
   * per school, because a marker has to sit *on* the line that is actually being
   * drawn: hardcoding 1339 would put a dot in mid-air the moment anyone filtered
   * to the Dutch, whose own highest year is 1891. Where a school is too thin for
   * the curve to be drawn at all there are no marks either — the same rule, not
   * a second one.
   *
   * The year is not the claim. The curve is smoothed with sigmaAt's window, which
   * is 19 years wide at the medieval peak, so the argmax names a neighbourhood
   * and the mark carries its own sigma to say how wide. The end mark is dropped
   * when it falls near one of the other two, which is what happens to a school
   * that peaks late: it would be labelling the same place twice.
   *
   * Cached per school like the curve it reads, and for the same reason — neither
   * depends on the year, the search or the layout, so neither is ever recomputed.
   *
   * @param {number} nat school index, or -1 for all
   * @returns {{kind: string, year: number, v: number, sigma: number, share: number}[]}
   */
  chromaMarks(nat = -1) {
    this._marks ??= new Map();
    const hit = this._marks.get(nat);
    if (hit) return hit;

    const { v, ok } = this.chromaCurve(nat);
    let hi = -1, lo = -1, end = -1;
    for (let i = 0; i < v.length; i++) {
      if (!ok[i]) continue;
      if (hi < 0 || v[i] > v[hi]) hi = i;
      if (lo < 0 || v[i] < v[lo]) lo = i;
      end = i;
    }

    const out = [];
    if (hi >= 0) {
      const mark = (kind, i) => ({
        kind,
        year: this.y0 + i,
        v: v[i],
        sigma: Math.round(this.sigmaAt(this.y0 + i)),
        share: v[i] / v[hi],
      });
      out.push(mark("hi", hi), mark("lo", lo));
      // Far enough from both to be a third reading rather than a second label on
      // one of the first two.
      const clear = (i) => Math.abs(end - i) > v.length * 0.08;
      if (clear(hi) && clear(lo)) out.push(mark("end", end));
    }

    this._marks.set(nat, out);
    return out;
  }

  /**
   * Narrow by title or artist — by dimming, never by removing.
   *
   * 7,094 works and no way to reach one by name: you found a painting by moving
   * the pointer around until you hit it. But a search that hid everything else
   * would answer "where is Caravaggio in here" with a handful of dots in a void,
   * and the whereabouts is the question. The field keeps its shape and its
   * density — a dimmed particle contributes to crowding exactly as before, so
   * nothing moves when you type — and only loses opacity and size.
   *
   * All terms must match, so "vermeer delft" narrows rather than widens. Case and
   * accents are folded: nobody types Bruegel with the diaeresis, and the
   * catalogue is inconsistent about it anyway.
   *
   * @returns {number} works matched, or 0 when the query is empty
   */
  setSearch(query) {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    this.searching = terms.length > 0;
    // Folded haystack built once, on the first search rather than at boot: most
    // visits never type anything, and this is 7,094 string allocations.
    this.hay ??= this.paintings.map((p) => fold(`${p.t || ""} ${p.a || ""}`));
    this._beginMatch();
    let matched = 0;
    for (let pi = 0; pi < this.hay.length; pi++) {
      if (this.searching && !terms.every((term) => this.hay[pi].includes(term))) continue;
      this.matchOf[pi] = 1;
      matched++;
    }
    // The weights depend on the query, so the query is part of their key.
    this.searchKey = query;
    return this.searching ? matched : 0;
  }

  /**
   * The other way of asking the same question: which works hold a colour like
   * this one.
   *
   * Text finds a painting you can already name. But the thing measured here is
   * not names, it is colour, and "what else looks like this" is the question the
   * data answers best and the one no amount of typing could reach. It is the
   * same question the chromatic plane answers geometrically — neighbours in Lab
   * are neighbours on screen — asked of one particular colour and answered by
   * name.
   *
   * Distance is plain Euclidean distance in CIE L*a*b*, lightness included: a
   * pale rose and a deep crimson are not the same colour, and dropping L* to
   * match "hue" would say they were. It is ΔE76 rather than ΔE2000; the finer
   * formula rescales this space in ways that matter when you are grading print,
   * and here it would only reorder works that are already indistinguishable.
   *
   * A painting's distance is its *nearest* cluster's, not its palette's average.
   * The question is whether the work contains this colour, not whether the whole
   * canvas is in this key — and the cluster that answers is the one that gets
   * the ring, so the mark on the field lands on the colour that was matched
   * rather than on the work's largest patch.
   *
   * The source painting is excluded. It is the thing being asked about, it is
   * already open in the panel, and its own remaining clusters would otherwise
   * take the first places in a list of what else is out there.
   *
   * Everything downstream is the text search's, unchanged: the same dimming, the
   * same rings, the same list, the same walk with Enter. Only the way `matchOf`
   * is filled is different.
   *
   * @param {number} particle the clicked colour
   * @returns {{works: number, worst: number}} how many came back, and the ΔE of
   *   the farthest of them — the reach the answer actually needed
   */
  setNear(particle) {
    const L0 = this.lum[particle], a0 = this.lx[particle], b0 = this.ly[particle];
    const self = this.owner[particle];
    const P = this.paintings.length;

    // Nearest cluster per painting, and which one it was. Squared distances
    // throughout — the ordering is the same and the ceiling squares too, so the
    // one sqrt that is taken is the one that gets printed.
    this._nearD ??= new Float32Array(P);
    this._nearI ??= new Int32Array(P);
    this._nearD.fill(Infinity);
    for (let i = 0; i < this.n; i++) {
      const o = this.owner[i];
      if (o === self) continue;
      const dL = this.lum[i] - L0, da = this.lx[i] - a0, db = this.ly[i] - b0;
      const d = dL * dL + da * da + db * db;
      if (d < this._nearD[o]) { this._nearD[o] = d; this._nearI[o] = i; }
    }

    const cap = NEAR_CEILING * NEAR_CEILING;
    const ranked = [];
    for (let o = 0; o < P; o++) if (this._nearD[o] <= cap) ranked.push(o);
    ranked.sort((x, y) => this._nearD[x] - this._nearD[y]);
    const chosen = ranked.slice(0, NEAR_WORKS);

    this._beginMatch();
    for (const o of chosen) {
      this.matchOf[o] = 1;
      this.markOf[o] = this._nearI[o];
    }
    this.searching = chosen.length > 0;
    // Distinct from any typed query — a search for the literal text "~1234"
    // would fold to something else, and this never reaches the haystack anyway.
    this.searchKey = `~${particle}`;
    return {
      works: chosen.length,
      worst: chosen.length ? Math.sqrt(this._nearD[chosen[chosen.length - 1]]) : 0,
    };
  }

  /** Clear the per-work match state both questions write into.
   *
   *  `matchOf` is what a work is worth when something is being asked and it is
   *  not the answer; `markOf` is which of its particles should carry the ring,
   *  or -1 for "whichever is drawn first", which is the largest cluster and is
   *  what a text match wants. Allocated on first use, then only ever refilled. */
  _beginMatch() {
    const P = this.paintings.length;
    this.matchOf ??= new Float32Array(P);
    this.markOf ??= new Int32Array(P);
    this.matchOf.fill(SEARCH_DIM);
    this.markOf.fill(-1);
  }

  /**
   * One particle per matching work, in year order, for stepping through a search.
   *
   * A count of matches tells you how many there are but not where they are, and
   * dimming everything else only narrows the haystack. This gives the caller a
   * blob to point at.
   *
   * The particles are the ones `step()` collected — the same set the field puts
   * rings on, so the list, the rings and the stepping can never disagree about
   * what answered. Year order rather than index order, because the index order is
   * the order four catalogues happened to be merged in.
   *
   * @returns {number[]} particle indices, empty when nothing is being searched
   */
  matchList() {
    const out = Array.from(this.marks.subarray(0, this.markN));
    out.sort((a, b) => this.year[a] - this.year[b] || a - b);
    return out;
  }

  /**
   * Window width, in years, at a given point on the scrubber.
   *
   * A fixed window would be dishonest in both directions: coverage swings about
   * sixtyfold between decades, so ±20 years is a crowd in the 1870s and three
   * paintings in the 1350s — and three paintings is not a period's palette, it is
   * three paintings. The window widens where the collection thins, until it holds
   * enough works to be worth calling a palette.
   */
  sigmaAt(year) {
    const idx = Math.round(year) - this.y0;
    let count = this.perYear[idx] || 0;
    let radius = SEARCH_MAX;
    for (let r = 1; r <= SEARCH_MAX; r++) {
      const lo = idx - r, hi = idx + r;
      if (lo >= 0) count += this.perYear[lo];
      if (hi < this.perYear.length) count += this.perYear[hi];
      if (count >= WINDOW_WORKS) { radius = r; break; }
    }
    // 0.62 turns the radius that held enough works into a Gaussian sigma whose
    // three-sigma reach is roughly that radius.
    return clamp(radius * 0.62, SIGMA_MIN, SIGMA_MAX);
  }

  /**
   * Advance one frame.
   *
   * `year` is the timelapse cursor, or null for the default state: the whole
   * collection at once, every painting weighted the same. `nat` is a school index
   * or -1 for all schools — a filter, so a school shows its own colour tradition
   * rather than being averaged into everyone else's. `chrono` picks the layout:
   * true for year × lightness, false for the a* and b* chromatic plane.
   *
   * Returns nothing; positions and weights are read straight off the arrays.
   */
  step({ year = null, t = 0, reduceMotion = false, nat = -1, chrono = true }) {
    const timed = year !== null;
    const sigma = timed ? this.sigmaAt(year) : 0;
    const inv = timed ? 1 / (2 * sigma * sigma) : 0;
    this.chrono = chrono;
    const n = this.n;
    const density = chrono ? this.densityT : this.density;
    const cell = chrono ? this.cellT : this.cell;

    /* Which particles are present and how crowded each cell is depends on the year
       and the filter, and on nothing else — not on t. Paused, or showing the whole
       collection, this pass produced a byte-identical answer sixty times a second.
       Keyed and skipped instead; the arrays are still there from last time, which
       is why density is only cleared on the branch that refills it. */
    const wKey = `${timed ? year : "a"}|${nat}|${chrono}|${this.searchKey}`;
    if (wKey !== this._wKey) {
      this._wKey = wKey;
      density.fill(0);
      const stamp = ++this.seenStamp;
      const searching = this.searching, matchOf = this.matchOf;
      let total = 0, works = 0, matched = 0, markN = 0;
      for (let i = 0; i < n; i++) {
        /* One school or all of them. This used to admit a second school as
           well, and the sentinel for "no second school" was -1 — which is also
           what natOf falls back to for a painting the build left without a
           school, so an unattributed work matched the absence of a filter and
           appeared under every school at once. Nothing in the current dataset
           reaches that fallback, so it was never visible. With the comparison
           gone the case cannot arise: -1 is never equal to a real index. */
        if (nat >= 0 && this.natOf[i] !== nat) { this.w[i] = 0; continue; }
        let wt = 1;
        if (timed) {
          const d = this.year[i] - year;
          wt = Math.exp(-d * d * inv);
          // Tested before the search dims it: a work you are not looking for
          // should fade, not fall out of the window it belongs to.
          if (wt < MIN_WEIGHT) { this.w[i] = 0; continue; }
        }
        const o = this.owner[i];
        this.w[i] = searching ? wt * matchOf[o] : wt;
        // Crowding is counted on the undimmed weight, so typing changes what the
        // field looks like without changing where anything is.
        const m = wt * this.mass[i];
        density[cell[i]] += m;
        total += m;
        if (this.seenAt[o] !== stamp) {
          this.seenAt[o] = stamp;
          works++;
          if (searching && matchOf[o] === 1) {
            matched++;
            // First drawn cluster of a matching work, and palettes are stored
            // largest share first, so this is its biggest visible patch — the one
            // worth putting a ring on. Collected here rather than in a pass of its
            // own: this loop already walks every particle and already knows which
            // owner it is meeting for the first time.
            //
            // Unless the question named a cluster of its own: a colour search
            // matched one particular patch, and ringing the largest one instead
            // would put the mark on a colour that had nothing to do with the
            // answer. Safe to substitute here — every cluster of a work shares
            // its year and its school, so `wt` is identical across them and the
            // gate above decides the same way for all five.
            if (this.w[i] >= 0.12) {
              const named = this.markOf[o];
              this.marks[markN++] = named >= 0 ? named : i;
            }
          }
        }
      }

      let occupied = 0;
      for (let c = 0; c < density.length; c++) if (density[c] > 0) occupied++;
      this._weights = { total, works, occupied, matched, markN };
    }
    const { total, works, occupied, matched, markN } = this._weights;
    this.markN = markN;
    /* Which particles are on screen, as one string. Anything downstream that has
       to be rebuilt when the visible set changes — the list of what a search
       matched — compares this instead of guessing from the year. */
    this.viewKey = wKey;

    // Share of the period's measured colour, per cell of the plane — and then
    // relative to an even spread over the cells this period actually reaches. So
    // "1" is an ordinary cell for this year and the blob is about cell-sized;
    // above that it swells. Share rather than raw count, so scrubbing changes the
    // shape of the cloud instead of inflating it wherever the museum owns more.
    /* A cell is square in Lab and rectangular in chrono — a decade is not four
       points of L* — so the blob's reach is measured per axis. It stays round in
       cell space and becomes an ellipse in pixels, which is the honest way round:
       the offset means "this much crowding", not "this many pixels". */
    const cellPxX = chrono ? CELL_YEARS * this.tview.sx : CELL_LAB * this.view.scale;
    const cellPxY = chrono ? CELL_LUM * this.tview.sy : CELL_LAB * this.view.scale;
    const norm = total > 0 ? occupied / total : 0;
    const drift = reduceMotion ? 0 : DRIFT_PX;
    const ease = reduceMotion || !this.placed ? 1 : EASE;

    const omega = t * DRIFT_HZ * Math.PI * 2;
    const sinT = Math.sin(omega), cosT = Math.cos(omega);

    let colours = 0, from = this.y1, to = this.y0, moved = 0;
    for (let i = 0; i < n; i++) {
      const wt = this.w[i];
      if (wt === 0) continue;
      colours++;
      const yr = this.year[i];
      if (yr < from) from = yr;
      if (yr > to) to = yr;

      const relative = density[cell[i]] * norm;
      const cells = Math.min(SPREAD_CAP,
        SPREAD_FLOOR + SPREAD_GAIN * Math.sqrt(relative)) * this.jr[i];
      // sin(ωt + phase), by the angle-addition identity — see pcos/psin above.
      const wobble = drift * (sinT * this.pcos[i] + cosT * this.psin[i]);
      const tx = this.baseX(i) + this.jx[i] * (cells * cellPxX + wobble);
      const ty = this.baseY(i) + this.jy[i] * (cells * cellPxY + wobble);

      const dx = (tx - this.x[i]) * ease, dy = (ty - this.y[i]) * ease;
      this.x[i] += dx;
      this.y[i] += dy;
      const d = dx * dx + dy * dy;
      if (d > moved) moved = d;
      // Dominant clusters read heavier; the faintest edge of the window stays small
      // so that fading in looks like arriving, not like growing. Kept small on
      // purpose: the cloud should be a mist that many particles build, not a
      // scatter of discs you can count.
      this.rad[i] = (1.15 + 2.5 * this.mass[i]) * (0.5 + 0.5 * wt);
    }

    this.placed = true;
    /* How far the fastest particle travelled this frame, in CSS px. The renderer
     * uses it to decide whether the picture is worth redrawing: once the whole
     * collection has settled, the only motion left is the idle breathing, which
     * moves about 0.03 px per frame. Redrawing that 60 times a second repaints
     * 32,350 particles to change nothing an eye can see. */
    this.motion = Math.sqrt(moved);
    this.stats = { works, colours, from, to, sigma, matched };
  }

  /** Nearest drawn particle to a point, or -1. Called on click only. */
  pick(px, py, slop = 16) {
    let best = -1, bestD = slop * slop;
    for (let i = 0; i < this.n; i++) {
      if (this.w[i] < 0.12) continue;
      const dx = this.x[i] - px, dy = this.y[i] - py;
      const d = dx * dx + dy * dy;
      // Ties go to the more present particle: what you meant to click is what is
      // brightest under the cursor.
      if (d < bestD || (d < bestD * 1.6 && best >= 0 && this.w[i] > this.w[best] * 1.4)) {
        best = i; bestD = Math.min(d, bestD);
      }
    }
    return best;
  }
}

/** Case and accents folded away: nobody types Brueghel the same way twice, and the
    four catalogues do not agree with each other about diacritics either. */
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clampInt = (v, max) => (v < 0 ? 0 : v > max ? max : v);

/* A cheap deterministic hash. Math.random() would reshuffle the cloud on every
   reload, and the field is supposed to be the same picture every time. */
function hash01(x) {
  let h = (x * 2654435761) >>> 0;
  h ^= h >>> 15; h = (h * 2246822519) >>> 0;
  h ^= h >>> 13; h = (h * 3266489917) >>> 0;
  h ^= h >>> 16;
  // >>> before dividing: ^= yields a signed int32, and a negative here would have
  // put NaN into every sqrt() downstream.
  return (h >>> 0) / 4294967296;
}
