/* CHROMATICA — renderer for the colour field.
 *
 * Two passes, and the reason for both is honesty about colour:
 *
 *  1. A glow bed, drawn at a fraction of the resolution and scaled back up. The
 *     upscale itself is the blur, which is far cheaper than a real one and gives
 *     the soft, nebular falloff. It carries the atmosphere.
 *  2. The crisp pass at full resolution, which carries the actual measurement.
 *
 * Both composite with source-over, never with "lighter". Additive blending looks
 * spectacular and lies: overlapping colours converge on white, so a dense region
 * of deep Venetian red would render as a pink glare. With source-over, stacking
 * particles of one colour approaches that colour instead — density reads as
 * solidity, and what you see at any point of the cloud is a colour some painter
 * actually mixed.
 *
 * Nothing here strokes, outlines, or tints a particle. The only accent-coloured
 * mark on the surface is the ring around a selected one.
 *
 * The one exception, and why: the ground is #0a0a0a, which is L* 2.7, and 2,353
 * of the 32,438 measured colours are below L* 10 — 932 of them below L* 5, some
 * of them literally #000000. Those are real measurements, mostly the grounds of
 * Caravaggio-descended painting and the burnt browns of old varnish, and they
 * were disappearing into the panel. Two things are done about it, both keyed
 * only to the colour's own lightness, so a colour is never altered on account of
 * anything but how dark it is:
 *
 *  - Its opacity is raised toward 1. This makes it *more* faithful, not less: at
 *    alpha 0.52 over a near-black panel, what lands on screen is a blend of the
 *    measurement and the background. At alpha 1 it is the measurement.
 *  - It gets a neutral mat underneath, slightly wider than the core, so it reads
 *    as a dark thing on a lifted ground rather than as a hole. The mat is white
 *    at low alpha — colourless by construction, so it cannot imply a hue that
 *    was not measured, and it shows as an aureole around the colour instead of
 *    passing through it.
 *
 * Above MAT_L both effects are zero and nothing about the field has changed.
 */

import { ORDER_BAND } from "./field.js";

// Beyond this many matching works the rings stop being marks and become noise.
const MARK_CAP = 200;
const ACCENT = "#00ff9d";
const BG = "#0a0a0a";
const GLOW_SCALE = 0.34;   // resolution of the blur bed
const GLOW_SPREAD = 3.1;   // how much wider the bed's blobs are than the crisp ones
const GLOW_ALPHA = 0.34;
/* A particle is drawn as a wide faint skirt plus a small core rather than as one
   disc. A single filled circle at a readable alpha has a visible rim, and 12,000
   visible rims read as bokeh — a scatter of sequins you can count — instead of as
   a mist. Two radii is the cheapest falloff that kills the edge. */
const HALO_SPREAD = 2.0;
const HALO_ALPHA = 0.11;
const CORE_SPREAD = 0.9;
const CORE_ALPHA = 0.52;
/* Below this lightness a colour starts to lose the panel. L* 24 is where the
   quadratic falloff below first becomes visible at all (lift 0.16 at L* 15, the
   13th percentile) and where it reaches its full strength only at true black.
   28% of the colours are under L* 24, but 3/4 of them are touched by less than a
   fifth of the effect: the correction is aimed at the 2.9% that were actually
   invisible, not spread across the shadows generally. */
const MAT_L = 24;
const MAT_SPREAD = 1.55;   // between core and skirt, so it reads as an aureole
const MAT_ALPHA = 0.09;
const MAT_GLOW = 0.5;      // the mat is softer in the blur bed than on the surface
const RING_GAP = 6.5;      // where the selection ring rests, outside the particle
const RING_OPEN = 13;      // where it starts, before closing in
const RING_ALPHA = 0.9;

