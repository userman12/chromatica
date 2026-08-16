/* CHROMATICA — application shell.
 *
 * The instrument has one surface and two independent controls over it.
 *
 *  - LAYOUT is where a colour stands. By default it stands at its year and its
 *    lightness, so the whole collection is one long chronological band: six
 *    centuries read left to right, dark below and light above. The other layout
 *    puts it at its a* and b* coordinate instead, the chromatic plane, where hue
 *    rather than time is the geography. Both are measurements; the toggle only
 *    chooses which two of them are the axes, and the field morphs between them.
 *  - TIMELAPSE is which colours are present. It replaces the flat weight with a
 *    window that moves through time, so the field thins to one period.
 *
 * The two compose: the timelapse in the chronological layout is a lit band walking
 * across the band; in the chromatic plane it is a cloud recomposing in place.
 *
 * Everything else is the panel it is mounted in: two HUD bars carrying the
 * measurement in cold monospace, and one line under the field naming its axes,
 * because an axis the viewer cannot name is a decoration.
 */
import { Field, CHROMA_AXIS } from "./field.js";
import { Nebula } from "./nebula.js";
import { Stats, RANK_MIN_WORKS } from "./stats.js";
import { STEPS } from "./story.js";
import { VIEWS, VIEW_NAMES, applyView } from "./views.js";
import { perf } from "./perf.js";

const PLAY_YEARS_PER_SEC = 7.5;   // the timelapse crawl
const SCRUB_SLOP = 4;             // px of movement still counted as a click
const STAGE_GAIN = 1.35;          // years per px when dragging on the field itself
const INK = 2600;                 // target colours on screen, for the alpha normaliser
/* Canvas 2D is retained: what was drawn stays on screen until something draws over
 * it. So a frame in which nothing moved more than this needs no draw call at all —
 * and the settled field, breathing at ~0.03 px per frame, is almost every frame.
 * The number is a visible-motion threshold, not a frame budget: the displayed
 * positions never lag the true ones by more than this, on particles whose blurred
 * radius is an order of magnitude larger. */
const REDRAW_PX = 0.25;
/* How long the selection ring takes to close onto the particle it names. Short
 * enough to read as a response rather than a transition, long enough that the eye
 * follows it to the blob instead of hunting for what changed. It only costs
 * frames because the cloud beneath it is held: the ring is a stroke over a blit. */
const RING_MS = 170;

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  scope: $("scope"),
  statWorks: $("statWorks"), statColours: $("statColours"),
  statSpan: $("statSpan"), statWindow: $("statWindow"),
  statSpanCell: $("statSpanCell"), statWindowCell: $("statWindowCell"),
  stage: $("stage"), field: $("field"), hint: $("hint"), hoverchip: $("hoverchip"),
  axes: $("axes"), btnLayout: $("btnLayout"),
  cursorValue: $("cursorValue"),
  natFilter: $("natFilter"),
  search: $("search"), searchCount: $("searchCount"), searchList: $("searchList"),
  btnTimelapse: $("btnTimelapse"), btnPlay: $("btnPlay"),
  btnInfo: $("btnInfo"), foot: $("foot"), head: $("head"), views: $("views"),
  // The footer's control groups, as groups: a reading claims or releases each
  // of these whole rather than button by button. See views.js CONTROLS.
  cursor: $("cursor"), findWrap: $("findWrap"), schoolWrap: $("schoolWrap"),
  timelapseWrap: $("timelapseWrap"), timelineWrap: $("timelineWrap"),
  tables: $("tables"), tablesClose: $("tablesClose"),
  tableBy: $("tableBy"), tableMeasure: $("tableMeasure"),
  tableHigh: $("tableHigh"), tableLow: $("tableLow"),
  tablesNote: $("tablesNote"),
  tablesHighLabel: $("tablesHighLabel"), tablesLowLabel: $("tablesLowLabel"),
  timeline: $("timelineCanvas"), timelineLabel: $("timelineLabel"),
  markChip: $("markChip"),
  about: $("about"), aboutClose: $("aboutClose"), aboutStory: $("aboutStory"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailTitle: $("detailTitle"), detailArtist: $("detailArtist"),
  detailYear: $("detailYear"), detailNat: $("detailNat"), detailId: $("detailId"),
  detailSource: $("detailSource"), aboutSources: $("aboutSources"),
  detailPalette: $("detailPalette"), detailSwatches: $("detailSwatches"),
  detailLink: $("detailLink"), btnNear: $("btnNear"),
  detailEra: $("detailEra"), detailKin: $("detailKin"),
  detailKinLabel: $("detailKinLabel"), detailKinList: $("detailKinList"),
  compare: $("compare"), compareClose: $("compareClose"),
  compareA: $("compareA"), compareB: $("compareB"),
  compareFiguresA: $("compareFiguresA"), compareFiguresB: $("compareFiguresB"),
  compareNote: $("compareNote"), compareVerdict: $("compareVerdict"),
  story: $("story"), storyClose: $("storyClose"), storyCount: $("storyCount"),
  storyTitle: $("storyTitle"), storyText: $("storyText"),
  storyBack: $("storyBack"), storyNext: $("storyNext"), storyDots: $("storyDots"),
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null, field: null, stats: null,
  view: "field",         // which reading is in front
  tableBy: "artist",     // what the tables group by
  tableMeasure: "chroma",
  step: -1,              // position in the story, -1 when not in it
  mode: "all",        // "all" = the whole span at once, "time" = the timelapse
  chrono: true,       // layout: true = year × lightness, false = the a* and b* plane
  playing: false,
  cursor: 0,          // the timelapse year, kept as a float so play is smooth
  nat: -1,            // school filter, -1 for all
  query: "",          // free text over title and artist; dims, never removes
  near: -1,           // the colour being asked about, or -1; the other question
  nearInfo: null,     // {hex, worst} — what that question was, for the list header
  selected: -1,       // particle index
  matchAt: -1,        // position in the current list of matches, -1 = not stepping
  matchTotal: 0,
  matchIds: [],       // the matching particles, in the order the list shows them
  preview: -1,        // particle ringed by pointing at a result row, not selected
  listKey: null,      // field.viewKey the list was built from
  hover: -1,
  hintSpent: false,   // the opening line has been read; it does not come back
  tlMark: -1,         // index into field.chromaMarks(nat), the one under the pointer
  cssW: 0, cssH: 0,
  tlW: 0, tlH: 0,
  footH: 0,           // the footer's real height, published to CSS as --foot-h
  headH: 0,           // and the header's, as --head-h
  // Last values written to the DOM and to the strip. The field is redrawn every
  // frame because it moves; the panel is not. Writing four readout nodes and 600
  // bars on every frame cost more than all 32,350 particles did.
  ui: {}, tlKey: "", scopeKey: null,
  debt: 0,            // unpainted motion, in CSS px
  dirty: true,        // the cloud itself changed: filter, year, layout, search, size
  marks: true,        // only the marks over it changed: selection, preview, ring
  ringAt: 0,          // when the current selection landed, for its arrival
};
const nebula = new Nebula(el.field);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (n) => n.toLocaleString("en-US");
const span = (s, e) => (s === e ? String(s) : `${s}–${e}`);

/* ---------- boot ---------- */
const bootLines = ["CHROMATICA v0.3"];
const boot = (line) => {
  bootLines.push(line);
  el.bootLog.textContent = bootLines.join("\n");
};

/* ---------- view ---------- */
function measure() {
  const rect = el.stage.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  if (w === state.cssW && h === state.cssH) return;   // observed, so called often
  state.cssW = w;
  state.cssH = h;
  // The canvas is sized in whole pixels, so it is also *placed* in whole pixels
  // rather than left at height:100% of a box that is 484.4 tall. Otherwise CSS
  // stretches the backing store by the fraction, and a click is read through a
  // scale the picker knows nothing about. Sub-pixel, but this is the coordinate
  // system every pick and every hover chip is measured in.
  el.field.style.width = `${w}px`;
  el.field.style.height = `${h}px`;
  nebula.resize(state.cssW, state.cssH);
  state.field.resize(state.cssW, state.cssH);
  state.tlW = el.timeline.clientWidth;
  state.tlH = el.timeline.clientHeight;
  state.tlKey = "";   // force the strip to redraw at the new size
  state.dirty = true;
}

/* The footer's real height, published to CSS.
 *
 * `--foot-h` is what the detail panel, the about panel and the results list all
 * stand on: each is fixed to the viewport and clears the footer by sitting at
 * that height plus a margin. It was a constant — 96px, and 116px under 720px —
 * and the footer is not a constant. `.controls` wraps, so on a narrow screen it
 * is three rows of controls above the strip, comfortably past either number,
 * and a panel opened *over* the timeline it was written to clear.
 *
 * Measured rather than computed, for the same reason lockWidths measures: the
 * height depends on the font the machine happens to have and on where the flex
 * row happens to break, and neither is knowable from here. Nothing that reads
 * `--foot-h` can change the footer's own height — they are all fixed-position
 * offsets — so writing it back cannot start a loop.
 */
function measureFoot() {
  const h = Math.ceil(el.foot.getBoundingClientRect().height);
  if (h === state.footH) return;
  state.footH = h;
  document.documentElement.style.setProperty("--foot-h", `${h}px`);
}

/* The header's real height, for the same reason and by the same means.
 *
 * `--hud-h` is a *minimum*, not a height: the top bar wraps to two rows on a
 * narrow screen and measures 87px where the variable says 58. A panel pinned
 * below the bar using the variable therefore began above it and covered the
 * very menu that opens it. Measured, like everything else here that has to
 * clear a bar whose height nobody can name in advance. */
function measureHead() {
  const h = Math.ceil(el.head.getBoundingClientRect().height);
  if (h === state.headH) return;
  state.headH = h;
  document.documentElement.style.setProperty("--head-h", `${h}px`);
}

/* Nothing in these two bars may change width when its text changes. CHROMATIC
   PLANE is five characters longer than CHRONOLOGY, so pressing it moved every
   button beside it; the works count loses a digit as you scrub, so the readout
   above the field twitched sixty times a second. Both are the same fault as the
   footer that resized the canvas: this interface sits around a picture, and a
   control that grows pushes the picture.
   Measured rather than computed. The font is whatever the machine has — there is
   no @font-face here — so a width in `ch` would be right on the machines that
   have JetBrains Mono and wrong on the rest. Each element is shown every string
   it will ever hold, and keeps the widest. */
function lockWidths() {
  const lock = (node, variants) => {
    const text = node.textContent, cls = node.className;
    node.style.minWidth = "";   // or a second pass would only ever measure the first
    let widest = 0;
    for (const v of variants) {
      node.textContent = typeof v === "string" ? v : v.text;
      if (typeof v !== "string") node.className = v.className;
      widest = Math.max(widest, node.getBoundingClientRect().width);
    }
    node.textContent = text;
    node.className = cls;
    node.style.minWidth = `${Math.ceil(widest)}px`;
  };
  const F = state.field, works = state.data.paintings.length;
  const wholeSpan = span(F.y0, F.y1);
  lock(el.btnLayout, ["CHROMATIC PLANE", "CHRONOLOGY"]);
  lock(el.btnPlay, ["❚❚", "▶"]);
  lock(el.cursorValue, [String(F.y1)]);
  lock(el.statWorks, [num(works)]);
  lock(el.statColours, [num(F.n)]);
  lock(el.statSpan, [wholeSpan, "—"]);
  lock(el.statWindow, ["ALL", "±999 YR"]);
  lock(el.searchCount, [`${num(works)} OF ${num(works)} ↵`]);
  // Both strings the strip's own label can take, since it sits beside a canvas
  // that takes the rest of the row.
  lock(el.timelineLabel, ["DRAG TO SCRUB", "CLICK FOR TIMELAPSE"]
    .map((a) => `BARS WORKS · LINE CHROMA · ${a}`));
}

