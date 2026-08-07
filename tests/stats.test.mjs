/* The derived measurements: aggregates, rankings, percentiles, siblings.
 *
 * These are numbers the interface will print as statements — "more muted than
 * 71% of its time", "the most colourful painter here" — and a statement is a
 * claim in a way a cloud of particles is not. So the arithmetic is pinned
 * against hand-checkable fixtures, and then against the published dataset,
 * where the thing worth asserting is not a value but a shape: that the floors
 * hold, that the tables are actually sorted, that nothing claims a precision
 * the sample does not have.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Field } from "../app/js/field.js";
import { Stats, RANK_MIN_WORKS, ERA_HALF_WIDTH } from "../app/js/stats.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A dataset with known colours, so the averages can be worked out by hand. */
function fixture() {
  const paintings = [];
  const add = (y, artist, school, source, colours) => paintings.push({
    i: String(paintings.length), c: source, t: `Work ${paintings.length}`,
    a: artist, y, s: y, e: y, n: school, k: colours,
  });
  // A saturated painter and a grey one, in the same years, so a ranking has an
  // unambiguous right answer.
  for (let k = 0; k < 10; k++) add(1500 + k, "Vivid", 0, 0, ["#ff0000", "#00ff00"]);
  for (let k = 0; k < 10; k++) add(1500 + k, "Grey", 1, 0, ["#808080", "#7f7f7f"]);
  // Below the floor: must never appear in an artist ranking however extreme.
  add(1505, "Barely Here", 0, 1, ["#ff00ff"]);
  return {
    meta: {
      yearRange: [1500, 1509],
      nationalities: ["Bright school", "Grey school"],
      sources: [{ key: "a", name: "Museum A" }, { key: "b", name: "Museum B" }],
    },
    paintings,
  };
}

function build(data = fixture()) {
  const field = new Field(data);
  return new Stats(data, field);
}

/* ---------- per-painting figures ---------- */

test("chroma and lightness are averaged over a painting's whole palette", () => {
  const stats = build();
  // Pure red and pure green are both far from grey; the average of the two
  // must be far from grey as well.
  assert.ok(stats.chroma[0] > 80, `saturated work read ${stats.chroma[0]}`);
  // Two near-identical greys average to something with no chroma at all.
  assert.ok(stats.chroma[10] < 1, `neutral work read ${stats.chroma[10]}`);
  // Mid grey sits near L*53.6, the standard sRGB reference.
  assert.ok(Math.abs(stats.light[10] - 53.4) < 1, `grey L* read ${stats.light[10]}`);
});

test("every painting gets a figure", () => {
  const stats = build();
  for (let i = 0; i < stats.data.paintings.length; i++) {
    assert.ok(Number.isFinite(stats.chroma[i]), `painting ${i} has no chroma`);
    assert.ok(Number.isFinite(stats.light[i]), `painting ${i} has no lightness`);
  }
});

/* ---------- grouping ---------- */

test("groups partition the collection with no work lost or doubled", () => {
  const stats = build();
  for (const by of ["artist", "school", "source"]) {
    const total = stats.groups(by).reduce((n, g) => n + g.works, 0);
    assert.equal(total, stats.data.paintings.length, `${by} groups do not add up`);
  }
});

test("a group's span is the span of its own works", () => {
  const stats = build();
  const vivid = stats.groups("artist").find((g) => g.key === "Vivid");
  assert.equal(vivid.works, 10);
  assert.equal(vivid.from, 1500);
  assert.equal(vivid.to, 1509);
});

/* ---------- rankings ---------- */

test("a ranking is sorted, and by the end it was asked for", () => {
  const stats = build();
  const high = stats.ranking("artist", "chroma", "high");
  const low = stats.ranking("artist", "chroma", "low");
  assert.equal(high[0].key, "Vivid", "the saturated painter tops the high table");
  assert.equal(low[0].key, "Grey", "the neutral painter tops the low table");
  for (let i = 1; i < high.length; i++) {
    assert.ok(high[i - 1].chroma >= high[i].chroma, "high table is out of order");
  }
  for (let i = 1; i < low.length; i++) {
    assert.ok(low[i - 1].chroma <= low[i].chroma, "low table is out of order");
  }
});

test("an artist under the floor never appears, however extreme", () => {
  // Magenta is the most saturated thing in the fixture, and it is one painting.
  // A table whose top row is a single work is a table about sampling noise.
  const stats = build();
  const names = stats.ranking("artist", "chroma", "high", 50).map((g) => g.key);
  assert.ok(!names.includes("Barely Here"),
    "a one-work artist reached the ranking");
});

test("schools and museums have no floor, because they cannot be thin", () => {
  const stats = build();
  const schools = stats.ranking("school", "chroma", "high", 50);
  assert.equal(schools.length, 2, "both schools must be listed");
  const sources = stats.ranking("source", "chroma", "high", 50);
  assert.equal(sources.length, 2, "both museums must be listed");
});

