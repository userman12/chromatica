/* Canvas 2D renderer for the page.
 *
 * ~12,000 cells is far too many for DOM nodes and comfortable for fillRect, so
 * there is no WebGL here and no per-cell object allocation: the layout hands over
 * flat typed arrays and this file only reads them.
 *
 * Everything is positioned on whole CSS pixels by layout.js and rounded to device
 * pixels here, so neighbouring cells inside a word share an exact edge: no stroke,
 * no gap, no seam. The only empty space on the surface is the word spacing and the
 * leading, and both are structure, not decoration.
 *
 * The accent never fills a cell. A hovered or selected painting is framed, ruled
 * and called out in the margin — the measured colour is never tinted, lightened or
 * recoloured to show that the interface noticed it.
 */
import { cellX, cellY, visibleRows, rowYear } from "./layout.js";

const BG = "#0a0a0a";
const ACCENT = "#00ff9d";
const LABEL = "#4a504c";       // the year in the margin, at rest
const DIM_ALPHA = 0.085;       // filtered-out works: structure stays, colour recedes
const BAND = 3;                // scan-line sweep step, in device px — stepped, not smooth

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.cssH = 0;
    this.front = document.createElement("canvas");   // freshly composed frame
    this.back = document.createElement("canvas");    // frame being swept away
    this.sweep = null;
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(cssW * this.dpr));
    this.h = Math.max(1, Math.round(cssH * this.dpr));
    this.cssH = cssH;
    for (const c of [this.canvas, this.front, this.back]) {
      c.width = this.w;
      c.height = this.h;
    }
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
  }

  /** CSS px -> device px. Rounding both edges is what keeps cells touching exactly. */
  d(v) { return Math.round(v * this.dpr); }

  /** Compose the whole frame into an arbitrary 2D context, in device pixels. */
  compose(ctx, state) {
    const { layout: L, data, matches, hovered, selected, scrollY } = state;
    const px = this.dpr;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.w, this.h);

    const [r0, r1] = visibleRows(L, this.cssH, scrollY);

    // Each row owns a contiguous slice of words, and each word a contiguous run of
    // cells, so the visible cells are one range — nothing off-screen is touched.
    const i0 = L.paintingCell0[L.rowStart[r0]];
    const pEnd = L.rowStart[Math.min(r1 + 1, L.rows + 1)];
    const i1 = pEnd >= L.paintingCell0.length
      ? L.totalCells
      : L.paintingCell0[pEnd];

    let alpha = 1;
    ctx.globalAlpha = 1;
    for (let i = i0; i < i1; i++) {
      if (matches) {
        const want = matches[L.cellPainting[i]] === 1 ? 1 : DIM_ALPHA;
        if (want !== alpha) { ctx.globalAlpha = want; alpha = want; }
      }
      const x = this.d(cellX(L, L.cellPx[i]));
      const y = this.d(cellY(L, L.cellRow[i], scrollY));
      const x1 = this.d(cellX(L, L.cellPx[i]) + L.cell);
      const y1 = this.d(cellY(L, L.cellRow[i], scrollY) + L.cell);
      ctx.fillStyle = L.cellColor[i];
      ctx.fillRect(x, y, Math.max(1, x1 - x), Math.max(1, y1 - y));
    }
    ctx.globalAlpha = 1;

    // A hairline in the blank rows above each century, so the paragraphs read as
    // sections at a glance instead of having to be counted.
    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = 0.16;
    for (const para of L.paras) {
      if (para.row0 === 0 || para.row0 < r0 || para.row0 > r1 + 1) continue;
      const y = this.d(cellY(L, para.row0, scrollY) - L.leading - 3);
      ctx.fillRect(this.d(L.gutter), y, this.d(L.lineW), Math.max(1, Math.round(px)));
    }
    ctx.globalAlpha = 1;

    const hoverRow = hovered >= 0 ? L.paintingRow[hovered] : -1;
    const selRow = selected >= 0 ? L.paintingRow[selected] : -1;

    // The reading ruler: one accent line in the leading under the line the pointer
    // is on. It sits in space that belongs to no cell, so it covers no colour.
    if (hoverRow >= 0) {
      ctx.fillStyle = ACCENT;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(this.d(L.gutter), this.d(cellY(L, hoverRow, scrollY) + L.cell + 1),
        this.d(L.lineW), Math.max(1, Math.round(px)));
      ctx.globalAlpha = 1;
    }

    this.margin(ctx, state, r0, r1, hoverRow, selRow);

    if (hovered >= 0 && hovered !== selected) this.frame(ctx, state, hovered, false);
    if (selected >= 0) this.frame(ctx, state, selected, true);
  }

  /**
   * The margin: the year each line opens with, printed straight from the data.
   * A century's first line is lit, and so is the line being pointed at or read —
   * which is how the ordinal axis becomes a number you can actually look up.
   */
  margin(ctx, state, r0, r1, hoverRow, selRow) {
    const { layout: L, data, scrollY } = state;
    const opens = new Set(L.paras.map((p) => p.row0));

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(10 * this.dpr)}px "JetBrains Mono", ui-monospace, monospace`;
    const x = this.d(L.gutter - 12);

    for (let row = r0; row <= r1; row++) {
      if (L.rowStart[row] === L.rowStart[row + 1]) continue;     // a paragraph gap
      const year = rowYear(L, data, row);
      if (year === null) continue;
      const lit = row === hoverRow || row === selRow || opens.has(row);
      ctx.fillStyle = lit ? ACCENT : LABEL;
      ctx.fillText(String(year), x, this.d(cellY(L, row, scrollY) + L.cell / 2));
    }
  }

  /**
   * Frame one painting — one word — in the accent. The frame is drawn entirely
   * outside the block, in the word spacing and the leading, so not one measured
   * pixel is covered. The selected work also gets an underline, which is what a
   * caret does on a page of text.
   */
  frame(ctx, state, index, isSelected) {
    const { layout: L, scrollY } = state;
    const lw = Math.max(1, Math.round(this.dpr));
    const x0 = this.d(cellX(L, L.paintingX[index]));
    const x1 = this.d(cellX(L, L.paintingX[index] + L.paintingLen[index] * L.cell));
    const y0 = this.d(cellY(L, L.paintingRow[index], scrollY));
    const y1 = this.d(cellY(L, L.paintingRow[index], scrollY) + L.cell);

    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = isSelected ? 1 : 0.7;
    ctx.fillRect(x0 - lw, y0 - lw, x1 - x0 + lw * 2, lw);          // top
    ctx.fillRect(x0 - lw, y1, x1 - x0 + lw * 2, lw);               // bottom
    ctx.fillRect(x0 - lw, y0, lw, y1 - y0);                        // left
    ctx.fillRect(x1, y0, lw, y1 - y0);                             // right
    if (isSelected) ctx.fillRect(x0 - lw, y1 + lw * 2, x1 - x0 + lw * 2, lw);
    ctx.globalAlpha = 1;
  }

  /** Immediate redraw — used for scrolling and hover, where a wipe would read as lag. */
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
