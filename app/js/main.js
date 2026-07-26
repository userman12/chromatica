/* CHROMATICA — application shell: data load, tape state, input, HUD.
 *
 * The view is two numbers: which column of the tape sits at the crown of the
 * drum, and how many pixels a cell measures there. There is no vertical pan — the
 * ribbon always fits the stage vertically, so scrolling is one axis and one axis
 * only, and that axis is time.
 */
import {
  buildLayout, projection, hitTest, visibleBins, visibleCols,
  worldAtScreenX, scaleBounds,
} from "./layout.js";
import { Renderer } from "./renderer.js";

const MET_URL = "https://www.metmuseum.org/art/collection/search/";
const ZOOM_STEP = 1.35;
const WHEEL_GAIN = 1.5;        // cells travelled per cell-width of wheel delta
const FRICTION = 0.92;         // tape coasts to a stop after the hand lets go
const VEL_MIN = 0.015;
const CLICK_SLOP = 4;          // px of movement still counted as a click

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  stage: $("stage"), grid: $("grid"),
  crosshair: $("crosshair"), hoverchip: $("hoverchip"),
  statWorks: $("statWorks"), statCells: $("statCells"),
  statSpan: $("statSpan"), statZoom: $("statZoom"),
  crownYear: $("crownYear"), cursorFrom: $("cursorFrom"), cursorTo: $("cursorTo"),
  filterNat: $("filterNat"), timeline: $("timelineCanvas"),
  btnOut: $("btnOut"), btnIn: $("btnIn"), btnReset: $("btnReset"), btnInfo: $("btnInfo"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailTitle: $("detailTitle"), detailArtist: $("detailArtist"),
  detailYear: $("detailYear"), detailNat: $("detailNat"), detailId: $("detailId"),
  detailColumn: $("detailColumn"), detailPalette: $("detailPalette"),
  detailSwatches: $("detailSwatches"), detailLink: $("detailLink"),
  about: $("about"), aboutClose: $("aboutClose"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
};

const state = {
  data: null, layout: null,
  view: { center: 0, scale: 14 },
  cssW: 0, cssH: 0,
  bounds: { min: 8, max: 30 },
  selected: -1,
  matches: null,          // Uint8Array over paintings, or null when unfiltered
  hovered: -1,
};
const renderer = new Renderer(el.grid);

/* ---------- boot ---------- */
const bootLines = ["CHROMATICA v0.1"];
function boot(line) {
  bootLines.push(line);
  el.bootLog.textContent = bootLines.join("\n");
}

/* ---------- helpers ---------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (n) => n.toLocaleString("en-US");
const span = (s, e) => (s === e ? String(s) : `${s}–${e}`);

/** The projection in CSS pixels — what pointer coordinates live in. */
function proj() {
  return projection(state.layout, state.view, state.cssW, state.cssH);
}

/* ---------- view maintenance ---------- */
function measure() {
  const rect = el.stage.getBoundingClientRect();
  state.cssW = Math.max(1, Math.floor(rect.width));
  state.cssH = Math.max(1, Math.floor(rect.height));
  renderer.resize(state.cssW, state.cssH);
}

function relayout() {
  const before = state.layout ? state.view.center / state.layout.worldW : 0.5;
  state.layout = buildLayout(state.data, state.cssW, state.cssH);
  state.bounds = scaleBounds(state.layout, state.cssH);
  state.view.scale = clamp(state.layout.cellCenter, state.bounds.min, state.bounds.max);
  state.view.center = before * state.layout.worldW;
  clampView();
}

function clampView() {
  const v = state.view;
  v.scale = clamp(v.scale, state.bounds.min, state.bounds.max);
  // Both ends may be brought to the crown, so every work is reachable; past them
  // the tape simply is not there any more, and the axis says so.
  v.center = clamp(v.center, 0, state.layout.worldW - 1);
}

function zoomAt(factor, anchorX) {
  const v = state.view;
  const anchor = worldAtScreenX(proj(), anchorX);
  const before = v.scale;
  v.scale = clamp(v.scale * factor, state.bounds.min, state.bounds.max);
  // Keep the column under the cursor where it is: the arc scales with 1/scale, so
  // the offset from the crown scales with it too.
  v.center = anchor - (anchor - v.center) * (before / v.scale);
  clampView();
  render();
}

/* ---------- render + HUD ---------- */
function render(withScan) {
  if (withScan) renderer.scan(state); else renderer.draw(state);
  updateHud();
}

function updateHud() {
  const L = state.layout;
  const p = proj();
  const [b0, b1] = visibleBins(L, p);
  const bins = state.data.bins;

  let works = 0, cells = 0;
  for (let b = b0; b <= b1; b++) {
    const bin = bins[b];
    if (state.matches) {
      for (let pi = bin.p0; pi < bin.p1; pi++) {
        if (state.matches[pi] === 1) {
          works++;
          cells += state.data.paintings[pi].k.length;
        }
      }
    } else {
      works += bin.n;
      cells += L.binCellCount[b];
    }
  }

  const crown = bins[L.colBin[clamp(Math.round(p.center), 0, L.worldW - 1)]];
  const from = bins[b0].s;
  const to = bins[b1].e;
  el.statWorks.textContent = num(works);
  el.statCells.textContent = num(cells);
  el.statSpan.textContent = `${to - from + 1}y`;
  el.statZoom.textContent = (state.view.scale / state.layout.cellCenter).toFixed(2) + "×";
  el.crownYear.textContent = crown.s;
  el.cursorFrom.textContent = from;
  el.cursorTo.textContent = to;

  drawTimeline(b0, b1);
}

/**
 * The tape overview. Because the drum only ever shows about a fifth of the tape,
 * this strip is the only place the whole span is visible at once — so it carries
 * both the density of the collection and a window showing where you are.
 */
function drawTimeline(b0, b1) {
  const canvas = el.timeline;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const bins = state.data.bins;
  // Works per YEAR, not per bin: bins hold ~equal counts by construction, so only
  // the rate exposes how uneven the collection actually is over time.
  let peak = 0;
  const rate = bins.map((bin) => {
    const r = bin.n / (bin.e - bin.s + 1);
    if (r > peak) peak = r;
    return r;
  });

  const L = state.layout;
  const xOf = (col) => (col / L.worldW) * w;

  for (let b = 0; b < bins.length; b++) {
    const norm = Math.log1p(rate[b]) / Math.log1p(peak);   // spans ~2 orders of magnitude
    const barH = Math.max(1, Math.round(norm * (h - 1)));
    const x0 = Math.round(xOf(L.binCol0[b]));
    const x1 = Math.round(xOf(L.binCol0[b + 1]));
    ctx.fillStyle = b >= b0 && b <= b1 ? "#00ff9d" : "#2a2f2c";
    ctx.fillRect(x0, h - barH, Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0)), barH);
  }

  // The slice of tape currently on the drum, plus the crown itself.
  const [c0, c1] = visibleCols(L, proj());
  ctx.strokeStyle = "#00ff9d";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(Math.round(xOf(c0)) + 0.5, 0.5,
                 Math.max(2, Math.round(xOf(c1) - xOf(c0))), h - 1);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#00ff9d";
  ctx.fillRect(Math.round(xOf(state.view.center)), 0, Math.max(1, dpr), h);
}

