/* The pure arithmetic under the field.
 *
 * Run with `node --test tests/` — the runner is built into Node, so this suite
 * adds no dependency to a project that deliberately has none. `.mjs` because
 * there is no package.json to declare the module type in, and field.js is one.
 *
 * Only field.js is covered, and on purpose: it is the whole of the measurement
 * — colour conversion, placement, the window, the two searches — and the only
 * module that touches neither the DOM nor a canvas. nebula.js and main.js are
 * drawing and wiring; what they do is judged by looking at the field, which is
 * what the piece is for.
 *
 * What is tested here is the part that has to be *right* rather than pleasing:
 * a wrong Lab conversion or a non-deterministic hash would not look broken, it
 * would look like a slightly different painting collection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Field, rgbToLab, CHROMA_AXIS, ORDER_BAND } from "../app/js/field.js";

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: expected ${expected} ± ${tol}, got ${actual}`);

/* A dataset shaped like the real one but small enough to reason about. Two
   schools, a sparse early century and a dense late one — the shape sigmaAt
   exists to cope with. */
function fixture() {
  const paintings = [];
  const add = (y, n, k) => paintings.push({
    i: String(paintings.length), c: 0, t: `Work ${paintings.length}`,
    a: "Anon", y, s: y, e: y, n, b: 0, k,
  });
  // 1400–1409: one work a year, one school.
  for (let y = 1400; y < 1410; y++) add(y, 0, ["#804020", "#40608a"]);
  // 1890–1899: forty a year, the other school.
  for (let y = 1890; y < 1900; y++) {
    for (let j = 0; j < 40; j++) add(y, 1, ["#c04030", "#308050", "#f0e0d0"]);
  }
  return {
    meta: { yearRange: [1400, 1899], nationalities: ["Early", "Late"] },
    paintings,
  };
}

/* ---------- sRGB → CIE L*a*b* ---------- */

test("rgbToLab puts the D65 white point at L*100 and neutral chroma", () => {
  const [L, a, b] = rgbToLab(255, 255, 255);
  close(L, 100, 0.01, "L* of white");
  close(a, 0, 0.01, "a* of white");
  close(b, 0, 0.01, "b* of white");
});

test("rgbToLab puts black at the origin", () => {
  const [L, a, b] = rgbToLab(0, 0, 0);
  close(L, 0, 1e-9, "L* of black");
  close(a, 0, 1e-9, "a* of black");
  close(b, 0, 1e-9, "b* of black");
});

test("rgbToLab agrees with published sRGB reference values", () => {
  // Mid grey is neutral and sits near L*53.6 — the standard check that the
  // gamma decode is in the right place. A wrong or missing decode lands it
  // near L*46.6 instead, which is a whole different-looking field.
  const [Lg, ag, bg] = rgbToLab(128, 128, 128);
  close(Lg, 53.585, 0.02, "L* of #808080");
  close(ag, 0, 0.01, "a* of #808080");
  // Pure red: the most commonly tabulated non-neutral.
  const [Lr, ar, br] = rgbToLab(255, 0, 0);
  close(Lr, 53.24, 0.02, "L* of red");
  close(ar, 80.09, 0.05, "a* of red");
  close(br, 67.20, 0.05, "b* of red");
  // Pure blue, which is where a swapped a*/b* would show up unmistakably.
  const [, ab_, bb] = rgbToLab(0, 0, 255);
  close(ab_, 79.19, 0.05, "a* of blue");
  close(bb, -107.86, 0.05, "b* of blue");
});

test("chroma is highest for saturated colour and ~0 for neutrals", () => {
  const chroma = (r, g, b) => { const [, a, bb] = rgbToLab(r, g, b); return Math.hypot(a, bb); };
  assert.ok(chroma(200, 200, 200) < 0.01, "a neutral must have no chroma");
  assert.ok(chroma(255, 0, 0) > 100, "pure red must be far from grey");
});

/* ---------- determinism ----------
   The field is supposed to be the same picture every time. Everything that
   places a particle off its exact coordinate is hashed from the index rather
   than drawn from Math.random, so this is the property the whole visual
   identity of the piece rests on. */