/* ---------- the loop ---------- */
let t0 = 0;
let last = 0;

function frame(now) {
  if (perf) perf.frame(now);
  const t = (now - (t0 ||= now)) / 1000;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;

  if (state.mode === "time" && state.playing) {
    state.cursor += PLAY_YEARS_PER_SEC * dt;
    if (state.cursor > state.field.y1) state.cursor = state.field.y0;   // a timelapse loops
  }

  const tStep = perf ? performance.now() : 0;
  state.field.step({
    year: state.mode === "time" ? state.cursor : null,
    t, reduceMotion, nat: state.nat, chrono: state.chrono,
  });
  if (perf) perf.step(performance.now() - tStep);

  // The matches are what is on screen, so the list of them is rebuilt when what
  // is on screen changes — not every frame, and not only when you type.
  if (state.field.viewKey !== state.listKey) {
    state.listKey = state.field.viewKey;
    paintMatchList();
  }

  // The same amount of ink whatever the particle count: the whole span puts about
  // eight times more colour on the canvas than one window does, and at equal alpha
  // it would stop being a cloud and become a slab. Alpha only — no hue is touched.
  const colours = state.field.stats.colours;
  const intensity = colours > 0 ? clamp(INK / colours, 0.3, 1) : 1;

  // The timelapse reweights every particle on every frame, so there is always
  // something new to draw. The whole-collection view usually has nothing.
  state.debt += state.field.motion;
  /* Two clocks, because the field has two layers that change at different rates.
     The cloud is 113,560 arcs and only moves when the particles do, so it keeps
     the motion threshold it always had. The marks over it are a couple of hundred
     strokes and change the instant you point at a row or open a work — and used
     to drag a full repaint of every colour in the collection along with them. */
  const cloudStale = state.dirty || state.mode === "time" || state.debt >= REDRAW_PX;
  const ring = clamp((now - state.ringAt) / RING_MS, 0, 1);
  if (ring < 1) state.marks = true;   // keep painting while it is still arriving
  if (cloudStale || state.marks) {
    const tDraw = perf ? performance.now() : 0;
    // A row pointed at in the results list rings its blob without selecting it:
    // running the eye down the list should light up the field, not open panels.
    nebula.draw(state.field, state.preview >= 0 ? state.preview : state.selected,
      intensity, cloudStale, ring);
    if (perf) perf.draw(performance.now() - tDraw);
    state.marks = false;
    if (cloudStale) { state.debt = 0; state.dirty = false; }
  }
  paintReadout();
  /* Driven from the loop rather than from each setter, for the same reason the
     readout and the strip are: the scope line describes five independent pieces
     of state, and hanging it off every setter that can move one of them is a
     list that will eventually be missing an entry — it already was. It is keyed
     on its own text, so a frame that changes nothing costs one string compare. */
  paintScope();
  drawTimeline();
  if (perf) perf.render(now, state.field);
  requestAnimationFrame(frame);
}

/** Text nodes are only touched when their value actually changed. */
function put(node, key, value) {
  if (state.ui[key] === value) return;
  state.ui[key] = value;
  node.textContent = value;
}

function paintReadout() {
  const s = state.field.stats;
  const timed = state.mode === "time";
  const empty = s.colours === 0;
  const shown = empty ? "—" : span(s.from, s.to);
  put(el.statWorks, "works", num(s.works));
  put(el.statColours, "colours", num(s.colours));
  put(el.statSpan, "span", shown);
  put(el.statWindow, "window", timed ? `±${Math.round(s.sigma)} YR` : "ALL");

  /* Four readouts, three of them live at any moment — and never the same one
     twice or a constant dressed as a measurement.

     WINDOW is only a reading inside the timelapse. Outside it the answer is
     literally the word ALL, for the whole session, in the same type as the
     numbers that do change.

     SPAN is the opposite, and the analysis that asked for this had it wrong:
     it is *not* dead outside the timelapse, because it follows the school
     filter — the Dutch here run 1562–1907 and the Italians 1309–1905, which is
     a fact about the collection worth having. What it is instead is
     *duplicated* inside the timelapse, where the scope line already prints the
     identical string as its year chip. So each is shown exactly where it is
     the only one saying it.

     Vacant rather than hidden, as everywhere else: the readout is right
     aligned, so dropping a column out of the flow would slide the credit icons
     sideways every time the timelapse is pressed. */
  el.statSpanCell.classList.toggle("is-vacant", timed);
  el.statWindowCell.classList.toggle("is-vacant", !timed);
  // Matches among the works actually on screen, not in the whole dataset: with a
  // school or a year window on, those are two different numbers. Once you start
  // walking the matches the count becomes your position in them, because that is
  // then the more useful of the two numbers.
  // "N OF M" is the right shape for a text search and the wrong one for a colour
  // search: the nearest two dozen out of seven thousand is not a proportion
  // anyone should read as one, because the numerator was chosen and not found.
  // So the colour question states what it is — the nearest, this many of them
  // still in view — and only the walking position is said the same way in both,
  // since there it means the same thing.
  put(el.searchCount, "matched",
    !asking() ? ""
      : state.matchAt >= 0 ? `${state.matchAt + 1}/${num(state.matchTotal)} ↵`
        : state.near >= 0 ? `${num(s.matched)} NEAREST ↵`
          : `${num(s.matched)} OF ${num(s.works)} ↵`);

  if (state.mode !== "time") return;
  const year = Math.round(state.cursor);
  if (state.ui.year !== year) {
    state.ui.year = year;
    el.cursorValue.textContent = year;
    el.timeline.setAttribute("aria-valuenow", year);
    el.timeline.setAttribute("aria-valuetext", `${year}, ${num(s.works)} works in the window`);
  }
}

/**
 * Works per year on a linear year axis, log-scaled in height.
 *
 * Not decoration and not a progress bar. The collection is about sixty times
 * denser in the 1870s than in the 1350s, and this is the only place that
 * unevenness is visible. In the timelapse the lit span is the window currently
 * contributing colour, so it visibly breathes as thin centuries force it open.
 */
