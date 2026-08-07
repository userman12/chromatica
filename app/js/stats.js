/* CHROMATICA — what the measurements add up to.
 *
 * The field shows every colour and argues nothing. The chroma curve under it
 * argues one thing, in one line, about the whole collection at once. This is
 * the layer in between: the same measurements grouped by the things a person
 * actually asks about — a painter, a school, a museum, a moment — and reduced
 * to numbers that can be ranked and compared.
 *
 * Two figures per group, and only two, because they are the two the field
 * itself is built out of:
 *
 *  - CHROMA, sqrt(a*² + b*²): how far a colour sits from grey. This is the
 *    measurement the whole piece is about. Its collapse between the fourteenth
 *    century and the seventeenth is the argument.
 *  - LIGHTNESS, L*: where a colour sits between black and white, which is the
 *    vertical axis of the default layout.
 *
 * Both are averaged unweighted across a painting's palette entries: the fifth
 * cluster counts as much as the first. Weighting by cluster share would make
 * the number track how much canvas a colour covers rather than which colours
 * were reached for, and the second is the question. This is the same choice
 * chromaCurve makes in field.js, and it is made the same way here so that a
 * ranking and the curve cannot disagree.
 *
 * Nothing here is computed until something asks for it, and nothing is computed
 * twice: the dataset does not change while the page is open.
 */

/* A ranking wants a floor. One work by an artist is a work, not a tendency,
   and a table whose top rows are all painters with two paintings each is a
   table about sampling noise. Eight is where the medieval Sienese and the
   Hudson River School still qualify while the long tail of single-work
   attributions does not — 177 painters out of 2,246, which is a list someone
   might actually read. */
export const RANK_MIN_WORKS = 8;

/* The window a painting is judged against when asking "was this bright for its
   time". Thirty years either side, which is about a working life and wide
   enough that the thinnest decades still have something to compare against.
   Not the adaptive window sigmaAt uses: that one exists to keep a *drawn*
   curve honest where the collection thins, and here a wider window in a thin
   century is exactly right — it is the only way the comparison exists at all. */
export const ERA_HALF_WIDTH = 30;

/* Below this many contemporaries a percentile is not reported. Nine works
   means the answer can only be one of ten values, and printing "more colourful
   than 89% of its time" off nine paintings claims a precision that is not
   there. */
const ERA_MIN_WORKS = 12;

export class Stats {
  /** @param {object} data the built chromatica.json
   *  @param {import("./field.js").Field} field the same works, already in Lab */
  constructor(data, field) {
    this.data = data;
    this.field = field;
    const paintings = data.paintings;
    const n = paintings.length;

    /* Per painting, averaged over its palette. field.js has already converted
       every colour to Lab and knows which particles belong to which work, so
       this is a walk over the particles rather than a second conversion. */
    this.chroma = new Float32Array(n);
    this.light = new Float32Array(n);
    const counts = new Uint8Array(n);
    for (let i = 0; i < field.n; i++) {
      const owner = field.owner[i];
      this.chroma[owner] += Math.hypot(field.lx[i], field.ly[i]);
      this.light[owner] += field.lum[i];
      counts[owner]++;
    }
    for (let p = 0; p < n; p++) {
      if (!counts[p]) continue;
      this.chroma[p] /= counts[p];
      this.light[p] /= counts[p];
    }

    /* Painting -> its first particle, which is the inverse of field.owner.
       Anything that reaches a painting by name rather than by clicking — a
       table row, a sibling thumbnail — has an index into `paintings` and needs
       a particle to select, and walking `owner` to find one is a scan of
       34,000 entries for a click. Palettes are stored largest share first, so
       the first particle is also the work's biggest patch, which is the one
       worth ringing. */
    this.firstParticle = new Int32Array(n);
    for (let p = 0, at = 0; p < n; p++) {
      this.firstParticle[p] = at;
      at += paintings[p].k.length;
    }

    this._groups = new Map();
    this._eras = new Map();
  }

