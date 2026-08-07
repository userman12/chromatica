/* The story tells the truth, and keeps telling it.
 *
 * Seven sentences of prose quote seven numbers off the dataset — the peak, the
 * trough, where it ends, which school is lowest. Prose does not recompute
 * itself when a fifth collection is added, so without this the story becomes
 * the one part of the project that states figures nobody is checking. Adding
 * the Rijksmuseum moved the Dutch mean; the next source will move something
 * else.
 *
 * So this recomputes the chroma curve from the built dataset, the same way
 * field.js draws it, and asserts that every claim in story.js still holds. When
 * one fails, the fix is to look at what the data now says and rewrite the
 * sentence — not to loosen the test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Field } from "../app/js/field.js";
import { Stats } from "../app/js/stats.js";
import { STEPS } from "../app/js/story.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "app", "data", "chromatica.json");

let data = null;
try { data = JSON.parse(readFileSync(FILE, "utf8")); } catch { /* not built */ }

/** The drawn chroma curve, and its landmarks. */
function curve() {
  const field = new Field(data);
  const { v, ok } = field.chromaCurve(-1);
  let hi = -1, lo = -1, end = -1;
  for (let i = 0; i < v.length; i++) {
    if (!ok[i]) continue;
    if (hi < 0 || v[i] > v[hi]) hi = i;
    if (lo < 0 || v[i] < v[lo]) lo = i;
    end = i;
  }
  return {
    peak: { year: field.y0 + hi, value: v[hi] },
    trough: { year: field.y0 + lo, value: v[lo] },
    end: { year: field.y0 + end, value: v[end] },
  };
}

/** Every number the story states, in the step that states it. */
const CLAIMS = [
  [1, /reaches 27\b/, "the peak value"],
  [1, /around 1339/i, "the peak year"],
  [2, /fallen to 15\b/, "the trough value"],
  [2, /1670s/, "the trough decade"],
  [4, /\b17 at the end/, "the closing value"],
  [4, /two thirds/, "the recovery as a fraction of the peak"],
];

test("the story quotes the curve's real landmarks", { skip: !data }, () => {
  const { peak, trough, end } = curve();

  // Each is checked against the sentence that carries it, so a failure names
  // the claim rather than just a number.
  assert.equal(Math.round(peak.value), 27, "the peak has moved");
  assert.ok(Math.abs(peak.year - 1339) <= 5, `the peak is now ${peak.year}`);
  assert.equal(Math.round(trough.value), 15, "the trough has moved");
  assert.ok(trough.year >= 1670 && trough.year < 1680,
    `the trough is now ${trough.year}, no longer the 1670s`);
  assert.equal(Math.round(end.value), 17, "the closing value has moved");

  const recovery = end.value / peak.value;
  assert.ok(recovery > 0.6 && recovery < 0.72,
    `the recovery is now ${(recovery * 100).toFixed(0)}%, no longer "two thirds"`);

  for (const [step, pattern, what] of CLAIMS) {
    assert.match(STEPS[step].text, pattern, `step ${step} no longer states ${what}`);
  }
});

test("the peak really is early and the trough really is Baroque", { skip: !data }, () => {
  const { peak, trough } = curve();
  assert.ok(peak.year < 1400, `"colour peaks early" is false: peak at ${peak.year}`);
  assert.ok(trough.year > 1600 && trough.year < 1750,
    `"then it goes out" places the trough in the Baroque; it is at ${trough.year}`);
  assert.ok(peak.value > trough.value * 1.5,
    "the collapse should be large enough to be worth a step of its own");
});

test("the Dutch really are the most muted school", { skip: !data }, () => {
  // Step 3 says so in plain words, and it is the one claim a new source is
  // most likely to overturn -- the Rijksmuseum was added precisely here.
  const stats = new Stats(data, new Field(data));
  const schools = stats.ranking("school", "chroma", "low", 3)
    .filter((g) => g.key !== "Other / unattributed");
  assert.equal(schools[0].key, "Dutch",
    `the lowest school is now ${schools[0].key}, not the Dutch`);
  assert.match(STEPS[3].text, /Dutch are the most muted/);
});

test("every step is a state the field could be put in by hand", { skip: !data }, () => {
  // A step that could not be reached with the controls would be a second,
  // special rendering -- and then the story would be showing something the
  // instrument cannot, which is exactly what this project does not do.
  const nats = data.meta.nationalities;
  for (const [i, step] of STEPS.entries()) {
    const s = step.state;
    assert.ok(["all", "time"].includes(s.mode), `step ${i}: unknown mode`);
    assert.equal(typeof s.chrono, "boolean", `step ${i}: no layout`);
    if (s.mode === "time") {
      assert.ok(Number.isInteger(s.year), `step ${i}: timelapse without a year`);
      assert.ok(s.year >= data.meta.yearRange[0] && s.year <= data.meta.yearRange[1],
        `step ${i}: year ${s.year} is outside the span`);
    }
    if (s.natName) {
      assert.ok(nats.includes(s.natName),
        `step ${i}: "${s.natName}" is not a school in this dataset`);
    }
  }
});

test("the story is short enough to be read", () => {
  assert.ok(STEPS.length >= 5 && STEPS.length <= 9,
    `${STEPS.length} steps is not a walk, it is a document`);
  for (const [i, step] of STEPS.entries()) {
    const words = step.text.split(/\s+/).length;
    assert.ok(words <= 80, `step ${i} is ${words} words; the panel it replaces was 903`);
    assert.ok(step.title.length <= 34, `step ${i}'s title is too long to sit in a bar`);
  }
});
