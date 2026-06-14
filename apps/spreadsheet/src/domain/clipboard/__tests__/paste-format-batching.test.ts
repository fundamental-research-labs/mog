import { compactCellFormatUpdates } from '../paste-format-batching';

describe('compactCellFormatUpdates', () => {
  it('compacts a dense pasted column into one range', () => {
    const result = compactCellFormatUpdates(
      Array.from({ length: 5 }, (_, row) => ({
        row,
        col: 2,
        format: { numberFormat: 'General' },
      })),
    );

    expect(result).toEqual([
      {
        format: { numberFormat: 'General' },
        ranges: [{ startRow: 0, endRow: 4, startCol: 2, endCol: 2 }],
      },
    ]);
  });

  it('keeps distinct formats separate and normalizes property order', () => {
    const result = compactCellFormatUpdates([
      { row: 0, col: 0, format: { bold: true, fontSize: 12 } },
      { row: 0, col: 1, format: { fontSize: 12, bold: true } },
      { row: 0, col: 3, format: { italic: true } },
    ]);

    expect(result).toEqual([
      {
        format: { bold: true, fontSize: 12 },
        ranges: [{ startRow: 0, endRow: 0, startCol: 0, endCol: 1 }],
      },
      {
        format: { italic: true },
        ranges: [{ startRow: 0, endRow: 0, startCol: 3, endCol: 3 }],
      },
    ]);
  });
});
