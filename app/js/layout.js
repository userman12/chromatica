/* CHROMATICA — layout: six centuries set as a page of text.
 *
 * Every colour is a letter, every painting is a word, every century is a
 * paragraph, and the reading order IS the chronology: the first cell top-left is
 * the earliest work, the last cell bottom-right the latest. Nothing is
 * off-screen, so there is nothing to navigate — the whole dataset is one page.
 *
 * What position means has not changed and must not change: it is time and
 * nothing else. Cells inside a word stay in the order the extraction produced
 * them (descending pixel share), works inside a paragraph stay chronological.
 * No colour is sorted, grouped, reordered or derived from a metric.
 *
 * A word is never broken across a line. That is what keeps a painting readable
 * as a single object, and it is why the right edge is ragged — the ragged edge is
 * a consequence of being honest about where works end, not a decoration.
 *
 * The cell size is chosen by measurement at every resize: the largest size in
 * [CELL_MIN, CELL_MAX] whose flow still fits the stage. All coordinates here are
 * whole CSS pixels, which is what lets neighbouring cells share an exact edge and
 * keeps the surface borderless.
 */

const CELL_MAX = 11;
const CELL_MIN = 7;
const CELL_PREF = 9;         // used when the page cannot fit and has to scroll
export const GUTTER = 62;    // px on the left, for the year of each line
const PAD_R = 16;
const PAD_T = 12;
const PARA_GAP = 2;          // blank lines between centuries

/* Leading. Without it the lines touch and a word merges with the words above and
 * below it, which is precisely what turned the first attempt into brown static.
 * It is the difference between a field of pixels and a page of text. */
const LEADING = 3;

/* The space between words, in px. This is the one piece of empty space in the
 * design and it earns its place: packed edge to edge, 11,728 mostly-ochre cells
 * read as static, and a painting cannot be told from its neighbour. Text is
 * legible because of the spaces, not in spite of them. Cells INSIDE a word still
 * touch exactly — the borderless surface is preserved where it means something. */
const WORD_GAP = 3;

const centuryOf = (year) => Math.floor(year / 100) * 100;

/**
 * Flow the works into a line of `lineW` px and report how many rows that takes.
 * Cheap enough to call once per candidate cell size.
 */
function measure(paintings, lineW, cell) {
  let rows = 0;
  let century = null;
  let x = 0;
  for (const p of paintings) {
    const c = centuryOf(p.y);
    if (c !== century) {                            // new paragraph
      if (century !== null) rows += PARA_GAP;
      century = c;
      rows += 1;
      x = 0;
    }
    const w = p.k.length * cell;
    if (x + w > lineW) { rows += 1; x = 0; }         // wrap, never split
    x += w + WORD_GAP;
  }
  return rows;
}

