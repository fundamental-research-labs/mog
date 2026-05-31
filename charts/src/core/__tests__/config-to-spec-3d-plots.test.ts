import { compile } from '../../grammar/compiler';
import type { AnyMark, PathMark } from '../../primitives/types';
import type { ChartConfig, ChartData, ChartType } from '../../types';
import { configToSpec } from '../config-to-spec';

const COMPILE_OPTIONS = {
  width: 480,
  height: 320,
  skipAxes: true,
  skipLegend: true,
  skipTitle: true,
};

function barFamilyData(): ChartData {
  return {
    categories: ['North', 'South'],
    series: [
      {
        name: 'Actual',
        data: [
          { x: 'North', y: 8 },
          { x: 'South', y: 5 },
        ],
      },
      {
        name: 'Forecast',
        data: [
          { x: 'North', y: 3 },
          { x: 'South', y: 4 },
        ],
      },
    ],
  };
}

function trendData(): ChartData {
  return {
    categories: ['Q1', 'Q2', 'Q3'],
    series: [
      {
        name: 'Revenue',
        data: [
          { x: 'Q1', y: 4 },
          { x: 'Q2', y: 8 },
          { x: 'Q3', y: 6 },
        ],
      },
    ],
  };
}

function pieData(): ChartData {
  return {
    categories: ['Hardware', 'Services', 'Software'],
    series: [
      {
        name: 'Mix',
        data: [
          { x: 'Hardware', y: 30 },
          { x: 'Services', y: 45 },
          { x: 'Software', y: 25 },
        ],
      },
    ],
  };
}

function makeConfig(type: ChartType, overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type,
    anchorRow: 0,
    anchorCol: 0,
    width: 8,
    height: 5,
    ...overrides,
  };
}

function compiledMarks(type: ChartType, data: ChartData, overrides: Partial<ChartConfig> = {}) {
  const spec = configToSpec(makeConfig(type, overrides), data);
  return compile(spec, undefined, COMPILE_OPTIONS).marks;
}

function pathMarks(marks: AnyMark[]): PathMark[] {
  return marks.filter((mark): mark is PathMark => mark.type === 'path');
}

function dataBarRects(marks: AnyMark[]) {
  return marks.filter(
    (mark) =>
      mark.type === 'rect' &&
      mark.datum &&
      typeof mark.datum === 'object' &&
      'category' in mark.datum &&
      'value' in mark.datum,
  );
}

function allNumbers(values: Array<number | undefined>): values is number[] {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

function pathBounds(mark: PathMark): { width: number; height: number } {
  const coordinates = (mark.path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(
    Number,
  );
  const xs = coordinates.filter((_value, index) => index % 2 === 0);
  const ys = coordinates.filter((_value, index) => index % 2 === 1);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function markHas3DMetadata(mark: AnyMark): boolean {
  return (
    JSON.stringify(mark.datum ?? mark)
      .toLowerCase()
      .match(/chart3d|3d|depth|back|side|face|shape/) !== null
  );
}

function visible3DDepthMarks(marks: AnyMark[]): AnyMark[] {
  return marks.filter((mark) => {
    if (!markHas3DMetadata(mark)) return false;
    if ('path' in mark && typeof mark.path === 'string') return mark.path.length > 0;
    if ('width' in mark && 'height' in mark && allNumbers([mark.width, mark.height])) {
      return mark.width > 0 && mark.height > 0;
    }
    if ('outerRadius' in mark && typeof mark.outerRadius === 'number') return mark.outerRadius > 0;
    return true;
  });
}

function expect3DBarFamilyPaths(marks: AnyMark[]): PathMark[] {
  const bars = dataBarRects(marks);
  const paths = pathMarks(marks);

  expect(bars).toEqual([]);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.some(markHas3DMetadata)).toBe(true);

  return paths;
}

describe('configToSpec 3-D plot rendering support', () => {
  it('renders stacked pyramid columns as 3-D path faces instead of plain rect data bars', () => {
    const marks = compiledMarks('pyramidColStacked', barFamilyData());
    const paths = expect3DBarFamilyPaths(marks);

    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(
      new Set(
        paths
          .map((mark) => (mark.datum as Record<string, unknown> | undefined)?.category)
          .filter(Boolean),
      ),
    ).toEqual(new Set(['North', 'South']));
  });

  it('keeps ordinary 2-D columns as rect bars', () => {
    const marks = compiledMarks('column', barFamilyData(), { subType: 'stacked' });

    expect(dataBarRects(marks).length).toBeGreaterThan(0);
    expect(pathMarks(marks).some(markHas3DMetadata)).toBe(false);
  });

  it('preserves horizontal vs vertical orientation for bar3d and column3d path geometry', () => {
    const bar3DPaths = expect3DBarFamilyPaths(compiledMarks('bar3d', barFamilyData()));
    const column3DPaths = expect3DBarFamilyPaths(compiledMarks('column3d', barFamilyData()));

    const barBounds = pathBounds(bar3DPaths[0]);
    const columnBounds = pathBounds(column3DPaths[0]);

    expect(barBounds.width).toBeGreaterThan(barBounds.height);
    expect(columnBounds.height).toBeGreaterThan(columnBounds.width);
  });

  it('renders cylinder chart types with curved path faces instead of box-only polygons', () => {
    const paths = expect3DBarFamilyPaths(compiledMarks('cylinderColStacked', barFamilyData()));

    expect(paths.some((mark) => mark.path.includes('C'))).toBe(true);
  });

  it.each([
    ['line3d', 'line', trendData()],
    ['area3d', 'area', trendData()],
    ['pie3d', 'pie', pieData()],
  ] as const)(
    'renders visible depth or back-face marks for %s beyond the 2-D %s baseline',
    (threeDType, twoDType, data) => {
      const threeDMarks = compiledMarks(threeDType, data);
      const twoDMarks = compiledMarks(twoDType, data);
      const depthMarks = visible3DDepthMarks(threeDMarks);

      expect(depthMarks.length).toBeGreaterThan(0);
      expect(threeDMarks.length).toBeGreaterThan(twoDMarks.length);
    },
  );

  it('carries 3-D intent through the public configToSpec contract before compilation', () => {
    const spec = configToSpec(makeConfig('column3d'), barFamilyData());

    expect(JSON.stringify(spec).toLowerCase()).toMatch(/chart3d|3d|depth|face|shape|path/);
  });
});
