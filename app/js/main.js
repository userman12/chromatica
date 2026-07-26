/* CHROMATICA — application shell.
 *
 * The interaction model is one gesture. There is no zoom, no pan, no filter and no
 * sort: you drag a year, and the whole field of colour recomposes around it. That
 * is the entire instrument, and the restraint is the point — the experience is
 * meant to be watched, not operated.
 *
 * Two things are deliberately not buttons:
 *
 *  - Time moves on its own until you touch it. Opening the page starts a slow
 *    drift through the centuries, so the default state is contemplative; the first
 *    touch hands control over for good. A play/pause pair would have been a second
 *    control, and there is only allowed to be one.
 *  - Dragging horizontally anywhere on the field scrubs, not just on the track.
 *    The cloud is the instrument; the track is only where the reading is printed.
 *
 * Clicking a particle to see its painting is a second layer, not a requirement.
 */
import { Field } from "./field.js";
import { Nebula } from "./nebula.js";

const MET_URL = "https://www.metmuseum.org/art/collection/search/";
const DRIFT_YEARS_PER_SEC = 7.5;   // the unattended crawl through history
const SCRUB_SLOP = 4;              // px of movement still counted as a click
const STAGE_GAIN = 1.35;           // years per px when dragging on the field itself

const $ = (id) => document.getElementById(id);
const el = {
  boot: $("boot"), bootLog: $("bootLog"),
  stage: $("stage"), field: $("field"),
  year: $("year"), track: $("track"), hint: $("hint"),
  btnInfo: $("btnInfo"), about: $("about"), aboutClose: $("aboutClose"),
  aboutMethod: $("aboutMethod"), aboutSource: $("aboutSource"),
  detail: $("detail"), detailClose: $("detailClose"), detailImg: $("detailImg"),
  detailTitle: $("detailTitle"), detailArtist: $("detailArtist"),
  detailYear: $("detailYear"), detailNat: $("detailNat"), detailId: $("detailId"),
  detailPalette: $("detailPalette"), detailSwatches: $("detailSwatches"),
  detailLink: $("detailLink"),
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  data: null, field: null,
  cursor: 0,          // the year, kept as a float so the drift is smooth
  drifting: !reduceMotion,
  selected: -1,       // particle index
  cssW: 0, cssH: 0,
};
const nebula = new Nebula(el.field);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (n) => n.toLocaleString("en-US");
const span = (s, e) => (s === e ? String(s) : `${s}–${e}`);

/* ---------- boot ---------- */
const bootLines = ["CHROMATICA v0.2"];
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
}

/* ---------- the loop ---------- */
let t0 = 0;
let last = 0;

function frame(now) {
  const t = (now - (t0 ||= now)) / 1000;
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;

  if (state.drifting) {
    state.cursor += DRIFT_YEARS_PER_SEC * dt;
    if (state.cursor > state.field.y1) state.cursor = state.field.y0;  // it loops only while unattended
  }

  state.field.step(state.cursor, t, reduceMotion);
  nebula.draw(state.field, state.selected);
  paintReadout();
  requestAnimationFrame(frame);
}

function paintReadout() {
  const year = Math.round(state.cursor);
  if (el.year.textContent !== String(year)) {
    el.year.textContent = year;
    el.track.setAttribute("aria-valuenow", year);
    el.track.setAttribute("aria-valuetext",
      `${year}, ${num(state.field.stats.works)} works in the window`);
  }
  drawTrack();
}

/**
 * The track: works per year on a linear year axis, log-scaled in height.
 *
 * It is not decoration and not a progress bar. The field is a moving window over a
 * collection that is about sixty times denser in the 1870s than in the 1350s, and
 * this is the only place that unevenness is visible. The lit span is the window
 * currently contributing colour, so its width visibly breathes as thin centuries
 * force the window open.
 */
function drawTrack() {
  const canvas = el.track;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);

  const F = state.field;
  const { from, to } = F.stats;
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
    const lit = year >= from && year <= to;
    ctx.globalAlpha = lit ? 0.85 : 0.3;
    ctx.fillStyle = lit ? "#00ff9d" : "#2e3532";
    ctx.fillRect(Math.floor(xOf(year)), base - barH, Math.ceil(barW), barH);
  }

  // baseline + handle: the two thinnest possible marks
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#1e2220";
  ctx.fillRect(0, base, w, Math.max(1, dpr));
  const hx = Math.round(xOf(state.cursor));
  ctx.fillStyle = "#00ff9d";
  ctx.fillRect(hx, 0, Math.max(1, dpr), h);
}

/* ---------- scrubbing ---------- */
function setCursor(year, byHand = true) {
  state.cursor = clamp(year, state.field.y0, state.field.y1);
  if (byHand) takeControl();
}