function drawTimeline() {
  const F = state.field;
  const timed = state.mode === "time";
  const { from, to } = F.stats;

  // 600 bars is a redraw, not a repaint: only when the lit span or the handle moved.
  // nat belongs in both keys: the curve follows the filter, so a school change
  // has to invalidate the strip even mid-timelapse, where it once did not.
  const key = timed
    ? `t|${from}|${to}|${Math.round(state.cursor)}|${state.nat}|${state.tlMark}`
    : `a|${state.nat}|${state.tlMark}`;
  if (key === state.tlKey) return;
  state.tlKey = key;

  const canvas = el.timeline;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(state.tlW * dpr));
  const h = Math.max(1, Math.round(state.tlH * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const y0 = F.y0, y1 = F.y1;
  const xOf = (year) => ((year - y0) / (y1 - y0 + 1)) * w;
  const barW = Math.max(1, w / (y1 - y0 + 1));

  let peak = 0;
  for (const c of F.perYear) if (c > peak) peak = c;

  const base = h - Math.max(1, dpr);
  for (let year = y0; year <= y1; year++) {
    const c = F.perYear[year - y0];
    if (!c) continue;
    const barH = Math.max(1, Math.round((Math.log1p(c) / Math.log1p(peak)) * (base - 1)));
    const lit = !timed || (year >= from && year <= to);
    ctx.globalAlpha = timed ? (lit ? 0.85 : 0.3) : 0.5;
    ctx.fillStyle = lit ? "#00ff9d" : "#2e3532";
    ctx.fillRect(Math.floor(xOf(year)), base - barH, Math.ceil(barW), barH);
  }

  // --- mean chroma, over the bars ---
  // Drawn twice: once thick in the panel colour, then thin in near-white. The
  // dark pass is not a shadow, it is a gap cut in the histogram so the line stays
  // one line where it crosses a lit bar of nearly its own weight.
  const [cLo, cHi] = CHROMA_AXIS;
  const top = h * 0.12, span = h * 0.66;
  const yOf = (c) => top + span * (1 - clamp((c - cLo) / (cHi - cLo), 0, 1));
  const marks = F.chromaMarks(state.nat);

  /* Near-white, not the accent: the strip already spends green on the histogram
     and on the timelapse handle, and a third hue in 26 px would be read as a
     third measurement. The axis is fixed (CHROMA_AXIS) rather than rescaled to
     whatever the current filter spans, so two schools looked at one after the
     other are directly comparable. */
  const strokeCurve = (nat) => {
    const { v, ok } = F.chromaCurve(nat);
    for (const [width, colour, alpha] of [[3.2, "#0a0a0a", 1], [1.3, "#e8f5ef", 0.82]]) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, width * dpr);
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      let drawing = false;
      for (let year = y0; year <= y1; year++) {
        const i = year - y0;
        if (!ok[i]) { drawing = false; continue; }   // a gap, not a guess
        const px = xOf(year) + barW / 2, py = yOf(v[i]);
        if (drawing) ctx.lineTo(px, py);
        else { ctx.moveTo(px, py); drawing = true; }
      }
      ctx.stroke();
    }
  };
  strokeCurve(state.nat);

  /* --- the curve's own extremes, marked --- */
  /* The line already draws the argument the piece is about — colour at its
     highest in the 14th century, at its lowest in the Baroque, never recovering
     — and then said none of it. These are the marks that do.

     In the curve's own near-white, never in the accent: the strip already spends
     green on the histogram and on the timelapse handle, and a third green thing
     would read as a third measurement rather than as a label of the line it sits
     on. Ringed on a dark disc for the same reason the curve is stroked twice —
     over a lit bar of nearly its own weight, an unringed dot disappears.

     They are not a fourth kind of control. Clicking one opens the timelapse at
     its year, which is what clicking anywhere on this strip already did; the mark
     only makes the landing exact and gives the point a name. */
  for (let m = 0; m < marks.length; m++) {
    const mk = marks[m];
    const px = xOf(mk.year) + barW / 2, py = yOf(mk.v);
    const on = m === state.tlMark;
    const r = (on ? 3.6 : 2.5) * dpr;

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath();
    ctx.arc(px, py, r + 1.7 * dpr, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#e8f5ef";
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();

    // Filled only under the pointer, so the one being read is the one named.
    if (on) {
      ctx.fillStyle = "#e8f5ef";
      ctx.beginPath();
      ctx.arc(px, py, r - 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // baseline, and the handle only when there is a year to point at
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#1e2220";
  ctx.fillRect(0, base, w, Math.max(1, dpr));
  if (timed) {
    ctx.fillStyle = "#00ff9d";
    ctx.fillRect(Math.round(xOf(state.cursor)), 0, Math.max(1, dpr), h);
  }
}

/* ---------- the view, in the URL ---------- */
/* `?y=1600` has always worked, but it was the only thing that did: which layout
 * you were in, which school you had narrowed to, and which painting you had open
 * lived only in this tab. "The Dutch, on the chromatic plane, this Vermeer" was
 * not something anyone could send.
 *
 * Four keys, written with replaceState and never pushState — the back button
 * should leave the page, not walk back through every year you scrubbed past.
 * Anything else already in the query string is preserved rather than rebuilt, so
 * ?perf=1 survives a scrub.
 */

/** Stable name for a particle: collection, catalogue number, which cluster of the
 *  palette. A bare index would be shorter and would break the next time the
 *  dataset is rebuilt and every painting shifts by one. */
function particleName(i) {
  const F = state.field;
  const p = state.data.paintings[F.owner[i]];
  // Palettes are five entries at most, so walking back to the painting's first
  // particle is cheaper than storing the base index for all 32,350.
  let k = 0;
  while (i - k - 1 >= 0 && F.owner[i - k - 1] === F.owner[i]) k++;
  return `${state.data.meta.sources[p.c].key}.${p.i}.${k}`;
}

/** The inverse, or -1 if the URL names something this dataset does not have. */
function particleNamed(name) {
  const first = name.indexOf("."), last = name.lastIndexOf(".");
  if (first < 1 || last <= first) return -1;
  const key = name.slice(0, first);
  const id = name.slice(first + 1, last);
  const k = Number(name.slice(last + 1));
  const c = state.data.meta.sources.findIndex((s) => s.key === key);
  if (c < 0 || !Number.isInteger(k) || k < 0) return -1;
  // One pass over 7,094 paintings, and only when the parameter is present.
  const paintings = state.data.paintings;
  let base = 0;
  for (let pi = 0; pi < paintings.length; pi++) {
    const p = paintings[pi];
    if (p.c === c && p.i === id) return k < p.k.length ? base + k : -1;
    base += p.k.length;
  }
  return -1;
}

let urlTimer = 0;

/** Coalesce to at most four writes a second: a drag moves the cursor every frame,
 *  and Safari rate-limits replaceState. Trailing edge, so the URL always ends up
 *  describing where you stopped. */
function syncURL() {
  if (urlTimer) return;
  urlTimer = setTimeout(() => { urlTimer = 0; writeURL(); }, 250);
}

function writeURL() {
  // Nothing is written mid-timelapse. The URL should say where you stopped, not
  // which frame of an animation was on screen when the throttle happened to fire.
  if (state.playing) return;
  const q = new URLSearchParams(location.search);
  const set = (k, v) => (v === null ? q.delete(k) : q.set(k, v));
  set("y", state.mode === "time" ? String(Math.round(state.cursor)) : null);
  set("nat", state.nat >= 0 ? String(state.nat) : null);
  set("plane", state.chrono ? null : "1");
  set("q", state.query ? state.query : null);
  set("w", state.selected >= 0 ? particleName(state.selected) : null);
  // Named the same way `w` is, and for the same reason: the question is a
  // colour of a particular painting, and a bare index would point at a different
  // one the next time the dataset is rebuilt.
  set("near", state.near >= 0 ? particleName(state.near) : null);
  // Which step of the story, so a sentence and the field under it can be sent
  // together. The step also sets school, layout and year, so those keys are
  // written alongside it and the link works even for a reader who follows it
  // into a build where the story has been rewritten.
  set("step", state.step >= 0 ? String(state.step + 1) : null);
  // Which reading. Omitted for the field, so an ordinary link stays the short
  // one it has always been and only a departure from the default is spelled.
  set("view", state.view === "field" ? null : state.view);
  const qs = q.toString();
  const next = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  history.replaceState(null, "", next);
}

/** Read the same four keys at boot. Each is validated against the dataset that
 *  actually loaded, and an unusable one is dropped rather than approximated. */
function applyURL() {
  const q = new URLSearchParams(location.search);

  // Schools under 12 works have no option in the filter, so the select would
  // silently keep showing ALL while the field narrowed. Only honour what is there.
  const school = (key) => {
    const n = Number(q.get(key));
    return q.has(key) && Number.isInteger(n)
      && el.natFilter.querySelector(`option[value="${n}"]`) ? n : -1;
  };
  const nat = school("nat");
  if (nat >= 0) setSchools(nat);

  if (q.get("plane") === "1") setLayout(false);

  // A query that matches nothing is still honoured: an empty answer is an
  // answer, and silently dropping it would look like the search had not run.
  const query = q.get("q");
  if (query) setQuery(query.slice(0, 80));

  // ?y=1600 opens straight into the timelapse at a year, paused: a moment in the
  // field is worth being able to hand to someone.
  const year = Number(q.get("y"));
  if (Number.isFinite(year) && year >= state.field.y0 && year <= state.field.y1) {
    setMode("time", { year, play: false });
  }

  const named = q.get("w");
  if (named) {
    const particle = particleNamed(named);
    // Opened even if the current filter or year window hides its particle: the
    // link asked for this painting. The ring is drawn only where there is
    // something to ring, which nebula already checks.
    if (particle >= 0) showDetail(particle);
  }

  // Last, because it is the one thing here that overrides another: a colour
  // question and a text question cannot both stand, and a link that carries one
  // meant the one it names.
  const near = q.get("near");
  if (near) {
    const particle = particleNamed(near);
    if (particle >= 0) setNear(particle);
  }

  /* After everything, because opening a step sets school, layout and year
     itself and would otherwise be overwritten by the keys read above. Bounds
     checked against the story that actually shipped: a link made against a
     seven-step version should land somewhere sensible in a five-step one
     rather than opening nothing. */
  const step = Number(q.get("step"));
  if (Number.isInteger(step) && step >= 1) {
    setView("story", { fromURL: true });
    setStep(Math.min(step, STEPS.length) - 1);
  } else if (VIEW_NAMES.includes(q.get("view"))) {
    // A reading without a step: the tables, or the story at its beginning.
    setView(q.get("view"));
  }
}

/* ---------- modes ---------- */
function setMode(mode, { year = null, play = null } = {}) {
  state.mode = mode;
  const timed = mode === "time";
  if (timed && year !== null) state.cursor = clamp(year, state.field.y0, state.field.y1);
  if (timed && play !== null) state.playing = play && !reduceMotion;
  if (!timed) state.playing = false;
  state.ui = {}; state.tlKey = "";   // the panel is being rewritten from scratch
  state.dirty = true;

  el.btnTimelapse.setAttribute("aria-pressed", String(timed));
  // Not `hidden`: see .is-vacant. These two keep their space in the footer in
  // both modes, so switching mode cannot resize the field above them.
  el.btnPlay.classList.toggle("is-vacant", !timed);
  // The scrub position exists only while there is one. Vacant rather than
  // hidden, as everywhere in this footer: the field is a canvas above it.
  el.cursor.classList.toggle("is-vacant", !timed);
  paintTimelineLabel();
  paintPlay();
  paintCopy();
  syncURL();
}

/**
 * Switch which two measurements are the axes.
 *
 * Nothing is recomputed and nothing is refiltered: the same particles walk to new
 * coordinates under the same easing, so the morph itself shows that it is one set
 * of colours being read two ways rather than two pictures.
 */
function setLayout(chrono) {
  state.chrono = chrono;
  state.dirty = true;
  paintCopy();
  syncURL();
}

/* The strip carries two measurements at once, and the label is the only place
   that says which is which. It has to stay short: .timeline__label is nowrap
   and takes its width off the canvas. */
function paintTimelineLabel() {
  el.timelineLabel.textContent = "BARS WORKS · LINE CHROMA · "
    + (state.mode === "time" ? "DRAG TO SCRUB" : "CLICK FOR TIMELAPSE");
}

/** Which school is on the field, or -1 for all of them. */
function setSchools(nat) {
  state.nat = nat;
  el.natFilter.value = String(state.nat);
  setTimelineMark(-1);   // the marks belong to the old school; the index would be stale
  state.tlKey = "";
  state.dirty = true;   // particles leave the field without moving
  paintTimelineLabel();
  syncURL();
}

/* Search dims rather than filters, and that is the whole point of it. A word
   typed here does not remove anything from the field: every particle stays where
   it stood, and the ones that do not match simply fall back. So you read the
   answer against the collection it came out of — where in the six centuries the
   matches sit, and how much of the field they are — instead of against black.
   The count says how many works answered, because a scattering of faint
   particles is not something you can total by eye. */
function setQuery(query) {
  state.query = query;
  // Both questions fill the same array, so only one can be standing. Typing puts
  // the colour question away rather than fighting it for the field — and now
  // says so, because it used to happen in silence: a colour question you had
  // deliberately asked vanished the moment you typed a letter, with the chip
  // that named it disappearing from the scope line and nothing put in its place.
  if (state.near >= 0) {
    state.near = -1; state.nearInfo = null; paintNear();
    if (query) note("THE COLOUR QUESTION WAS PUT AWAY — ONE AT A TIME");
  }
  state.field.setSearch(query);
  /* The box is only written when it does not already say this, *ignoring* the
     spaces at its ends — because the query is trimmed and every space is a
     trailing space at the moment it is typed. Comparing the raw value put the
     trimmed string straight back into the box on that keystroke, so a space could
     never be entered and `leonardo da vinci` had to be typed as one word. */
  if (el.search.value.trim() !== query) el.search.value = query;
  state.matchAt = -1;   // a different question has a different set of answers
  state.matchTotal = 0;
  state.dirty = true;   // alpha and radius change; nothing moves
  syncURL();
}

/* The second way of asking, from the panel a particle opened.
   Text reaches a painting you can already name; this reaches the ones you
   cannot, by the only property the field actually measures. It deliberately
   builds no second machinery: it fills the same match array the search fills, so
   the answer arrives as the same rings on the field, the same named list beside
   it, and the same walk with Enter. What changes is the question, not the
   instrument.
   The work stays selected and stays open. Its own ring is the accent one, and
   the neighbours' are the thin marks — so the reference and the answers are
   told apart on the field without a third kind of mark being invented. */
function setNear(particle) {
  const displaced = state.query;   // one question at a time, and it is said
  if (displaced) setQuery("");
  const found = state.field.setNear(particle);
  state.near = particle;
  state.nearInfo = { hex: state.field.css[particle], worst: found.worst };
  state.matchAt = -1;
  state.matchTotal = found.works;
  state.dirty = true;
  paintNear();
  if (displaced) note(`“${displaced}” WAS PUT AWAY — ONE QUESTION AT A TIME`);
  syncURL();
}

/** Put the colour question away, and hand the field back to whatever text
 *  question was standing before it — usually none. */
function clearNear() {
  state.near = -1;
  state.nearInfo = null;
  state.field.setSearch(state.query);
  state.matchAt = -1;
  state.matchTotal = 0;
  state.dirty = true;
  paintNear();
  syncURL();
}

/* The button latches, because the thing it starts is a state of the field and
   not an action. It is pressed only while the panel is showing the very colour
   the question was asked about: stepping through the answers moves the panel
   onto the neighbours, and there the same button offers to ask again from
   there — which is a different question and must not look like the one already
   running. */
function paintNear() {
  const running = state.near >= 0 && state.near === state.selected;
  el.btnNear.setAttribute("aria-pressed", String(running));
  /* The button used to say the same eight words whatever was selected, which
     made the best question in the piece look like a generic control. It names
     the colour it would actually ask about — the one marked in the swatches
     directly above it — so the swatch, the button and the answer's header all
     say the same thing and read as one gesture. */
  const hex = state.selected >= 0 ? state.field.css[state.selected] : null;
  el.btnNear.innerHTML = running
    ? "STOP · SHOWING COLOURS LIKE THIS"
    : hex
      ? `<i style="background:${hex}"></i>FIND COLOURS LIKE ${hex.toUpperCase()}`
      : "COLOURS LIKE THIS ONE";
}

/** Is anything being asked of the field at all — by name, or by colour. */
const asking = () => Boolean(state.query) || state.near >= 0;

/* Which paintings answered, said in words.
   The field can show where the matches are — every one of them is ringed — but a
   ring is a position, not a name, and "which of these is which" is not a question
   a cloud of colour can answer. So the search prints its results: year, title,
   artist, in chronological order, the same order and the same set as the rings.
   Pointing at a row lights its ring on the field, clicking it opens the work.
   That is the whole bridge between the two halves of the answer. */
const MATCH_ROWS = 200;   // the cap the rings use too: past it, marks become texture

function paintMatchList() {
  const list = state.field.matchList();
  state.preview = -1;   // the rows are about to be replaced; the index would be stale
  state.matchTotal = list.length;
  if (state.matchAt >= list.length) state.matchAt = -1;
  /* A colour question keeps its header even when nothing answered, because the
     header is the only thing that states it and the only place it can be put
     away from. Narrow to a small school and then ask about a colour and this is
     where you land: the two dozen nearest works are real, and none of them are
     in view. A typed question needs no such care — the words are still in the
     box, and the count beside it already says none. */
  if (!asking() || (!list.length && !state.nearInfo)) {
    el.searchList.hidden = true;
    el.searchList.innerHTML = "";
    state.matchIds = [];
    return;
  }
  const shown = list.slice(0, MATCH_ROWS);
  state.matchIds = list;
  const F = state.field;
  /* A colour question has to say what it asked. A list of names under a text
     search explains itself — the words are in the box above it — but under a
     colour search the box is empty and the rows would be a set of paintings with
     no stated reason for being together. So the colour is shown, as a swatch and
     as its hex, with the distance the answer had to reach: the last of these
     works is that far from the one clicked, which is the one number that says
     whether "like this" is a strong claim here or a weak one.
     It carries its own dismissal too. A text question is put away in the box
     that holds it; a colour question has no box, and binding it to the panel it
     was asked from would end it every time you clicked past a particle —
     including on the way to reading one of its own answers. */
  const head = state.nearInfo
    ? `<li class="findlist__head"><i style="background:${state.nearInfo.hex}"></i>`
      + `LIKE ${state.nearInfo.hex.toUpperCase()} · WITHIN ΔE ${state.nearInfo.worst.toFixed(1)}`
      + `<button class="findlist__x" aria-label="Stop searching by colour">×</button></li>`
    : "";
  el.searchList.innerHTML = head + shown.map((i, k) => {
    const p = state.data.paintings[F.owner[i]];
    /* A row is a button, not a decorated <li>. It was reachable by pointer
       only: the walk with Enter from the search box has always existed, but
       anyone arriving here with Tab found a list of paintings and no way to
       open one. The particle field cannot be made reachable this way and
       should not pretend to be — but this list is words, and words are the
       part a keyboard and a screen reader can actually have. */
    return `<li data-k="${k}" class="${k === state.matchAt ? "is-at" : ""}">`
      + `<button type="button" tabindex="0">`
      + `<b>${span(p.s, p.e)}</b><span>${escapeHtml(p.t || "Untitled")}`
      + `<i>${escapeHtml(p.a || "Unattributed")}</i></span></button></li>`;
  }).join("")
    /* Past MARK_CAP the field stops ringing the matches as well, and that was
       never said: the list admitted it had more rows than it was showing, but
       the picture had quietly stopped answering too, so a wide search looked
       like a narrow one that had simply missed. Both halves are stated now,
       and the cap they share is named once rather than written twice. */
    + (list.length > shown.length
      ? `<li class="findlist__more">${num(list.length - shown.length)} MORE`
        + (list.length > MATCH_ROWS ? " · TOO MANY TO RING ON THE FIELD" : "")
        + " — NARROW THE SEARCH</li>"
      : "")
    // Said rather than left as an empty box: the works exist, the filter on the
    // field is what is hiding them, and that is the actionable half of it.
    + (list.length ? ""
      : `<li class="findlist__more">NONE OF THEM ARE IN VIEW</li>`);
  el.searchList.hidden = false;
}

/* Enter walks the matches, shift+Enter walks them backwards, and each step rings
   one blob, opens it, and moves the highlight down the list — so the name and the
   position on the field are read together.
   The matched particles are not made larger or brighter to stand out; only the
   rings are added. Radius and opacity here are measurements — share of the
   palette, weight in the window — and bending them to answer a search would be
   drawing a number the data does not hold. */
function stepMatch(dir) {
  const list = state.field.matchList();
  state.matchTotal = list.length;
  if (!list.length) { state.matchAt = -1; return; }
  const here = list.indexOf(state.selected);
  const k = here >= 0 ? here + dir : (dir > 0 ? 0 : list.length - 1);
  state.matchAt = ((k % list.length) + list.length) % list.length;
  showDetail(list[state.matchAt]);
  markMatchRow();
}

/* The result rows, and only those. The list also carries a header naming a
   colour question and a footer counting what was cut off, and neither is a
   result: walking `children` put the highlight on the footer as soon as the
   position passed the last shown row, and off by one the moment a header
   appeared above them. `data-k` is the position, so it is what is asked for. */
function markMatchRow() {
  const rows = el.searchList.querySelectorAll("li[data-k]");
  for (let k = 0; k < rows.length; k++) rows[k].classList.toggle("is-at", k === state.matchAt);
  rows[state.matchAt]?.scrollIntoView({ block: "nearest" });
}

/* What the surface currently is, said in words. The field draws no axis lines —
   a ruler over a measurement is still a drawn thing — so this line carries the
   whole of it, and it has to change the instant the layout does. */
function paintCopy() {
  const timed = state.mode === "time";
  const F = state.field;
  el.axes.textContent = state.chrono
    ? `HORIZONTAL · YEAR, ${F.y0} → ${F.y1}   ·   VERTICAL · LIGHTNESS L*, DARK BELOW`
    : "HORIZONTAL · a*, GREEN → RED   ·   VERTICAL · b*, BLUE → YELLOW";
  el.btnLayout.textContent = state.chrono ? "CHROMATIC PLANE" : "CHRONOLOGY";
  el.btnLayout.title = state.chrono
    ? "Restack the same colours by hue instead of by year"
    : "Spread the same colours along the years again";
  // Only while the hint is still the hint. Once it has been spent, or while it
  // is carrying a note, this line is not paintCopy's to write.
  if (!state.hintSpent && !el.hint.classList.contains("is-note")) {
    el.hint.textContent = timed
      ? "DRAG THE FIELD OR THE STRIP · ← → TO STEP A YEAR"
      : "EVERY PARTICLE IS ONE MEASURED COLOUR OF ONE PAINTING";
  }
}

/* ---------- the line under the field ----------
 *
 * One element, two jobs, and never both at once.
 *
 * At rest it is the opening hint — what a particle is — and it fades out for
 * good once you have touched anything, because a sentence you have already
 * read and acted on is a sentence the picture is paying rent for. It used to
 * be permanent.
 *
 * The rest of the time it is where the interface says the thing it has just
 * done to you unasked. There are exactly two such things, and both are the
 * same rule: the field answers one question at a time, so asking a colour
 * question puts a typed one away and vice versa. That happened in silence,
 * which made a deliberate action look like a bug.
 */
const HINT_MS = 2600;      // how long a note stays before the line goes quiet
let noteTimer = 0;

function note(text) {
  clearTimeout(noteTimer);
  el.hint.textContent = text;
  el.hint.classList.add("is-note");
  el.hint.classList.remove("is-spent");
  noteTimer = setTimeout(() => {
    el.hint.classList.remove("is-note");
    el.hint.classList.add("is-spent");
  }, HINT_MS);
}

/** The opening hint has been read; it does not come back. */
function spendHint() {
  if (state.hintSpent) return;
  state.hintSpent = true;
  // The opening is a demonstration for someone who has not started yet. The
  // moment they have, it is in the way.
  endOpening();
  if (!el.hint.classList.contains("is-note")) el.hint.classList.add("is-spent");
}

/* ---------- the scope line ---------- */
/*
 * What you are looking at, in words, above the field.
 *
 * This replaces three lines of permanent prose — two of blurb and one naming
 * the layout — with one line that says strictly more. The old ones described
 * the collection and the current layout and never mentioned the thing hardest
 * to keep in your head: what you have narrowed to. Five independent variables
 * (layout, year window, school, text query, colour question) could all be true
 * at once and no single place on screen said so. RESET existed because of that,
 * and RESET is the weaker answer: it can undo the state but it cannot teach it.
 *
 * So each narrowing is a chip, each chip lifts exactly its own constraint, and
 * with nothing narrowed the line states the size of the whole instead — which
 * is what the blurb was for. One element, four jobs, and it is never blank.
 */
const SCOPE_LABEL = {
  plane: "CHROMATIC PLANE",
  chrono: "YEAR × LIGHTNESS",
};

/** The chips, as data. Rendered by paintScope, acted on by the click handler. */
function scopeChips() {
  const chips = [];
  const F = state.field, meta = state.data.meta;

  // The layout is always shown, and is the one chip that is never removable:
  // there is no "no layout". Pressing it swaps to the other reading, which is
  // what the button in the footer does — the chip is the same control said in
  // the place you are already reading.
  chips.push({
    key: "layout", swap: true,
    text: state.chrono ? SCOPE_LABEL.chrono : SCOPE_LABEL.plane,
  });

  if (state.mode === "time") {
    const s = F.stats;
    chips.push({ key: "time", text: `${span(s.from, s.to)} · MOVING WINDOW` });
  }
  if (state.nat >= 0) {
    chips.push({ key: "nat", text: (meta.nationalities[state.nat] || "?").toUpperCase() });
  }
  if (state.query) {
    chips.push({ key: "query", text: `“${state.query}” · ${num(F.stats.matched)}` });
  }
  if (state.near >= 0 && state.nearInfo) {
    chips.push({
      key: "near", swatch: state.nearInfo.hex,
      text: `LIKE ${state.nearInfo.hex.toUpperCase()} · ${num(F.stats.matched)}`,
    });
  }
  return chips;
}

/** True when anything at all has been narrowed away from the opening state. */
const narrowed = () =>
  state.mode === "time" || state.nat >= 0 || Boolean(state.query) || state.near >= 0;

function paintScope() {
  const meta = state.data.meta;
  const chips = scopeChips();
  // Keyed so the DOM is only rewritten when the words actually change. This
  // runs from paintCopy on every mode change and the timelapse changes `from`
  // and `to` continuously, so without this it would rebuild sixty times a
  // second — the same fault the readout and the strip already guard against.
  const key = JSON.stringify(chips) + String(narrowed());
  if (key === state.scopeKey) return;
  state.scopeKey = key;

  const scope = chips.map((chip) =>
    `<button class="scope__chip${chip.swap ? " scope__chip--swap" : ""}" data-scope="${chip.key}">`
    + (chip.swatch ? `<i style="background:${chip.swatch}"></i>` : "")
    + escapeHtml(chip.text)
    + (chip.swap ? "" : chip.key === "layout" ? "" : "<b>×</b>")
    + "</button>").join("");

  // With nothing narrowed the line says what the whole thing is. That sentence
  // used to be the blurb, and it is read off the data so it cannot go stale.
  const whole = narrowed() ? "" :
    `<span class="scope__whole">${num(meta.totalPaintings)} PAINTINGS · `
    + `${num(meta.totalCells)} MEASURED COLOURS · ${meta.yearRange[0]}–${meta.yearRange[1]}`
    + ` · ${meta.sources.length} COLLECTIONS</span>`;

  const clear = narrowed()
    ? `<button class="scope__clear" data-scope="all" title="Back to the whole collection">CLEAR ALL</button>`
    : "";

  el.scope.innerHTML = scope + whole + clear;
}

/* The copy-link button that used to sit here is gone: it read as one more
   thing bolted onto the end of the line, and the permalink it exposed was
   never the point — the URL already carries the view, silently, on every
   change (see writeURL/syncURL). Sharing it is what the browser's own address
   bar is for. Nothing about the sync itself changed; only the affordance that
   announced it did. */

function paintPlay() {
  el.btnPlay.textContent = state.playing ? "❚❚" : "▶";
  el.btnPlay.setAttribute("aria-label", state.playing ? "Pause" : "Play");
}

function setPlaying(on) {
  state.playing = on && !reduceMotion;
  paintPlay();
  syncURL();   // nothing is written while playing, so pausing is when the year lands
}

function setCursor(year) {
  state.cursor = clamp(year, state.field.y0, state.field.y1);
  syncURL();
}

/* ---------- input ---------- */
function yearAtTimeline(clientX) {
  const rect = el.timeline.getBoundingClientRect();
  const f = clamp((clientX - rect.left) / rect.width, 0, 1);
  return state.field.y0 + f * (state.field.y1 - state.field.y0);
}

const MARK_GRAB = 9;   // px either side of a mark that count as being on it

/** Which extreme the pointer is over, or -1.
 *
 *  Tested on x only, though the marks sit at a height as well. The strip is 26px
 *  tall and a mark is 5px across: asking for the pointer to be on the curve too
 *  would make a target most people would miss. There is nothing to lose by being
 *  generous — a click that lands on a mark and a click that lands beside it both
 *  open the timelapse near that year, so a false positive costs a few years of
 *  cursor, not a wrong action. */
function markAtTimeline(clientX) {
  const F = state.field;
  const marks = F.chromaMarks(state.nat);
  if (!marks.length) return -1;
  const rect = el.timeline.getBoundingClientRect();
  const x = clientX - rect.left;
  const perYear = rect.width / (F.y1 - F.y0 + 1);
  for (let i = 0; i < marks.length; i++) {
    const mx = (marks[i].year - F.y0 + 0.5) * perYear;
    if (Math.abs(x - mx) <= MARK_GRAB) return i;
  }
  return -1;
}

const MARK_TEXT = {
  hi: "HIGHEST MEAN CHROMA",
  lo: "LOWEST MEAN CHROMA",
  end: "WHERE THE FIELD ENDS",
};

/** Name the mark under the pointer, or clear it.
 *
 *  The year is deliberately not given as a year. The curve is smoothed with the
 *  same adaptive window the field uses, 19 years wide at the medieval peak, so
 *  the highest point names a neighbourhood and printing "1339" alone would claim
 *  a precision the smoothing already spent. The window is printed beside it. */
function setTimelineMark(index, clientX) {
  if (index !== state.tlMark) {
    state.tlMark = index;
    state.tlKey = "";   // the filled ring is part of the strip, so the strip redraws
  }
  if (index < 0) { el.markChip.hidden = true; return; }

  const mk = state.field.chromaMarks(state.nat)[index];
  const share = Math.round(mk.share * 100);
  el.markChip.innerHTML =
    `<b>${MARK_TEXT[mk.kind]} ${mk.v.toFixed(1)}</b>`
    + `<i>AROUND ${mk.year} · SMOOTHED OVER ±${mk.sigma} YEARS</i>`
    + (mk.kind === "hi" ? "" : `<i>${share}% OF THIS CURVE'S HIGHEST</i>`);
  el.markChip.hidden = false;

  // Kept inside the strip, measured rather than guessed from the text length.
  const rect = el.timeline.getBoundingClientRect();
  const box = el.markChip.getBoundingClientRect();
  const x = clamp(clientX - rect.left - box.width / 2, 0, rect.width - box.width);
  el.markChip.style.left = `${x}px`;
}

function bindInput() {
  /* --- the strip: scrubs in the timelapse, and is the way into it otherwise --- */
  let onStrip = false;
  el.timeline.addEventListener("pointerdown", (event) => {
    spendHint();
    onStrip = true;
    el.timeline.setPointerCapture(event.pointerId);
    // On a mark, the mark's own year rather than the one under the finger: the
    // whole point of the mark is that it names an exact place on the curve.
    const m = markAtTimeline(event.clientX);
    const year = m >= 0
      ? state.field.chromaMarks(state.nat)[m].year
      : yearAtTimeline(event.clientX);
    if (state.mode !== "time") setMode("time", { year, play: false });
    else { setCursor(year); setPlaying(false); }
  });
  el.timeline.addEventListener("pointermove", (event) => {
    if (onStrip && state.mode === "time") { setCursor(yearAtTimeline(event.clientX)); return; }
    const m = markAtTimeline(event.clientX);
    setTimelineMark(m, event.clientX);
    el.timeline.classList.toggle("is-onmark", m >= 0);
  });
  el.timeline.addEventListener("pointerleave", () => {
    setTimelineMark(-1);
    el.timeline.classList.remove("is-onmark");
  });
  const releaseStrip = () => { onStrip = false; };
  el.timeline.addEventListener("pointerup", releaseStrip);
  el.timeline.addEventListener("pointercancel", releaseStrip);

  /* --- the field: a tap opens a painting; in the timelapse a drag also scrubs ---
   *
   * Every one of these listeners is on the stage rather than on the canvas,
   * because a drag has to keep working after the pointer has left the picture.
   * But the stage also *contains* the story panel, and the panel has buttons.
   *
   * That combination broke them completely. A press on NEXT bubbled to the
   * stage, the stage called setPointerCapture, and from that moment every
   * pointer event for that finger belonged to the stage — so the pointerup
   * landed there too, no click was ever delivered to the button, and the tap
   * was instead read as a tap on the field underneath. The story opened and
   * then could not be walked.
   *
   * So a gesture is the field's only when it starts on the field. The test is
   * `target !== el.field` rather than a list of overlays to exclude: the axes
   * line, the hint and the hover chip are all `pointer-events: none`, so the
   * canvas is the only thing inside the stage that can be a target unless
   * something has deliberately been put over it — and anything deliberately
   * put over it should keep its own clicks.
   */
  let drag = null;
  el.stage.addEventListener("pointerdown", (event) => {
    if (event.target !== el.field) return;   // chrome over the field, not the field
    spendHint();   // you have touched the field; you no longer need telling what it is
    el.stage.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, from: state.cursor, moved: 0 };
  });
  el.stage.addEventListener("pointermove", (event) => {
    // While a drag is running the pointer is captured by the stage, so the
    // target is the stage and not the canvas. The guard above is about where a
    // gesture *starts*; once one is under way it owns the pointer.
    if (!drag && event.target !== el.field) { hideChip(); return; }
    const rect = el.stage.getBoundingClientRect();
    const px = event.clientX - rect.left, py = event.clientY - rect.top;

    if (drag) {
      const dx = event.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      if (drag.moved >= SCRUB_SLOP && state.mode === "time") {
        el.stage.classList.add("is-scrubbing");
        setPlaying(false);
        setCursor(drag.from + dx * STAGE_GAIN);
        hideChip();
        return;
      }
      if (drag.moved >= SCRUB_SLOP) { hideChip(); return; }
    }
    showChip(px, py);
  });
  const endStage = (event) => {
    if (!drag) return;
    const wasTap = drag.moved < SCRUB_SLOP;
    drag = null;
    el.stage.classList.remove("is-scrubbing");
    if (!wasTap) return;
    const rect = el.stage.getBoundingClientRect();
    const hit = state.field.pick(event.clientX - rect.left, event.clientY - rect.top);
    if (hit >= 0) showDetail(hit); else hideDetail();
  };
  el.stage.addEventListener("pointerup", endStage);
  el.stage.addEventListener("pointercancel", () => {
    drag = null;
    el.stage.classList.remove("is-scrubbing");
  });
  el.stage.addEventListener("pointerleave", hideChip);

  /* --- controls --- */
  el.btnTimelapse.addEventListener("click", () => {
    if (state.mode === "time") setMode("all");
    else setMode("time", { year: state.field.y0, play: true });
  });
  el.btnPlay.addEventListener("click", () => setPlaying(!state.playing));
  el.btnLayout.addEventListener("click", () => setLayout(!state.chrono));
  /* The scope line, delegated because its chips are rewritten whenever the
     view changes. Each chip lifts exactly the one constraint it names — which
     is the whole difference between this and the RESET button it replaces. */
  el.scope.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-scope]");
    if (!chip) return;
    switch (chip.dataset.scope) {
      case "layout": setLayout(!state.chrono); break;
      case "time": setMode("all"); break;
      case "nat": setSchools(-1); hideDetail(); break;
      case "query": setQuery(""); break;
      case "near": clearNear(); break;
      case "all":
        setSchools(-1);
        setQuery("");
        if (state.near >= 0) clearNear();
        hideDetail();
        setMode("all");
        break;
    }
  });
  el.natFilter.addEventListener("change", () => {
    setSchools(Number(el.natFilter.value));
    hideDetail();
  });
  // "search" inputs fire input on the browser's own clear button too, so one
  // listener covers typing, pasting and the ×.
  el.search.addEventListener("input", () => setQuery(el.search.value.trim()));

  /* Delegated, because the rows are rewritten whenever the visible set changes.
     Pointing at a row rings its work on the field; clicking opens it. */
  el.searchList.addEventListener("pointerover", (event) => {
    const row = event.target.closest("li[data-k]");
    const next = row ? state.matchIds[+row.dataset.k] : -1;
    if (next === state.preview) return;
    state.preview = next ?? -1;
    state.marks = true;   // a ring moves; the cloud under it has not changed
    // Pointing at a row is already a decision most of the way made, so its
    // painting is fetched now. By the time the click lands the panel has nothing
    // to wait for. One file, only on rows actually pointed at.
    if (state.preview >= 0) {
      const p = state.data.paintings[state.field.owner[state.preview]];
      preload(`thumbs/${state.data.meta.sources[p.c].key}/${p.i}.webp`);
    }
  });
  el.searchList.addEventListener("pointerleave", () => {
    if (state.preview < 0) return;
    state.preview = -1;
    state.marks = true;
  });
  /* Tabbing onto a row rings its blob, exactly as pointing at one does. The
     rows carry the same answer either way, so they should light the same part
     of the field either way — otherwise the keyboard path is a list of names
     with the picture beside it gone dark. Rows are buttons now, so `focusin`
     is the keyboard's `pointerover`. */
  el.searchList.addEventListener("focusin", (event) => {
    const row = event.target.closest("li[data-k]");
    if (!row) return;
    const next = state.matchIds[+row.dataset.k] ?? -1;
    if (next === state.preview) return;
    state.preview = next;
    state.marks = true;
    if (next >= 0) {
      const p = state.data.paintings[state.field.owner[next]];
      preload(`thumbs/${state.data.meta.sources[p.c].key}/${p.i}.webp`);
    }
  });
  el.searchList.addEventListener("focusout", (event) => {
    // Only when focus has actually left the list, not when it moves between
    // two rows inside it — which fires focusout on the one being left.
    if (el.searchList.contains(event.relatedTarget)) return;
    if (state.preview < 0) return;
    state.preview = -1;
    state.marks = true;
  });
  /* A sibling thumbnail opens that painting, in the same panel, which is what
     makes the strip a way of walking an artist rather than a decoration. */
  el.detail.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-kin]");
    if (!thumb) return;
    showDetail(state.stats.firstParticle[+thumb.dataset.kin]);
  });
  el.searchList.addEventListener("click", (event) => {
    if (event.target.closest(".findlist__x")) { clearNear(); return; }
    const row = event.target.closest("li[data-k]");
    if (!row) return;
    state.matchAt = +row.dataset.k;
    state.preview = -1;
    showDetail(state.matchIds[state.matchAt]);
    markMatchRow();
  });
  el.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Escape") return;
    event.stopPropagation();   // Escape in the box clears it; it does not close the panel
    setQuery("");
  });
  /* Pressing it again puts the question away: the control that started a state
     should be able to end it. The list header has the other × for when the panel
     has since moved on to one of the answers, and the button no longer stands
     over the colour that was asked about. */
  el.btnNear.addEventListener("click", () => {
    if (state.selected < 0) return;
    if (state.near === state.selected) clearNear(); else setNear(state.selected);
  });
  /* --- the tables --- */
  el.views.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });
  el.tablesClose.addEventListener("click", () => setView("field"));
  el.compareClose.addEventListener("click", () => setView("field"));
  el.compareA.addEventListener("change", paintCompare);
  el.compareB.addEventListener("change", paintCompare);
  el.tableBy.addEventListener("click", (event) => {
    const button = event.target.closest("[data-by]");
    if (!button) return;
    state.tableBy = button.dataset.by;
    paintTables();
  });
  el.tableMeasure.addEventListener("click", (event) => {
    const button = event.target.closest("[data-measure]");
    if (!button) return;
    state.tableMeasure = button.dataset.measure;
    paintTables();
  });
  // One listener over both tables: they are rewritten on every switch.
  el.tables.addEventListener("click", (event) => {
    const row = event.target.closest("li [data-key]");
    if (row) enterFromTable(row.dataset.key);
  });

  /* --- the story --- */
  el.storyClose.addEventListener("click", () => setView("field"));
  el.storyBack.addEventListener("click", () => setStep(state.step - 1));
  el.storyNext.addEventListener("click", () => {
    // The last step does not loop and does not congratulate you. It leaves you
    // in the field, with the controls exactly where the story put them.
    if (state.step >= STEPS.length - 1) setView("field");
    else setStep(state.step + 1);
  });
  el.storyDots.addEventListener("click", (event) => {
    const dot = event.target.closest("[data-step]");
    if (dot) setStep(+dot.dataset.step);
  });

  el.btnInfo.addEventListener("click", () => {
    setView("field");
    el.about.hidden = false;
    el.aboutClose.focus({ preventScroll: true });
  });
  // The panel keeps the method and hands the argument on: anyone who opened it
  // wanting to know what they are looking at should be walked, not read to.
  el.aboutStory.addEventListener("click", () => {
    setView("story");
  });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);

  /* --- keyboard --- */
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideDetail();
      setView("field");
      return;
    }
    /* In the story the arrows walk the steps rather than the years. Both are
       "move along the argument", and only one of them is what the reader means
       while a sentence is on screen. */
    if (state.step >= 0 && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      setStep(state.step + (event.key === "ArrowRight" ? 1 : -1));
      return;
    }
    if (event.target === el.search) return;   // space and arrows belong to the box
    if (event.key === " " && state.mode === "time") {
      event.preventDefault(); setPlaying(!state.playing); return;
    }
    if (state.mode !== "time") return;
    let dy = 0;
    if (event.key === "ArrowRight") dy = event.shiftKey ? 10 : 1;
    else if (event.key === "ArrowLeft") dy = event.shiftKey ? -10 : -1;
    else if (event.key === "PageUp") dy = -50;
    else if (event.key === "PageDown") dy = 50;
    else if (event.key === "Home") { setCursor(state.field.y0); event.preventDefault(); return; }
    else if (event.key === "End") { setCursor(state.field.y1); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    setPlaying(false);
    setCursor(Math.round(state.cursor) + dy);
  });

  /* The opening is cancelled by any interaction at all, listened for once on
     the window in the capture phase. Hanging it off the individual controls is
     a list that would eventually be missing an entry -- and it already would
     have been: spendHint covers the field and the strip, but not the menu, the
     search box or the school filter, and someone who has pressed any of those
     has plainly started and does not need to be shown how. */
  for (const type of ["pointerdown", "keydown", "wheel"]) {
    window.addEventListener(type, endOpening, { capture: true, once: true });
  }

  /* The stage is watched, not the window. A window resize is not the only thing
     that changes the size of the field: the footer under it grows and shrinks
     with the mode, and a canvas measured for the old height is stretched by CSS
     to the new one — the picture moves, the coordinates behind pick() do not,
     and the ring lands off the pointer. ResizeObserver fires before the paint
     that would have shown the mismatch, and measure() returns immediately when
     the box has not actually changed, so calling it often costs nothing. */
  new ResizeObserver(measure).observe(el.stage);
  /* Watched separately from the stage, because the two move in opposite
     directions: the footer growing by a row is exactly what shrinks the stage,
     so one observer firing on both would be told about the same event twice and
     still have to measure each box on its own. */
  new ResizeObserver(measureFoot).observe(el.foot);
  new ResizeObserver(measureHead).observe(el.head);
}

