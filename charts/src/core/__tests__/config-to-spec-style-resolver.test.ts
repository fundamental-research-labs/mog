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

  it('uses owner style context when ergonomic chart fields are absent', () => {
    const spec = configToSpec(
      config({
        title: 'Owner styled',
        series: [{}],
        chartStyleContext: {
          owners: [
            {
              ownerKey: 'chartArea',
              format: {
                fill: { type: 'solid', color: { theme: 'accent1' } },
                line: { color: '#111111', width: 1 },
              },
            },
            {
              ownerKey: 'plotArea',
              format: {
                fill: {
                  type: 'gradient',
                  gradientType: 'linear',
                  angle: 45,
                  stops: [
                    { position: 0, color: '#000000' },
                    { position: 1, color: '#FFFFFF' },
                  ],
                },
              },
            },
            {
              ownerKey: 'title',
              format: {
                font: { color: { theme: 'accent1' }, size: 16, bold: true },
              },
              richText: [{ text: 'Owner styled', font: { italic: true } }],
            },
            {
              ownerKey: 'series(0)',
              format: {
                fill: { type: 'solid', color: '#00AA00' },
              },
            },
          ],
        },
      }),
      data,
    ) as UnitSpec;

    expect(spec.config?.chartFrame).toMatchObject({
      fill: { type: 'solid', color: '#123456' },
      line: { paint: { type: 'solid', color: '#111111' } },
    });
    expect(spec.config?.plotFrame?.fill).toEqual({
      type: 'linearGradient',
      angle: 45,
      stops: [
        { offset: 0, color: '#000000', opacity: undefined },
        { offset: 1, color: '#FFFFFF', opacity: undefined },
      ],
    });
    expect(spec.title).toMatchObject({
      text: 'Owner styled',
      color: '#123456',
      fontSize: 64 / 3,
      fontWeight: 'bold',
      richText: [expect.objectContaining({ text: 'Owner styled', fontStyle: 'italic' })],
    });
    expect(spec.config?.range?.category).toEqual(['#00AA00']);
  });

  it('lets direct ergonomic fields override owner style properties without dropping owner siblings', () => {
    const spec = configToSpec(
      config({
        chartFormat: {
          line: { width: 4 },
        },
        chartStyleContext: {
          owners: [
            {
              ownerKey: 'chartArea',
              format: {
                fill: { type: 'solid', color: '#EEEEEE' },
                line: { color: '#111111', width: 1 },
              },
            },
          ],
        },
      }),
      data,
    ) as UnitSpec;

    expect(spec.config?.chartFrame).toMatchObject({
      fill: { type: 'solid', color: '#EEEEEE' },
      line: {
        paint: { type: 'solid', color: '#111111' },
        width: 16 / 3,
      },
    });
  });
});
