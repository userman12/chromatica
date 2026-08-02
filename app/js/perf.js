/* CHROMATICA — frame instrumentation, off unless ?perf=1.
 *
 * The README quotes 0.57 ms for step() and ~14 ms for a draw, at 60 fps. Those
 * numbers were measured on the 11,728-particle build and the field is now
 * 32,350, so they have been carried in the document as inherited rather than
 * known. This is the thing that turns them back into measurements.
 *
 * Three separate figures, because they answer different questions:
 *
 *  - FRAME is the interval between callbacks. It is the only one the viewer
 *    feels, and it includes everything the browser does that this code cannot
 *    see: compositing, other tabs, the display's own pace.
 *  - STEP and DRAW are what this code spends inside a frame. Their sum can sit
 *    far below FRAME on a settled field and that is the system working, not an
 *    error — most frames draw nothing at all.
 *  - DRAWN is what fraction of frames reached nebula.draw. A low number next to
 *    a healthy FRAME means the redraw threshold is earning its keep; a high one
 *    means the field is genuinely in motion and DRAW is the budget that matters.
 *
 * Percentiles rather than a mean: a mean of 16.7 ms is equally consistent with a
 * steady 60 fps and with alternating 8 ms and 25 ms frames, and only one of
 * those is watchable. p95 is where the stutter shows up.
 *
 * Cost when off is one `if (perf)` per section per frame, on a binding that
 * never changes. Nothing is allocated, nothing is timed, and the overlay is
 * never built. The instrument does not pay for the instrumentation.
 */

const WINDOW = 180;   // ~3 s of frames: long enough for a p95 to mean something

/** Percentile from an unsorted ring buffer, by copying — 180 floats, 4×/second. */
function pct(values, count, q) {
  if (count === 0) return 0;
  const sorted = Array.prototype.slice.call(values, 0, count).sort((a, b) => a - b);
  return sorted[Math.min(count - 1, Math.floor(count * q))];
}

/** Frames that drew, within the window. */
function sum(bits, count) {
  let n = 0;
  for (let i = 0; i < count; i++) n += bits[i];
  return n;
}

export class Perf {
  constructor() {
    this.frames = new Float32Array(WINDOW);
    this.steps = new Float32Array(WINDOW);
    this.draws = new Float32Array(WINDOW);
    this.nFrame = this.nStep = this.nDraw = 0;
    this.iFrame = this.iStep = this.iDraw = 0;
    this.drew = new Uint8Array(WINDOW);   // did this frame reach nebula.draw
    this.iDrew = -1; this.nDrew = 0;
    this.last = 0;
    this.painted = 0;
    this.node = this.build();
  }

  build() {
    const node = document.createElement("pre");
    node.id = "perf";
    node.setAttribute("aria-hidden", "true");   // a dev readout, not part of the piece
    node.style.cssText = [
      "position:fixed", "top:8px", "right:8px", "z-index:99",
      "margin:0", "padding:8px 10px",
      "font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
      "letter-spacing:.06em", "color:#00ff9d",
      "background:rgba(6,10,8,.86)", "border:1px solid #14231c",
      "pointer-events:none", "white-space:pre",
    ].join(";");
    document.body.appendChild(node);
    return node;
  }

  frame(now) {
    if (this.last) {
      this.frames[this.iFrame] = now - this.last;
      this.iFrame = (this.iFrame + 1) % WINDOW;
      this.nFrame = Math.min(WINDOW, this.nFrame + 1);
    }
    this.last = now;
    // This frame's slot in the drew ring, cleared now and set by draw() if it
    // gets there. Rolling like the percentiles: a ratio since page load would
    // keep reporting the boot sequence an hour into a session.
    this.iDrew = (this.iDrew + 1) % WINDOW;
    this.drew[this.iDrew] = 0;
    this.nDrew = Math.min(WINDOW, this.nDrew + 1);
  }

  step(ms) {
    this.steps[this.iStep] = ms;
    this.iStep = (this.iStep + 1) % WINDOW;
    this.nStep = Math.min(WINDOW, this.nStep + 1);
  }

  draw(ms) {
    this.draws[this.iDraw] = ms;
    this.iDraw = (this.iDraw + 1) % WINDOW;
    this.nDraw = Math.min(WINDOW, this.nDraw + 1);
    if (this.iDrew >= 0) this.drew[this.iDrew] = 1;
  }

  /** Repaint the overlay four times a second — often enough to read, rare enough to ignore. */
  render(now, field) {
    if (now - this.painted < 250) return;
    this.painted = now;

    const f50 = pct(this.frames, this.nFrame, 0.5);
    const f95 = pct(this.frames, this.nFrame, 0.95);
    const fps = f50 > 0 ? 1000 / f50 : 0;
    const rows = [
      "PERF  ?perf=1",
      `FPS    ${fps.toFixed(1).padStart(6)}`,
      `FRAME  ${f50.toFixed(2).padStart(6)} p50  ${f95.toFixed(2).padStart(6)} p95`,
      `STEP   ${pct(this.steps, this.nStep, 0.5).toFixed(2).padStart(6)} p50  `
        + `${pct(this.steps, this.nStep, 0.95).toFixed(2).padStart(6)} p95`,
      `DRAW   ${pct(this.draws, this.nDraw, 0.5).toFixed(2).padStart(6)} p50  `
        + `${pct(this.draws, this.nDraw, 0.95).toFixed(2).padStart(6)} p95`,
      `DRAWN  ${(this.nDrew ? (sum(this.drew, this.nDrew) / this.nDrew) * 100 : 0)
        .toFixed(0).padStart(5)}% of frames`,
      `PARTS  ${field.n.toLocaleString("en-US").padStart(6)}`,
      `LIT    ${field.stats.colours.toLocaleString("en-US").padStart(6)}`,
    ];
    this.node.textContent = rows.join("\n");
  }
}

/** null unless asked for, so `if (perf)` is the whole cost of shipping this. */
export const perf =
  new URLSearchParams(location.search).get("perf") === "1" ? new Perf() : null;