/* ---------- panels ---------- */
function showDetail(index) {
  const p = state.data.paintings[index];
  const bin = state.data.bins[p.b];
  state.selected = index;
  el.detailImg.src = `thumbs/${p.i}.jpg`;
  el.detailImg.alt = p.t || "Untitled";
  el.detailTitle.textContent = p.t || "Untitled";
  el.detailArtist.textContent = p.a || "Unattributed";
  el.detailYear.textContent = span(p.s, p.e);
  el.detailNat.textContent = state.data.meta.nationalities[p.n] || "—";
  el.detailId.textContent = p.i;
  el.detailColumn.textContent = `${span(bin.s, bin.e)} · ${bin.n} works`;
  // k-means runs with k=5; clusters under 4% of pixels are dropped, so a shorter
  // palette is a real statement about the painting, not a failure.
  el.detailPalette.textContent = p.k.length === 5
    ? "5 of 5 clusters retained"
    : `${p.k.length} of 5 retained · ${5 - p.k.length} below the 4% floor`;
  // Hex values are the measurement. They are shown as text, not just as colour.
  el.detailSwatches.innerHTML = p.k.map((hex) =>
    `<li><i style="background:${hex}"></i><code>${hex.toUpperCase()}</code></li>`).join("");
  el.detailLink.href = MET_URL + p.i;
  el.detail.hidden = false;
  render();
}

