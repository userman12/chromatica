/* Canvas 2D renderer for the tape.
 *
 * ~12,000 cells is far too many for DOM nodes and comfortable for fillRect, so
 * there is no WebGL here and no per-cell object allocation: the layout hands over
 * flat typed arrays and this file only reads them.
 *
 * The drum's axis is vertical, so the perspective factor depends only on the
 * column. Every cell therefore stays an axis-aligned rectangle, and both of its
 * boundaries are rounded in projected space — which is what keeps the surface
 * borderless and edge-to-edge even while it curves. There is no stroke, no gap and
 * no gutter on any cell in this file.
 *
 * The accent never fills a cell. Highlighting is done by lifting a work off the
 * drum and outlining it, never by tinting the colour that was measured from the
 * painting.
 */
import {
  projection, projectX, projectY, columnDepth, visibleCols, THETA_MAX,
} from "./layout.js";

const BG = "#0a0a0a";
const ACCENT = "#00ff9d";
const TICK = "#2a2f2c";
const TICK_LIT = "#4d5c56";
const LABEL = "#6b7671";
const DIM_ALPHA = 0.085;      // filtered-out cells: structure stays, colour recedes
const BAND = 3;               // scan-line sweep step, in device px — stepped, not smooth
const POP = 1.3;              // how far the hovered work lifts toward the viewer
const VIGNETTE = 0.17;        // share of each side where the tape rolls into black

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
    this.vignette = null;
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

    const g = this.ctx.createLinearGradient(0, 0, this.w, 0);
    g.addColorStop(0, BG);
    g.addColorStop(VIGNETTE, "rgba(10,10,10,0)");
    g.addColorStop(1 - VIGNETTE, "rgba(10,10,10,0)");
    g.addColorStop(1, BG);
    this.vignette = g;
  }

  /** The projection for this frame, in device pixels. */
  projFor(state) {
    return projection(
      state.layout,
      { center: state.view.center, scale: state.view.scale * this.dpr },
      this.w, this.h,
    );
  }

  /** Compose the whole frame into an arbitrary 2D context, in device pixels. */
  compose(ctx, state) {
    const { layout, matches, hovered, selected } = state;
    const proj = this.projFor(state);
    const { rows, cellColor, cellPainting, binCellStart, binCol0, colBin, binCellCount } = layout;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);

    const [c0, c1] = visibleCols(layout, proj);

    // Walk the visible columns directly. Cells inside a bin are stored
    // column-major, so a column's cells are one exact contiguous slice — no
    // search, and nothing off-arc is ever touched.
    let edgeL = Math.round(projectX(proj, c0));
    let alpha = 1;
    ctx.globalAlpha = 1;

    for (let col = c0; col <= c1; col++) {
      const edgeR = Math.round(projectX(proj, col + 1));
      const wCell = Math.max(1, edgeR - edgeL);

      const b = colBin[col];
      const colInBin = col - binCol0[b];
      const start = binCellStart[b] + colInBin * rows;
      const n = Math.min(rows, binCellCount[b] - colInBin * rows);

      const p = columnDepth(proj, col);
      const rowH = proj.scale * p;
      const yTop = proj.cy - (rows / 2) * rowH;

      for (let r = 0; r < n; r++) {
        const i = start + r;
        if (matches) {
          const want = matches[cellPainting[i]] === 1 ? 1 : DIM_ALPHA;
          if (want !== alpha) { ctx.globalAlpha = want; alpha = want; }
        }
        const y0 = Math.round(yTop + r * rowH);
        const y1 = Math.round(yTop + (r + 1) * rowH);
        ctx.fillStyle = cellColor[i];
        ctx.fillRect(edgeL, y0, wCell, Math.max(1, y1 - y0));
      }
      edgeL = edgeR;
    }
    ctx.globalAlpha = 1;

    this.timeAxis(ctx, state, proj, c0, c1);

    // The ends of the tape roll into black instead of being cut by the frame.
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.w, this.h);

    if (hovered >= 0 && hovered !== selected) this.lift(ctx, state, proj, hovered, false);
    if (selected >= 0) this.lift(ctx, state, proj, selected, true);
  }

  /**
   * Projected bounding box of one painting's run of cells, in device pixels.
   * The run is contiguous by construction (see layout.js).
   */
  runBox(state, proj, index) {
    const { layout, data } = state;
    const { rows, cellX, cellY, paintingCell0 } = layout;
    const n = data.paintings[index].k.length;
    const i0 = paintingCell0[index];

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const col = cellX[i0 + j];
      if (Math.abs((col + 0.5 - proj.center) * proj.k) >= THETA_MAX) continue;
      const ax = projectX(proj, col), bx = projectX(proj, col + 1);
      const ay = projectY(proj, col, cellY[i0 + j]);
      const by = projectY(proj, col, cellY[i0 + j] + 1);
      if (ax < x0) x0 = ax;
      if (bx > x1) x1 = bx;
      if (ay < y0) y0 = ay;
      if (by > y1) y1 = by;
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1, i0, n };
  }

  /**
   * Lift a work off the drum: its own cells, redrawn larger about their centre,
   * with an accent frame around the block. The colours are the measured ones —
   * scale and outline are the only things the interface adds.
   */
  lift(ctx, state, proj, index, isSelected) {
    const box = this.runBox(state, proj, index);
    if (!box) return;
    const { layout } = state;
    const { cellX, cellY, cellColor } = layout;

    const scale = isSelected ? POP + 0.08 : POP;
    const mx = (box.x0 + box.x1) / 2;
    const my = (box.y0 + box.y1) / 2;
    const at = (v, m) => m + (v - m) * scale;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 10 * this.dpr;
    ctx.shadowOffsetY = 2 * this.dpr;

    for (let j = 0; j < box.n; j++) {
      const i = box.i0 + j;
      const col = cellX[i];
      if (Math.abs((col + 0.5 - proj.center) * proj.k) >= THETA_MAX) continue;
      const x0 = Math.round(at(projectX(proj, col), mx));
      const x1 = Math.round(at(projectX(proj, col + 1), mx));
      const y0 = Math.round(at(projectY(proj, col, cellY[i]), my));
      const y1 = Math.round(at(projectY(proj, col, cellY[i] + 1), my));
      ctx.fillStyle = cellColor[i];
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      ctx.shadowColor = "transparent";     // shadow on the block, not between cells
    }
    ctx.restore();

    const lw = Math.max(1, Math.round(this.dpr));
    ctx.strokeStyle = ACCENT;
    ctx.globalAlpha = isSelected ? 1 : 0.75;
    ctx.lineWidth = lw;
    ctx.strokeRect(
      Math.round(at(box.x0, mx)) - lw / 2,
      Math.round(at(box.y0, my)) - lw / 2,
      Math.round(at(box.x1, mx) - at(box.x0, mx)) + lw,
      Math.round(at(box.y1, my) - at(box.y0, my)) + lw,
    );
    ctx.globalAlpha = 1;
  }

  /**
   * The time axis, drawn ON the drum so it curves with the tape: a tick at every
   * bin boundary, a taller tick and a year at every century it crosses, and the
   * bin at the crown called out in the accent — that is the "you are here".
   */
  timeAxis(ctx, state, proj, c0, c1) {
    const { layout, data } = state;
    const bins = data.bins;
    const crown = layout.colBin[Math.max(0, Math.min(layout.worldW - 1,
      Math.round(proj.center)))];

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    let lastLabelX = -Infinity;
    for (let b = 0; b < bins.length; b++) {
      const col = layout.binCol0[b];
      if (col < c0 || col > c1) continue;

      const x = Math.round(projectX(proj, col));
      const yBase = projectY(proj, col, layout.rows) + 7 * this.dpr;
      const century = Math.floor(bins[b].s / 100) !==
        (b > 0 ? Math.floor(bins[b - 1].s / 100) : -1);
      const lit = b === crown;

      ctx.fillStyle = lit ? ACCENT : (century ? TICK_LIT : TICK);
      const len = (lit ? 11 : century ? 9 : 5) * this.dpr;
      ctx.fillRect(x, yBase, Math.max(1, Math.round(this.dpr)), len);

      if ((century || lit) && x - lastLabelX > 52 * this.dpr) {
        ctx.fillStyle = lit ? ACCENT : LABEL;
        ctx.font = `${Math.round(10 * this.dpr)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(String(bins[b].s), x, yBase + len + 4 * this.dpr);
        lastLabelX = x;
      }
    }

    // The tape is not a loop. Where it genuinely ends, it says why.
    ctx.font = `${Math.round(9 * this.dpr)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillStyle = TICK_LIT;
    if (c0 === 0) {
      ctx.textAlign = "right";
      ctx.fillText(`${bins[0].s} · EARLIEST WORK`,
        projectX(proj, 0) - 10 * this.dpr, proj.cy);
    }
    if (c1 === layout.worldW - 1) {
      ctx.textAlign = "left";
      ctx.fillText(`${bins[bins.length - 1].e} · PUBLIC DOMAIN LIMIT`,
        projectX(proj, layout.worldW) + 10 * this.dpr, proj.cy);
    }
  }

  /** Immediate redraw — used for scrolling, zoom and hover, where a wipe would lag. */
  draw(state) {
    this.sweep = null;
    this.compose(this.ctx, state);
  }

  /**
   * Redraw with a CRT-style scan-line refresh: the new frame arrives band by band
   * from the top while the previous frame is still standing below the sweep.
   * Used only for discrete state changes (filter, reset), never while scrolling.
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