/* ---------- the opening ----------
 *
 * You land on thirty-four thousand dots and the boot sequence, handsome as it
 * is, tells you the count and nothing about what a dot is. The line under the
 * field says every particle is one measured colour of one painting, and that
 * is a sentence about a picture rather than the picture itself.
 *
 * So the field demonstrates itself once: a ring closes on one particle and its
 * chip appears, unasked, naming a painting you may well recognise and the hex
 * of the colour that was taken from it. Three seconds, then it lets go. It
 * teaches the whole grammar of the thing — a dot is a colour, a colour belongs
 * to a work, the work has a name — without a word of instruction, and it is
 * the same chip you would have got by pointing, so nothing is being mimed.
 *
 * It is cancelled by the first real interaction, because someone who has
 * already started exploring does not need to be shown how.
 */
const OPENING_MS = 3200;
const OPENING_IN = 900;     // let the field settle before anything is pointed at

/* Chosen by rule, not by index. A hardcoded position would point at a
   different painting the next time the dataset is rebuilt -- the same trap the
   permalinks avoid by naming works rather than numbering them. Titles first,
   because a name you recognise does more teaching than an anonymous panel;
   then a guaranteed fallback, so this cannot come up empty on a dataset that
   happens to hold none of them. */
const OPENING_TITLES = [
  "De Nachtwacht", "Het melkmeisje", "Water Lilies", "Sunflowers",
  "Wheatfield", "Self-Portrait",
];