/** The first touch ends the unattended drift, permanently. */
function takeControl() {
  if (state.drifting) {
    state.drifting = false;
    el.hint.classList.add("scrub__hint--gone");
  }
}

function yearAtTrack(clientX) {
  const rect = el.track.getBoundingClientRect();
  const f = clamp((clientX - rect.left) / rect.width, 0, 1);
  return state.field.y0 + f * (state.field.y1 - state.field.y0);
}

function bindInput() {
  /* --- the track --- */
  let onTrack = false;
  el.track.addEventListener("pointerdown", (event) => {
    onTrack = true;
    el.track.setPointerCapture(event.pointerId);
    setCursor(yearAtTrack(event.clientX));
  });
  el.track.addEventListener("pointermove", (event) => {
    if (onTrack) setCursor(yearAtTrack(event.clientX));
  });
  const releaseTrack = () => { onTrack = false; };
  el.track.addEventListener("pointerup", releaseTrack);
  el.track.addEventListener("pointercancel", releaseTrack);

  /* --- the field itself: horizontal drag scrubs, a tap opens a painting --- */
  let drag = null;
  el.stage.addEventListener("pointerdown", (event) => {
    el.stage.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, from: state.cursor, moved: 0 };
  });
  el.stage.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.moved >= SCRUB_SLOP) {
      el.stage.classList.add("is-scrubbing");
      setCursor(drag.from + dx * STAGE_GAIN);
    }
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

  /* --- keyboard: the same single gesture, in steps --- */
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hideDetail(); el.about.hidden = true; return; }
    let dy = 0;
    if (event.key === "ArrowRight") dy = event.shiftKey ? 10 : 1;
    else if (event.key === "ArrowLeft") dy = event.shiftKey ? -10 : -1;
    else if (event.key === "PageUp") dy = -50;
    else if (event.key === "PageDown") dy = 50;
    else if (event.key === "Home") { setCursor(state.field.y0); event.preventDefault(); return; }
    else if (event.key === "End") { setCursor(state.field.y1); event.preventDefault(); return; }
    else return;
    event.preventDefault();
    setCursor(Math.round(state.cursor) + dy);
  });

  el.btnInfo.addEventListener("click", () => { el.about.hidden = false; });
  el.aboutClose.addEventListener("click", () => { el.about.hidden = true; });
  el.detailClose.addEventListener("click", hideDetail);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(measure, 120);
  });
}

/* ---------- the optional second layer ---------- */
function showDetail(particle) {
  const F = state.field;
  const p = state.data.paintings[F.owner[particle]];
  const thisHex = F.css[particle];
  state.selected = particle;
  // The scrub stops while you are looking at a work: the particle you clicked
  // would otherwise fade out from under the panel.
  takeControl();

  el.detailImg.src = `thumbs/${p.i}.jpg`;
  el.detailImg.alt = p.t || "Untitled";
  el.detailTitle.textContent = p.t || "Untitled";
  el.detailArtist.textContent = p.a || "Unattributed";
  el.detailYear.textContent = span(p.s, p.e);
  el.detailNat.textContent = state.data.meta.nationalities[p.n] || "—";
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
  el.detailLink.href = MET_URL + p.i;
  el.detail.hidden = false;
}

function hideDetail() {
  el.detail.hidden = true;
  state.selected = -1;
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
    + `${meta.yearRange[0]}–${meta.yearRange[1]}. `
    + `Built from the Met Open Access dataset snapshot of ${meta.sourceCsvSnapshot}.`;
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
    boot("! the field cannot be composed.");
    return;
  }

  state.data = data;
  boot(`> ${num(data.meta.totalPaintings)} paintings / `
    + `${num(data.meta.totalCells)} extracted colours`);

  state.field = new Field(data);
  // ?y=1600 opens on a year and does not drift. Not a control — nothing on screen
  // changes — but a moment in the field is worth being able to hand to someone.
  const asked = Number(new URLSearchParams(location.search).get("y"));
  if (Number.isFinite(asked) && asked >= state.field.y0 && asked <= state.field.y1) {
    state.cursor = asked;
    state.drifting = false;
    el.hint.classList.add("scrub__hint--gone");
  } else {
    state.cursor = state.field.y0;
  }
  boot(`> ${state.field.n.toLocaleString("en-US")} particles in CIE L*a*b*`);
  boot(`> ${state.field.y0}–${state.field.y1} / window is adaptive`);

  el.track.setAttribute("aria-valuemin", state.field.y0);
  el.track.setAttribute("aria-valuemax", state.field.y1);
  fillAbout(data.meta);
  measure();
  bindInput();
  boot("> composing ...");

  await new Promise((resolve) => setTimeout(resolve, 460));
  el.boot.classList.add("boot--done");
  requestAnimationFrame(frame);
  setTimeout(() => { el.boot.hidden = true; }, 800);
}

init();