  /**
   * Group the collection by one property and reduce each group to its numbers.
   *
   * @param {"artist"|"school"|"source"} by
   * @returns {{key: string, label: string, works: number,
   *            chroma: number, light: number, from: number, to: number}[]}
   */
  groups(by) {
    const hit = this._groups.get(by);
    if (hit) return hit;

    const meta = this.data.meta;
    const label = {
      artist: (p) => p.a || "Unattributed",
      school: (p) => meta.nationalities[p.n] || "Other / unattributed",
      source: (p) => meta.sources[p.c].name,
    }[by];

    const acc = new Map();
    this.data.paintings.forEach((p, i) => {
      const key = label(p);
      let g = acc.get(key);
      if (!g) acc.set(key, g = { key, label: key, works: 0, chroma: 0, light: 0,
                                 from: Infinity, to: -Infinity, items: [] });
      g.works++;
      g.chroma += this.chroma[i];
      g.light += this.light[i];
      if (p.y < g.from) g.from = p.y;
      if (p.y > g.to) g.to = p.y;
      g.items.push(i);
    });

    const out = [...acc.values()];
    for (const g of out) { g.chroma /= g.works; g.light /= g.works; }
    this._groups.set(by, out);
    return out;
  }

  /**
   * One ranking, ready to print.
   *
   * @param {"artist"|"school"|"source"} by
   * @param {"chroma"|"light"} measure
   * @param {"high"|"low"} end which end of the table
   * @param {number} limit
   */
  ranking(by, measure, end, limit = 12) {
    // The floor is about statistical weight, and only artists have a long tail
    // of one-work entries: there are twelve schools and five museums, and every
    // one of them holds hundreds of paintings.
    const floor = by === "artist" ? RANK_MIN_WORKS : 1;
    const rows = this.groups(by).filter((g) => g.works >= floor
      // "Unattributed" is not a painter, and a school called "Other" is the
      // absence of a school. Neither belongs in a table of who is most
      // anything -- but they stay in the school and source tables, where they
      // are a real and honest share of the collection.
      && !(by === "artist" && (g.key === "Unattributed" || g.key === "Anonymous")));
    const sorted = rows.slice().sort((a, b) =>
      end === "high" ? b[measure] - a[measure] : a[measure] - b[measure]);
    return sorted.slice(0, limit);
  }

  /**
   * Where one painting sits among the works of its own time.
   *
   * "Chroma 14.2" is a number nobody has a feel for. "More muted than 71% of
   * what was painted around it" is the same measurement as a statement, and it
   * is the statement the field makes visually — this is only saying it in
   * words for one work.
   *
   * @returns {{chroma: number, light: number, works: number,
   *            from: number, to: number} | null} percentiles in 0..1, or null
   *   when the painting's era is too thin to be worth quoting.
   */
  era(index) {
    const p = this.data.paintings[index];
    const from = p.y - ERA_HALF_WIDTH, to = p.y + ERA_HALF_WIDTH;
    const key = `${from}`;
    let band = this._eras.get(key);
    if (!band) {
      // The paintings array is in year order, so the band is a contiguous slice
      // and can be found by walking rather than filtering the whole collection.
      const paintings = this.data.paintings;
      let lo = 0, hi = paintings.length;
      while (lo < hi && paintings[lo].y < from) lo++;
      let end = lo;
      while (end < hi && paintings[end].y <= to) end++;
      const chroma = [], light = [];
      for (let i = lo; i < end; i++) { chroma.push(this.chroma[i]); light.push(this.light[i]); }
      chroma.sort((a, b) => a - b);
      light.sort((a, b) => a - b);
      band = { chroma, light, works: end - lo, from, to };
      this._eras.set(key, band);
    }
    if (band.works < ERA_MIN_WORKS) return null;
    return {
      chroma: share(band.chroma, this.chroma[index]),
      light: share(band.light, this.light[index]),
      works: band.works, from: band.from, to: band.to,
    };
  }

  /**
   * The other works by the same hand, nearest in date first.
   *
   * Only possible since the five catalogues' spellings were folded into one
   * name per painter: before that Rembrandt was three artists and this would
   * have shown a third of his work while claiming to show all of it.
   *
   * @returns {number[]} painting indices, never including `index` itself
   */
  siblings(index, limit = 12) {
    const artist = this.data.paintings[index].a;
    if (!artist || artist === "Unattributed") return [];
    const group = this.groups("artist").find((g) => g.key === artist);
    if (!group) return [];
    const year = this.data.paintings[index].y;
    return group.items
      .filter((i) => i !== index)
      .sort((a, b) => Math.abs(this.data.paintings[a].y - year)
                    - Math.abs(this.data.paintings[b].y - year))
      .slice(0, limit);
  }
}

/** Fraction of `sorted` that lies below `value`, by binary search. */
function share(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return sorted.length ? lo / sorted.length : 0;
}
