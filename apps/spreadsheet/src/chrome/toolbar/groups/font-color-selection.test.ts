import { getCommonSelectionFontColor, normalizeEffectiveFontColor } from './font-color-selection';

describe('font color selection', () => {
  it('treats missing font color as effective black', () => {
    expect(normalizeEffectiveFontColor(undefined)).toBe('#000000');
    expect(normalizeEffectiveFontColor(null)).toBe('#000000');
  });

  it('returns black for a uniform default-black selection', () => {
    const color = getCommonSelectionFontColor({
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
      activeCellFontColor: undefined,
      getCellFormat: () => undefined,
    });

    expect(color).toBe('#000000');
  });

  it('returns undefined for a mixed black and red selection', () => {
    const color = getCommonSelectionFontColor({
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
      activeCellFontColor: '#000000',
      getCellFormat: (_row, col) => (col === 0 ? undefined : { fontColor: '#FF0000' }),
    });

    expect(color).toBeUndefined();
  });

  it('normalizes equivalent hex values before comparing', () => {
    const color = getCommonSelectionFontColor({
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
      activeCellFontColor: '#000',
      getCellFormat: (_row, col) => (col === 0 ? { fontColor: '#000' } : { fontColor: '#000000' }),
    });

    expect(color).toBe('#000000');
  });

  it('falls back to the active cell color for large selections', () => {
    const color = getCommonSelectionFontColor({
      ranges: [{ startRow: 0, startCol: 0, endRow: 99, endCol: 99 }],
      activeCellFontColor: '#123456',
      getCellFormat: () => {
        throw new Error('large selections should not be scanned cell-by-cell');
      },
      maxCells: 10,
    });

    expect(color).toBe('#123456');
  });
});