test("Unattributed is not a painter", () => {
  const data = fixture();
  for (let k = 0; k < 20; k++) {
    data.paintings.push({ i: `u${k}`, c: 0, t: "?", a: "Unattributed",
                          y: 1500, s: 1500, e: 1500, n: 0, k: ["#ff0000"] });
  }
  const stats = build(data);
  const names = stats.ranking("artist", "chroma", "high", 50).map((g) => g.key);
  assert.ok(!names.includes("Unattributed"));
  // But it is still a real share of the collection, so it stays in the groups.
  assert.ok(stats.groups("artist").some((g) => g.key === "Unattributed"));
});

test("the limit is honoured", () => {
  const stats = build();
  assert.equal(stats.ranking("artist", "chroma", "high", 1).length, 1);
});

/* ---------- percentile within an era ---------- */

test("a percentile places a work among its contemporaries", () => {
  const stats = build();
  const vivid = stats.era(0);       // a saturated work
  const grey = stats.era(10);       // a neutral one, same years
  assert.ok(vivid, "the fixture era should be thick enough to quote");
  assert.ok(vivid.chroma > 0.4, `saturated work placed at ${vivid.chroma}`);
  assert.ok(grey.chroma < 0.6, `neutral work placed at ${grey.chroma}`);
  assert.ok(vivid.chroma > grey.chroma, "the saturated work must place higher");
});

test("a percentile is a fraction, and the era reports its own width", () => {
  const stats = build();
  const era = stats.era(0);
  assert.ok(era.chroma >= 0 && era.chroma <= 1, "chroma percentile out of range");
  assert.ok(era.light >= 0 && era.light <= 1, "lightness percentile out of range");
  assert.equal(era.to - era.from, ERA_HALF_WIDTH * 2);
  assert.ok(era.works > 0);
});

test("a thin era is not quoted at all", () => {
  // Three works, alone in their century: any percentile off this is one of
  // three values dressed up as a measurement.
  const data = {
    meta: { yearRange: [1400, 1402], nationalities: ["X"], sources: [{ key: "a", name: "A" }] },
    paintings: [0, 1, 2].map((k) => ({
      i: String(k), c: 0, t: "t", a: "A", y: 1400 + k, s: 1400 + k, e: 1400 + k,
      n: 0, k: ["#ff0000"],
    })),
  };
  assert.equal(build(data).era(0), null, "a three-work era must not be quoted");
});

/* ---------- siblings ---------- */

test("siblings are the same hand, never the work itself", () => {
  const stats = build();
  const others = stats.siblings(0);
  assert.ok(others.length > 0);
  assert.ok(!others.includes(0), "a painting is not its own sibling");
  for (const i of others) {
    assert.equal(stats.data.paintings[i].a, "Vivid", "a sibling is by another hand");
  }
});

test("siblings come back nearest in date first", () => {
  const stats = build();
  const year = stats.data.paintings[0].y;
  const gaps = stats.siblings(0).map((i) => Math.abs(stats.data.paintings[i].y - year));
  assert.deepEqual(gaps, gaps.slice().sort((a, b) => a - b));
});

test("an unattributed work has no siblings", () => {
  const data = fixture();
  data.paintings[0].a = "Unattributed";
  // Without this, every anonymous panel in the collection would be presented
  // as another work by the same painter.
  assert.deepEqual(build(data).siblings(0), []);
});

/* ---------- against the published dataset ---------- */

test("the real collection produces sane tables", () => {
  const file = join(ROOT, "app", "data", "chromatica.json");
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); }
  catch { return; }   // dataset not built; the fixture tests still stand

  const stats = build(data);
  const top = stats.ranking("artist", "chroma", "high", 10);
  assert.equal(top.length, 10);
  for (const row of top) {
    assert.ok(row.works >= RANK_MIN_WORKS, `${row.key} is under the floor`);
    assert.ok(row.chroma > 0 && row.chroma < 140, `${row.key} chroma ${row.chroma}`);
  }
  // The piece's own argument, asserted: colour peaks early. If the top of this
  // table ever stops being medieval, either the data or the claim has moved.
  const medieval = top.filter((g) => g.to < 1500).length;
  assert.ok(medieval >= 2,
    `expected early painters at the top of the chroma table, got ${
      top.map((g) => `${g.key} (${g.from}-${g.to})`).join(", ")}`);

  // Every painting can be asked about without throwing, and the percentile is
  // either a real fraction or an honest null.
  for (let i = 0; i < data.paintings.length; i += 97) {
    const era = stats.era(i);
    if (era) {
      assert.ok(era.chroma >= 0 && era.chroma <= 1);
      assert.ok(era.light >= 0 && era.light <= 1);
    }
  }
});
