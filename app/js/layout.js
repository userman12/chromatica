/* Layout — maps paintings onto a tape, and the tape onto a cylinder.
 *
 * THE WORLD is a ribbon: a fixed number of ROWS, and as many COLUMNS as the
 * colours need. It is far wider than any screen, so the tape is scrolled rather
 * than fitted — you are always inside history, never looking at all of it.
 *
 * THE PROJECTION wraps that ribbon around a drum whose axis is VERTICAL. That
 * choice is what keeps the renderer cheap: the perspective factor depends only on
 * the column, so every cell is still an axis-aligned rectangle and can still be
 * filled with fillRect, with both boundaries rounded in projected space so
 * neighbours share an exact pixel edge. Curvature, not blur, is what makes the
 * ends of the tape disappear.
 *
 * Horizontal position still means TIME and nothing else. Columns inside a bin are
 * filled in chronological order, and colours inside a painting stay in dominance
 * order — no reordering, no derived metric on the axis.
 */

const CELL_CENTER = 14;        // px per cell at the crown of the drum
const RIBBON_FRACTION = 0.42;  // share of stage height the ribbon occupies at rest
const ROWS_MIN = 12;
const ROWS_MAX = 30;

/* Half of the arc that is drawn. Chosen by measurement, not taste: past ~52 deg
 * the outermost cells fall below a pixel and the tape edge turns to smear, and
 * past ~66 deg the projection folds back on itself. At 46 deg a cell runs from
 * 14px at the crown to 6.3px at the rim, so the whole visible surface stays above
 * the 6px floor the panel look depends on. Columns beyond the arc MUST be culled
 * before drawing — sin() is periodic, so their projected x re-enters the stage. */
export const THETA_MAX = 46 * Math.PI / 180;
const F_RATIO = 2.4;                          // eye distance / drum radius — mild perspective

/** Perspective foreshortening at angle theta. Independent of radius. */
function pOf(theta) {
  return F_RATIO / (F_RATIO + 1 - Math.cos(theta));
}

export function buildLayout(data, stageW, stageH) {
  const bins = data.bins;
  const paintings = data.paintings;
  const nBins = bins.length;

  let totalCells = 0;
  for (const p of paintings) totalCells += p.k.length;

  const rows = Math.min(ROWS_MAX, Math.max(ROWS_MIN,
    Math.round(stageH * RIBBON_FRACTION / CELL_CENTER) || ROWS_MIN));

  // Each bin is as many columns as its own colours need. Bins already hold
  // roughly equal numbers of works, so widths vary only mildly — and the tape
  // stays a solid surface, which uniform widths could not do without punching
  // black holes into the lighter periods.
  const binCellCount = new Int32Array(nBins);
  for (const p of paintings) binCellCount[p.b] += p.k.length;

  const binCol0 = new Int32Array(nBins + 1);
  for (let b = 0; b < nBins; b++) {
    binCol0[b + 1] = binCol0[b] + Math.ceil(binCellCount[b] / rows);
  }
  const worldW = binCol0[nBins];

  // Column -> bin, so hit testing never searches.
  const colBin = new Int32Array(worldW);
  for (let b = 0; b < nBins; b++) {
    for (let c = binCol0[b]; c < binCol0[b + 1]; c++) colBin[c] = b;
  }

  const cellColor = new Array(totalCells);
  const cellPainting = new Int32Array(totalCells);
  const cellX = new Int32Array(totalCells);
  const cellY = new Int32Array(totalCells);
  const binCellStart = new Int32Array(nBins + 1);
  // A painting's colours are written consecutively, so its cells are always one
  // contiguous run — that is what lets hover light a whole work in O(k).
  const paintingCell0 = new Int32Array(paintings.length);

  let cursor = 0;
  for (let b = 0; b < nBins; b++) {
    binCellStart[b] = cursor;
    const bin = bins[b];
    const base = binCol0[b];
    let indexInBin = 0;
    for (let pi = bin.p0; pi < bin.p1; pi++) {
      const painting = paintings[pi];
      paintingCell0[pi] = cursor;
      for (let c = 0; c < painting.k.length; c++) {
        // Column-major: a painting reads as a vertical run of its own palette
        // rather than a fragment split across two rows.
        const col = (indexInBin / rows) | 0;
        const row = indexInBin - col * rows;
        cellColor[cursor] = painting.k[c];
        cellPainting[cursor] = pi;
        cellX[cursor] = base + col;
        cellY[cursor] = row;
        cursor++;
        indexInBin++;
      }
    }
  }
  binCellStart[nBins] = cursor;

  return {
    rows, worldW, totalCells, cellCenter: CELL_CENTER,
    cellColor, cellPainting, cellX, cellY,
    binCellStart, binCellCount, binCol0, colBin, paintingCell0,
  };
}