export function buildLayout(data, stageW, stageH) {
  const paintings = data.paintings;

  // Largest cell whose page fits. Falls back to CELL_MIN, and then the page is
  // allowed to be taller than the stage and scrolls — cell legibility wins over
  // fitting, because below 6px a cell stops reading as a colour sample.
  const lineW = Math.max(60, stageW - GUTTER - PAD_R);

  // Prefer a cell you can actually read. If the whole page fits the stage at some
  // size, take the largest such size and there is nothing to scroll; if it does
  // not fit at any size, do NOT shrink to the floor — use the comfortable size and
  // let the page scroll. A 7px cell that fits is worth less than a 9px cell you
  // can tell apart from its neighbour.
  let cell = CELL_PREF;
  let rows = measure(paintings, lineW, CELL_PREF);
  for (let s = CELL_MAX; s >= CELL_MIN; s--) {
    const r = measure(paintings, lineW, s);
    if (r * (s + LEADING) + PAD_T * 2 <= stageH) { cell = s; rows = r; break; }
  }

  const totalCells = data.meta.totalCells;
  const cellColor = new Array(totalCells);
  const cellPainting = new Int32Array(totalCells);
  const cellPx = new Int32Array(totalCells);      // x within the text column, px
  const cellRow = new Int32Array(totalCells);

  const nP = paintings.length;
  const paintingCell0 = new Int32Array(nP);
  const paintingLen = new Int32Array(nP);         // cells in the word
  const paintingRow = new Int32Array(nP);
  const paintingX = new Int32Array(nP);           // px within the text column

  // Words are laid down in reading order, so each row owns one contiguous slice
  // of them. rowStart turns hit testing into a bounded search inside one row.
  const rowStart = new Int32Array(rows + 2);

  const paras = [];
  let century = null;
  let row = 0;
  let x = 0;
  let cursor = 0;
  let lastRow = 0;

  for (let pi = 0; pi < nP; pi++) {
    const p = paintings[pi];
    const c = centuryOf(p.y);
    if (c !== century) {
      if (century !== null) {
        const prev = paras[paras.length - 1];
        prev.rowN = row - prev.row0 + 1;
        row += 1 + PARA_GAP;
      }
      century = c;
      x = 0;
      paras.push({ century: c, row0: row, rowN: 1, works: 0, cells: 0, p0: pi, p1: pi });
    }
    const w = p.k.length * cell;
    if (x + w > lineW) { row += 1; x = 0; }

    while (lastRow < row) { rowStart[++lastRow] = pi; }

    const para = paras[paras.length - 1];
    para.works += 1;
    para.cells += p.k.length;
    para.p1 = pi;

    paintingCell0[pi] = cursor;
    paintingLen[pi] = p.k.length;
    paintingRow[pi] = row;
    paintingX[pi] = x;

    for (let j = 0; j < p.k.length; j++) {
      cellColor[cursor] = p.k[j];
      cellPainting[cursor] = pi;
      cellPx[cursor] = x + j * cell;
      cellRow[cursor] = row;
      cursor++;
    }
    x += w + WORD_GAP;
  }
  if (paras.length) {
    const last = paras[paras.length - 1];
    last.rowN = row - last.row0 + 1;
  }
  while (lastRow < rows + 1) { rowStart[++lastRow] = nP; }

  return {
    cell, lineW, rows, gutter: GUTTER, padTop: PAD_T, wordGap: WORD_GAP,
    leading: LEADING, pitch: cell + LEADING,
    height: rows * (cell + LEADING) + PAD_T * 2,
    totalCells: cursor,
    cellColor, cellPainting, cellPx, cellRow,
    paintingCell0, paintingLen, paintingRow, paintingX, rowStart,
    paras,
  };
}

/** Top-left corner of a cell, in CSS px relative to the stage. */
export function cellX(layout, px) { return layout.gutter + px; }
export function cellY(layout, row, scrollY = 0) {
  return layout.padTop + row * layout.pitch - scrollY;
}

/** Cell index under a stage-relative point, or -1. Bounded search in one row. */
export function hitTest(layout, px, py, scrollY = 0) {
  const { cell, rowStart, paintingX, paintingLen } = layout;
  const row = Math.floor((py - layout.padTop + scrollY) / layout.pitch);
  // The leading belongs to no word: a point in it is a miss, not the nearest hit.
  if ((py - layout.padTop + scrollY) - row * layout.pitch >= cell) return -1;
  if (row < 0 || row >= layout.rows) return -1;
  const x = px - layout.gutter;
  if (x < 0 || x > layout.lineW) return -1;

  let lo = rowStart[row], hi = rowStart[row + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x0 = paintingX[mid];
    const x1 = x0 + paintingLen[mid] * cell;
    if (x < x0) hi = mid - 1;
    else if (x >= x1) lo = mid + 1;             // includes the gap after the word
    else return layout.paintingCell0[mid] + Math.floor((x - x0) / cell);
  }
  return -1;
}

/** Rows on screen, so a scrolled page never draws what it cannot show. */
export function visibleRows(layout, stageH, scrollY = 0) {
  const r0 = Math.max(0, Math.floor((scrollY - layout.padTop) / layout.pitch));
  const r1 = Math.min(layout.rows - 1,
    Math.ceil((scrollY + stageH - layout.padTop) / layout.pitch));
  return [r0, r1];
}

/** The year a line opens with — what the gutter prints, straight from the data. */
export function rowYear(layout, data, row) {
  const pi = layout.rowStart[row];
  return pi < data.paintings.length ? data.paintings[pi].y : null;
}

export function maxScroll(layout, stageH) {
  return Math.max(0, layout.height - stageH);
}
