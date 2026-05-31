import * as chartsRoot from '@mog/charts';
import {
  DEFAULT_CHART_COLORS,
  getDefaultColor as getDefaultColorFromRoot,
  lightenColor as lightenColorFromRoot,
  type ChartConfig,
} from '@mog/charts';
import * as chartUtils from '@mog/charts/utils';
import {
  DEFAULT_CATEGORY_COLORS,
  applyChartTintShade,
  applyWorkbookThemePalette,
  chartStyleRepeatThemeColor,
  createChartWorkbookThemeColorPalette,
  normalizeChartHexColor,
  resolveChartColor,
  resolveChartTextColor,
  type ChartThemeColorReference,
  type ChartWorkbookThemeColorPalette,
} from '@mog/charts/utils';

describe('@mog/charts package exports', () => {
  it('keeps existing root color helpers available from the package root', () => {
    const config: ChartConfig = { type: 'bar' };

    expect(config.type).toBe('bar');
    expect(getDefaultColorFromRoot(0)).toBe(DEFAULT_CHART_COLORS[0]);
    expect(getDefaultColorFromRoot(0)).toBe(DEFAULT_CATEGORY_COLORS[0]);
    expect(lightenColorFromRoot('#000000', 100)).toBe('#ffffff');
    expect(chartsRoot).toHaveProperty('getDefaultColor');
  });

  it('exposes chart color and theme utilities from the utilities subpath', () => {
    const palette = createChartWorkbookThemeColorPalette([
      { name: 'accent1', color: '#123456' },
      { name: 'tx1', color: '111111' },
    ]);
    const themeColor: ChartThemeColorReference = { theme: 'accent1', tintShade: 0.5 };
    const workbookPalette: ChartWorkbookThemeColorPalette = palette!;

    expect(normalizeChartHexColor('abc')).toBe('#aabbcc');
    expect(applyWorkbookThemePalette({ color: themeColor }, workbookPalette)).toEqual({
      color: applyChartTintShade('#123456', 0.5),
    });
    expect(chartStyleRepeatThemeColor('accent1', 6)).toBe('#264478');
    expect(chartUtils.getDefaultColor(2)).toBe(DEFAULT_CATEGORY_COLORS[2]);
    expect(resolveChartColor(themeColor, { palette: workbookPalette })).toBe(
      applyChartTintShade('#123456', 0.5),
    );
    expect(resolveChartTextColor({ theme: 'tx1' })).toBe('#595959');
  });

  it('does not widen the root export with utility-only chart theme resolvers', () => {
    expect(chartsRoot).not.toHaveProperty('normalizeChartHexColor');
    expect(chartsRoot).not.toHaveProperty('resolveChartColor');
    expect(chartsRoot).not.toHaveProperty('createChartWorkbookThemeColorPalette');
    expect(chartsRoot).not.toHaveProperty('applyWorkbookThemePalette');
    expect(chartsRoot).not.toHaveProperty('chartStyleRepeatThemeColor');
    expect(chartUtils).toHaveProperty('normalizeChartHexColor');
    expect(chartUtils).toHaveProperty('resolveChartColor');
    expect(chartUtils).toHaveProperty('createChartWorkbookThemeColorPalette');
    expect(chartUtils).toHaveProperty('applyWorkbookThemePalette');
    expect(chartUtils).toHaveProperty('chartStyleRepeatThemeColor');
  });
});
