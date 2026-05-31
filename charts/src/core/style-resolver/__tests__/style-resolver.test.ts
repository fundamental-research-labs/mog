import {
  resolveChartColor,
  resolveChartColorDetailed,
  resolveChartFillPaint,
} from '../index';
import type { ChartWorkbookThemeData } from '../../../types';

const theme = {
  colors: [{ name: 'accent1', color: '#4472C4' }],
  colorScheme: {
    accent1: { type: 'SrgbClr', val: '4472C4', transforms: [] },
    accent2: { type: 'SrgbClr', val: '112233', transforms: [] },
  },
} satisfies ChartWorkbookThemeData;

describe('chart style resolver', () => {
  it('applies chart-local color mapping before workbook theme lookup', () => {
    expect(
      resolveChartColor(
        { theme: 'tx1' },
        {
          workbookTheme: theme,
          colorMapOverride: { type: 'override', mapping: { tx1: 'Accent2' } },
        },
      ),
    ).toBe('#112233');
  });

  it('applies DrawingML color transforms and preserves resolved alpha', () => {
    const resolved = resolveChartColorDetailed(
      { theme: 'accent1' },
      {
        workbookTheme: {
          colors: [],
          colorScheme: {
            accent1: {
              type: 'SrgbClr',
              val: '808080',
              transforms: [
                { type: 'LumMod', val: 50000 },
                { type: 'Alpha', val: 25000 },
              ],
            },
          },
        },
      },
    );

    expect(resolved).toEqual({ color: '#404040', opacity: 0.25 });
  });

  it('resolves gradient fills as paint instead of narrowing to a solid string', () => {
    expect(
      resolveChartFillPaint(
        {
          type: 'gradient',
          gradientType: 'linear',
          angle: 45,
          stops: [
            { position: 0, color: { theme: 'accent1' } },
            { position: 1, color: '#ffffff', transparency: 0.5 },
          ],
        },
        { workbookTheme: theme },
      ),
    ).toEqual({
      type: 'linearGradient',
      angle: 45,
      stops: [
        { offset: 0, color: '#4472C4', opacity: undefined },
        { offset: 1, color: '#ffffff', opacity: 0.5 },
      ],
    });
  });
});
