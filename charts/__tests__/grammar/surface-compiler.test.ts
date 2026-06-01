import { configToSpec } from '../../src/core/config-to-spec';
import { compile } from '../../src/grammar/compiler';
import type { AnyMark, PathMark } from '../../src/primitives/types';
import type { UnitSpec } from '../../src/grammar/spec';
import type { ChartConfig, ChartData, ChartType } from '../../src/types';

type SurfaceChartType = Extract<
  ChartType,
  'surface' | 'surface3d' | 'surfaceWireframe' | 'surfaceTopView' | 'surfaceTopViewWireframe'
>;

const SURFACE_TYPES: SurfaceChartType[] = [
  'surface',
  'surface3d',
  'surfaceWireframe',
  'surfaceTopView',
  'surfaceTopViewWireframe',
];

const WIREFRAME_TYPES: SurfaceChartType[] = ['surfaceWireframe', 'surfaceTopViewWireframe'];
const TOP_VIEW_TYPES: SurfaceChartType[] = ['surfaceTopView', 'surfaceTopViewWireframe'];

const surfaceData: ChartData = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    {
      name: 'North',
      data: [
        { x: 'Q1', y: 10 },
        { x: 'Q2', y: 35 },
        { x: 'Q3', y: 60 },
        { x: 'Q4', y: 85 },
      ],
    },
    {
      name: 'South',
      data: [
        { x: 'Q1', y: 25 },
        { x: 'Q2', y: 50 },
        { x: 'Q3', y: 75 },
        { x: 'Q4', y: 95 },
      ],
    },
    {
      name: 'West',
      data: [
        { x: 'Q1', y: 5 },
        { x: 'Q2', y: 45 },
        { x: 'Q3', y: 65 },
        { x: 'Q4', y: 90 },
      ],
    },
  ],
};

function surfaceConfig(type: SurfaceChartType): ChartConfig {
  return {
    type,
    anchorRow: 0,
    anchorCol: 0,
    width: 6,
    height: 16,
    colors: ['#1f77b4', '#2ca02c', '#ff7f0e', '#d62728', '#9467bd'],
  };
}

function compileSurface(type: SurfaceChartType): PathMark[] {
  const spec = configToSpec(surfaceConfig(type), surfaceData);
  const result = compile(spec, undefined, {
    width: 480,
    height: 320,
    skipAxes: true,
    skipLegend: true,
    skipTitle: true,
  });

  expectPathOnlyDataMarks(result.marks);
  return result.marks;
}

function asUnitSpec(spec: ReturnType<typeof configToSpec>): UnitSpec {
  if ('layer' in spec && Array.isArray(spec.layer)) {
    throw new Error('expected unit spec');
  }
  return spec;
}

function expectPathOnlyDataMarks(marks: AnyMark[]): asserts marks is PathMark[] {
  expect(marks).not.toHaveLength(0);
  expect(marks.some((mark) => mark.type === 'rect')).toBe(false);
  expect(marks.every((mark) => mark.type === 'path')).toBe(true);
  for (const mark of marks) {
    expectRenderablePath(mark as PathMark);
  }
}

function expectRenderablePath(mark: PathMark): void {
  const path = mark.path.trim();
  expect(path).toMatch(/^M/);
  expect(path).toMatch(/\bL/);

  const coordinates =
    path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map((value) => Number(value)) ?? [];
  expect(coordinates.length).toBeGreaterThanOrEqual(4);
  expect(coordinates.every(Number.isFinite)).toBe(true);
}

describe('surface chart compilation', () => {
  it.each(SURFACE_TYPES)('compiles %s to path marks, not rect placeholders', (type) => {
    const marks = compileSurface(type);

    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks.map((mark) => mark.path)).size).toBeGreaterThan(0);
  });

  it.each(WIREFRAME_TYPES)('produces open stroked mesh paths for %s', (type) => {
    const marks = compileSurface(type);

    expect(marks.length).toBeGreaterThan(0);
    expect(marks.some((mark) => !mark.path.includes('Z'))).toBe(true);
    expect(marks.every((mark) => mark.style.stroke)).toBe(true);
    expect(marks.every((mark) => mark.style.fill === undefined)).toBe(true);
  });

  it.each(TOP_VIEW_TYPES)('produces non-empty contour geometry for %s', (type) => {
    const marks = compileSurface(type);

    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks.map((mark) => mark.path)).size).toBeGreaterThan(1);
    if (type === 'surfaceTopView') {
      expect(marks.some((mark) => mark.path.trim().endsWith('Z'))).toBe(true);
      expect(marks.some((mark) => typeof mark.style.fill === 'string')).toBe(true);
    } else {
      expect(marks.some((mark) => !mark.path.includes('Z'))).toBe(true);
      expect(marks.some((mark) => typeof mark.style.stroke === 'string')).toBe(true);
    }
  });

  it('uses Excel-like one-unit bands for auto-scaled 3-D surface legends', () => {
    const saddleData: ChartData = {
      categories: [0, 1, 2],
      series: [
        {
          name: 'A',
          data: [
            { x: 0, y: -4 },
            { x: 1, y: -3 },
            { x: 2, y: -2 },
          ],
        },
        {
          name: 'B',
          data: [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 2, y: 1 },
          ],
        },
        {
          name: 'C',
          data: [
            { x: 0, y: 2 },
            { x: 1, y: 3 },
            { x: 2, y: 4 },
          ],
        },
      ],
    };

    const spec = asUnitSpec(configToSpec(surfaceConfig('surface3d'), saddleData));

    expect(spec.mark).toMatchObject({
      type: 'surface3d',
      contourBands: [
        expect.objectContaining({ label: '-4.000--3.000' }),
        expect.objectContaining({ label: '-3.000--2.000' }),
        expect.objectContaining({ label: '-2.000--1.000' }),
        expect.objectContaining({ label: '-1.000-0.000' }),
        expect.objectContaining({ label: '0.000-1.000' }),
        expect.objectContaining({ label: '1.000-2.000' }),
        expect.objectContaining({ label: '2.000-3.000' }),
        expect.objectContaining({ label: '3.000-4.000' }),
      ],
    });
  });
});
