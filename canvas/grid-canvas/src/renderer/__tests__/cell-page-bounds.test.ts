import { GridRendererImpl } from '../grid-renderer';

type PageRect = { x: number; y: number; width: number; height: number } | null;

function getCellPageBounds(options: {
  rowTop: number;
  rowHeight?: number;
  colLeft?: number;
  colWidth?: number;
}): PageRect {
  const { rowTop, rowHeight = 17, colLeft = 0, colWidth = 77 } = options;
  const fake = {
    currentSheetId: 'sheet-1',
    viewportLayout: {
      viewports: [
        {
          id: 'main',
          sheetId: 'sheet-1',
          bounds: { x: 10, y: 20, width: 200, height: 100 },
          cellRange: { startRow: 5, startCol: 2, endRow: 5, endCol: 2 },
          viewportOrigin: { x: 0, y: 0 },
          scrollOffset: { x: 0, y: 0 },
          scrollBehavior: { type: 'free' },
          zoom: 1,
          renderConfig: {
            showGridLines: true,
            showHeaders: false,
            backgroundColor: '#ffffff',
            lowFidelity: false,
            opacity: 1,
          },
        },
      ],
    },
    positionIndex: {
      getColLeft: () => colLeft,
      getRowTop: () => rowTop,
      getColWidth: () => colWidth,
      getRowHeight: () => rowHeight,
    },
    container: {
      getBoundingClientRect: () => ({ x: 100, y: 50 }),
    },
    coords: {
      cellToViewport: () => null,
    },
  };

  return (GridRendererImpl.prototype as any).getCellPageBounds.call(fake, 5, 2) as PageRect;
}

describe('GridRendererImpl.getCellPageBounds', () => {
  it('returns null when viewport clipping leaves only a tiny edge strip', () => {
    expect(getCellPageBounds({ rowTop: 98.8 })).toBeNull();
  });

  it('keeps addressable partially visible cells available', () => {
    expect(getCellPageBounds({ rowTop: 95 })).toEqual({
      x: 110,
      y: 165,
      width: 77,
      height: 5,
    });
  });

  it('keeps fully visible small cells available', () => {
    expect(getCellPageBounds({ rowTop: 40, rowHeight: 3 })).toEqual({
      x: 110,
      y: 110,
      width: 77,
      height: 3,
    });
  });
});