function openingParticle() {
  const paintings = state.data.paintings;
  for (const title of OPENING_TITLES) {
    const at = paintings.findIndex((p) => p.t === title);
    if (at >= 0) return state.stats.firstParticle[at];
  }
  // The most saturated work in the collection: always exists, and lands on the
  // medieval end, which is where the argument starts anyway.
  let best = 0;
  for (let i = 1; i < paintings.length; i++) {
    if (state.stats.chroma[i] > state.stats.chroma[best]) best = i;
  }
  return state.stats.firstParticle[best];
}

let openingTimer = 0;

function runOpening() {
  if (reduceMotion) return;   // an unrequested animation is exactly what this asks to be spared
  openingTimer = setTimeout(() => {
    // Not if the visitor got there first, and not if a link brought them
    // somewhere specific -- a shared view should open on what it names.
    if (state.hintSpent || state.view !== "field" || state.selected >= 0) return;
    const particle = openingParticle();
    state.preview = particle;    // the ring, without opening the panel
    state.ringAt = performance.now();
    state.marks = true;
    showChipAt(particle);
    openingTimer = setTimeout(endOpening, OPENING_MS);
  }, OPENING_IN);
}

function endOpening() {
  clearTimeout(openingTimer);
  openingTimer = 0;
  if (state.preview < 0) return;
  state.preview = -1;
  state.marks = true;
  hideChip();
}

