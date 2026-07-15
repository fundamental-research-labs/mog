import { GridRendererImpl } from '../grid-renderer';

function readClippedContent(
  clippedCells: Map<string, string> | null,
  row: number,
  col: number,
): string | null {
  const fake = {
    gridLayers: {
      cells: clippedCells ? { getClippedCells: () => clippedCells } : null,
    },
  };

  return GridRendererImpl.prototype.getClippedCellContent.call(fake as any, row, col);
}

describe('GridRendererImpl.getClippedCellContent', () => {
  it('returns the full source text tracked for an ellipsized cell', () => {
    const clippedCells = new Map([['3,10', 'apr_2026_credits']]);

    expect(readClippedContent(clippedCells, 3, 10)).toBe('apr_2026_credits');
  });

  it('returns null when the cell is not clipped or the cells layer is absent', () => {
    expect(readClippedContent(new Map(), 3, 10)).toBeNull();
    expect(readClippedContent(null, 3, 10)).toBeNull();
  });
});
