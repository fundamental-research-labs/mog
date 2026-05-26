import {
  buildAboveContext,
  buildLeftContext,
  getAboveContextBounds,
  getLeftContextBounds,
} from '../internal/range-context';
import type { ContextCellData } from '../internal/range-context';

// =============================================================================
// getLeftContextBounds
// =============================================================================

describe('getLeftContextBounds', () => {
  it('returns null when startCol is 0', () => {
    expect(getLeftContextBounds(5, 0, 10)).toBeNull();
  });

  it('returns bounds clamped to column 0', () => {
    const bounds = getLeftContextBounds(0, 3, 5);
    expect(bounds).toEqual({ startRow: 0, startCol: 0, endRow: 5, endCol: 2 });
  });

  it('limits scan depth to 20 columns', () => {
    const bounds = getLeftContextBounds(0, 30, 5);
    expect(bounds).toEqual({ startRow: 0, startCol: 10, endRow: 5, endCol: 29 });
  });
});

// =============================================================================
// buildLeftContext
// =============================================================================

describe('buildLeftContext', () => {
  it('returns null when startCol is 0', () => {
    expect(buildLeftContext([], 0, 0, 5)).toBeNull();
  });

  it('returns null when no textual cells found', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 123, formatted: '123' },
      { row: 1, col: 0, value: 456, formatted: '456' },
    ];
    expect(buildLeftContext(cells, 0, 1, 1)).toBeNull();
  });

  it('finds textual labels to the left', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'Revenue', formatted: 'Revenue' },
      { row: 1, col: 0, value: 'Expenses', formatted: 'Expenses' },
    ];
    const result = buildLeftContext(cells, 0, 1, 1);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]).toBe('A1:Revenue');
    expect(result![1]).toBe('A2:Expenses');
  });

  it('skips numeric cells', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 1, value: 999, formatted: '999' },
      { row: 0, col: 0, value: 'Label', formatted: 'Label' },
    ];
    const result = buildLeftContext(cells, 0, 2, 0);
    expect(result).not.toBeNull();
    expect(result![0]).toBe('A1:Label');
  });

  it('collects up to 2 labels per row', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 2, value: 'C', formatted: 'C' },
      { row: 0, col: 1, value: 'B', formatted: 'B' },
      { row: 0, col: 0, value: 'A', formatted: 'A' },
    ];
    // Range starts at col 3, so cols 0-2 are left context
    const result = buildLeftContext(cells, 0, 3, 0);
    expect(result).not.toBeNull();
    // Should pick the 2 closest: col 2 and col 1, rendered left-to-right
    expect(result![0]).toBe('B1:B | C1:C');
  });

  it('outputs empty string for rows with no labels', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'Header', formatted: 'Header' },
      // row 1 has nothing
    ];
    const result = buildLeftContext(cells, 0, 1, 1);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0]).toBe('A1:Header');
    expect(result![1]).toBe('');
  });

  it('prepends indent arrows', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'Sub-item', formatted: 'Sub-item', indent: 2 },
    ];
    const result = buildLeftContext(cells, 0, 1, 0);
    expect(result).not.toBeNull();
    expect(result![0]).toBe('\u2192\u2192A1:Sub-item');
  });
});

// =============================================================================
// getAboveContextBounds
// =============================================================================

describe('getAboveContextBounds', () => {
  it('returns null when startRow is 0', () => {
    expect(getAboveContextBounds(0, 0, 5)).toBeNull();
  });

  it('returns bounds clamped to row 0', () => {
    const bounds = getAboveContextBounds(3, 0, 5);
    expect(bounds).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 5 });
  });

  it('limits scan depth to 20 rows', () => {
    const bounds = getAboveContextBounds(30, 0, 5);
    expect(bounds).toEqual({ startRow: 10, startCol: 0, endRow: 29, endCol: 5 });
  });
});

// =============================================================================
// buildAboveContext
// =============================================================================

describe('buildAboveContext', () => {
  it('returns null when startRow is 0', () => {
    expect(buildAboveContext([], 0, 0, 5)).toBeNull();
  });

  it('returns null when no textual cells above', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 100, formatted: '100' },
      { row: 0, col: 1, value: 200, formatted: '200' },
    ];
    expect(buildAboveContext(cells, 1, 0, 1)).toBeNull();
  });

  it('finds header row and builds chain', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'Name', formatted: 'Name' },
      { row: 0, col: 1, value: 'Score', formatted: 'Score' },
      { row: 0, col: 2, value: 'Grade', formatted: 'Grade' },
    ];
    const result = buildAboveContext(cells, 1, 0, 2);
    expect(result).toBe('A1:Name | B1:Score | C1:Grade');
  });

  it('inserts ... for numeric gaps', () => {
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'Name', formatted: 'Name' },
      { row: 0, col: 1, value: 2024, formatted: '2024' },
      { row: 0, col: 2, value: 'Total', formatted: 'Total' },
    ];
    const result = buildAboveContext(cells, 1, 0, 2);
    expect(result).toBe('A1:Name | ... | C1:Total');
  });

  it('picks the row with the most votes', () => {
    // Row 0 has headers for cols 0-2
    // Row 1 has a header only for col 2
    // Range starts at row 2, cols 0-2
    const cells: ContextCellData[] = [
      { row: 0, col: 0, value: 'A', formatted: 'A' },
      { row: 0, col: 1, value: 'B', formatted: 'B' },
      { row: 0, col: 2, value: 'C', formatted: 'C' },
      { row: 1, col: 2, value: 'X', formatted: 'X' },
    ];
    const result = buildAboveContext(cells, 2, 0, 2);
    // Row 1 is closer but only has 1 vote; row 0 should win with 2+ votes
    // (voting uses rightmost 30% of columns, which for 3 cols = 1 col = col 2)
    // Col 2 scan upward: finds row 1 first → row 1 gets 1 vote
    // But row 0 also has textual cells; since voting only uses rightmost cols,
    // and col 2 finds row 1 first, row 1 wins with 1 vote
    // Actually with 3 cols, 30% = 0.9, rounded to 1, so only col 2 votes
    expect(result).not.toBeNull();
    expect(result).toContain('X');
  });

  it('uses wider voting with more columns', () => {
    // 10 columns → 30% = 3 voting columns (cols 7, 8, 9)
    const cells: ContextCellData[] = [];
    // Row 0: headers in all 10 cols
    for (let c = 0; c < 10; c++) {
      cells.push({ row: 0, col: c, value: `H${c}`, formatted: `H${c}` });
    }
    // Row 1: header only in col 9
    cells.push({ row: 1, col: 9, value: 'X', formatted: 'X' });

    const result = buildAboveContext(cells, 2, 0, 9);
    // Cols 7,8,9 vote: col 9 finds row 1, cols 7,8 find row 0
    // Row 0 gets 2 votes, row 1 gets 1 → row 0 wins
    expect(result).not.toBeNull();
    expect(result).toContain('H0');
    expect(result).toContain('H9');
  });
});