/** Scale bounds: the ribbon may be pushed in until it nearly fills the stage. */
export function scaleBounds(layout, stageH) {
  return {
    min: CELL_CENTER * 0.62,
    max: Math.max(CELL_CENTER, stageH * 0.88 / layout.rows),
  };
}

/**
 * Everything the renderer and the hit test need for one frame.
 * `view.center` is the world column sitting at the crown of the drum.
 */
export function projection(layout, view, stageW, stageH) {
  const radius = (stageW / 2) / (Math.sin(THETA_MAX) * pOf(THETA_MAX));
  const k = view.scale / radius;             // radians per cell
  return {
    radius, k,
    cx: stageW / 2,
    cy: stageH / 2,
    scale: view.scale,
    center: view.center,
    rows: layout.rows,
  };
}

/** Projected x of a world column boundary (fractional columns allowed). */
export function projectX(proj, worldX) {
  const theta = (worldX - proj.center) * proj.k;
  return proj.cx + proj.radius * Math.sin(theta) * pOf(theta);
}

/** Vertical foreshortening of a whole column — constant down its height. */
export function columnDepth(proj, col) {
  return pOf((col + 0.5 - proj.center) * proj.k);
}

/** Projected y of a world row boundary within a given column. */
export function projectY(proj, col, worldY) {
  const p = columnDepth(proj, col);
  return proj.cy + (worldY - proj.rows / 2) * proj.scale * p;
}

/** Columns whose arc still falls inside the drawn arc, as [first, last]. */
export function visibleCols(layout, proj) {
  const span = THETA_MAX / proj.k;
  const first = Math.max(0, Math.ceil(proj.center - span));
  const last = Math.min(layout.worldW - 1, Math.floor(proj.center + span));
  return [first, last];
}

/**
 * Inverse of projectX. sin(theta)*p(theta) is monotonic well past THETA_MAX, so
 * bisection converges without ambiguity — 28 halvings put us far below one pixel.
 */
function thetaAtScreenX(proj, px) {
  const target = (px - proj.cx) / proj.radius;
  let lo = -THETA_MAX, hi = THETA_MAX;
  if (target <= Math.sin(lo) * pOf(lo)) return lo;
  if (target >= Math.sin(hi) * pOf(hi)) return hi;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (Math.sin(mid) * pOf(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inverse of projectX: screen x -> fractional world column. */
export function worldAtScreenX(proj, px) {
  return proj.center + thetaAtScreenX(proj, px) / proj.k;
}

/** Screen pixel -> painting index, or -1. Closed form apart from the bisection. */
export function hitTest(layout, proj, px, py) {
  const theta = thetaAtScreenX(proj, px);
  if (Math.abs(theta) >= THETA_MAX) return -1;

  const col = Math.floor(proj.center + theta / proj.k);
  if (col < 0 || col >= layout.worldW) return -1;

  const p = columnDepth(proj, col);
  const row = Math.floor(proj.rows / 2 + (py - proj.cy) / (proj.scale * p));
  if (row < 0 || row >= layout.rows) return -1;

  const bin = layout.colBin[col];
  const indexInBin = (col - layout.binCol0[bin]) * layout.rows + row;
  if (indexInBin >= layout.binCellCount[bin]) return -1;   // ragged last column

  return layout.cellPainting[layout.binCellStart[bin] + indexInBin];
}

/** Bins currently on screen, for the readout and the timeline marker. */
export function visibleBins(layout, proj) {
  const [c0, c1] = visibleCols(layout, proj);
  return [layout.colBin[c0], layout.colBin[c1]];
}
