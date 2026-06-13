import { jest } from '@jest/globals';
import { ViewportPositionIndex } from '@mog/grid-renderer';
import type { ViewportLayout } from '@mog-sdk/contracts/viewport';

import { GridRendererImpl } from '../grid-renderer';

const SHEET_ID = 'sheet-1';

function createPositionIndex(): ViewportPositionIndex {
  const positionIndex = new ViewportPositionIndex(20, 80);
  const rowPositions = new Float64Array(20);
  const colPositions = new Float64Array(20);

  for (let row = 0; row < rowPositions.length; row += 1) {
    rowPositions[row] = row * 20;
  }

  for (let col = 0; col < colPositions.length; col += 1) {
    colPositions[col] = col * 80;
  }

  positionIndex.setPositions(rowPositions, colPositions, 0, 0);
  return positionIndex;
}

function createLayout(): ViewportLayout {
  return {
    viewports: [
      {
        id: 'main',
        sheetId: SHEET_ID,
        bounds: { x: 50, y: 24, width: 240, height: 120 },
        cellRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 3 },
        viewportOrigin: { x: 0, y: 0 },
        scrollOffset: { x: 0, y: 0 },
        scrollBehavior: { type: 'free' },
        zoom: 1,
      },
    ],
    primaryViewportId: 'main',
    dividers: [],
    contentSize: { width: 1600, height: 400 },
    maxScroll: { x: 1360, y: 280 },
    headerInfo: {
      frozenRows: 0,
      frozenCols: 0,
      frozenRowsHeight: 0,
      frozenColsWidth: 0,
      scrollPosition: { x: 0, y: 0 },
      zoom: 1,
    },
  };
}

function createRenderer() {
  const coordinateFallback = jest.fn(() => ({ x: 999, y: 999, width: 80, height: 20 }));
  const fake = {
    currentSheetId: SHEET_ID,
    viewportLayout: createLayout(),
    positionIndex: createPositionIndex(),
    coords: {
      cellToViewport: coordinateFallback,
    },
    container: {
      getBoundingClientRect: () => ({
        x: 10,
        y: 20,
        width: 640,
        height: 360,
        top: 20,
        right: 650,
        bottom: 380,
        left: 10,
      }),
    },
  };

  return {
    coordinateFallback,
    getCellPageBounds: GridRendererImpl.prototype.getCellPageBounds.bind(fake as any) as (
      row: number,
      col: number,
    ) => { x: number; y: number; width: number; height: number } | null,
  };
}

describe('GridRendererImpl.getCellPageBounds', () => {
  it('returns clipped page bounds for a cell in the viewport layout', () => {
    const { coordinateFallback, getCellPageBounds } = createRenderer();

    expect(getCellPageBounds(1, 1)).toEqual({
      x: 140,
      y: 64,
      width: 80,
      height: 20,
    });
    expect(coordinateFallback).not.toHaveBeenCalled();
  });

  it('returns null for a cell outside the viewport layout', () => {
    const { coordinateFallback, getCellPageBounds } = createRenderer();

    expect(getCellPageBounds(7, 1)).toBeNull();
    expect(coordinateFallback).not.toHaveBeenCalled();
  });
});
