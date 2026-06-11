import { resolvePageScrollPosition } from '../page-scroll';

function makeDimensions(options: { colWidth?: number; rowHeight?: number } = {}) {
  const colWidth = options.colWidth ?? 69;
  const rowHeight = options.rowHeight ?? 20;
  return {
    totalRows: 1_000,
    totalCols: 1_000,
    getRowTop: (row: number) => row * rowHeight,
    getColLeft: (col: number) => col * colWidth,
  };
}

describe('resolvePageScrollPosition', () => {
  it('keeps single-viewport horizontal page scroll behavior unchanged', () => {
    const next = resolvePageScrollPosition({
      axis: 'horizontal',
      direction: 'next',
      visibleRange: { startRow: 0, startCol: 9, endRow: 36, endCol: 37 },
      dimensions: makeDimensions(),
      current: { x: 621, y: 0 },
      layout: {
        viewports: [
          {
            id: 'main',
            viewportOrigin: { x: 0, y: 0 },
          },
        ],
        primaryViewportId: 'main',
      } as any,
    });

    expect(next).toEqual({ x: 38 * 69, y: 0 });
  });

  it('subtracts frozen viewport origin from horizontal page scroll targets', () => {
    const next = resolvePageScrollPosition({
      axis: 'horizontal',
      direction: 'next',
      visibleRange: { startRow: 451, startCol: 9, endRow: 487, endCol: 37 },
      dimensions: makeDimensions(),
      current: { x: 621, y: 6270 },
      layout: {
        viewports: [
          {
            id: 'main',
            viewportOrigin: { x: 207, y: 60 },
          },
        ],
        primaryViewportId: 'main',
      } as any,
    });

    expect(next).toEqual({ x: 38 * 69 - 207, y: 6270 });
  });

  it('subtracts frozen viewport origin from vertical page scroll targets', () => {
    const next = resolvePageScrollPosition({
      axis: 'vertical',
      direction: 'previous',
      visibleRange: { startRow: 451, startCol: 9, endRow: 487, endCol: 37 },
      dimensions: makeDimensions(),
      current: { x: 621, y: 6270 },
      layout: {
        viewports: [
          {
            id: 'main',
            viewportOrigin: { x: 207, y: 60 },
          },
        ],
        primaryViewportId: 'main',
      } as any,
    });

    expect(next).toEqual({ x: 621, y: (451 - 37) * 20 - 60 });
  });
});
