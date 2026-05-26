/**
 * Tests for GridCoordinateSystem.
 *
 * Extracted from the orphan compute-layout.test.ts when computeGridLayout
 * was deleted. GridCoordinateSystem is independent of any
 * layout-pipeline implementation; these tests cover cellToDocument /
 * documentToCell with custom row heights and column widths.
 *
 * @module grid-renderer/layout/__tests__/grid-coords.test
 */

import { ViewportPositionIndex } from '../../coordinates/viewport-position-index';
import { GridCoordinateSystem } from '../grid-coords';

function createTestPositionIndex(opts?: {
  defaultRowHeight?: number;
  defaultColWidth?: number;
  totalRows?: number;
  totalCols?: number;
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
    rowPositions[i] = y;
    y += opts?.customRowHeights?.get(i) ?? defaultRowHeight;
  }

  const colPositions = new Float64Array(numCols);
  let x = 0;
  for (let i = 0; i < numCols; i++) {
    colPositions[i] = x;
    x += opts?.customColWidths?.get(i) ?? defaultColWidth;
  }

  pi.setPositions(rowPositions, colPositions, 0, 0);
  pi.setTotalDimensions(totalRows, totalCols);

  return pi;
}

describe('GridCoordinateSystem', () => {
  const coords = new GridCoordinateSystem();

  it('should convert cell to document coordinates', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });

    const rect = coords.cellToDocument(3, 2, pi);
    expect(rect.x).toBe(200);
    expect(rect.y).toBe(75);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(25);
  });

  it('should convert document position to cell', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });

    const cell = coords.documentToCell(250, 80, pi);
    expect(cell.row).toBe(3);
    expect(cell.col).toBe(2);
  });

  it('should handle origin (0,0) document position', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });

    const cell = coords.documentToCell(0, 0, pi);
    expect(cell.row).toBe(0);
    expect(cell.col).toBe(0);
  });

  it('should handle negative document positions by returning 0', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });

    const cell = coords.documentToCell(-10, -10, pi);
    expect(cell.row).toBe(0);
    expect(cell.col).toBe(0);
  });

  it('should convert cell at origin to document space', () => {
    const pi = createTestPositionIndex({ totalRows: 100, totalCols: 26 });

    const rect = coords.cellToDocument(0, 0, pi);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(25);
  });

  it('should handle custom row heights in cellToDocument', () => {
    const pi = createTestPositionIndex({
      totalRows: 100,
      totalCols: 26,
      customRowHeights: new Map([
        [0, 50],
        [1, 30],
      ]),
    });

    const rect = coords.cellToDocument(2, 0, pi);
    expect(rect.y).toBe(80);
    expect(rect.height).toBe(25);
  });

  it('should handle custom col widths in documentToCell', () => {
    const pi = createTestPositionIndex({
      totalRows: 100,
      totalCols: 26,
      customColWidths: new Map([[0, 200]]),
    });

    const cell = coords.documentToCell(150, 0, pi);
    expect(cell.col).toBe(0);

    const cell2 = coords.documentToCell(250, 0, pi);
    expect(cell2.col).toBe(1);
  });
});
