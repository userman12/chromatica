/* Canvas 2D renderer.
 *
 * ~12,000 cells is far too many for DOM nodes but comfortable for fillRect, so
 * there is no WebGL here and no per-cell object allocation: the layout hands over
 * flat typed arrays and this file only reads them.
 *
 * Cell edges are snapped by rounding BOTH boundaries in world space, so
 * neighbouring cells always share an exact pixel edge. That is what produces the
 * borderless, edge-to-edge "high-density panel" surface — there is no stroke,
 * no gap and no gutter anywhere in this file.
 */
import { visibleBins } from "./layout.js";

const BG = "#0a0a0a";
const ACCENT = "#00ff9d";
const DIM_ALPHA = 0.085;      // filtered-out cells: structure stays, colour recedes
const BAND = 3;               // scan-line sweep step, in device px — stepped, not smooth

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.front = document.createElement("canvas");   // freshly composed frame
    this.back = document.createElement("canvas");    // frame being swept away
    this.sweep = null;
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(cssW * this.dpr));
    this.h = Math.max(1, Math.round(cssH * this.dpr));
    for (const c of [this.canvas, this.front, this.back]) {
      c.width = this.w;
      c.height = this.h;
    }
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
  }

  /** Compose the colour field into an arbitrary 2D context, in device pixels. */
  compose(ctx, state) {
    const { layout, view, cssW, selected, matches } = state;
    const s = view.scale * this.dpr;
    const px = view.panX;
    const py = view.panY;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);

    const [b0, b1] = visibleBins(layout, view, cssW);
    const { cellX, cellY, cellColor, cellPainting, binCellStart } = layout;

    // Two passes so globalAlpha is set twice per frame instead of per cell.
    // Cells never overlap, so draw order is irrelevant.
    for (let pass = 0; pass < 2; pass++) {
      const dim = pass === 0;
      if (dim && !matches) continue;
      ctx.globalAlpha = dim ? DIM_ALPHA : 1;

      for (let b = b0; b <= b1; b++) {
        const end = binCellStart[b + 1];
        for (let i = binCellStart[b]; i < end; i++) {
          if (matches) {
            const isMatch = matches[cellPainting[i]] === 1;
            if (isMatch === dim) continue;
          }
          const x0 = Math.round((cellX[i] - px) * s);
          const y0 = Math.round((cellY[i] - py) * s);
          const w = Math.round((cellX[i] + 1 - px) * s) - x0;
          const h = Math.round((cellY[i] + 1 - py) * s) - y0;
          ctx.fillStyle = cellColor[i];
          ctx.fillRect(x0, y0, w < 1 ? 1 : w, h < 1 ? 1 : h);
        }
      }
    }
    ctx.globalAlpha = 1;

    if (selected >= 0) this.outline(ctx, state, s, px, py);
  }

  /** Mark the selected painting's run of cells. The accent never fills a cell —
   *  artwork colour is never overpainted. */
  outline(ctx, state, s, px, py) {
    const { layout, selected } = state;
    const { cellX, cellY, cellPainting, binCellStart, binCellCount } = layout;
    const bin = state.data.paintings[selected].b;
    const end = binCellStart[bin] + binCellCount[bin];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = binCellStart[bin]; i < end; i++) {
      if (cellPainting[i] !== selected) continue;
      const x0 = Math.round((cellX[i] - px) * s);
      const y0 = Math.round((cellY[i] - py) * s);
      const x1 = Math.round((cellX[i] + 1 - px) * s);
      const y1 = Math.round((cellY[i] + 1 - py) * s);
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
    if (minX === Infinity) return;

    // Pad outward so the marker sits around the cells, not on top of them.
    const pad = Math.max(1, Math.round(this.dpr));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = pad;
    ctx.strokeRect(minX - pad / 2, minY - pad / 2,
                   maxX - minX + pad, maxY - minY + pad);
  }

  /** Immediate redraw — used for pan, zoom and hover, where any wipe would lag. */
  draw(state) {
    this.sweep = null;
    this.compose(this.ctx, state);
  }

  /**
   * Redraw with a CRT-style scan-line refresh: the new frame arrives band by band
   * from the top while the previous frame is still standing below the sweep.
   * Used only for discrete state changes (filter, reset), never for dragging.
   */
  scan(state, onDone) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.draw(state);
      if (onDone) onDone();
      return;
    }
    this.back.getContext("2d").drawImage(this.canvas, 0, 0);
    this.compose(this.front.getContext("2d"), state);

    const ctx = this.ctx;
    const total = this.h;
    const perFrame = Math.max(BAND * 4, Math.ceil(total / 26 / BAND) * BAND);
    let y = 0;
    const token = {};
    this.sweep = token;

    const step = () => {
      if (this.sweep !== token) return;               // superseded by a newer draw
      y = Math.min(total, y + perFrame);
      ctx.drawImage(this.front, 0, 0, this.w, y, 0, 0, this.w, y);
      if (y < total) {
        ctx.drawImage(this.back, 0, y, this.w, total - y, 0, y, this.w, total - y);
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 0.55;
        ctx.fillRect(0, y, this.w, Math.max(1, this.dpr));
        ctx.globalAlpha = 1;
        requestAnimationFrame(step);
      } else {
        this.sweep = null;
        if (onDone) onDone();
      }
    };
    requestAnimationFrame(step);
  }
}