/* ---------- hover ---------- */
function showChip(px, py) {
  const hit = state.field.pick(px, py, 12);
  if (hit < 0) { hideChip(); return; }
  fillChip(hit, px, py);
}

/** The same chip, on a particle the visitor did not point at — used by the
 *  opening, which shows one unasked. Placed at the particle's own position, so
 *  what appears is exactly what pointing at it would have produced. */
function showChipAt(particle) {
  const F = state.field;
  if (!(F.w[particle] > 0)) return;   // not currently drawn: nothing to point at
  fillChip(particle, F.x[particle], F.y[particle]);
}

function fillChip(hit, px, py) {
  const F = state.field;
  const p = state.data.paintings[F.owner[hit]];
  if (hit !== state.hover) {
    state.hover = hit;
    /* The last line is the only advertisement for the best thing here.
       "Colours like this one" is what this dataset answers better than any
       other question, and it lived two clicks deep: you had to already have
       clicked a particle, then find a button in the panel. Anyone who never
       clicked a particle never learned it existed. Saying it on the chip costs
       no new chrome and puts the offer exactly where the curiosity is — under
       a colour someone has just pointed at. */
    el.hoverchip.innerHTML =
      `<b>${escapeHtml(p.t || "Untitled")}</b>`
      + `<i>${escapeHtml(p.a || "Unattributed")} · ${span(p.s, p.e)}</i><br>`
      + `<code>${F.css[hit].toUpperCase()}</code>`
      + `<u>CLICK · THEN COLOURS LIKE THIS ONE</u>`;
  }
  el.hoverchip.hidden = false;
  // Keep the chip inside the stage: measured, not guessed from the text length.
  const box = el.hoverchip.getBoundingClientRect();
  const x = clamp(px + 14, 4, state.cssW - box.width - 4);
  const y = clamp(py + 14, 4, state.cssH - box.height - 4);
  el.hoverchip.style.left = `${x}px`;
  el.hoverchip.style.top = `${y}px`;
}

function hideChip() {
  el.hoverchip.hidden = true;
  state.hover = -1;
}

/* ---------- the tables ----------
 *
 * The field shows every colour and argues nothing. The chroma curve under it
 * argues one thing about the whole collection at once. These are the layer
 * between: the same measurements, grouped by the things a person actually asks
 * about, and ranked.
 *
 * They also fix something the field never did. Six centuries of colour against
 * black is a superb thing to explore and a hard thing to *enter*: with no name
 * in your head there is nowhere to click first. A table is a list of names,
 * every one of which leads back into the field — so it is a door, not a
 * detour. That is why each row narrows the field and closes the panel rather
 * than opening some second reading of its own.
 *
 * What the top of the chroma table says is the whole argument of the piece,
 * stated in names rather than as a curve: the most colourful painters here are
 * fourteenth-century Sienese and Florentines, and the collection has never
 * been that saturated since.
 */
const TABLE_ROWS = 12;

const MEASURE = {
  chroma: {
    label: "CHROMA", high: "MOST COLOUR", low: "LEAST COLOUR",
    // Not the group's own range: a bar has to be read against a fixed ruler or
    // two tables cannot be compared. This is CHROMA_AXIS, the same one the
    // strip under the field draws both curves against.
    axis: CHROMA_AXIS,
    note: "How far a colour sits from grey — √(a*² + b*²) in CIE L*a*b*, "
      + "averaged over every measured colour of every work.",
  },
  light: {
    label: "LIGHTNESS", high: "LIGHTEST", low: "DARKEST",
    axis: [20, 70],
    note: "L*, where a colour sits between black and white, averaged over "
      + "every measured colour of every work.",
  },
};

const BY = {
  artist: { label: "PAINTERS", floor: `AT LEAST ${RANK_MIN_WORKS} WORKS` },
  school: { label: "SCHOOLS", floor: "" },
  source: { label: "MUSEUMS", floor: "" },
};

