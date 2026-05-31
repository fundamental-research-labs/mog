import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import {
  applyWorkbookThemeColors,
  loadWorkbookTheme,
  loadWorkbookThemeColorPalette,
} from '../bridge/theme-colors';

describe('theme color bridge helpers', () => {
  it('loads a normalized workbook theme palette from the bridge', async () => {
    const palette = await loadWorkbookThemeColorPalette({
      getWorkbookTheme: async () =>
        ({
          colors: [
            { name: 'accent2', color: 'c0504d' },
            { name: 'tx1', color: '#101112' },
            { name: 'ignored', color: 'not-a-color' },
          ],
        }) as any,
    });

    expect(palette).toEqual({
      accent2: '#C0504D',
      dk1: '#101112',
    });
  });

  it('treats missing or failing theme bridges as no palette', async () => {
    await expect(loadWorkbookThemeColorPalette(undefined)).resolves.toBeNull();
    await expect(
      loadWorkbookThemeColorPalette({
        getWorkbookTheme: async () => {
          throw new Error('theme unavailable');
        },
      }),
    ).resolves.toBeNull();
  });

  it('loads full workbook theme context from the bridge', async () => {
    const theme = await loadWorkbookTheme({
      getWorkbookTheme: async () =>
        ({
          name: 'Office Theme',
          colors: [{ name: 'accent1', color: '123456' }],
          colorScheme: { accent1: { type: 'SrgbClr', val: '123456', transforms: [] } },
        }) as any,
    });

    expect(theme).toMatchObject({
      name: 'Office Theme',
      colors: [{ name: 'accent1', color: '123456' }],
      colorScheme: { accent1: { type: 'SrgbClr', val: '123456', transforms: [] } },
    });
  });

  it('attaches workbook theme context without mutating theme references', async () => {
    const config = {
      type: 'line',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 8,
      dataRange: '',
      series: [
        {
          name: 'Revenue',
          values: 'Sheet1!A1:B1',
          format: { line: { color: { theme: 'accent1' }, width: 2 } },
        },
      ],
    } as ChartConfig;

    const workbookTheme = {
      colors: [{ name: 'accent1', color: '#123456' }],
      colorScheme: { accent1: { type: 'SrgbClr', val: '123456', transforms: [] } },
    };
    const themed = await applyWorkbookThemeColors(config, async () => workbookTheme);

    expect(themed.series?.[0]?.format?.line?.color).toEqual({ theme: 'accent1' });
    expect(themed.workbookTheme).toBe(workbookTheme);
    expect(config.series?.[0]?.format?.line?.color).toEqual({ theme: 'accent1' });
  });

  it('returns the original config when no palette is available', async () => {
    const config = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 8,
      dataRange: 'A1:B2',
    } as ChartConfig;

    await expect(applyWorkbookThemeColors(config, async () => null)).resolves.toBe(config);
  });
});