function hideDetail() {
  if (el.detail.hidden && state.selected < 0) return;
  el.detail.hidden = true;
  state.selected = -1;
  render();
}

/* ---------- filter ---------- */
function applyFilter(natIndex) {
  if (natIndex < 0) {
    state.matches = null;
  } else {
    const paintings = state.data.paintings;
    const m = new Uint8Array(paintings.length);
    for (let i = 0; i < paintings.length; i++) m[i] = paintings[i].n === natIndex ? 1 : 0;
    state.matches = m;
  }
  render(true);
}

/* ---------- input ---------- */
function stagePoint(event) {
  const rect = el.stage.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

let velocity = 0;
let coasting = null;

function coast() {
  if (Math.abs(velocity) < VEL_MIN) { coasting = null; velocity = 0; render(); return; }
  state.view.center += velocity;
  const before = state.view.center;
  clampView();
  if (state.view.center !== before) velocity = 0;      // hit an end: stop dead
  velocity *= FRICTION;
  render();
  coasting = requestAnimationFrame(coast);
}

function stopCoast() {
  if (coasting) cancelAnimationFrame(coasting);
  coasting = null;
  velocity = 0;
}

function bindInput() {
  el.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    stopCoast();
    if (event.ctrlKey || event.metaKey) {          // pinch, or ctrl+wheel
      // The whole zoom range is only about 2.1x, and one mouse notch reports a
      // delta of 100 — uncapped that is the entire range in a single click. A
      // trackpad pinch reports single digits, so this cap only bites on wheels.
      const [x] = stagePoint(event);
      const d = Math.max(-30, Math.min(30, event.deltaY));
      zoomAt(Math.pow(0.99, d), x);
      return;
    }
    // Either wheel axis drives the tape. Vertical wheels are what most people
    // have, and there is only one axis to move.
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX : event.deltaY;
    state.view.center += (delta / state.view.scale) * WHEEL_GAIN;
    clampView();
    render();
  }, { passive: false });

  let dragging = null;
  el.stage.addEventListener("pointerdown", (event) => {
    el.stage.setPointerCapture(event.pointerId);
    stopCoast();
    dragging = { x: event.clientX, moved: 0, center: state.view.center, last: state.view.center };
    el.stage.classList.add("is-grabbing");
  });

  el.stage.addEventListener("pointermove", (event) => {
    const [x, y] = stagePoint(event);
    if (dragging) {
      const dx = event.clientX - dragging.x;
      dragging.moved = Math.max(dragging.moved, Math.abs(dx));
      // Drag left, tape travels forward in time — the surface follows the hand.
      state.view.center = dragging.center - dx / state.view.scale;
      clampView();
      velocity = state.view.center - dragging.last;
      dragging.last = state.view.center;
      render();
      return;
    }
    el.crosshair.hidden = false;
    el.crosshair.style.left = Math.round(x) + "px";
    const hit = hitTest(state.layout, proj(), x, y);
    if (hit !== state.hovered) {
      state.hovered = hit;
      updateHoverChip(hit, x, y);
      renderer.draw(state);            // the lift is part of the frame
    } else if (hit >= 0) {
      placeHoverChip(x, y);
    }
  });

  const endDrag = (event) => {
    if (!dragging) return;
    const wasClick = dragging.moved < CLICK_SLOP;
    dragging = null;
    el.stage.classList.remove("is-grabbing");
    if (wasClick) {
      const [x, y] = stagePoint(event);
      const hit = hitTest(state.layout, proj(), x, y);
      if (hit >= 0) showDetail(hit); else hideDetail();
      return;
    }
    if (Math.abs(velocity) >= VEL_MIN) coasting = requestAnimationFrame(coast);
  };
  el.stage.addEventListener("pointerup", endDrag);
  el.stage.addEventListener("pointercancel", () => {
    dragging = null;
    el.stage.classList.remove("is-grabbing");
  });

  el.stage.addEventListener("pointerleave", () => {
    el.crosshair.hidden = true;
    el.hoverchip.hidden = true;
    if (state.hovered >= 0) { state.hovered = -1; renderer.draw(state); }
  });

  const scrub = (event) => {
    const rect = el.timeline.getBoundingClientRect();
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    stopCoast();
    state.view.center = fraction * state.layout.worldW;
    clampView();
    render();
  };
  el.timeline.addEventListener("pointerdown", (event) => {
    el.timeline.setPointerCapture(event.pointerId);
    scrub(event);
  });
  el.timeline.addEventListener("pointermove", (event) => {
    if (event.buttons === 1) scrub(event);
  });

  el.btnIn.addEventListener("click", () => zoomAt(ZOOM_STEP, state.cssW / 2));
  el.btnOut.addEventListener("click", () => zoomAt(1 / ZOOM_STEP, state.cssW / 2));
  el.btnReset.addEventListener("click", resetView);
  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);
  el.filterNat.addEventListener("change", (event) => applyFilter(Number(event.target.value)));

  window.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoomAt(ZOOM_STEP, state.cssW / 2);
    else if (event.key === "-" || event.key === "_") zoomAt(1 / ZOOM_STEP, state.cssW / 2);
    else if (event.key === "0") resetView();
    else if (event.key === "Escape") { hideDetail(); el.about.hidden = true; }
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      stopCoast();
      stepBin(event.key === "ArrowRight" ? 1 : -1);
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { measure(); relayout(); render(); }, 120);
  });
}

