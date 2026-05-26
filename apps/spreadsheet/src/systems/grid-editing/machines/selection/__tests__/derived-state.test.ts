import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { clearDerivedSelectionCache, computeDerivedSelectionState } from '../derived-state';

describe('computeDerivedSelectionState', () => {
  beforeEach(() => {
    clearDerivedSelectionCache();
  });

  it('treats select-all as both full-row and full-column without materializing the sheet', () => {
    const derived = computeDerivedSelectionState([
      {
        startRow: 0,
        startCol: 0,
        endRow: MAX_ROWS - 1,
        endCol: MAX_COLS - 1,
        isFullRow: true,
        isFullColumn: true,
      },
    ]);

    expect(derived.hasFullRowSelection).toBe(true);
    expect(derived.hasFullColumnSelection).toBe(true);
    expect(derived.selectedRows.size).toBe(0);
    expect(derived.selectedCols.size).toBe(0);
    expect(derived.fullySelectedRows.size).toBe(0);
    expect(derived.fullySelectedCols.size).toBe(0);
  });

  it('keeps small full-row and full-column selections addressable', () => {
    const rows = computeDerivedSelectionState([
      { startRow: 2, startCol: 0, endRow: 4, endCol: MAX_COLS - 1, isFullRow: true },
    ]);

    expect(rows.hasFullRowSelection).toBe(true);
    expect([...rows.fullySelectedRows]).toEqual([2, 3, 4]);
    expect(rows.selectedCols.size).toBe(0);

    clearDerivedSelectionCache();

    const cols = computeDerivedSelectionState([
      { startRow: 0, startCol: 1, endRow: MAX_ROWS - 1, endCol: 3, isFullColumn: true },
    ]);

    expect(cols.hasFullColumnSelection).toBe(true);
    expect([...cols.fullySelectedCols]).toEqual([1, 2, 3]);
    expect(cols.selectedRows.size).toBe(0);
  });

  it('does not materialize very large full-axis spans', () => {
    const derived = computeDerivedSelectionState([
      { startRow: 0, startCol: 0, endRow: 50_000, endCol: MAX_COLS - 1, isFullRow: true },
    ]);

    expect(derived.hasFullRowSelection).toBe(true);
    expect(derived.selectedRows.size).toBe(0);
    expect(derived.fullySelectedRows.size).toBe(0);
  });
});
