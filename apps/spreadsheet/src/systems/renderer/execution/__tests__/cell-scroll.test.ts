import type { ISheetViewGeometry } from '@mog-sdk/sheet-view';

import { resolveCellLevelScrollPosition } from '../cell-scroll';

function createGeometry(
  overrides: Partial<Pick<ISheetViewGeometry, 'getDimensions'>> = {},
): Pick<ISheetViewGeometry, 'getDimensions'> {
  return {
    getDimensions(anchor) {
      const row = 'row' in anchor ? anchor.row : anchor.startRow;
      const col = 'col' in anchor ? anchor.col : anchor.startCol;
      return [
        {
          row,
          top: row * 20,
          height: 20,
          hidden: false,
        },
        {
          col,
          left: col * 80,
          width: 80,
          hidden: false,
        },
      ];
    },
    ...overrides,
  };
}

describe('resolveCellLevelScrollPosition', () => {
  it('uses direct cell positions when panes are not frozen', () => {
    const position = resolveCellLevelScrollPosition({
      geometry: createGeometry(),
      topRow: 10,
      leftCol: 3,
      frozenPanes: { rows: 0, cols: 0 },
    });

    expect(position).toEqual({ x: 240, y: 200 });
  });

  it('subtracts frozen row and column boundaries', () => {
    const position = resolveCellLevelScrollPosition({
      geometry: createGeometry(),
      topRow: 10,
      leftCol: 3,
      frozenPanes: { rows: 2, cols: 1 },
    });

    expect(position).toEqual({ x: 160, y: 160 });
  });

  it('uses the viewport frozen pane state when no explicit panes are provided', () => {
    const position = resolveCellLevelScrollPosition({
      geometry: createGeometry(),
      viewport: {
        getFrozenPanes: () => ({ rows: 2, cols: 1 }),
      },
      topRow: 5,
      leftCol: 4,
    });

    expect(position).toEqual({ x: 240, y: 60 });
  });

  it('clamps cell positions inside frozen panes to the scroll origin', () => {
    const position = resolveCellLevelScrollPosition({
      geometry: createGeometry(),
      topRow: 1,
      leftCol: 0,
      frozenPanes: { rows: 3, cols: 2 },
    });

    expect(position).toEqual({ x: 0, y: 0 });
  });

  it('returns null when geometry cannot resolve the target cell', () => {
    const position = resolveCellLevelScrollPosition({
      geometry: createGeometry({
        getDimensions(anchor) {
          const row = 'row' in anchor ? anchor.row : anchor.startRow;
          if (row === 7) return [];
          return createGeometry().getDimensions(anchor);
        },
      }),
      topRow: 7,
      leftCol: 3,
      frozenPanes: { rows: 2, cols: 1 },
    });

    expect(position).toBeNull();
  });
});
