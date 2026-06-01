import {
  resolveChartOwnerFormat,
  resolveChartColor,
  resolveChartColorDetailed,
  resolveChartFillPaint,
} from '../index';
import type { ChartConfig } from '../../../types';
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

  it('merges owner style context with direct ergonomic format by property', () => {
    const config = {
      type: 'bar',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 8,
      dataRange: 'A1:B2',
      chartStyleContext: {
        owners: [
          {
            ownerKey: 'title',
            format: {
              font: {
                color: { theme: 'accent1' },
                size: 12,
              },
              line: {
                color: '#111111',
                width: 1,
              },
            },
          },
        ],
      },
    } satisfies ChartConfig;

    expect(
      resolveChartOwnerFormat(config, 'title', {
        font: { size: 18, bold: true },
        line: { width: 3 },
      }),
    ).toEqual({
      font: {
        color: { theme: 'accent1' },
        size: 18,
        bold: true,
      },
      line: {
        color: '#111111',
        width: 3,
      },
      fill: undefined,
      shadow: undefined,
      textRotation: undefined,
      textVerticalType: undefined,
    });
  });
});
