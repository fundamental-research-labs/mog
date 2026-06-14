import type { Viewport, ViewportLayout } from '@mog-sdk/contracts/viewport';

import { getLayoutAwareScrollToCell } from '../viewport-scroll-target';

const renderConfig = {
  showGridLines: true,
  showHeaders: false,
  backgroundColor: '#ffffff',
  lowFidelity: false,
  opacity: 1,
};

function viewport(partial: Partial<Viewport> & Pick<Viewport, 'id' | 'cellRange'>): Viewport {
  return {
    bounds: { x: 0, y: 0, width: 500, height: 300 },
    viewportOrigin: { x: 0, y: 0 },
    scrollOffset: { x: 0, y: 0 },
    scrollBehavior: { type: 'free' },
    zoom: 1,
    renderConfig,
    ...partial,
  };
}

function layout(viewports: Viewport[]): ViewportLayout {
  return {
    viewports,
    primaryViewportId: 'main',
    dividers: [],
    contentSize: { width: 1000, height: 2000 },
    maxScroll: { x: 1000, y: 1000 },
    headerInfo: {
      frozenRows: 4,
      frozenCols: 2,
      frozenRowsHeight: 100,
      frozenColsWidth: 160,
      scrollPosition: { x: 0, y: 80 },
      zoom: 1,
    },
  };
}

const positionIndex = {
  hasData: true,
  getRowTop: (row: number) => row * 25,
  getRowHeight: () => 25,
  getColLeft: (col: number) => col * 80,
  getColWidth: () => 80,
};

describe('getLayoutAwareScrollToCell', () => {
  it('treats renderer page bounds as the authoritative visibility check', () => {
    const getCoordinateScrollTarget = jest.fn(() => ({ top: 100, left: 0 }));

    expect(
      getLayoutAwareScrollToCell({
        sheetId: 'sheet-1',
        cell: { row: 7, col: 0 },
        layout: layout([
          viewport({
            id: 'main',
            cellRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 10 },
          }),
        ]),
        positionIndex,
        frozenPanes: { rows: 4, cols: 2 },
        currentScroll: { x: 0, y: 0 },
        maxScroll: { x: 1000, y: 1000 },
        getCellPageBounds: () => ({ width: 80, height: 25 }),
        getCoordinateScrollTarget,
      }),
    ).toBeNull();
    expect(getCoordinateScrollTarget).not.toHaveBeenCalled();
  });

  it('derives a vertical target from the layout when legacy coordinates return a no-op target', () => {
    const target = getLayoutAwareScrollToCell({
      sheetId: 'sheet-1',
      cell: { row: 16, col: 0 },
      layout: layout([
        viewport({
          id: 'frozen-cols',
          bounds: { x: 0, y: 100, width: 160, height: 200 },
          viewportOrigin: { x: 0, y: 100 },
          scrollOffset: { x: 0, y: 80 },
          scrollBehavior: { type: 'vertical-only' },
          cellRange: { startRow: 8, startCol: 0, endRow: 15, endCol: 1 },
        }),
        viewport({
          id: 'main',
          bounds: { x: 160, y: 100, width: 500, height: 80 },
          viewportOrigin: { x: 160, y: 100 },
          scrollOffset: { x: 0, y: 80 },
          cellRange: { startRow: 8, startCol: 2, endRow: 15, endCol: 10 },
        }),
      ]),
      positionIndex,
      frozenPanes: { rows: 4, cols: 2 },
      currentScroll: { x: 0, y: 80 },
      maxScroll: { x: 1000, y: 1000 },
      getCellPageBounds: () => null,
      getCoordinateScrollTarget: () => ({ left: 0, top: 80 }),
    });

    expect(target).toEqual({ x: 0, y: 145 });
  });

  it('collapses padding when the scrollable row pane is smaller than the target row', () => {
    const tinyPanePositionIndex = {
      hasData: true,
      getRowTop: (row: number) => (row === 7 ? 126.6666666667 : row * 17.3333333333),
      getRowHeight: (row: number) => (row === 7 ? 17.3333333333 : 17.3333333333),
      getColLeft: (col: number) => col * 80,
      getColWidth: () => 80,
    };
    const baseViewport = {
      id: 'frozen-cols',
      bounds: { x: 50, y: 105.3333333333, width: 398, height: 14.6666666667 },
      viewportOrigin: { x: 0, y: 81.3333333333 },
      scrollOffset: { x: 0, y: 68 },
      scrollBehavior: { type: 'vertical-only' as const },
      cellRange: { startRow: 8, startCol: 0, endRow: 9, endCol: 1 },
    };

    const target = getLayoutAwareScrollToCell({
      sheetId: 'sheet-1',
      cell: { row: 7, col: 0 },
      layout: layout([viewport(baseViewport)]),
      positionIndex: tinyPanePositionIndex,
      frozenPanes: { rows: 4, cols: 2 },
      currentScroll: { x: 831, y: 68 },
      maxScroll: { x: 1000, y: 1000 },
      getCellPageBounds: () => null,
      getCoordinateScrollTarget: () => ({ left: 831, top: 68 }),
    });

    expect(target?.x).toBe(831);
    expect(target?.y).toBeCloseTo(45.3333333334);
  });

  it('preserves horizontal scroll when only the target row is outside the viewport', () => {
    const target = getLayoutAwareScrollToCell({
      sheetId: 'sheet-1',
      cell: { row: 466, col: 6 },
      layout: layout([
        viewport({
          id: 'main',
          bounds: { x: 0, y: 0, width: 500, height: 300 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 400, y: 10750 },
          cellRange: { startRow: 430, startCol: 5, endRow: 465, endCol: 33 },
        }),
      ]),
      positionIndex,
      frozenPanes: { rows: 0, cols: 0 },
      currentScroll: { x: 400, y: 10750 },
      maxScroll: { x: 1000, y: 20000 },
      getCellPageBounds: () => null,
      getCoordinateScrollTarget: () => ({ left: 400, top: 10750 }),
    });

    expect(target).toEqual({ x: 400, y: 11395 });
  });
});