export class Nebula {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.bed = document.createElement("canvas");
    this.bedCtx = this.bed.getContext("2d");
    /* The cloud is held as a picture rather than rebuilt for every frame that
       needs to show it. A full render is 116,220 arcs and 64,700 fillStyle
       writes, nearly all of them a distinct colour string, and none of that
       depends on which particle happens to be ringed — so pointing at a row in
       the results list used to repaint every colour in the collection in order
       to move one ring. The cloud is redrawn on the motion threshold as before;
       the marks are drawn over a copy of it, which costs one blit. */
    this.cloud = document.createElement("canvas");
    this.cloudCtx = this.cloud.getContext("2d", { alpha: false });
    this.dpr = 1;
  }

  /* The scan lines belong to the panel, not to the data: one 1-px line every 3 at
     3.5% white, the same texture the surface had before, so the field reads as a
     lit instrument rather than as a web page. It is uniform across the whole
     canvas, so it cannot make one measured colour look different from another. */
  buildScanlines() {
    const tile = document.createElement("canvas");
    tile.width = 1; tile.height = 3;
    const c = tile.getContext("2d");
    c.fillStyle = "#ffffff09";
    c.fillRect(0, 0, 1, 1);
    this.scan = this.ctx.createPattern(tile, "repeat");
  }

  /**
   * Per-particle "how much ground is this one losing", 0 for anything at or above
   * MAT_L and 1 for black, squared so the onset is gentle and only the genuinely
   * lost colours get the full correction.
   *
   * Built once per field: L* is a property of the measurement and never changes.
   * field.order runs darkest-first and is never re-sorted, so every particle
   * needing a mat sits in one run at the head of it — which is why the mat can be
   * its own pass with a single fillStyle rather than an interruption inside the
   * colour-batched loops. The run is not pure: ORDER_BAND lets lighter particles
   * fall inside it, and those are skipped when drawing rather than excluded here.
   */
  liftFor(field) {
    if (this._liftSrc === field.lum) return;
    const lum = field.lum;
    const lift = new Float32Array(lum.length);
    let end = 0;
    for (let k = 0; k < field.n; k++) {
      const i = field.order[k];
      // Not "break at the first light one": order is jittered by up to ORDER_BAND
      // either side of lightness, so a dark particle can sort after a lighter one.
      // Past MAT_L + ORDER_BAND none can, which is where the run genuinely ends.
      if (lum[i] >= MAT_L + ORDER_BAND) break;
      if (lum[i] >= MAT_L) continue;
      const t = 1 - lum[i] / MAT_L;
      lift[i] = t * t;
      end = k + 1;
    }
    this.lift = lift;
    this.darkEnd = end;
    this._liftSrc = lum;
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.bed.width = Math.max(1, Math.round(cssW * GLOW_SCALE));
    this.bed.height = Math.max(1, Math.round(cssH * GLOW_SCALE));
    // Same backing store as the surface, so the blit is 1:1 device pixels and
    // resamples nothing. Setting either dimension blanks it, so what it holds is
    // gone rather than stale — the caller repaints on resize anyway.
    this.cloud.width = this.canvas.width;
    this.cloud.height = this.canvas.height;
  }

  /**
   * @param {import("./field.js").Field} field
   * @param {number} selected
   * @param {number} intensity Global alpha scale. The whole collection at once puts
   *   roughly eight times more colour on the canvas than one period does, and at
   *   full alpha it stops being a cloud and becomes a slab; this thins it back down
   *   without touching a single hue.
   */
  renderCloud(field, intensity) {
    const TAU = Math.PI * 2;
    const { x, y, w, rad, css, order, n } = field;
    this.liftFor(field);
    const lift = this.lift, darkEnd = this.darkEnd;

    // --- glow bed, low resolution ---
    const g = this.bedCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.bed.width, this.bed.height);
    const S = GLOW_SCALE;

    // The dark ones' aura goes into the bed first, so it is under everything and
    // gets the same blur as the rest of the atmosphere. Without it a black
    // particle contributes nothing to the bed at all and its neighbourhood is
    // fractionally darker than bare panel — a hole, which is exactly how it read.
    g.fillStyle = "#ffffff";
    for (let k = 0; k < darkEnd; k++) {
      const i = order[k];
      const wt = w[i], lf = lift[i];
      if (wt === 0 || lf === 0) continue;   // jitter puts some light ones in this run
      g.globalAlpha = wt * lf * MAT_ALPHA * MAT_GLOW * intensity;
      g.beginPath();
      g.arc(x[i] * S, y[i] * S, Math.max(0.7, rad[i] * S * GLOW_SPREAD), 0, TAU);
      g.fill();
    }

    let lastFill = null;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const wt = w[i];
      if (wt === 0) continue;
      const c = css[i];
      if (c !== lastFill) { g.fillStyle = c; lastFill = c; }
      g.globalAlpha = wt * GLOW_ALPHA * intensity;
      g.beginPath();
      g.arc(x[i] * S, y[i] * S, Math.max(0.7, rad[i] * S * GLOW_SPREAD), 0, TAU);
      g.fill();
    }

    // --- compose, into the held picture rather than onto the surface ---
    const ctx = this.cloudCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.bed, 0, 0, this.cssW, this.cssH);

    // --- mats, under the crisp pass and under each other ---
    ctx.fillStyle = "#ffffff";
    for (let k = 0; k < darkEnd; k++) {
      const i = order[k];
      const wt = w[i], lf = lift[i];
      if (wt === 0 || lf === 0) continue;
      ctx.globalAlpha = wt * lf * MAT_ALPHA * intensity;
      ctx.beginPath();
      ctx.arc(x[i], y[i], rad[i] * MAT_SPREAD, 0, TAU);
      ctx.fill();
    }

    // --- crisp pass: skirt, then core ---
    lastFill = null;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const wt = w[i];
      if (wt === 0) continue;
      const c = css[i];
      if (c !== lastFill) { ctx.fillStyle = c; lastFill = c; }
      const r = rad[i];
      // Opacity runs toward 1 as the colour gets darker, so what lands on the mat
      // is the measurement rather than a blend of it with whatever is beneath.
      const solid = k < darkEnd ? lift[i] : 0;
      ctx.globalAlpha = wt * (HALO_ALPHA + (1 - HALO_ALPHA) * solid * 0.35) * intensity;
      ctx.beginPath();
      ctx.arc(x[i], y[i], r * HALO_SPREAD, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = wt * (CORE_ALPHA + (1 - CORE_ALPHA) * solid) * intensity;
      ctx.beginPath();
      ctx.arc(x[i], y[i], r * CORE_SPREAD, 0, TAU);
      ctx.fill();
    }

    // --- panel texture ---
    if (!this.scan) this.buildScanlines();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.scan;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  /**
   * One frame: the held cloud, then the marks over it.
   *
   * Splitting these is the whole of the change. The cloud costs 116,220 arcs and
   * depends only on where the particles are; the marks cost at most a couple of
   * hundred strokes and change the instant you point at something. Drawing them
   * on one clock meant every hover repainted every colour in the collection.
   *
   * @param {import("./field.js").Field} field
   * @param {number} selected particle to ring, or -1
   * @param {number} intensity Global alpha scale. The whole collection at once puts
   *   roughly eight times more colour on the canvas than one period does, and at
   *   full alpha it stops being a cloud and becomes a slab; this thins it back down
   *   without touching a single hue.
   * @param {boolean} rebuild whether the cloud itself has moved since last frame
   * @param {number} ring 0..1, how far the selection ring is into its arrival
   */
  draw(field, selected, intensity = 1, rebuild = true, ring = 1) {
    const TAU = Math.PI * 2;
    const { x, y, w, rad } = field;
    if (rebuild) this.renderCloud(field, intensity);

    const ctx = this.ctx;
    // 1:1, in device pixels, so the copy is a copy and not a resample.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.cloud, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    /* --- the marks, and the only ones allowed inside the field ---
       A search that only dims the rest answers "how many" and not "which ones":
       at 22% the non-matches are still thousands of blobs, and five Caravaggios
       among them are unfindable. So every matching work gets a thin ring on its
       largest visible patch. Rings rather than a brighter or bigger particle,
       because size and opacity here are measurements — this is the interface
       pointing at the data, kept visibly separate from it.
       Above a couple of hundred the rings stop being marks and become a texture
       of their own, so past that only the count and the list speak. */
    if (field.markN > 0 && field.markN <= MARK_CAP) {
      ctx.globalAlpha = 0.62;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < field.markN; k++) {
        const i = field.marks[k];
        // Each arc gets its own sub-path, or they would be strung together by the
        // line the path carries from one circle to the next.
        ctx.moveTo(x[i] + rad[i] + 4.5, y[i]);
        ctx.arc(x[i], y[i], rad[i] + 4.5, 0, TAU);
      }
      ctx.stroke();
    }

    /* The ring closes onto the particle rather than appearing on it. It is a
       tenth of a second of easing and it is doing one job: saying *which* of
       twelve thousand blobs under the cursor was the one taken, which a ring
       that is simply there from one frame to the next does not. It ends at
       exactly the radius and opacity it always had, so the resting picture is
       unchanged — only the arrival is new. Free now: the cloud beneath it is a
       held picture, so an animating ring costs one blit and one stroke. */
    if (selected >= 0 && w[selected] > 0) {
      const e = 1 - (1 - ring) ** 3;   // ease-out: quick, then settling
      ctx.globalAlpha = RING_ALPHA * e;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x[selected], y[selected],
        rad[selected] + RING_GAP + (RING_OPEN - RING_GAP) * (1 - e), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
