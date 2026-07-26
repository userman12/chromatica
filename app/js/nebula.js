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
 */

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

export class Nebula {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.bed = document.createElement("canvas");
    this.bedCtx = this.bed.getContext("2d");
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

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
    this.bed.width = Math.max(1, Math.round(cssW * GLOW_SCALE));
    this.bed.height = Math.max(1, Math.round(cssH * GLOW_SCALE));
  }

  /**
   * @param {import("./field.js").Field} field
   * @param {number} selected
   * @param {number} intensity Global alpha scale. The whole collection at once puts
   *   roughly eight times more colour on the canvas than one period does, and at
   *   full alpha it stops being a cloud and becomes a slab; this thins it back down
   *   without touching a single hue.
   */
  draw(field, selected, intensity = 1) {
    const TAU = Math.PI * 2;
    const { x, y, w, rad, css, order, n } = field;

    // --- glow bed, low resolution ---
    const g = this.bedCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.bed.width, this.bed.height);
    const S = GLOW_SCALE;
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

    // --- compose ---
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.bed, 0, 0, this.cssW, this.cssH);

    // --- crisp pass: skirt, then core ---
    lastFill = null;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const wt = w[i];
      if (wt === 0) continue;
      const c = css[i];
      if (c !== lastFill) { ctx.fillStyle = c; lastFill = c; }
      const r = rad[i];
      ctx.globalAlpha = wt * HALO_ALPHA * intensity;
      ctx.beginPath();
      ctx.arc(x[i], y[i], r * HALO_SPREAD, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = wt * CORE_ALPHA * intensity;
      ctx.beginPath();
      ctx.arc(x[i], y[i], r * CORE_SPREAD, 0, TAU);
      ctx.fill();
    }

    // --- panel texture ---
    if (!this.scan) this.buildScanlines();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.scan;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // --- the one interface mark allowed inside the field ---
    if (selected >= 0 && w[selected] > 0) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x[selected], y[selected], rad[selected] + 6.5, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
