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

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  hudSub: $("hudSub"),
  statWorks: $("statWorks"), statColours: $("statColours"),
  statSpan: $("statSpan"), statWindow: $("statWindow"),
  stage: $("stage"), field: $("field"), hint: $("hint"), hoverchip: $("hoverchip"),
  axes: $("axes"), btnLayout: $("btnLayout"),
  cursorLabel: $("cursorLabel"), cursorValue: $("cursorValue"),
  cursorRange: $("cursorRange"), cursorSpan: $("cursorSpan"),
  natFilter: $("natFilter"), natFilter2: $("natFilter2"),
  search: $("search"), searchCount: $("searchCount"), searchList: $("searchList"),
  btnTimelapse: $("btnTimelapse"), btnPlay: $("btnPlay"),
  btnReset: $("btnReset"), btnInfo: $("btnInfo"),
  timeline: $("timelineCanvas"), timelineLabel: $("timelineLabel"),
  about: $("about"), aboutClose: $("aboutClose"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailTitle: $("detailTitle"), detailArtist: $("detailArtist"),
  detailYear: $("detailYear"), detailNat: $("detailNat"), detailId: $("detailId"),
  detailSource: $("detailSource"), aboutSources: $("aboutSources"),
  hudBlurbScope: $("hudBlurbScope"),
  detailPalette: $("detailPalette"), detailSwatches: $("detailSwatches"),
  detailLink: $("detailLink"),
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null, field: null,
  mode: "all",        // "all" = the whole span at once, "time" = the timelapse
  chrono: true,       // layout: true = year × lightness, false = the a* and b* plane
  playing: false,
  cursor: 0,          // the timelapse year, kept as a float so play is smooth
  nat: -1,            // school filter, -1 for all
  nat2: -1,           // a second school shown beside the first, -1 for none
  query: "",          // free text over title and artist; dims, never removes
  selected: -1,       // particle index
  matchAt: -1,        // position in the current list of matches, -1 = not stepping
  matchTotal: 0,
  matchIds: [],       // the matching particles, in the order the list shows them
  preview: -1,        // particle ringed by pointing at a result row, not selected
  listKey: null,      // field.viewKey the list was built from
  hover: -1,
  cssW: 0, cssH: 0,
  tlW: 0, tlH: 0,
  // Last values written to the DOM and to the strip. The field is redrawn every
  // frame because it moves; the panel is not. Writing four readout nodes and 600
  // bars on every frame cost more than the 11,728 particles did.
  ui: {}, tlKey: "",
  debt: 0,            // unpainted motion, in CSS px
  dirty: true,        // something other than motion changed the picture
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
  lock(el.cursorLabel, ["SHOWING", "YEAR"]);
  lock(el.cursorValue, [
    { text: "ALL YEARS", className: "cursor__year is-word" },
    { text: String(F.y1), className: "cursor__year" },
  ]);
  lock(el.cursorSpan, [wholeSpan]);
  lock(el.statWorks, [num(works)]);
  lock(el.statColours, [num(F.n)]);
  lock(el.statSpan, [wholeSpan, "—"]);
  lock(el.statWindow, ["ALL", "±999 YR"]);
  lock(el.searchCount, [`${num(works)} OF ${num(works)} ↵`]);
  // Every combination the strip's own label can take, since it sits beside a
  // canvas that takes the rest of the row.
  lock(el.timelineLabel, ["LINE", "LINE+DASH"].flatMap((k) =>
    ["DRAG TO SCRUB", "CLICK FOR TIMELAPSE"].map((a) => `BARS WORKS · ${k} CHROMA · ${a}`)));
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
    t, reduceMotion, nat: state.nat, nat2: state.nat2, chrono: state.chrono,
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
  if (state.dirty || state.mode === "time" || state.debt >= REDRAW_PX) {
    const tDraw = perf ? performance.now() : 0;
    // A row pointed at in the results list rings its blob without selecting it:
    // running the eye down the list should light up the field, not open panels.
    nebula.draw(state.field, state.preview >= 0 ? state.preview : state.selected, intensity);
    if (perf) perf.draw(performance.now() - tDraw);
    state.debt = 0;
    state.dirty = false;
  }
  paintReadout();
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
  const empty = s.colours === 0;
  const shown = empty ? "—" : span(s.from, s.to);
  put(el.statWorks, "works", num(s.works));
  put(el.statColours, "colours", num(s.colours));
  put(el.statSpan, "span", shown);
  put(el.statWindow, "window",
    state.mode === "time" ? `±${Math.round(s.sigma)} YR` : "ALL");
  // Matches among the works actually on screen, not in the whole dataset: with a
  // school or a year window on, those are two different numbers. Once you start
  // walking the matches the count becomes your position in them, because that is
  // then the more useful of the two numbers.
  put(el.searchCount, "matched",
    !state.query ? ""
      : state.matchAt >= 0 ? `${state.matchAt + 1}/${num(state.matchTotal)} ↵`
        : `${num(s.matched)} OF ${num(s.works)} ↵`);

  if (state.mode !== "time") return;
  const year = Math.round(state.cursor);
  if (state.ui.year !== year) {
    state.ui.year = year;
    el.cursorValue.textContent = year;
    el.timeline.setAttribute("aria-valuenow", year);
    el.timeline.setAttribute("aria-valuetext", `${year}, ${num(s.works)} works in the window`);
  }
  put(el.cursorSpan, "cursorSpan", shown);
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
    ? `t|${from}|${to}|${Math.round(state.cursor)}|${state.nat}|${state.nat2}`
    : `a|${state.nat}|${state.nat2}`;
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

  /* Both curves are the same near-white and are told apart by stroke, not by
     colour: the strip already spends green on the histogram and the handle, and a
     third hue in 26 px would be read as a third measurement. The axis is fixed
     (CHROMA_AXIS), so the two are directly comparable — that is the whole point of
     drawing them together. */
  const strokeCurve = (nat, dashed) => {
    const { v, ok } = F.chromaCurve(nat);
    for (const [width, colour, alpha] of [[3.2, "#0a0a0a", 1], [1.3, "#e8f5ef", 0.82]]) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, width * dpr);
      ctx.lineJoin = ctx.lineCap = "round";
      // The dark pass stays solid: it is the gap cut in the histogram, and a
      // dashed gap would let the bars through between the dashes.
      ctx.setLineDash(dashed && colour !== "#0a0a0a" ? [3 * dpr, 3 * dpr] : []);
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
    ctx.setLineDash([]);
  };
  // Second first, so the school in the main filter is the one on top.
  if (state.nat2 >= 0) strokeCurve(state.nat2, true);
  strokeCurve(state.nat, false);

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
  // particle is cheaper than storing the base index for all 32,438.
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
  set("nat2", state.nat2 >= 0 ? String(state.nat2) : null);
  set("plane", state.chrono ? null : "1");
  set("q", state.query ? state.query : null);
  set("w", state.selected >= 0 ? particleName(state.selected) : null);
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
  // setSchools, not the fields directly: a URL naming a second school and no
  // first, or the same school twice, has to collapse the same way the UI does.
  if (nat >= 0) setSchools(nat, school("nat2"));

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
  el.cursorRange.classList.toggle("is-vacant", !timed);
  el.cursorLabel.textContent = timed ? "YEAR" : "SHOWING";
  el.cursorValue.classList.toggle("is-word", !timed);
  if (!timed) el.cursorValue.textContent = "ALL YEARS";
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

