import { configToSpec } from '../config-to-spec';
import { compile } from '../../grammar/compiler';
import type { ChartConfig, ChartData } from '../../types';
import type { LayerSpec, UnitSpec } from '../../grammar/spec';

const data: ChartData = {
  categories: ['A', 'B'],
  series: [
    {
      name: 'Revenue',
      data: [
        { x: 'A', y: 1 },
        { x: 'B', y: 2 },
      ],
    },
  ],
};

function config(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: 'bar',
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 10,
    dataRange: 'A1:B3',
    workbookTheme: {
      colors: [{ name: 'accent1', color: '#123456' }],
      colorScheme: {
        accent1: { type: 'SrgbClr', val: '123456', transforms: [] },
      },
    },
    ...overrides,
  };
}

describe('configToSpec style resolver integration', () => {
  it('keeps theme references unresolved until frame paint resolution in charts-core', () => {
    const spec = configToSpec(
      config({
        roundedCorners: true,
        chartFormat: {
          fill: { type: 'solid', color: { theme: 'accent1' } },
          line: { color: { theme: 'accent1' }, width: 2 },
        },
      }),
      data,
    ) as UnitSpec;

    expect(spec.config?.chartFrame).toMatchObject({
      fill: { type: 'solid', color: '#123456' },
      line: { paint: { type: 'solid', color: '#123456' } },
      cornerRadius: 12,
    });
    expect(spec.config?.background).toBe('#123456');
  });

  it('renders plot-area gradient frames before data marks', () => {
    const spec = configToSpec(
      config({
        plotFormat: {
          fill: {
            type: 'gradient',
            gradientType: 'linear',
            angle: 90,
            stops: [
              { position: 0, color: { theme: 'accent1' } },
              { position: 1, color: '#FFFFFF' },
            ],
          },
        },
      }),
      data,
    ) as UnitSpec | LayerSpec;

    const result = compile(spec);
    expect(result.background?.[0]?.style.fillPaint).toEqual({
      type: 'linearGradient',
      angle: 90,
      stops: [
        { offset: 0, color: '#123456', opacity: undefined },
        { offset: 1, color: '#FFFFFF', opacity: undefined },
      ],
    });
  });
});
