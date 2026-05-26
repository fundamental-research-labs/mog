/**
 * Tests for forEachVisibleCell.
 *
 * Extracted from the orphan compute-layout.test.ts when computeGridLayout
 * was deleted. The forEachVisibleCell function is independent
 * of any layout-pipeline implementation; these tests cover its iteration,
 * hidden-cell skipping, merge deduplication, and dirty-rect culling
 * behavior.
 *
 * @module grid-renderer/layout/__tests__/for-each-visible-cell.test
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { docSpaceRect } from '@mog/canvas-engine';

import { ViewportMergeIndex } from '../../coordinates/viewport-merge-index';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { forEachVisibleCell } from '../for-each-visible-cell';
import type { VisibleCellInfo } from '../types';

function createTestPositionIndex(opts?: {
  defaultRowHeight?: number;
  defaultColWidth?: number;
  totalRows?: number;
  totalCols?: number;
  hiddenRows?: Set<number>;
  hiddenCols?: Set<number>;
  customRowHeights?: Map<number, number>;
  customColWidths?: Map<number, number>;
  numRows?: number;
  numCols?: number;
}): ViewportPositionIndex {
  const defaultRowHeight = opts?.defaultRowHeight ?? 25;
  const defaultColWidth = opts?.defaultColWidth ?? 100;
  const totalRows = opts?.totalRows ?? 1000;
  const totalCols = opts?.totalCols ?? 26;
  const numRows = opts?.numRows ?? Math.min(totalRows, 1000);
  const numCols = opts?.numCols ?? Math.min(totalCols, 100);

  const pi = new ViewportPositionIndex(defaultRowHeight, defaultColWidth);

  const rowPositions = new Float64Array(numRows);
  let y = 0;
  for (let i = 0; i < numRows; i++) {
    if (opts?.hiddenRows?.has(i)) {
      rowPositions[i] = y;
    } else {
      rowPositions[i] = y;
      y += opts?.customRowHeights?.get(i) ?? defaultRowHeight;
    }
  }

  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    if (opts?.hiddenCols?.has(i)) {
      colPositions[i] = x;
    } else {
      colPositions[i] = x;
      x += opts?.customColWidths?.get(i) ?? defaultColWidth;
    }
  }

  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(totalRows, totalCols);

  if (opts?.hiddenRows || opts?.hiddenCols) {
    pi.setHiddenState(opts.hiddenRows ?? new Set(), opts.hiddenCols ?? new Set());
  }

  return pi;
}

function createTestMergeIndex(merges?: Map<string, CellRange>): ViewportMergeIndex {
  const mi = new ViewportMergeIndex();
  if (merges && merges.size > 0) {
    const binaryMerges = Array.from(merges.values()).map((m) => ({
      start_row: m.startRow,
      start_col: m.startCol,
      end_row: m.endRow,
      end_col: m.endCol,
    }));
    mi.setMerges(binaryMerges);
  }
  return mi;
}

describe('forEachVisibleCell', () => {
  it('should iterate over all cells in a range', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }, pi, mi, (cell) =>
      cells.push(cell),
    );

    expect(cells).toHaveLength(9);
    expect(cells[0].row).toBe(0);
    expect(cells[0].col).toBe(0);
    expect(cells[0].x).toBe(0);
    expect(cells[0].y).toBe(0);
    expect(cells[0].width).toBe(100);
    expect(cells[0].height).toBe(25);
  });

  it('should skip hidden rows', () => {
    const pi = createTestPositionIndex({
      totalRows: 100,
      totalCols: 26,
      hiddenRows: new Set([1]),
    });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell({ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }, pi, mi, (cell) =>
      cells.push(cell),
    );

    expect(cells).toHaveLength(2);
    expect(cells[0].row).toBe(0);
    expect(cells[1].row).toBe(2);
  });

  it('should skip hidden columns', () => {
    const pi = createTestPositionIndex({
      totalRows: 100,
      totalCols: 26,
      hiddenCols: new Set([1]),
    });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell({ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }, pi, mi, (cell) =>
      cells.push(cell),
    );

    expect(cells).toHaveLength(2);
    expect(cells[0].col).toBe(0);
    expect(cells[1].col).toBe(2);
  });

  it('should handle merged cells with deduplication', () => {
    const merges = new Map<string, CellRange>();
    merges.set('A1:B2', { startRow: 0, startCol: 0, endRow: 1, endCol: 1 });

    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });
    const mi = createTestMergeIndex(merges);

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, pi, mi, (cell) =>
      cells.push(cell),
    );

    expect(cells).toHaveLength(1);
    expect(cells[0].merge).toBeDefined();
    expect(cells[0].merge!.originRow).toBe(0);
    expect(cells[0].merge!.originCol).toBe(0);
    expect(cells[0].merge!.mergeWidth).toBe(200);
    expect(cells[0].merge!.mergeHeight).toBe(50);
  });

  it('should compute correct document-space positions', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell({ startRow: 3, startCol: 2, endRow: 3, endCol: 2 }, pi, mi, (cell) =>
      cells.push(cell),
    );

    expect(cells).toHaveLength(1);
    expect(cells[0].x).toBe(200);
    expect(cells[0].y).toBe(75);
    expect(cells[0].width).toBe(100);
    expect(cells[0].height).toBe(25);
  });

  it('should NOT cull cells when dirty rects are in matching doc-space', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });
    const mi = createTestMergeIndex();

    const docSpaceDirtyRects = [docSpaceRect(0, 0, 100, 25)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
      pi,
      mi,
      (cell) => cells.push(cell),
      docSpaceDirtyRects,
    );

    expect(cells).toHaveLength(1);
    expect(cells[0].row).toBe(0);
    expect(cells[0].col).toBe(0);
  });

  it('should cull cells when dirty rects do not overlap in doc-space (Bug 3 scenario)', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });
    const mi = createTestMergeIndex();

    const canvasSpaceDirtyRects = [docSpaceRect(500, 26, 74, 22)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
      pi,
      mi,
      (cell) => cells.push(cell),
      canvasSpaceDirtyRects,
    );

    expect(cells).toHaveLength(0);
  });
});

describe('forEachVisibleCell with non-zero scroll + zoom dirty rects', () => {
  it('includes cells that intersect doc-space dirty rects (scrolled + zoomed)', () => {
    const pi = createTestPositionIndex({
      totalRows: 20,
      totalCols: 20,
      defaultRowHeight: 100,
      defaultColWidth: 100,
    });
    const mi = createTestMergeIndex();

    const dirtyRects = [docSpaceRect(700, 500, 100, 100)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 4, startCol: 6, endRow: 6, endCol: 8 },
      pi,
      mi,
      (cell) => cells.push(cell),
      dirtyRects,
    );

    expect(cells).toHaveLength(1);
    expect(cells[0].row).toBe(5);
    expect(cells[0].col).toBe(7);
  });

  it('culls cells when canvas-space rects are incorrectly passed (scroll offset mismatch)', () => {
    const pi = createTestPositionIndex({
      totalRows: 20,
      totalCols: 20,
      defaultRowHeight: 100,
      defaultColWidth: 100,
    });
    const mi = createTestMergeIndex();

    const wrongSpaceRects = [docSpaceRect(450, 430, 200, 200)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 4, startCol: 6, endRow: 6, endCol: 8 },
      pi,
      mi,
      (cell) => cells.push(cell),
      wrongSpaceRects,
    );

    const visitedKeys = cells.map((c) => `${c.row},${c.col}`);
    expect(visitedKeys).not.toContain('5,7');
  });

  it('visits multiple cells when doc-space dirty rect spans them', () => {
    const pi = createTestPositionIndex({
      totalRows: 20,
      totalCols: 20,
      defaultRowHeight: 50,
      defaultColWidth: 80,
    });
    const mi = createTestMergeIndex();

    const dirtyRects = [docSpaceRect(80, 100, 160, 100)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 5, endCol: 5 },
      pi,
      mi,
      (cell) => cells.push(cell),
      dirtyRects,
    );

    const visitedKeys = new Set(cells.map((c) => `${c.row},${c.col}`));
    expect(visitedKeys.has('2,1')).toBe(true);
    expect(visitedKeys.has('2,2')).toBe(true);
    expect(visitedKeys.has('3,1')).toBe(true);
    expect(visitedKeys.has('3,2')).toBe(true);
    expect(cells).toHaveLength(4);
  });

  it('culls all cells when dirty rects are entirely outside visible range in doc-space', () => {
    const pi = createTestPositionIndex({
      totalRows: 20,
      totalCols: 20,
      defaultRowHeight: 25,
      defaultColWidth: 100,
    });
    const mi = createTestMergeIndex();

    const dirtyRects = [docSpaceRect(5000, 5000, 100, 25)];

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 5, endCol: 5 },
      pi,
      mi,
      (cell) => cells.push(cell),
      dirtyRects,
    );

    expect(cells).toHaveLength(0);
  });

  it('no dirty rects (undefined) visits all cells — no culling', () => {
    const pi = createTestPositionIndex({
      totalRows: 10,
      totalCols: 10,
      defaultRowHeight: 25,
      defaultColWidth: 100,
    });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      pi,
      mi,
      (cell) => cells.push(cell),
      undefined,
    );

    expect(cells).toHaveLength(4);
  });

  it('empty dirty rects array culls all cells', () => {
    const pi = createTestPositionIndex({
      totalRows: 10,
      totalCols: 10,
      defaultRowHeight: 25,
      defaultColWidth: 100,
    });
    const mi = createTestMergeIndex();

    const cells: VisibleCellInfo[] = [];
    forEachVisibleCell(
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      pi,
      mi,
      (cell) => cells.push(cell),
      [],
    );

    expect(cells).toHaveLength(0);
  });
});
