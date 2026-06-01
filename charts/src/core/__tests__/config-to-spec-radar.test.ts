import { compile } from '../../grammar/compiler';
import type { UnitSpec } from '../../grammar/spec';
import type { PathMark, SymbolMark, TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';

function radarConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: 'radar',
    anchorRow: 0,
    anchorCol: 0,
    width: 7,
    height: 5,
    ...overrides,
  };
}

function radarData(): ChartData {
  return {
    categories: ['Speed', 'Quality', 'Cost', 'Support', 'Security', 'Scale'],
    series: [
      {
        name: 'Mog',
        data: [
          { x: 'Speed', y: 9 },
          { x: 'Quality', y: 8 },
          { x: 'Cost', y: 6 },
          { x: 'Support', y: 7 },
          { x: 'Security', y: 9 },
          { x: 'Scale', y: 8 },
        ],
      },
      {
        name: 'Excel',
        data: [
          { x: 'Speed', y: 7 },
          { x: 'Quality', y: 9 },
          { x: 'Cost', y: 8 },
          { x: 'Support', y: 6 },
          { x: 'Security', y: 7 },
          { x: 'Scale', y: 7 },
        ],
      },
    ],
  };
}

function compileRadar(config: ChartConfig = radarConfig(), data: ChartData = radarData()) {
  return compile(configToSpec(config, data), undefined, {
    width: 560,
    height: 400,
    skipAxes: true,
    skipLegend: true,
    skipTitle: true,
  });
}

function seriesPathMarks(marks: ReturnType<typeof compileRadar>['marks']): PathMark[] {
  return marks.filter(
    (mark): mark is PathMark => mark.type === 'path' && Array.isArray(mark.datum),
  );
}

describe('configToSpec radar charts', () => {
  it('compiles radar charts into polar series polygons instead of Cartesian lines', () => {
    const spec = configToSpec(radarConfig(), radarData()) as UnitSpec;

    expect(typeof spec.mark).toBe('object');
    expect(typeof spec.mark === 'object' ? spec.mark.type : spec.mark).toBe('radar');
    expect(spec.encoding.x?.axis).toBeNull();
    expect(spec.encoding.y?.axis).toBeNull();

    const result = compileRadar();
    const seriesPaths = seriesPathMarks(result.marks);

    expect(seriesPaths).toHaveLength(2);
    for (const mark of seriesPaths) {
      expect(mark.path.endsWith(' Z')).toBe(true);
      const yValues = [...mark.path.matchAll(/,(-?\d+(?:\.\d+)?)/g)].map((match) =>
        Number(match[1]),
      );
      expect(new Set(yValues.map((value) => Math.round(value))).size).toBeGreaterThan(2);
    }
  });

  it('renders marker and filled radar variants from subtype/config flags', () => {
    const markerResult = compileRadar(radarConfig({ subType: 'markers' }));
    const markerMarks = markerResult.marks.filter(
      (mark): mark is SymbolMark => mark.type === 'symbol',
    );
    expect(markerMarks).toHaveLength(12);

    const filledResult = compileRadar(radarConfig({ subType: 'filled' }));
    const filledSeries = seriesPathMarks(filledResult.marks);
    expect(filledSeries).toHaveLength(2);
    expect(filledSeries.every((mark) => typeof mark.style.fill === 'string')).toBe(true);
  });

  it('uses Excel-like chart background and value-axis formatting for radar charts', () => {
    const config = radarConfig({
      axis: {
        valueAxis: {
          visible: true,
          numberFormat: '0.0%',
        },
      },
    });
    const data: ChartData = {
      categories: ['Speed', 'Quality', 'Cost', 'Support'],
      series: [
        {
          name: 'Mog',
          data: [
            { x: 'Speed', y: 0.9 },
            { x: 'Quality', y: 0.8 },
            { x: 'Cost', y: 0.7 },
            { x: 'Support', y: 0.6 },
          ],
        },
      ],
    };

    const spec = configToSpec(config, data) as UnitSpec;
    expect(spec.config?.background).toBe('#ffffff');
    expect(spec.config?.chartFrame?.fill).toEqual({ type: 'solid', color: '#ffffff' });
    expect(spec.encoding.y?.format).toBe('0.0%');

    const result = compileRadar(config, data);
    expect(result.background?.[0]?.style.fill).toBe('#ffffff');

    const valueLabels = result.marks.filter(
      (mark): mark is TextMark =>
        mark.type === 'text' &&
        typeof mark.datum === 'object' &&
        mark.datum !== null &&
        (mark.datum as { role?: string }).role === 'radar-value-label',
    );
    expect(valueLabels.map((mark) => mark.text)).toContain('80.0%');
  });
});
