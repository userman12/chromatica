/* CHROMATICA — application shell: data load, view state, input, HUD. */
import { buildLayout, fitScale, hitTest, visibleBins } from "./layout.js";
import { Renderer } from "./renderer.js";

const MET_URL = "https://www.metmuseum.org/art/collection/search/";
const MAX_SCALE = 44;                 // px per cell at full magnification
const ZOOM_STEP = 1.45;
const LABEL_MIN_PX = 46;              // horizontal room a year label needs

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  stage: $("stage"), grid: $("grid"),
  crosshair: $("crosshair"), hoverchip: $("hoverchip"),
  statWorks: $("statWorks"), statCells: $("statCells"),
  statSpan: $("statSpan"), statZoom: $("statZoom"),
  scale: $("scale"), cursorFrom: $("cursorFrom"), cursorTo: $("cursorTo"),
  filterNat: $("filterNat"), density: $("densityCanvas"),
  btnOut: $("btnOut"), btnIn: $("btnIn"), btnReset: $("btnReset"), btnInfo: $("btnInfo"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailSwatches: $("detailSwatches"), detailTitle: $("detailTitle"),
  detailArtist: $("detailArtist"), detailYear: $("detailYear"),
  detailNat: $("detailNat"), detailId: $("detailId"), detailLink: $("detailLink"),
  about: $("about"), aboutClose: $("aboutClose"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
};

const state = {
  data: null, layout: null,
  view: { scale: 1, panX: 0, panY: 0 },
  cssW: 0, cssH: 0,
  minScale: 1,
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

function metaSpan(bin) {
  return bin.s === bin.e ? String(bin.s) : `${bin.s}–${bin.e}`;
}

/* ---------- view maintenance ---------- */
function measure() {
  const rect = el.stage.getBoundingClientRect();
  state.cssW = Math.max(1, Math.floor(rect.width));
  state.cssH = Math.max(1, Math.floor(rect.height));
  renderer.resize(state.cssW, state.cssH);
}

function relayout() {
  const previous = state.layout ? state.view.scale / state.minScale : 1;
  state.layout = buildLayout(state.data, state.cssW, state.cssH);
  state.minScale = fitScale(state.layout, state.cssW, state.cssH);
  state.view.scale = state.minScale * previous;
  clampView();
}

function clampView() {
  const v = state.view;
  const L = state.layout;
  v.scale = clamp(v.scale, state.minScale, MAX_SCALE);
  const visW = state.cssW / v.scale;
  const visH = state.cssH / v.scale;
  v.panX = visW >= L.worldW ? (L.worldW - visW) / 2 : clamp(v.panX, 0, L.worldW - visW);
  v.panY = visH >= L.worldH ? (L.worldH - visH) / 2 : clamp(v.panY, 0, L.worldH - visH);
}

function zoomAt(factor, anchorX, anchorY) {
  const v = state.view;
  const worldX = anchorX / v.scale + v.panX;
  const worldY = anchorY / v.scale + v.panY;
  v.scale = clamp(v.scale * factor, state.minScale, MAX_SCALE);
  v.panX = worldX - anchorX / v.scale;
  v.panY = worldY - anchorY / v.scale;
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
  const [b0, b1] = visibleBins(L, state.view, state.cssW);
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

  const from = bins[b0].s;
  const to = bins[b1].e;
  el.statWorks.textContent = num(works);
  el.statCells.textContent = num(cells);
  el.statSpan.textContent = `${to - from + 1}y`;
  el.statZoom.textContent = (state.view.scale / state.minScale).toFixed(2) + "×";
  el.cursorFrom.textContent = from;
  el.cursorTo.textContent = to;

  drawScaleLabels(b0, b1);
  drawDensity(b0, b1);
}

function drawScaleLabels(b0, b1) {
  const L = state.layout;
  const colPx = L.cellsPerRow * state.view.scale;
  const every = Math.max(1, Math.ceil(LABEL_MIN_PX / colPx));
  const parts = [];
  for (let b = b0; b <= b1; b++) {
    if (b % every !== 0) continue;
    const bin = state.data.bins[b];
    const centre = ((b + 0.5) * L.cellsPerRow - state.view.panX) * state.view.scale;
    if (centre < 12 || centre > state.cssW - 12) continue;
    const major = colPx > 90;
    parts.push(`<span class="${major ? "is-major" : ""}" style="left:${centre.toFixed(1)}px">`
      + (major ? metaSpan(bin) : bin.s) + "</span>");
  }
  el.scale.innerHTML = parts.join("");
}

function drawDensity(b0, b1) {
  const canvas = el.density;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const bins = state.data.bins;
  // Works per YEAR, not per column: columns hold ~equal counts by construction,
  // so only the rate exposes how uneven the collection actually is over time.
  let peak = 0;
  const rate = bins.map((bin) => {
    const r = bin.n / (bin.e - bin.s + 1);
    if (r > peak) peak = r;
    return r;
  });
  const colW = w / bins.length;
  for (let b = 0; b < bins.length; b++) {
    // log scale: real density spans about two orders of magnitude
    const norm = Math.log1p(rate[b]) / Math.log1p(peak);
    const barH = Math.max(1, Math.round(norm * h));
    const inView = b >= b0 && b <= b1;
    ctx.fillStyle = inView ? "#00ff9d" : "#2a2f2c";
    ctx.fillRect(Math.round(b * colW), h - barH,
                 Math.max(1, Math.round(colW) - (colW > 3 ? 1 : 0)), barH);
  }
}

/* ---------- panels ---------- */
function showDetail(index) {
  const p = state.data.paintings[index];
  state.selected = index;
  el.detailImg.src = `thumbs/${p.i}.jpg`;
  el.detailImg.alt = p.t || "Untitled";
  el.detailSwatches.innerHTML = p.k
    .map((hex) => `<i style="background:${hex}" title="${hex}"></i>`).join("");
  el.detailTitle.textContent = p.t || "Untitled";
  el.detailArtist.textContent = p.a || "Unattributed";
  el.detailYear.textContent = p.s === p.e ? String(p.s) : `${p.s}–${p.e}`;
  el.detailNat.textContent = state.data.meta.nationalities[p.n] || "—";
  el.detailId.textContent = p.i;
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

function bindInput() {
  el.stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const [x, y] = stagePoint(event);
    zoomAt(Math.pow(0.9985, event.deltaY), x, y);
  }, { passive: false });

  let dragging = null;
  el.stage.addEventListener("pointerdown", (event) => {
    el.stage.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, moved: 0,
                 panX: state.view.panX, panY: state.view.panY };
  });

  el.stage.addEventListener("pointermove", (event) => {
    const [x, y] = stagePoint(event);
    if (dragging) {
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      dragging.moved = Math.max(dragging.moved, Math.abs(dx) + Math.abs(dy));
      state.view.panX = dragging.panX - dx / state.view.scale;
      state.view.panY = dragging.panY - dy / state.view.scale;
      clampView();
      render();
      return;
    }
    el.crosshair.hidden = false;
    el.crosshair.style.left = Math.round(x) + "px";
    const hit = hitTest(state.layout, state.view, x, y);
    if (hit !== state.hovered) {
      state.hovered = hit;
      updateHoverChip(hit, x, y);
    } else if (hit >= 0) {
      placeHoverChip(x, y);
    }
  });

  const endDrag = (event) => {
    if (!dragging) return;
    const wasClick = dragging.moved < 4;
    dragging = null;
    if (!wasClick) return;
    const [x, y] = stagePoint(event);
    const hit = hitTest(state.layout, state.view, x, y);
    if (hit >= 0) showDetail(hit); else hideDetail();
  };
  el.stage.addEventListener("pointerup", endDrag);
  el.stage.addEventListener("pointercancel", () => { dragging = null; });

  el.stage.addEventListener("pointerleave", () => {
    el.crosshair.hidden = true;
    el.hoverchip.hidden = true;
    state.hovered = -1;
  });

  el.density.addEventListener("pointerdown", (event) => {
    const rect = el.density.getBoundingClientRect();
    const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const targetBin = Math.floor(fraction * state.data.bins.length);
    const visW = state.cssW / state.view.scale;
    state.view.panX = (targetBin + 0.5) * state.layout.cellsPerRow - visW / 2;
    clampView();
    render(true);
  });

  el.btnIn.addEventListener("click", () => zoomAt(ZOOM_STEP, state.cssW / 2, state.cssH / 2));
  el.btnOut.addEventListener("click", () => zoomAt(1 / ZOOM_STEP, state.cssW / 2, state.cssH / 2));
  el.btnReset.addEventListener("click", resetView);
  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);
  el.filterNat.addEventListener("change", (event) => applyFilter(Number(event.target.value)));

  window.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") zoomAt(ZOOM_STEP, state.cssW / 2, state.cssH / 2);
    else if (event.key === "-" || event.key === "_") zoomAt(1 / ZOOM_STEP, state.cssW / 2, state.cssH / 2);
    else if (event.key === "0") resetView();
    else if (event.key === "Escape") { hideDetail(); el.about.hidden = true; }
    else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const dir = event.key === "ArrowRight" ? 1 : -1;
      state.view.panX += dir * state.layout.cellsPerRow;
      clampView();
      render();
    }
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { measure(); relayout(); render(); }, 120);
  });
}

function resetView() {
  hideDetail();
  state.view.scale = state.minScale;
  clampView();
  render(true);
}

function updateHoverChip(index, x, y) {
  if (index < 0) { el.hoverchip.hidden = true; return; }
  const p = state.data.paintings[index];
  const year = p.s === p.e ? p.s : `${p.s}–${p.e}`;
  el.hoverchip.innerHTML = `<b>${escapeHtml(p.t || "Untitled")}</b>`
    + `<i>${escapeHtml(p.a || "Unattributed")} · ${year}</i>`;
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
  boot(`> grid ${state.layout.worldW}×${state.layout.worldH} cells`);
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
