/* CHROMATICA — application shell: data load, page state, input, HUD.
 *
 * The view is one number: how far down the page you have read. There is no zoom
 * and no horizontal pan, because there is no second axis to explore — reading
 * order is time, so moving through the collection is moving down the page, and
 * that is the whole navigation model.
 *
 * Everything else here exists to answer "which painting is this?" as directly as
 * possible: a chip while pointing, a technical sheet on click, arrow keys to step
 * word by word, and a linear works-per-year strip at the foot to jump by year.
 */
import {
  buildLayout, hitTest, visibleRows, maxScroll, rowYear,
} from "./layout.js";
import { Renderer } from "./renderer.js";

const MET_URL = "https://www.metmuseum.org/art/collection/search/";
const WHEEL_GAIN = 1;          // page scroll: the wheel means what it says
const FRICTION = 0.9;
const VEL_MIN = 0.4;           // px/frame
const CLICK_SLOP = 4;          // px of movement still counted as a click

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  stage: $("stage"), grid: $("grid"), hoverchip: $("hoverchip"),
  statWorks: $("statWorks"), statCells: $("statCells"),
  statSpan: $("statSpan"), statCell: $("statCell"),
  atYear: $("atYear"), cursorFrom: $("cursorFrom"), cursorTo: $("cursorTo"),
  filterNat: $("filterNat"), timeline: $("timelineCanvas"),
  btnTop: $("btnTop"), btnReset: $("btnReset"), btnInfo: $("btnInfo"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailTitle: $("detailTitle"), detailArtist: $("detailArtist"),
  detailYear: $("detailYear"), detailNat: $("detailNat"), detailId: $("detailId"),
  detailCentury: $("detailCentury"), detailPalette: $("detailPalette"),
  detailSwatches: $("detailSwatches"), detailLink: $("detailLink"),
  about: $("about"), aboutClose: $("aboutClose"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
};

const state = {
  data: null, layout: null,
  scrollY: 0,
  cssW: 0, cssH: 0,
  selected: -1,
  matches: null,          // Uint8Array over paintings, or null when unfiltered
  hovered: -1,
};
const renderer = new Renderer(el.grid);
let yearCounts = null;    // works per year across the whole span, for the foot strip

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

/* ---------- view maintenance ---------- */
function measure() {
  const rect = el.stage.getBoundingClientRect();
  state.cssW = Math.max(1, Math.floor(rect.width));
  state.cssH = Math.max(1, Math.floor(rect.height));
  renderer.resize(state.cssW, state.cssH);
}

function relayout() {
  // Hold your place across a resize. The cell size and the line width both change,
  // so the row you were on is not the row you will be on — the year is the thing
  // worth preserving, because the year is what the page is about.
  const year = state.layout ? rowYear(state.layout, state.data, topRow()) : null;
  state.layout = buildLayout(state.data, state.cssW, state.cssH);
  if (year !== null) scrollToYear(year, false);
  clampScroll();
}

const topRow = () =>
  clamp(Math.round((state.scrollY - state.layout.padTop) / state.layout.pitch),
    0, state.layout.rows - 1);

function clampScroll() {
  state.scrollY = clamp(Math.round(state.scrollY), 0, maxScroll(state.layout, state.cssH));
}

/** Put the first line that reaches `year` at the top of the stage. */
function scrollToYear(year, redraw = true) {
  const L = state.layout;
  let target = 0;
  for (let row = 0; row < L.rows; row++) {
    const y = rowYear(L, state.data, row);
    if (y !== null && y >= year) { target = row; break; }
    target = row;
  }
  state.scrollY = L.padTop + target * L.pitch - L.padTop;
  clampScroll();
  if (redraw) render();
}

/** Bring a painting fully into view without moving the page when it already is. */
function revealPainting(index) {
  const L = state.layout;
  const row = L.paintingRow[index];
  const top = L.padTop + row * L.pitch;
  if (top < state.scrollY + L.pitch) state.scrollY = top - L.pitch;
  else if (top + L.cell > state.scrollY + state.cssH - L.pitch) {
    state.scrollY = top + L.cell + L.pitch - state.cssH;
  }
  clampScroll();
}

/* ---------- render + HUD ---------- */
function render(withScan) {
  if (withScan) renderer.scan(state); else renderer.draw(state);
  updateHud();
}

function updateHud() {
  const L = state.layout;
  const [r0, r1] = visibleRows(L, state.cssH, state.scrollY);
  const p0 = L.rowStart[r0];
  const p1 = L.rowStart[Math.min(r1 + 1, L.rows + 1)];
  const paintings = state.data.paintings;

  let works = 0, cells = 0;
  for (let pi = p0; pi < p1; pi++) {
    if (state.matches && state.matches[pi] !== 1) continue;
    works++;
    cells += paintings[pi].k.length;
  }

  const from = p0 < paintings.length ? paintings[p0].y : paintings[paintings.length - 1].y;
  const to = paintings[Math.max(p0, Math.min(p1, paintings.length) - 1)].y;
  el.statWorks.textContent = num(works);
  el.statCells.textContent = num(cells);
  el.statSpan.textContent = `${to - from + 1}y`;
  el.statCell.textContent = `${L.cell}px`;
  el.atYear.textContent = from;
  el.cursorFrom.textContent = from;
  el.cursorTo.textContent = to;

  drawTimeline(from, to);
}

/**
 * The foot strip: works per year, on a LINEAR year axis, across the whole span.
 * The page itself is ordinal — a line covers one year in the 1870s and thirty in
 * the 1350s — so this is the one place the real shape of the collection is visible,
 * and it doubles as the way to jump to a year.
 */
function drawTimeline(from, to) {
  const canvas = el.timeline;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const [y0, y1] = state.data.meta.yearRange;
  const xOf = (year) => ((year - y0) / (y1 - y0 + 1)) * w;
  const barW = Math.max(1, w / (y1 - y0 + 1));

  // Log scale: the 1870s carry ~60x the works of the 1350s, and on a linear scale
  // every thin decade would read as empty rather than as thin.
  let peak = 0;
  for (const c of yearCounts) if (c > peak) peak = c;

  for (let year = y0; year <= y1; year++) {
    const c = yearCounts[year - y0];
    if (!c) continue;
    const barH = Math.max(1, Math.round((Math.log1p(c) / Math.log1p(peak)) * (h - 1)));
    ctx.fillStyle = year >= from && year <= to ? "#00ff9d" : "#2a2f2c";
    ctx.fillRect(Math.floor(xOf(year)), h - barH, Math.ceil(barW), barH);
  }

  // Where you are reading, as a window on the real timeline.
  ctx.strokeStyle = "#00ff9d";
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(Math.floor(xOf(from)) + 0.5, 0.5,
    Math.max(2, Math.ceil(xOf(to + 1) - xOf(from))), h - 1);
  ctx.globalAlpha = 1;
}

/* ---------- panels ---------- */
function showDetail(index) {
  const p = state.data.paintings[index];
  const century = state.layout.paras.find((q) => index >= q.p0 && index <= q.p1);
  state.selected = index;
  el.detailImg.src = `thumbs/${p.i}.jpg`;
  el.detailImg.alt = p.t || "Untitled";
  el.detailTitle.textContent = p.t || "Untitled";
  el.detailArtist.textContent = p.a || "Unattributed";
  el.detailYear.textContent = span(p.s, p.e);
  el.detailNat.textContent = state.data.meta.nationalities[p.n] || "—";
  el.detailId.textContent = p.i;
  el.detailCentury.textContent = century
    ? `${century.century}s · ${num(century.works)} works`
    : "—";
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
  state.scrollY += velocity;
  const before = state.scrollY;
  clampScroll();
  if (state.scrollY !== before) velocity = 0;      // hit an end: stop dead
  velocity *= FRICTION;
  render();
  coasting = requestAnimationFrame(coast);
}

function stopCoast() {
  if (coasting) cancelAnimationFrame(coasting);
  coasting = null;
  velocity = 0;
}

function hover(x, y) {
  const hit = hitTest(state.layout, x, y, state.scrollY);
  const painting = hit >= 0 ? state.layout.cellPainting[hit] : -1;
  if (painting !== state.hovered) {
    state.hovered = painting;
    updateHoverChip(painting, x, y);
    renderer.draw(state);            // the frame and the ruler are part of the frame
  } else if (painting >= 0) {
    placeHoverChip(x, y);
  }
}

function bindInput() {
  el.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    stopCoast();
    state.scrollY += (Math.abs(event.deltaY) > Math.abs(event.deltaX)
      ? event.deltaY : event.deltaX) * WHEEL_GAIN;
    clampScroll();
    render();
  }, { passive: false });

  let dragging = null;
  el.stage.addEventListener("pointerdown", (event) => {
    el.stage.setPointerCapture(event.pointerId);
    stopCoast();
    dragging = { y: event.clientY, moved: 0, from: state.scrollY, last: state.scrollY };
    el.stage.classList.add("is-grabbing");
  });

  el.stage.addEventListener("pointermove", (event) => {
    const [x, y] = stagePoint(event);
    if (dragging) {
      const dy = event.clientY - dragging.y;
      dragging.moved = Math.max(dragging.moved, Math.abs(dy));
      state.scrollY = dragging.from - dy;          // the page follows the hand
      clampScroll();
      velocity = state.scrollY - dragging.last;
      dragging.last = state.scrollY;
      render();
      return;
    }
    hover(x, y);
  });

  const endDrag = (event) => {
    if (!dragging) return;
    const wasClick = dragging.moved < CLICK_SLOP;
    dragging = null;
    el.stage.classList.remove("is-grabbing");
    if (wasClick) {
      const [x, y] = stagePoint(event);
      const hit = hitTest(state.layout, x, y, state.scrollY);
      if (hit >= 0) showDetail(state.layout.cellPainting[hit]); else hideDetail();
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
    el.hoverchip.hidden = true;
    if (state.hovered >= 0) { state.hovered = -1; renderer.draw(state); }
  });

  const jump = (event) => {
    const rect = el.timeline.getBoundingClientRect();
    const [y0, y1] = state.data.meta.yearRange;
    const f = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    stopCoast();
    scrollToYear(Math.round(y0 + f * (y1 - y0)));
  };
  el.timeline.addEventListener("pointerdown", (event) => {
    el.timeline.setPointerCapture(event.pointerId);
    jump(event);
  });
  el.timeline.addEventListener("pointermove", (event) => {
    if (event.buttons === 1) jump(event);
  });

  el.btnTop.addEventListener("click", () => {
    stopCoast();
    state.scrollY = 0;
    render(true);
  });
  el.btnReset.addEventListener("click", resetView);
  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);
  el.filterNat.addEventListener("change", (event) => applyFilter(Number(event.target.value)));

  window.addEventListener("keydown", (event) => {
    const L = state.layout;
    const page = Math.max(L.pitch, state.cssH - L.pitch * 2);
    if (event.key === "Escape") { hideDetail(); el.about.hidden = true; return; }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      stepWork(event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    let dy = 0;
    if (event.key === "ArrowDown") dy = L.pitch;
    else if (event.key === "ArrowUp") dy = -L.pitch;
    else if (event.key === "PageDown" || event.key === " ") dy = page;
    else if (event.key === "PageUp") dy = -page;
    else if (event.key === "Home") dy = -Infinity;
    else if (event.key === "End") dy = Infinity;
    else return;
    event.preventDefault();
    stopCoast();
    state.scrollY = dy === Infinity ? maxScroll(L, state.cssH)
      : dy === -Infinity ? 0 : state.scrollY + dy;
    clampScroll();
    render();
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { measure(); relayout(); render(); }, 120);
  });
}