function paintTables() {
  const measure = MEASURE[state.tableMeasure];
  const by = BY[state.tableBy];
  const [lo, hi] = measure.axis;

  /* A row is a button only when pressing it leads somewhere. Painters and
     schools both narrow the field; a museum does not, because the field has no
     filter for which collection a work came from and inventing one here would
     be a control that exists in a table and nowhere else. Those rows are a
     reading, and they are drawn as one — no pointer, no press. */
  const leadsBack = state.tableBy !== "source";
  const row = (group, place) => {
    const value = group[state.tableMeasure];
    const width = clamp((value - lo) / (hi - lo), 0, 1) * 100;
    const inner =
      `<em>${place}</em>`
      + `<span class="tables__name">${escapeHtml(group.label)}`
      + `<i>${num(group.works)} WORKS · ${span(group.from, group.to)}</i></span>`
      + `<b>${value.toFixed(1)}</b>`
      + `<u style="width:${width.toFixed(1)}%"></u>`;
    return leadsBack
      ? `<li><button type="button" data-key="${escapeHtml(group.key)}">${inner}</button></li>`
      : `<li><span class="tables__row">${inner}</span></li>`;
  };

  const fill = (node, end) => {
    const rows = state.stats.ranking(state.tableBy, state.tableMeasure, end, TABLE_ROWS);
    node.innerHTML = rows.map((g, i) => row(g, i + 1)).join("");
  };
  fill(el.tableHigh, "high");
  fill(el.tableLow, "low");

  el.tablesHighLabel.textContent = measure.high;
  el.tablesLowLabel.textContent = measure.low;
  el.tablesNote.textContent = measure.note
    + (by.floor ? ` Painters with fewer than ${RANK_MIN_WORKS} works are left out: `
      + "a handful of paintings is not a tendency." : "");

  for (const button of el.tableBy.children) {
    button.setAttribute("aria-pressed", String(button.dataset.by === state.tableBy));
  }
  for (const button of el.tableMeasure.children) {
    button.setAttribute("aria-pressed",
      String(button.dataset.measure === state.tableMeasure));
  }
}

/** A row was pressed: narrow the field to it and get out of the way. */
function enterFromTable(key) {
  if (state.tableBy === "school") {
    const index = state.data.meta.nationalities.indexOf(key);
    if (index < 0) return;
    setSchools(index);
    setQuery("");
  } else {
    // The search dims rather than filters, which is exactly right here: it
    // shows where this painter sits *inside* the collection rather than
    // deleting the rest, and the rings and the named list come free.
    setSchools(-1);
    setQuery(key);
  }
  setView("field");
  spendHint();
}

/* ---------- the story ----------
 *
 * Nine hundred words in a 420px box explained what the field is and why it
 * looks the way it does, and nobody read them. The field makes the argument
 * perfectly well on its own — but only if you already know to look for it, and
 * only if you can drive the controls that show it. So the argument drives them.
 *
 * Every step is exactly a state the controls can reach. Nothing here is a
 * second rendering, nothing is special-cased in the renderer, and the last step
 * simply leaves you in the field with everything where the story put it. That
 * is the difference between a walkthrough and a video: you are never watching,
 * you are always already holding the instrument.
 */
function setStep(index) {
  if (index < 0 || index >= STEPS.length) return;
  state.step = index;
  const step = STEPS[index];
  const s = step.state;

  // A school is named rather than indexed: the vocabulary is built from the
  // data and its order is not a promise, so "Dutch" survives a rebuild that
  // renumbers the list and `nat: 3` does not.
  if (s.natName !== undefined) {
    const at = state.data.meta.nationalities.indexOf(s.natName);
    setSchools(at >= 0 ? at : -1);
  } else if (s.nat !== undefined) {
    setSchools(s.nat);
  }
  if (s.query !== undefined) setQuery(s.query);
  if (s.chrono !== undefined) setLayout(s.chrono);
  if (s.mode === "time") setMode("time", { year: s.year, play: false });
  else setMode("all");
  hideDetail();

  el.storyCount.textContent = `${index + 1} / ${STEPS.length}`;
  el.storyTitle.textContent = step.title;
  el.storyText.textContent = step.text;
  el.storyBack.disabled = index === 0;
  el.storyNext.textContent = index === STEPS.length - 1 ? "EXPLORE →" : "NEXT →";
  el.storyDots.innerHTML = STEPS.map((_, i) =>
    `<button type="button" data-step="${i}" class="${i === index ? "is-at" : ""}" `
    + `aria-label="Step ${i + 1}"></button>`).join("");
}

/* ---------- two schools, one ruler ----------
 *
 * This was built once before as an overlay — both schools drawn on the same
 * field at once, each with its own curve on the strip — and withdrawn, because
 * two clouds in one space do not read as a comparison. They read as one filter
 * or the other, and the only part that worked was the pair of curves.
 *
 * Beside each other they read. What makes that honest is already in the
 * project: CHROMA_AXIS is fixed rather than rescaled per filter, so neither
 * side can look saturated merely by being the more colourful of the two, and
 * both bars mean the same thing at the same length.
 *
 * Schools only, not painters. Two painters at eight works each is a comparison
 * of sampling noise; the question the data actually supports is about
 * traditions.
 */
const COMPARE_AXIS = { chroma: CHROMA_AXIS, light: [20, 70] };
const COMPARE_MIN_WORKS = 30;

function paintCompare() {
  const groups = state.stats.groups("school");
  const find = (name) => groups.find((g) => g.key === name);
  const a = find(el.compareA.value), b = find(el.compareB.value);
  if (!a || !b) return;

  const figures = (group, other) => {
    const bar = (key, label) => {
      const [lo, hi] = COMPARE_AXIS[key];
      const width = clamp((group[key] - lo) / (hi - lo), 0, 1) * 100;
      // The other side's position is marked on this side's bar, so the two can
      // be compared without the eye travelling and having to remember.
      const mark = clamp((other[key] - lo) / (hi - lo), 0, 1) * 100;
      const lead = group[key] - other[key];
      return `<div class="compare__bar"><span>${label}</span>`
        + `<u><b style="width:${width.toFixed(1)}%"></b>`
        + `<i style="left:${mark.toFixed(1)}%"></i></u>`
        + `<em>${group[key].toFixed(1)}`
        + `<s>${lead >= 0 ? "+" : "−"}${Math.abs(lead).toFixed(1)}</s></em></div>`;
    };
    return `<p class="compare__count">${num(group.works)} WORKS · `
      + `${span(group.from, group.to)}</p>` + bar("chroma", "COLOUR") + bar("light", "LIGHT");
  };

  el.compareFiguresA.innerHTML = figures(a, b);
  el.compareFiguresB.innerHTML = figures(b, a);

  /* The one sentence the numbers add up to. Written out rather than left to
     the reader, because the whole reason the overlay failed was that it put
     two things on screen and said nothing about them. */
  const gap = a.chroma - b.chroma;
  const [more, less] = gap >= 0 ? [a, b] : [b, a];
  el.compareVerdict.innerHTML = Math.abs(gap) < 0.5
    ? `<b>${escapeHtml(a.label)}</b> and <b>${escapeHtml(b.label)}</b> painting sit at `
      + "almost exactly the same distance from grey."
    : `<b>${escapeHtml(more.label)}</b> painting sits <b>${Math.abs(gap).toFixed(1)}</b> `
      + `further from grey than <b>${escapeHtml(less.label)}</b> — `
      + `${Math.round(Math.abs(gap) / less.chroma * 100)}% more chroma, on the same scale.`;
}

function fillCompare() {
  const groups = state.stats.groups("school")
    .filter((g) => g.works >= COMPARE_MIN_WORKS && g.key !== "Other / unattributed")
    .sort((x, y) => y.works - x.works);
  const options = groups.map((g) =>
    `<option value="${escapeHtml(g.key)}">${escapeHtml(g.label)} (${num(g.works)})</option>`)
    .join("");
  el.compareA.innerHTML = options;
  el.compareB.innerHTML = options;
  // Opens on the comparison the data most invites: the Dutch are the lowest
  // chroma of any school here and the Italians among the highest — the Baroque
  // argument and the medieval one in a single picture.
  const has = (key) => groups.some((g) => g.key === key);
  el.compareA.value = has("Dutch") ? "Dutch" : groups[0].key;
  el.compareB.value = has("Italian") ? "Italian" : groups[1]?.key ?? groups[0].key;
  el.compareNote.textContent =
    "Both bars are drawn against one fixed scale — the same ruler the curve "
    + "under the field uses — so neither side can look saturated merely by being "
    + "the more colourful of the two. The mark on each bar is where the other "
    + "school falls.";
}

/* ---------- the readings ----------
 *
 * One question at the top, four answers, and choosing one recomposes the
 * footer so only its own controls are live.
 *
 * This is not a mode system in the usual sense, and the difference matters:
 * there is one dataset, one field, one set of measurements underneath all of
 * them. A reading only decides which is in front and which controls can act.
 * The field keeps its whole state across a switch — leave the tables and it is
 * exactly where you left it, still narrowed to whatever you had narrowed it to.
 */
function setView(next, { fromURL = false } = {}) {
  const view = VIEWS[next] ? next : "field";
  const previous = state.view;
  state.view = view;

  el.tables.hidden = view !== "tables";
  el.story.hidden = view !== "story";
  el.compare.hidden = view !== "compare";
  el.about.hidden = true;

  for (const button of el.views.children) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  applyView(view, (id) => el[id] ?? null);
  // Published so the stylesheet can reach view-dependent chrome that is not a
  // control and so cannot be put away by claiming it — the divider between the
  // two control groups being the one case: it is a statement that those groups
  // sit side by side, and in a reading where neither is live it divides
  // nothing from the one button that is.
  document.body.dataset.view = view;

  /* Only on the actual transition into a panel reading — pressing the button
     for the view you are already in must not yank focus off whatever inside
     it you have since tabbed to. Landing on "field" is the close side of the
     transition and needs nothing: the panel that was open is now [hidden],
     and a browser moves focus off a newly-hidden element on its own. */
  if (previous !== view) {
    const opened = { tables: el.tablesClose, story: el.storyClose, compare: el.compareClose }[view];
    opened?.focus({ preventScroll: true });
  }

  if (view === "tables") {
    hideDetail();
    paintTables();
  }
  if (view === "compare") {
    hideDetail();
    paintCompare();
  }
  if (view === "story") {
    spendHint();
    /* The story sets the field on every step, which is the whole of what it
       is — but that means entering it discards whatever you had narrowed to,
       and doing that in silence is the same fault as the two questions putting
       each other away without a word. Said, and only when there is something
       to lose. */
    if (narrowed()) note("THE STORY TAKES THE FIELD — YOUR VIEW IS SET ASIDE");
    // A link into a step sets the step itself; entering the story by pressing
    // it starts at the beginning.
    if (!fromURL) setStep(0);
  } else {
    state.step = -1;
  }
  syncURL();
}

/* ---------- the second layer ---------- */

/* Thumbnails already fetched, held decoded so a second look is instant. Capped:
   7,094 of them would be a real amount of memory, and the ones worth keeping are
   the ones just looked at. */
const IMG_CACHE = 48;
const imgs = new Map();

function preload(src) {
  let img = imgs.get(src);
  if (img) return img;
  img = new Image();
  img.decoding = "async";
  img.src = src;
  imgs.set(src, img);
  if (imgs.size > IMG_CACHE) imgs.delete(imgs.keys().next().value);
  return img;
}

/* How long the panel will hold for a picture before showing the words without
   it. Long enough to cover a decode and a warm fetch, short enough that a cold
   one does not read as the click having missed. */
const IMG_HOLD = 140;
let detailToken = 0;

/**
 * Open a work. What the eye is waiting on happens now; the panel follows when it
 * can be right in one go.
 *
 * The ring, the timelapse stopping and the URL are immediate, because those are
 * the answer to the click. The sheet is filled only once its picture is ready to
 * paint with it: setting `img.src` beside the text meant the words changed on the
 * frame you clicked and the painting arrived whenever the file did, so selecting
 * a second work showed you its title over the previous one's picture. Fast, and
 * still read as lag, because two things that describe one painting moved apart.
 */
