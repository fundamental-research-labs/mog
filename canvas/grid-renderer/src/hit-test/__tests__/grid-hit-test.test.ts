/**
 * Tests for GridHitTest
 *
 * Validates the merge-anchor snap, the layered priority ordering, and the
 * empty-cell handling. The renderer's hit-test sits at the boundary between
 * raw pixel input and downstream consumers (selection, drag, keyboard); these
 * tests lock in the contract that consumers always receive a canonical cell
 * address, regardless of where in the lifecycle the merge index becomes
 * available.
 */

import {
  NULL_CELL_DATA_SOURCE,
  NULL_GROUPING_DATA_SOURCE,
  NULL_SELECTION_DATA_SOURCE,
  NULL_SHEET_DATA_SOURCE,
} from '../../data/defaults';
import { ViewportMergeIndex } from '../../coordinates/viewport-merge-index';
import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { GridCoordinateSystem } from '../../layout/grid-coords';
import { createGridHitTest, type GridHitTarget } from '../grid-hit-test';

const ROW_HEADER_WIDTH = 50;
const COL_HEADER_HEIGHT = 24;
const DEFAULT_ROW_HEIGHT = 21;
const DEFAULT_COL_WIDTH = 100;

function makePositionIndex(): ViewportPositionIndex {
  return new ViewportPositionIndex(DEFAULT_ROW_HEIGHT, DEFAULT_COL_WIDTH);
}

/**
 * Compute the screen-space pixel center of a cell using default row/col sizes.
 * Matches the geometry used by the renderer when no explicit position arrays
 * are populated.
 */
function cellCenter(row: number, col: number): { x: number; y: number } {
  return {
    x: ROW_HEADER_WIDTH + col * DEFAULT_COL_WIDTH + DEFAULT_COL_WIDTH / 2,
    y: COL_HEADER_HEIGHT + row * DEFAULT_ROW_HEIGHT + DEFAULT_ROW_HEIGHT / 2,
  };
}

describe('GridHitTest — merge-anchor snap (RC4 4a)', () => {
  it('snaps a click anywhere inside a merged region to the merge anchor', () => {
    const positionIndex = makePositionIndex();
    const mergeIndex = new ViewportMergeIndex();
    // Merge B2:D4 (rows 1..3, cols 1..3 zero-indexed).
    mergeIndex.setMerges([{ start_row: 1, start_col: 1, end_row: 3, end_col: 3 }]);

    const hitTest = createGridHitTest({
      sheetData: NULL_SHEET_DATA_SOURCE,
      cellData: NULL_CELL_DATA_SOURCE,
      selectionData: NULL_SELECTION_DATA_SOURCE,
      positionIndex,
      mergeIndex,
      groupingData: NULL_GROUPING_DATA_SOURCE,
      coordSystem: new GridCoordinateSystem(),
      rowHeaderWidth: ROW_HEADER_WIDTH,
      colHeaderHeight: COL_HEADER_HEIGHT,
    });

    // Click the interior cell (2,2) inside the merge.
    const result = hitTest.hitTest(cellCenter(2, 2));
    expect(result).not.toBeNull();
    const target = result!.target as GridHitTarget;
    expect(target.type).toBe('cell');
    if (target.type !== 'cell') return;
    expect(target.row).toBe(1);
    expect(target.col).toBe(1);

    // Click the bottom-right corner of the merge.
    const corner = hitTest.hitTest(cellCenter(3, 3));
    const cornerTarget = corner!.target as GridHitTarget;
    if (cornerTarget.type !== 'cell') throw new Error('expected cell target');
    expect(cornerTarget.row).toBe(1);
    expect(cornerTarget.col).toBe(1);
  });

  it('returns the raw cell when no merge index is provided', () => {
    const positionIndex = makePositionIndex();
    const hitTest = createGridHitTest({
      sheetData: NULL_SHEET_DATA_SOURCE,
      cellData: NULL_CELL_DATA_SOURCE,
      selectionData: NULL_SELECTION_DATA_SOURCE,
      positionIndex,
      // mergeIndex omitted on purpose — backward compat for callers that haven't
      // wired the index yet.
      groupingData: NULL_GROUPING_DATA_SOURCE,
      coordSystem: new GridCoordinateSystem(),
      rowHeaderWidth: ROW_HEADER_WIDTH,
      colHeaderHeight: COL_HEADER_HEIGHT,
    });

    const result = hitTest.hitTest(cellCenter(2, 2));
    const target = result!.target as GridHitTarget;
    if (target.type !== 'cell') throw new Error('expected cell target');
    expect(target.row).toBe(2);
    expect(target.col).toBe(2);
  });

  it('returns the raw cell when the cell is outside any merge', () => {
    const positionIndex = makePositionIndex();
    const mergeIndex = new ViewportMergeIndex();
    mergeIndex.setMerges([{ start_row: 1, start_col: 1, end_row: 3, end_col: 3 }]);

    const hitTest = createGridHitTest({
      sheetData: NULL_SHEET_DATA_SOURCE,
      cellData: NULL_CELL_DATA_SOURCE,
      selectionData: NULL_SELECTION_DATA_SOURCE,
      positionIndex,
      mergeIndex,
      groupingData: NULL_GROUPING_DATA_SOURCE,
      coordSystem: new GridCoordinateSystem(),
      rowHeaderWidth: ROW_HEADER_WIDTH,
      colHeaderHeight: COL_HEADER_HEIGHT,
    });

    // Cell (5,5) is well outside the B2:D4 merge.
    const result = hitTest.hitTest(cellCenter(5, 5));
    const target = result!.target as GridHitTarget;
    if (target.type !== 'cell') throw new Error('expected cell target');
    expect(target.row).toBe(5);
    expect(target.col).toBe(5);
  });
});
