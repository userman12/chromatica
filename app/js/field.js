/* CHROMATICA — the colour field.
 *
 * Every extracted colour of every painting is one particle. There is no grid, no
 * cell and no sorting: a particle's place in the field is its place in the CIE
 * L*a*b* chromatic plane, so neutrals sit in the middle, saturated colours reach
 * the rim, and hue runs around as angle. Colours that look alike end up near each
 * other because that is what the space means — the regions in the cloud are not
 * drawn, they are the consequence of the measurement.
 *
 * Lightness is deliberately NOT given a third coordinate. Against near-black it is
 * already visible as the particle's own luminance, and inventing an axis for it
 * would put a made-up direction into a picture whose whole claim is that no
 * direction is made up. A dim cloud is a dark century.
 *
 * Time is a weight, not a position. The default state weights every painting
 * equally: the whole collection at once, six centuries in one field. Turning the
 * timelapse on replaces that flat weight with a Gaussian on the distance from each
 * painting's year to the cursor, and the weight drives opacity, size and how far
 * the particle is pushed out from its exact colour coordinate. That last part is
 * the density mechanism: when many paintings share a region of the plane, the
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

const CELL_LAB = 6;        // density-histogram cell, in L*a*b* units
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
const SPREAD_GAIN = 0.85;  // how much a cell's blob grows with its share
const SPREAD_CAP = 2.1;    // no blob ever reaches further than this, in cells
const EASE = 0.075;        // per-frame approach to the target position: fluid, not snapped
const DRIFT_PX = 5.5;      // amplitude of the idle breathing
const DRIFT_HZ = 0.055;
const RANK_MASS = [1, 0.86, 0.74, 0.64, 0.56]; // k-means clusters come largest-share first

export class Field {
  /** @param {object} data the built chromatica.json */
  constructor(data) {
    const paintings = data.paintings;
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

    this.x = new Float32Array(n);       // live position, CSS px
    this.y = new Float32Array(n);
    this.w = new Float32Array(n);       // current temporal weight, 0..1
    this.rad = new Float32Array(n);

    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
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
        if (A < minA) minA = A; if (A > maxA) maxA = A;
        if (B < minB) minB = B; if (B > maxB) maxB = B;
        i++;
      }
    }

    this.bounds = { minA, maxA, minB, maxB };

    /* Draw order, darkest first.
     *
     * Compositing is source-over, so wherever two particles overlap the later one
     * wins — and with painting order (chronological) a dark particle landing on a
     * bright neighbour punched a black hole in the cloud, which read as damage
     * rather than as measurement. Going darkest-first means the brighter of two
     * overlapping measurements is the one that survives, which is also what the
     * eye expects of light against black. No colour is altered either way. */
    this.order = new Int32Array(n);
    for (let j = 0; j < n; j++) this.order[j] = j;
    const lum = this.lum;
    this.order.sort((a, b) => lum[a] - lum[b]);

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

    this.view = { ox: 0, oy: 0, scale: 1, short: 1 };
    this.placed = false;
    this.stats = { works: 0, colours: 0, from: y0, to: y1, sigma: 0 };
    // Counting distinct works per frame without allocating a Set each frame:
    // a stamp per painting, compared against the frame's own stamp.
    this.seenStamp = 0;
    this.seenAt = new Int32Array(paintings.length);
  }

  /**
   * Fit the chromatic plane into the viewport. The scale is one number for both
   * axes: a* and b* are the same unit, and stretching them independently would
   * make "close in colour" mean something different horizontally and vertically.
   */
  resize(cssW, cssH) {
    const { minA, maxA, minB, maxB } = this.bounds;
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
    this.cssW = cssW; this.cssH = cssH;
  }

  /** Where a particle's exact colour sits on screen, before any density offset. */
  baseX(i) { return this.view.ox + this.lx[i] * this.view.scale; }
  baseY(i) { return this.view.oy - this.ly[i] * this.view.scale; }

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
   * rather than being averaged into everyone else's.
   *
   * Returns nothing; positions and weights are read straight off the arrays.
   */
  step({ year = null, t = 0, reduceMotion = false, nat = -1 }) {
    const timed = year !== null;
    const sigma = timed ? this.sigmaAt(year) : 0;
    const inv = timed ? 1 / (2 * sigma * sigma) : 0;
    const { density, cell, n } = this;
    density.fill(0);

    const stamp = ++this.seenStamp;
    let total = 0, works = 0;
    for (let i = 0; i < n; i++) {
      if (nat >= 0 && this.natOf[i] !== nat) { this.w[i] = 0; continue; }
      let wt = 1;
      if (timed) {
        const d = this.year[i] - year;
        wt = Math.exp(-d * d * inv);
        if (wt < MIN_WEIGHT) { this.w[i] = 0; continue; }
      }
      this.w[i] = wt;
      const m = wt * this.mass[i];
      density[cell[i]] += m;
      total += m;
      const o = this.owner[i];
      if (this.seenAt[o] !== stamp) { this.seenAt[o] = stamp; works++; }
    }

    let occupied = 0;
    for (let c = 0; c < density.length; c++) if (density[c] > 0) occupied++;

    // Share of the period's measured colour, per cell of the plane — and then
    // relative to an even spread over the cells this period actually reaches. So
    // "1" is an ordinary cell for this year and the blob is about cell-sized;
    // above that it swells. Share rather than raw count, so scrubbing changes the
    // shape of the cloud instead of inflating it wherever the museum owns more.
    const cellPx = CELL_LAB * this.view.scale;
    const norm = total > 0 ? occupied / total : 0;
    const drift = reduceMotion ? 0 : DRIFT_PX;
    const ease = reduceMotion || !this.placed ? 1 : EASE;

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
      const wobble = drift * Math.sin(t * DRIFT_HZ * Math.PI * 2 + this.phase[i]);
      const reach = cells * cellPx + wobble;
      const tx = this.baseX(i) + this.jx[i] * reach;
      const ty = this.baseY(i) + this.jy[i] * reach;

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
     * 11,728 particles to change nothing an eye can see. */
    this.motion = Math.sqrt(moved);
    this.stats = { works, colours, from, to, sigma };
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
