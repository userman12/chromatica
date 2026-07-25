/* Layout — maps paintings to a world grid of cells.
 *
 * The world is measured in CELL UNITS, not pixels, and zoom is simply
 * "pixels per cell unit". That keeps pan/zoom behaving like a map: the layout is
 * computed once per resize instead of once per frame, and zooming from the
 * overview to individual cells is one continuous scale, not two modes.
 *
 * Horizontal axis is ORDINAL: every bin gets an identical number of cell columns
 * regardless of how many years it spans. Bins already hold roughly equal numbers
 * of paintings (see pipeline/04_build.py), so columns end up near-equal height
 * and read as a continuous fabric — while the label strip reports the real span.
 */

const CELLS_PER_ROW_MIN = 3;
const CELLS_PER_ROW_MAX = 10;

/**
 * Choose how many cells wide each bin column is, so that the whole field
 * roughly matches the stage's aspect ratio at fit-all zoom.
 *
 * worldH/worldW = totalCells / (nBins^2 * cpr^2)  ->  solve for cpr.
 */
function chooseCellsPerRow(totalCells, nBins, stageW, stageH) {
  const aspect = Math.max(stageH, 1) / Math.max(stageW, 1);
  const ideal = Math.sqrt(totalCells / aspect) / nBins;
  const rounded = Math.round(ideal) || 4;
  return Math.min(CELLS_PER_ROW_MAX, Math.max(CELLS_PER_ROW_MIN, rounded));
}

export function buildLayout(data, stageW, stageH) {
  const bins = data.bins;
  const paintings = data.paintings;
  const nBins = bins.length;

  let totalCells = 0;
  for (const p of paintings) totalCells += p.k.length;

  const cellsPerRow = chooseCellsPerRow(totalCells, nBins, stageW, stageH);

  // Per-bin cell counts, then the tallest column defines world height.
  const binCellCount = new Int32Array(nBins);
  for (const p of paintings) binCellCount[p.b] += p.k.length;

  let worldH = 0;
  const binRows = new Int32Array(nBins);
  for (let b = 0; b < nBins; b++) {
    binRows[b] = Math.ceil(binCellCount[b] / cellsPerRow);
    if (binRows[b] > worldH) worldH = binRows[b];
  }
  const worldW = nBins * cellsPerRow;

  // Flat, typed cell arrays. Built once; the render loop only ever reads slices.
  const cellColor = new Array(totalCells);
  const cellPainting = new Int32Array(totalCells);
  const cellX = new Int32Array(totalCells);
  const cellY = new Int32Array(totalCells);
  const binCellStart = new Int32Array(nBins + 1);

  let cursor = 0;
  for (let b = 0; b < nBins; b++) {
    binCellStart[b] = cursor;
    const bin = bins[b];
    const baseCol = b * cellsPerRow;
    let indexInBin = 0;
    for (let pi = bin.p0; pi < bin.p1; pi++) {
      const painting = paintings[pi];
      // Colours stay in dominance order, so the leftmost cell column reads as a
      // stripe of each painting's single most dominant colour.
      for (let c = 0; c < painting.k.length; c++) {
        const row = (indexInBin / cellsPerRow) | 0;
        const col = indexInBin - row * cellsPerRow;
        cellColor[cursor] = painting.k[c];
        cellPainting[cursor] = pi;
        cellX[cursor] = baseCol + col;
        // Columns are anchored to the baseline and grow upward, so a short
        // column shows as a genuine dip in available works rather than being
        // silently stretched to fill.
        cellY[cursor] = worldH - 1 - row;
        cursor++;
        indexInBin++;
      }
    }
  }
  binCellStart[nBins] = cursor;

  return {
    cellsPerRow, worldW, worldH, totalCells,
    cellColor, cellPainting, cellX, cellY,
    binCellStart, binCellCount, binRows,
  };
}

/** Pixels-per-cell at which the entire field fits the stage. */
export function fitScale(layout, stageW, stageH) {
  return Math.min(stageW / layout.worldW, stageH / layout.worldH);
}

/**
 * Inverse mapping: screen pixel -> painting index, or -1.
 * O(1) — the grid is regular by construction, so no spatial index is needed.
 */
export function hitTest(layout, view, px, py) {
  const wx = Math.floor(px / view.scale + view.panX);
  const wy = Math.floor(py / view.scale + view.panY);
  if (wx < 0 || wx >= layout.worldW || wy < 0 || wy >= layout.worldH) return -1;

  const bin = (wx / layout.cellsPerRow) | 0;
  const col = wx - bin * layout.cellsPerRow;
  const row = layout.worldH - 1 - wy;
  if (row < 0 || row >= layout.binRows[bin]) return -1;

  const indexInBin = row * layout.cellsPerRow + col;
  if (indexInBin >= layout.binCellCount[bin]) return -1;   // ragged last row

  return layout.cellPainting[layout.binCellStart[bin] + indexInBin];
}

/** Range of bins currently intersecting the viewport, for culling. */
export function visibleBins(layout, view, stageW) {
  const first = Math.max(0, Math.floor(view.panX / layout.cellsPerRow));
  const last = Math.min(
    layout.binCellCount.length - 1,
    Math.ceil((view.panX + stageW / view.scale) / layout.cellsPerRow),
  );
  return [first, last];
}