test("the field composes identically from the same data", () => {
  const a = new Field(fixture()), b = new Field(fixture());
  const args = { year: null, t: 0, nat: -1, chrono: true };
  a.resize(1200, 700); b.resize(1200, 700);
  a.step(args); b.step(args);
  assert.deepEqual(Array.from(a.x), Array.from(b.x), "x positions must match");
  assert.deepEqual(Array.from(a.y), Array.from(b.y), "y positions must match");
  assert.deepEqual(Array.from(a.order), Array.from(b.order), "draw order must match");
});

test("scrubbing away from a year and back restores the same positions", () => {
  /* Only over the particles the year actually lights. step() skips anything
     outside the window rather than moving it, so a particle that is not in
     view holds wherever it last stood — which is what lets it ease back in
     from its old place instead of teleporting when the window returns. Its
     stale coordinate is not part of the picture and is not asserted here. */
  const F = new Field(fixture());
  F.resize(1200, 700);
  const at = (year) => {
    F.step({ year, t: 0, reduceMotion: true, chrono: true });
    return Array.from(F.x, (v, i) => (F.w[i] > 0 ? v : null));
  };
  const first = at(1895);
  at(1420);
  assert.deepEqual(at(1895), first, "the same year must recompose the same way");
  assert.ok(first.some((v) => v !== null), "the fixture must light something at 1895");
});

/* ---------- the temporal window ---------- */

test("sigmaAt widens where the collection thins", () => {
  const F = new Field(fixture());
  const sparse = F.sigmaAt(1405);   // one work a year
  const dense = F.sigmaAt(1895);    // forty a year
  assert.ok(sparse > dense,
    `the window must open in thin centuries: got ${sparse} sparse vs ${dense} dense`);
});

test("sigmaAt stays inside its own clamps everywhere", () => {
  const F = new Field(fixture());
  for (let y = F.y0; y <= F.y1; y++) {
    const s = F.sigmaAt(y);
    assert.ok(s >= 9 && s <= 44, `sigma out of range at ${y}: ${s}`);
    assert.ok(Number.isFinite(s), `sigma is not finite at ${y}`);
  }
});

/* ---------- the school filter ---------- */

test("a school filter admits only that school", () => {
  const F = new Field(fixture());
  F.resize(1200, 700);
  F.step({ year: null, t: 0, nat: 1, chrono: true });
  for (let i = 0; i < F.n; i++) {
    if (F.w[i] > 0) assert.equal(F.natOf[i], 1, `particle ${i} is not of the filtered school`);
  }
  assert.ok(F.stats.works > 0, "the filter must leave something standing");
});

test("a work with no school does not leak through every school filter", () => {
  /* The regression behind the nat2 guard in step(). natOf falls back to -1 for
     a painting the build left without a school, and -1 is also how "no second
     school" is spelled — so the bare `school !== nat2` matched the *absence* of
     a filter and let that work through whichever school was selected. */
  const data = fixture();
  data.paintings.push({
    i: "orphan", c: 0, t: "No school", a: "Anon",
    y: 1895, s: 1895, e: 1895, n: null, b: 0, k: ["#123456"],
  });
  const F = new Field(data);
  F.resize(1200, 700);
  assert.equal(F.natOf[F.n - 1], -1, "the fixture must actually produce the -1 fallback");
  F.step({ year: null, t: 0, nat: 1, chrono: true });
  assert.equal(F.w[F.n - 1], 0, "an unattributed work must not appear under a school filter");
});

/* ---------- search ---------- */

test("search folds case and accents and requires every term", () => {
  const data = fixture();
  data.paintings[0].a = "Paul Cézanne";
  data.paintings[0].t = "Still Life with Apples";
  const F = new Field(data);
  assert.equal(F.setSearch("cezanne"), 1, "accents must fold");
  assert.equal(F.setSearch("CÉZANNE"), 1, "case must fold");
  assert.equal(F.setSearch("apples cezanne"), 1, "terms may arrive in any order");
  assert.equal(F.setSearch("cezanne rouen"), 0, "every term must match");
  assert.equal(F.setSearch(""), 0, "an empty query is not a search");
  assert.equal(F.searching, false, "an empty query leaves nothing standing");
});

