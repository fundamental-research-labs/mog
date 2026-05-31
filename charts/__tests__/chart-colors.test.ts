import {
  applyChartTintShade,
  applyWorkbookThemePalette,
  chartStyleRepeatThemeColor,
  chartThemeSlotKey,
  createChartWorkbookThemeColorPalette,
  normalizeChartHexColor,
  ooxmlSchemeColorHex,
  resolveChartColor,
  resolveChartTextColor,
} from '../src/utils';

describe('chart OOXML/theme color utilities', () => {
  it('preserves direct color strings while normalizing supported hex forms', () => {
    expect(resolveChartColor('#abc')).toBe('#aabbcc');
    expect(resolveChartColor('#AABBCC')).toBe('#AABBCC');
    expect(resolveChartColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(normalizeChartHexColor('abc', { uppercase: true })).toBe('#AABBCC');
  });

  it('resolves OOXML scheme slots and aliases', () => {
    expect(ooxmlSchemeColorHex('accent1')).toBe('#4472C4');
    expect(ooxmlSchemeColorHex('tx1')).toBe('#000000');
    expect(ooxmlSchemeColorHex('bg1')).toBe('#FFFFFF');
    expect(chartThemeSlotKey('tx1')).toBe('dk1');
    expect(chartThemeSlotKey('bg2')).toBe('lt2');
  });

  it('applies Excel-compatible tint/shade math', () => {
    expect(applyChartTintShade('#4472C4', 0.5)).toBe('#A2B8E2');
    expect(applyChartTintShade('#ED7D31', -0.25)).toBe('#C55A11');
    expect(resolveChartColor({ theme: 'accent1', tintShade: 0.58 })).toBe('#93ADDD');
    expect(resolveChartColor({ theme: 'accent1', tint_shade: 0.86 })).toBe('#5E86CC');
  });

  it('keeps the imported tx1 text special case separate from generic scheme resolution', () => {
    expect(resolveChartTextColor({ theme: 'tx1' })).toBe('#595959');
    expect(resolveChartTextColor({ theme: 'tx1', tintShade: 0.5 })).toBe('#808080');
  });

  it('matches Excel repeated theme colors by source series index', () => {
    expect(chartStyleRepeatThemeColor('accent1', 5)).toBeUndefined();
    expect(chartStyleRepeatThemeColor('accent1', 6)).toBe('#264478');
    expect(chartStyleRepeatThemeColor('accent2', 7)).toBe('#9E480E');
    expect(chartStyleRepeatThemeColor('accent3', 8)).toBe('#636363');
  });

  it('creates workbook palettes and applies them through nested chart config values', () => {
    const palette = createChartWorkbookThemeColorPalette([
      { name: 'accent1', color: '#123456' },
      { name: 'tx1', color: '111111' },
      { name: 'bg1', color: '#fff' },
      { name: 'ignored', color: 'not-a-color' },
    ]);

    expect(palette).toEqual({
      accent1: '#123456',
      dk1: '#111111',
      lt1: '#FFFFFF',
    });
    expect(
      applyWorkbookThemePalette(
        {
          series: [
            {
              format: {
                line: { color: { theme: 'accent1', tint_shade: 0.2 } },
              },
            },
          ],
          titleFormat: {
            font: { color: { theme: 'tx1' } },
          },
          chartFormat: {
            fill: { type: 'solid', color: { theme: 'missing' } },
          },
        },
        palette!,
      ),
    ).toEqual({
      series: [
        {
          format: {
            line: { color: '#205D99' },
          },
        },
      ],
      titleFormat: {
        font: { color: '#111111' },
      },
      chartFormat: {
        fill: { type: 'solid', color: { theme: 'missing' } },
      },
    });
  });
});
