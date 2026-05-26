import { analyzeStylePatterns } from '../internal/style-patterns';
import type { StyleCell } from '../internal/style-patterns';

describe('analyzeStylePatterns', () => {
  it('returns empty array for no cells', () => {
    expect(analyzeStylePatterns([])).toEqual([]);
  });

  it('returns empty array when all cells have no format', () => {
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 'hello', format: undefined },
      { row: 0, col: 1, value: 42, format: undefined },
    ];
    expect(analyzeStylePatterns(cells)).toEqual([]);
  });

  it('returns empty array for null values with no format', () => {
    const cells: StyleCell[] = [{ row: 0, col: 0, value: null, format: undefined }];
    expect(analyzeStylePatterns(cells)).toEqual([]);
  });

  it('groups cells by identical style', () => {
    const boldFormat = { bold: true };
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 'A', format: boldFormat },
      { row: 0, col: 1, value: 'B', format: boldFormat },
      { row: 1, col: 0, value: 'C', format: boldFormat },
    ];
    const lines = analyzeStylePatterns(cells);
    expect(lines.length).toBeGreaterThan(0);
    // Should consolidate A1:B1 + A2 or A1:A2 + B1 etc
    expect(lines[0]).toContain('3 cells');
  });

  it('separates cells with different styles', () => {
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 'A', format: { bold: true } },
      { row: 0, col: 1, value: 'B', format: { italic: true } },
    ];
    const lines = analyzeStylePatterns(cells);
    // Two separate groups → at least 2 range lines
    const rangeLines = lines.filter((l) => l.includes(' cells'));
    expect(rangeLines).toHaveLength(2);
  });

  it('shows style description for non-default styles', () => {
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 10, format: { bold: true, backgroundColor: '#FFFF00' } },
    ];
    const lines = analyzeStylePatterns(cells);
    expect(lines.some((l) => l.includes('\u2192'))).toBe(true);
    expect(lines.some((l) => l.includes('bold'))).toBe(true);
    expect(lines.some((l) => l.includes('bg:#FFFF00'))).toBe(true);
  });

  it('consolidates adjacent cells into ranges', () => {
    const fmt = { bold: true };
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 'a', format: fmt },
      { row: 0, col: 1, value: 'b', format: fmt },
      { row: 0, col: 2, value: 'c', format: fmt },
    ];
    const lines = analyzeStylePatterns(cells);
    expect(lines[0]).toMatch(/A1:C1/);
    expect(lines[0]).toContain('3 cells');
  });

  it('consolidates rectangular blocks', () => {
    const fmt = { italic: true };
    const cells: StyleCell[] = [
      { row: 0, col: 0, value: 1, format: fmt },
      { row: 0, col: 1, value: 2, format: fmt },
      { row: 1, col: 0, value: 3, format: fmt },
      { row: 1, col: 1, value: 4, format: fmt },
    ];
    const lines = analyzeStylePatterns(cells);
    expect(lines[0]).toMatch(/A1:B2/);
    expect(lines[0]).toContain('4 cells');
  });

  it('caps output to 10 style entries', () => {
    // 12 unique styles
    const cells: StyleCell[] = [];
    for (let i = 0; i < 12; i++) {
      cells.push({
        row: i,
        col: 0,
        value: `v${i}`,
        format: { numberFormat: `fmt_${i}` },
      });
    }
    const lines = analyzeStylePatterns(cells);
    const rangeLines = lines.filter((l) => l.includes(' cells'));
    expect(rangeLines.length).toBeLessThanOrEqual(10);
    expect(lines.some((l) => l.includes('... and 2 more style patterns'))).toBe(true);
  });
});