/** Arrow keys walk the collection one work at a time, in chronological order. */
function stepWork(dir) {
  const n = state.data.paintings.length;
  const next = state.selected < 0
    ? (dir > 0 ? state.layout.rowStart[topRow()] : n - 1)
    : clamp(state.selected + dir, 0, n - 1);
  stopCoast();
  revealPainting(next);
  showDetail(next);
}

function resetView() {
  hideDetail();
  stopCoast();
  state.scrollY = 0;
  state.hovered = -1;
  el.hoverchip.hidden = true;
  if (state.matches) { el.filterNat.value = "-1"; state.matches = null; }
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
    + `${meta.yearRange[0]}–${meta.yearRange[1]}. `
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
    boot("! the page cannot be set.");
    return;
  }

  state.data = data;
  const [y0, y1] = data.meta.yearRange;
  yearCounts = new Int32Array(y1 - y0 + 1);
  for (const p of data.paintings) yearCounts[p.y - y0]++;

  boot(`> ${num(data.meta.totalPaintings)} paintings / `
    + `${num(data.meta.totalCells)} extracted colours`);
  boot(`> ${y0}–${y1} / ${data.meta.nationalities.length} schools`);

  fillFilter(data.meta.nationalities);
  fillAbout(data.meta);
  measure();
  relayout();
  boot(`> setting ${state.layout.rows} lines at ${state.layout.cell}px`);
  boot("> scanning ...");

  bindInput();
  updateHud();

  // one deliberate beat on the boot readout, then the page scans itself in
  await new Promise((resolve) => setTimeout(resolve, 420));
  el.boot.classList.add("boot--done");
  renderer.scan(state);
  setTimeout(() => { el.boot.hidden = true; }, 700);
}

init();