function showDetail(particle) {
  // Only when the selection actually moves, or stepping with Enter would restart
  // the arrival on every frame that re-opened the same work.
  if (state.selected !== particle) state.ringAt = performance.now();
  state.selected = particle;
  state.marks = true;   // the ring is over the cloud, not in it
  // The timelapse stops while you are looking at a work: the particle you clicked
  // would otherwise fade out from under the panel.
  setPlaying(false);
  paintNear();
  syncURL();
  fillDetail(particle);
}

async function fillDetail(particle) {
  const F = state.field;
  const p = state.data.paintings[F.owner[particle]];
  const thisHex = F.css[particle];
  // `c` indexes meta.sources: the thumbnail path, the outbound link and the
  // credit line all come from there, because five catalogues number their own
  // objects independently and an id alone no longer identifies anything.
  const src = state.data.meta.sources[p.c];
  const href = `thumbs/${src.key}/${p.i}.webp`;

  const token = ++detailToken;
  const img = preload(href);
  if (!img.complete) {
    await Promise.race([
      img.decode().catch(() => {}),   // a broken file still gets its sheet
      new Promise((done) => setTimeout(done, IMG_HOLD)),
    ]);
    // Clicking faster than the network: whichever work was asked for last is the
    // one that gets the panel, not whichever file happened to arrive last.
    if (token !== detailToken) return;
  }

  // The intrinsic size goes on with the source. `height: auto` on its own makes
  // the browser lay the figure out at nothing, paint, then relayout once the file
  // says how tall it is — so the sheet under it jumped. Given the ratio up front
  // there is one layout and no jump. Known here because it has just been decoded.
  if (img.naturalWidth) {
    el.detailImg.width = img.naturalWidth;
    el.detailImg.height = img.naturalHeight;
  }
  el.detailImg.src = href;
  el.detailImg.alt = p.t || "Untitled";
  el.detailTitle.textContent = p.t || "Untitled";
  el.detailArtist.textContent = p.a || "Unattributed";
  el.detailYear.textContent = span(p.s, p.e);
  el.detailNat.textContent = state.data.meta.nationalities[p.n] || "—";
  el.detailSource.textContent = src.name;
  el.detailId.textContent = p.i;
  // k-means runs with k=5; clusters under 4% of pixels are dropped, so a shorter
  // palette is a real statement about the painting, not a failure.
  el.detailPalette.textContent = p.k.length === 5
    ? "5 of 5 clusters retained"
    : `${p.k.length} of 5 retained · ${5 - p.k.length} below the 4% floor`;
  // The clicked colour is marked, and every hex is printed: the hex is the
  // measurement, and it should not be left implicit in a swatch.
  el.detailSwatches.innerHTML = p.k.map((h) =>
    `<li class="${h === thisHex ? "is-this" : ""}"><i style="background:${h}"></i>`
    + `<code>${h.toUpperCase()}</code></li>`).join("");
  el.detailLink.href = src.url.replace("{}", encodeURIComponent(p.i));
  el.detailLink.textContent = `OPEN AT ${src.short} ↗`;
  paintEra(F.owner[particle]);
  paintKin(F.owner[particle]);
  /* Focus follows the panel only on the transition into it — never on a
     refresh while it is already open. This runs again every time you step to
     a different particle (Enter through search matches, a sibling thumbnail,
     the timelapse walking past), and stealing focus back to the close button
     on every one of those would fight a keyboard user who has since moved
     focus somewhere inside the panel on purpose. */
  const wasHidden = el.detail.hidden;
  el.detail.hidden = false;
  if (wasHidden) el.detailClose.focus({ preventScroll: true });
}

/* Where this work sits among the paintings of its own time.
 *
 * The panel could already tell you a work's chroma to one decimal place, and
 * the number meant nothing: nobody has a feel for 14.2. The same measurement
 * said as a position — more muted than seven in ten of what was painted around
 * it — is a fact you can hold, and it is the fact the field is showing
 * visually anyway. This only says it in words, for one painting.
 *
 * Shown as a bar rather than a percentage alone because the claim is about
 * where it falls in a distribution, and a bar is a distribution. Dropped
 * entirely when the era is too thin to quote: a percentile off nine paintings
 * is one of ten values dressed up as a measurement.
 */
function paintEra(index) {
  const era = state.stats.era(index);
  if (!era) { el.detailEra.hidden = true; return; }

  const line = (label, place, low, high) => {
    const percent = Math.round(place * 100);
    /* Said from whichever end is the shorter statement: "in the top 8%" beats
       "more colourful than 92%", and both are the same number.
       "OF ITS TIME" used to close each of these and had to go: at the panel's
       real width it pushed the sentence onto a second line and left the word
       TIME stranded under the bar. It was also saying nothing the next line
       does not say better — the basis under these two names the era outright,
       with its span and how many works are in it. */
    const words = percent >= 50
      ? `${high} THAN ${percent}%`
      : `${low} THAN ${100 - percent}%`;
    return `<div class="era__row"><span>${label}</span>`
      + `<u><i style="left:${clamp(place, 0, 1) * 100}%"></i></u>`
      + `<b>${words}</b></div>`;
  };

  el.detailEra.innerHTML =
    `<h3>THIS WORK IN ITS OWN TIME</h3>`
    + line("COLOUR", era.chroma, "MORE MUTED", "MORE COLOURFUL")
    + line("LIGHT", era.light, "DARKER", "LIGHTER")
    + `<i class="era__basis">OF THE ${num(era.works)} WORKS PAINTED ${era.from}–${era.to}</i>`;
  el.detailEra.hidden = false;
}

/* The other works by the same hand.
 *
 * 83% of the collection has at least one sibling, and until the five
 * catalogues' spellings were folded into one name per painter this could not
 * have been built honestly: Rembrandt existed as three artists, so a panel
 * claiming to show his other works would have shown a third of them.
 *
 * Nearest in date first, because the interesting neighbour of a painting is
 * usually the one made beside it — and because a painter's span can be fifty
 * years, in which the palette is not one thing.
 */
const KIN_SHOWN = 8;

function paintKin(index) {
  const kin = state.stats.siblings(index, KIN_SHOWN);
  if (!kin.length) { el.detailKin.hidden = true; return; }

  const artist = state.data.paintings[index].a;
  const total = state.stats.groups("artist").find((g) => g.key === artist)?.works ?? 0;
  el.detailKinLabel.textContent =
    `${num(total - 1)} MORE BY ${artist.toUpperCase()}`;

  const sources = state.data.meta.sources;
  el.detailKinList.innerHTML = kin.map((i) => {
    const p = state.data.paintings[i];
    const href = `thumbs/${sources[p.c].key}/${p.i}.webp`;
    return `<li><button type="button" data-kin="${i}" title="${escapeHtml(p.t)} · ${span(p.s, p.e)}">`
      + `<img src="${href}" alt="${escapeHtml(p.t || "Untitled")}" loading="lazy" decoding="async">`
      + `<i>${p.y}</i></button></li>`;
  }).join("");
  el.detailKin.hidden = false;
}

function hideDetail() {
  // Invalidates any fill still waiting on a picture. The token guards against a
  // newer selection landing first; closing is the other way the answer can go
  // stale, and without this a slow file would reopen the panel after you had
  // already clicked it away.
  detailToken++;
  el.detail.hidden = true;
  state.selected = -1;
  state.matchAt = -1;   // no ring standing, so the count goes back to the total
  markMatchRow();
  state.marks = true;
  syncURL();
}

/* ---------- init ---------- */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function fillAbout(meta) {
  el.aboutMethod.innerHTML = Object.values(meta.notes || {})
    .map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  el.aboutSource.textContent =
    `${num(meta.totalPaintings)} paintings, ${num(meta.totalCells)} extracted colours, `
    + `${meta.yearRange[0]}–${meta.yearRange[1]}, from `
    + `${meta.sources.length} open-access collections. `
    + `Built ${meta.generatedAt}.`;
  // Each museum is credited by name, with its licence and how much of the field
  // is actually its: the counts are the attribution being specific.
  el.aboutSources.innerHTML = meta.sources.map((s) =>
    `<li><a href="${escapeHtml(s.site)}" target="_blank" rel="noopener">`
    + `${escapeHtml(s.name)} ↗</a> — ${escapeHtml(s.licence)}, `
    + `${num(s.n)} paintings</li>`).join("");
}

/** Schools, most represented first, with their counts: the filter states its own bias. */
function fillFilter(data) {
  const counts = new Map();
  for (const p of data.paintings) {
    if (p.n == null) continue;
    counts.set(p.n, (counts.get(p.n) || 0) + 1);
  }
  const rows = [...counts.entries()]
    .filter(([, c]) => c >= 12)
    .sort((a, b) => b[1] - a[1]);
  const options = rows.map(([n, c]) =>
    `<option value="${n}">${escapeHtml(data.meta.nationalities[n] || "?")} (${c})</option>`)
    .join("");
  el.natFilter.innerHTML = `<option value="-1">ALL</option>${options}`;
}

async function init() {
  boot("> connecting to dataset ...");
  let data;
  try {
    // no-cache, not force-cache: revalidate every load. The dataset and this
    // script are separate files with separate cache lifetimes, so force-cache
    // let a browser pair a months-old JSON with today's code -- and when the
    // schema moves under it, that combination is not stale, it is broken.
    // Revalidating costs one conditional request that answers 304 in the
    // ordinary case, and the images are the bandwidth here anyway.
    const response = await fetch("data/chromatica.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    if (!Array.isArray(data?.meta?.sources)) {
      throw new Error("dataset is older than this build");
    }
  } catch (error) {
    boot(`! dataset unavailable: ${error.message}`);
    boot("! the field cannot be composed. try a hard reload.");
    return;
  }

  try {
    await compose(data);   // awaited, or a throw past its first await escapes
  } catch (error) {
    // A half-drawn boot screen that never finishes reads as a hang, and a hang
    // gives no one anything to act on. Say what broke instead.
    boot(`! ${error.message}`);
    boot("! the field cannot be composed. try a hard reload.");
  }
}

async function compose(data) {
  state.data = data;
  boot(`> ${num(data.meta.totalPaintings)} paintings / `
    + `${num(data.meta.totalCells)} extracted colours`);

  state.field = new Field(data);
  // Built on the field rather than on the raw data: field.js has already
  // converted every colour to Lab, and doing it twice would be both slower and
  // a second place for the conversion to drift.
  state.stats = new Stats(data, state.field);
  state.cursor = state.field.y0;
  boot(`> ${num(state.field.n)} particles measured in CIE L*a*b*`);
  boot("> layout: year × lightness");
  boot(`> ${state.field.y0}–${state.field.y1} / whole span`);

  el.timeline.setAttribute("aria-valuemin", state.field.y0);
  el.timeline.setAttribute("aria-valuemax", state.field.y1);
  fillAbout(data.meta);
  fillFilter(data);
  fillCompare();
  measure();
  measureFoot();
  measureHead();
  bindInput();
  setLayout(true);
  setMode("all");
  setView("field");   // establishes which controls are live before anything is shown
  lockWidths();
  // Widths measured in a fallback face are wrong once the real one arrives.
  if (document.fonts?.ready) document.fonts.ready.then(lockWidths);
  applyURL();

  boot("> composing ...");
  await new Promise((resolve) => setTimeout(resolve, 460));
  el.boot.classList.add("boot--done");
  requestAnimationFrame(frame);
  setTimeout(() => { el.boot.hidden = true; }, 800);
  runOpening();   // the field shows what a particle is, once, then lets go
}

init();
