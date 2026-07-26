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
import { Field } from "./field.js";
import { Nebula } from "./nebula.js";

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
  natFilter: $("natFilter"),
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
  selected: -1,       // particle index
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
  state.cssW = Math.max(1, Math.floor(rect.width));
  state.cssH = Math.max(1, Math.floor(rect.height));
  nebula.resize(state.cssW, state.cssH);
  state.field.resize(state.cssW, state.cssH);
  state.tlW = el.timeline.clientWidth;
  state.tlH = el.timeline.clientHeight;
  state.tlKey = "";   // force the strip to redraw at the new size
  state.dirty = true;
}

/* ---------- the loop ---------- */
let t0 = 0;
let last = 0;

function frame(now) {
  const t = (now - (t0 ||= now)) / 1000;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;

  if (state.mode === "time" && state.playing) {
    state.cursor += PLAY_YEARS_PER_SEC * dt;
    if (state.cursor > state.field.y1) state.cursor = state.field.y0;   // a timelapse loops
  }

  state.field.step({
    year: state.mode === "time" ? state.cursor : null,
    t, reduceMotion, nat: state.nat, chrono: state.chrono,
  });

  // The same amount of ink whatever the particle count: the whole span puts about
  // eight times more colour on the canvas than one window does, and at equal alpha
  // it would stop being a cloud and become a slab. Alpha only — no hue is touched.
  const colours = state.field.stats.colours;
  const intensity = colours > 0 ? clamp(INK / colours, 0.3, 1) : 1;

  // The timelapse reweights every particle on every frame, so there is always
  // something new to draw. The whole-collection view usually has nothing.
  state.debt += state.field.motion;
  if (state.dirty || state.mode === "time" || state.debt >= REDRAW_PX) {
    nebula.draw(state.field, state.selected, intensity);
    state.debt = 0;
    state.dirty = false;
  }
  paintReadout();
  drawTimeline();
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
  const key = timed ? `t|${from}|${to}|${Math.round(state.cursor)}` : `a|${state.nat}`;
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

  // baseline, and the handle only when there is a year to point at
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#1e2220";
  ctx.fillRect(0, base, w, Math.max(1, dpr));
  if (timed) {
    ctx.fillStyle = "#00ff9d";
    ctx.fillRect(Math.round(xOf(state.cursor)), 0, Math.max(1, dpr), h);
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
  el.btnPlay.hidden = !timed;
  el.cursorRange.hidden = !timed;
  el.cursorLabel.textContent = timed ? "YEAR" : "SHOWING";
  el.cursorValue.classList.toggle("is-word", !timed);
  if (!timed) el.cursorValue.textContent = "ALL YEARS";
  el.timelineLabel.textContent = timed
    ? "WORKS PER YEAR · DRAG TO SCRUB"
    : "WORKS PER YEAR · CLICK TO START A TIMELAPSE";
  paintPlay();
  paintCopy();
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
}

function setCursor(year) {
  state.cursor = clamp(year, state.field.y0, state.field.y1);
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
    state.nat = -1;
    el.natFilter.value = "-1";
    hideDetail();
    setLayout(true);
    setMode("all");
  });
  el.natFilter.addEventListener("change", () => {
    state.nat = Number(el.natFilter.value);
    state.tlKey = "";
    state.dirty = true;   // particles leave the field without moving
    hideDetail();
  });
  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);

  /* --- keyboard --- */
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideDetail(); el.about.hidden = true; return; }
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

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 120);
  });
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
}

function hideDetail() {
  el.detail.hidden = true;
  state.selected = -1;
  state.dirty = true;
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
  el.natFilter.innerHTML = `<option value="-1">ALL</option>`
    + rows.map(([n, c]) =>
      `<option value="${n}">${escapeHtml(data.meta.nationalities[n] || "?")} (${c})</option>`)
      .join("");
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

  // ?y=1600 opens straight into the timelapse at a year, paused: a moment in the
  // field is worth being able to hand to someone.
  const asked = Number(new URLSearchParams(location.search).get("y"));
  if (Number.isFinite(asked) && asked >= state.field.y0 && asked <= state.field.y1) {
    setMode("time", { year: asked, play: false });
  }

  boot("> composing ...");
  await new Promise((resolve) => setTimeout(resolve, 460));
  el.boot.classList.add("boot--done");
  requestAnimationFrame(frame);
  setTimeout(() => { el.boot.hidden = true; }, 800);
}

init();