test("a non-matching work dims but stays clickable", () => {
  /* The whole argument of the search: it dims rather than filters, so an answer
     is read against the collection it came out of. The dimmed weight has to
     stay above the 0.12 floor pick() uses, or the rest of the field would be
     visible and unclickable — which is worse than either. */
  const F = new Field(fixture());
  F.resize(1200, 700);
  F.setSearch("nothing matches this");
  F.step({ year: null, t: 0, nat: -1, chrono: true });
  let dimmed = 0;
  for (let i = 0; i < F.n; i++) if (F.w[i] > 0) { dimmed++; assert.ok(F.w[i] >= 0.12); }
  assert.ok(dimmed > 0, "a failed search must not empty the field");
});

/* ---------- colours like this one ---------- */

test("setNear excludes the source painting and respects its ceiling", () => {
  const F = new Field(fixture());
  F.resize(1200, 700);
  const found = F.setNear(0);
  assert.ok(found.works > 0, "something must come back");
  assert.ok(found.works <= 24, `NEAR_WORKS caps the answer, got ${found.works}`);
  assert.ok(found.worst <= 16, `NEAR_CEILING caps the reach, got ${found.worst}`);
  // matchOf is a Float32Array, so the dimmed value is fround(0.22), not 0.22.
  close(F.matchOf[F.owner[0]], 0.22, 1e-6,
    "the painting being asked about must not answer its own question");
});

test("setNear ranks the nearest colour first", () => {
  const F = new Field(fixture());
  F.resize(1200, 700);
  F.setNear(0);
  F.step({ year: null, t: 0, nat: -1, chrono: true });
  const list = F.matchList();
  assert.ok(list.length > 0, "the answer must reach the field as marks");
  const [L0, a0, b0] = [F.lum[0], F.lx[0], F.ly[0]];
  for (const i of list) {
    const d = Math.hypot(F.lum[i] - L0, F.lx[i] - a0, F.ly[i] - b0);
    assert.ok(d <= 16, `a returned work sits at ΔE ${d.toFixed(1)}, past the ceiling`);
  }
});

/* ---------- the chroma curve ---------- */

test("the chroma curve is drawn only where it has support", () => {
  const F = new Field(fixture());
  const { v, ok } = F.chromaCurve(-1);
  assert.equal(v.length, F.y1 - F.y0 + 1, "one value per year");
  for (let i = 0; i < v.length; i++) {
    if (ok[i]) assert.ok(v[i] > 0 && Number.isFinite(v[i]), `drawn but meaningless at index ${i}`);
  }
  // The sparse century holds two works a year against forty: it must not be
  // asserted, and the dense one must.
  assert.equal(ok[1405 - F.y0], 0, "a thin stretch must be a gap, not a guess");
  assert.equal(ok[1895 - F.y0], 1, "a dense stretch must be drawn");
});

test("chroma marks sit on the curve they label", () => {
  const F = new Field(fixture());
  const { v, ok } = F.chromaCurve(-1);
  for (const mark of F.chromaMarks(-1)) {
    const i = mark.year - F.y0;
    assert.equal(ok[i], 1, `a mark at ${mark.year} sits where the curve is not drawn`);
    close(mark.v, v[i], 1e-6, `the mark's value at ${mark.year}`);
    assert.ok(mark.share > 0 && mark.share <= 1, "share is a fraction of the highest");
  }
});

/* ---------- picking ---------- */

test("pick returns the particle under the point, or -1", () => {
  const F = new Field(fixture());
  F.resize(1200, 700);
  F.step({ year: null, t: 0, reduceMotion: true, nat: -1, chrono: true });
  const target = F.order[Math.floor(F.n / 2)];
  assert.equal(F.pick(F.x[target], F.y[target], 2), target, "a direct hit must be found");
  assert.equal(F.pick(-500, -500), -1, "empty space must return -1");
});

/* ---------- the tuning constants the renderer depends on ---------- */

test("the exported tuning constants are what nebula.js assumes", () => {
  assert.equal(ORDER_BAND, 5, "nebula.js walks the dark run with this slack");
  assert.deepEqual(CHROMA_AXIS, [10, 30], "the strip draws both curves against this fixed axis");
});