/**
 * Which schools are on the field, as one operation because they constrain each
 * other: ALL in the first means every school is already shown, so a second one
 * would filter nothing, and the same school twice is one school.
 */
/* The strip carries two things and now sometimes three, and the label is the only
   place that says which is which. It has to stay short: .timeline__label is
   nowrap and takes its width off the canvas. */
function paintTimelineLabel() {
  el.timelineLabel.textContent = `BARS WORKS · ${state.nat2 >= 0 ? "LINE+DASH" : "LINE"} CHROMA · `
    + (state.mode === "time" ? "DRAG TO SCRUB" : "CLICK FOR TIMELAPSE");
}

function setSchools(nat, nat2) {
  state.nat = nat;
  state.nat2 = nat < 0 || nat2 === nat ? -1 : nat2;
  el.natFilter.value = String(state.nat);
  el.natFilter2.value = String(state.nat2);
  el.natFilter2.disabled = state.nat < 0;
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
  if (!state.query || !list.length) {
    el.searchList.hidden = true;
    el.searchList.innerHTML = "";
    state.matchIds = [];
    return;
  }
  const shown = list.slice(0, MATCH_ROWS);
  state.matchIds = list;
  const F = state.field;
  el.searchList.innerHTML = shown.map((i, k) => {
    const p = state.data.paintings[F.owner[i]];
    return `<li data-k="${k}" class="${k === state.matchAt ? "is-at" : ""}">`
      + `<b>${span(p.s, p.e)}</b><span>${escapeHtml(p.t || "Untitled")}`
      + `<i>${escapeHtml(p.a || "Unattributed")}</i></span></li>`;
  }).join("")
    + (list.length > shown.length
      ? `<li class="findlist__more">${num(list.length - shown.length)} MORE — NARROW THE SEARCH</li>`
      : "");
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

function markMatchRow() {
  const rows = el.searchList.children;
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
  el.hint.textContent = timed
    ? "DRAG THE FIELD OR THE STRIP · ← → TO STEP A YEAR"
    : "EVERY PARTICLE IS ONE MEASURED COLOUR OF ONE PAINTING";
  el.hudSub.textContent = (state.chrono
    ? "YEAR × LIGHTNESS · THE COLLECTION UNROLLED IN TIME"
    : "CIE L*a*b* CHROMATIC PLANE · PLACED BY HUE")
    + (timed ? " · MOVING WINDOW IN TIME" : " · CLICK A PARTICLE FOR ITS PAINTING");
}

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

function bindInput() {
  /* --- the strip: scrubs in the timelapse, and is the way into it otherwise --- */
  let onStrip = false;
  el.timeline.addEventListener("pointerdown", (event) => {
    onStrip = true;
    el.timeline.setPointerCapture(event.pointerId);
    const year = yearAtTimeline(event.clientX);
    if (state.mode !== "time") setMode("time", { year, play: false });
    else { setCursor(year); setPlaying(false); }
  });
  el.timeline.addEventListener("pointermove", (event) => {
    if (onStrip && state.mode === "time") setCursor(yearAtTimeline(event.clientX));
  });
  const releaseStrip = () => { onStrip = false; };
  el.timeline.addEventListener("pointerup", releaseStrip);
  el.timeline.addEventListener("pointercancel", releaseStrip);

  /* --- the field: a tap opens a painting; in the timelapse a drag also scrubs --- */
  let drag = null;
  el.stage.addEventListener("pointerdown", (event) => {
    el.stage.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, from: state.cursor, moved: 0 };
  });
  el.stage.addEventListener("pointermove", (event) => {
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
  el.btnReset.addEventListener("click", () => {
    setSchools(-1, -1);
    setQuery("");
    hideDetail();
    setLayout(true);
    setMode("all");
  });
  el.natFilter.addEventListener("change", () => {
    setSchools(Number(el.natFilter.value), state.nat2);
    hideDetail();
  });
  el.natFilter2.addEventListener("change", () => {
    setSchools(state.nat, Number(el.natFilter2.value));
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
    state.dirty = true;
  });
  el.searchList.addEventListener("pointerleave", () => {
    if (state.preview < 0) return;
    state.preview = -1;
    state.dirty = true;
  });
  el.searchList.addEventListener("click", (event) => {
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
  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);

  /* --- keyboard --- */
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideDetail(); el.about.hidden = true; return; }
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

  /* The stage is watched, not the window. A window resize is not the only thing
     that changes the size of the field: the footer under it grows and shrinks
     with the mode, and a canvas measured for the old height is stretched by CSS
     to the new one — the picture moves, the coordinates behind pick() do not,
     and the ring lands off the pointer. ResizeObserver fires before the paint
     that would have shown the mismatch, and measure() returns immediately when
     the box has not actually changed, so calling it often costs nothing. */
  new ResizeObserver(measure).observe(el.stage);
}

/* ---------- hover ---------- */
function showChip(px, py) {
  const hit = state.field.pick(px, py, 12);
  if (hit < 0) { hideChip(); return; }
  const F = state.field;
  const p = state.data.paintings[F.owner[hit]];
  if (hit !== state.hover) {
    state.hover = hit;
    el.hoverchip.innerHTML =
      `<b>${escapeHtml(p.t || "Untitled")}</b>`
      + `<i>${escapeHtml(p.a || "Unattributed")} · ${span(p.s, p.e)}</i><br>`
      + `<code>${F.css[hit].toUpperCase()}</code>`;
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

/* ---------- the second layer ---------- */
function showDetail(particle) {
  const F = state.field;
  const p = state.data.paintings[F.owner[particle]];
  const thisHex = F.css[particle];
  state.selected = particle;
  state.dirty = true;   // the ring is drawn on the canvas
  // The timelapse stops while you are looking at a work: the particle you clicked
  // would otherwise fade out from under the panel.
  setPlaying(false);

  // `c` indexes meta.sources: the thumbnail path, the outbound link and the
  // credit line all come from there, because four catalogues number their own
  // objects independently and an id alone no longer identifies anything.
  const src = state.data.meta.sources[p.c];
  el.detailImg.src = `thumbs/${src.key}/${p.i}.webp`;
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
  el.detail.hidden = false;
  syncURL();
}

function hideDetail() {
  el.detail.hidden = true;
  state.selected = -1;
  state.matchAt = -1;   // no ring standing, so the count goes back to the total
  markMatchRow();
  state.dirty = true;
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

/** The blurb states the size of the thing, so it is read off the thing. */
function fillBlurb(meta) {
  if (!el.hudBlurbScope) return;
  el.hudBlurbScope.textContent =
    `EVERY COLOUR MEASURED IN ${num(meta.totalPaintings)} PAINTINGS, `
    + `${meta.yearRange[0]}–${meta.yearRange[1]}, ACROSS `
    + `${meta.sources.length} OPEN-ACCESS COLLECTIONS.`;
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
  el.natFilter2.innerHTML = `<option value="-1">NONE</option>${options}`;
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
  state.cursor = state.field.y0;
  boot(`> ${num(state.field.n)} particles measured in CIE L*a*b*`);
  boot("> layout: year × lightness");
  boot(`> ${state.field.y0}–${state.field.y1} / whole span`);

  el.timeline.setAttribute("aria-valuemin", state.field.y0);
  el.timeline.setAttribute("aria-valuemax", state.field.y1);
  fillAbout(data.meta);
  fillBlurb(data.meta);
  fillFilter(data);
  measure();
  bindInput();
  setLayout(true);
  setMode("all");
  lockWidths();
  // Widths measured in a fallback face are wrong once the real one arrives.
  if (document.fonts?.ready) document.fonts.ready.then(lockWidths);
  applyURL();

  boot("> composing ...");
  await new Promise((resolve) => setTimeout(resolve, 460));
  el.boot.classList.add("boot--done");
  requestAnimationFrame(frame);
  setTimeout(() => { el.boot.hidden = true; }, 800);
}

init();