/** Arrow keys move a whole column of time, so the axis is walkable exactly. */
function stepBin(dir) {
  const L = state.layout;
  const here = L.colBin[clamp(Math.round(state.view.center), 0, L.worldW - 1)];
  const target = clamp(here + dir, 0, state.data.bins.length - 1);
  state.view.center = (L.binCol0[target] + L.binCol0[target + 1]) / 2;
  clampView();
  render();
}

function resetView() {
  hideDetail();
  stopCoast();
  state.view.scale = state.layout.cellCenter;
  state.view.center = state.layout.worldW / 2;
  clampView();
  render(true);
}

function updateHoverChip(index, x, y) {
  if (index < 0) { el.hoverchip.hidden = true; return; }
  const p = state.data.paintings[index];
  el.hoverchip.innerHTML = `<b>${escapeHtml(p.t || "Untitled")}</b>`
    + `<i>${escapeHtml(p.a || "Unattributed")} · ${span(p.s, p.e)}</i>`;
  el.hoverchip.hidden = false;
  placeHoverChip(x, y);
}

function placeHoverChip(x, y) {
  const chip = el.hoverchip;
  const flipX = x + 18 + chip.offsetWidth > state.cssW;
  const flipY = y + 18 + chip.offsetHeight > state.cssH;
  chip.style.left = Math.round(flipX ? x - 14 - chip.offsetWidth : x + 14) + "px";
  chip.style.top = Math.round(flipY ? y - 12 - chip.offsetHeight : y + 12) + "px";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/* ---------- init ---------- */
function fillAbout(meta) {
  const notes = meta.notes || {};
  el.aboutMethod.innerHTML = Object.values(notes)
    .map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  el.aboutSource.textContent =
    `${num(meta.totalPaintings)} paintings, ${num(meta.totalCells)} extracted colours, `
    + `${meta.bins} columns spanning ${meta.yearRange[0]}–${meta.yearRange[1]}. `
    + `Built from the Met Open Access dataset snapshot of ${meta.sourceCsvSnapshot}.`;
}

function fillFilter(nationalities) {
  const options = nationalities
    .map((name, index) => ({ name, index }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, index } of options) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = name.toUpperCase();
    el.filterNat.appendChild(option);
  }
}

async function init() {
  boot("> connecting to dataset ...");
  let data;
  try {
    const response = await fetch("data/chromatica.json", { cache: "force-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
  } catch (error) {
    boot(`! dataset unavailable: ${error.message}`);
    boot("! the colour field cannot be rendered.");
    return;
  }

  state.data = data;
  boot(`> ${num(data.meta.totalPaintings)} paintings / `
    + `${num(data.meta.totalCells)} extracted colours`);
  boot(`> ${data.meta.bins} columns / ${data.meta.yearRange[0]}–${data.meta.yearRange[1]}`);

  fillFilter(data.meta.nationalities);
  fillAbout(data.meta);
  measure();
  relayout();
  state.view.center = state.layout.worldW / 2;
  boot(`> tape ${state.layout.worldW}×${state.layout.rows} cells / mounting drum`);
  boot("> scanning ...");

  bindInput();
  updateHud();

  // one deliberate beat on the boot readout, then the field scans itself in
  await new Promise((resolve) => setTimeout(resolve, 420));
  el.boot.classList.add("boot--done");
  renderer.scan(state);
  setTimeout(() => { el.boot.hidden = true; }, 700);
}

init();
