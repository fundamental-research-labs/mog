import { configToSpec } from '../config-to-spec';
import { compile } from '../../grammar/compiler';
import type { PathMark, TextMark } from '../../primitives/types';
import type { ChartConfig, ChartData } from '../../types';
import type { UnitSpec } from '../../grammar/spec';

function surfaceConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    type: 'surface',
    anchorRow: 0,
    anchorCol: 0,
    width: 10,
    height: 8,
    legend: { show: true, visible: true, position: 'right' },
    ...overrides,
  };
}

function surfaceData(): ChartData {
  return {
    categories: [0, 1, 2],
    series: [
      {
        name: 'Y0',
        data: [
          { x: 0, y: 65 },
          { x: 1, y: 65 },
          { x: 2, y: 65 },
        ],
      },
      {
        name: 'Y1',
        data: [
          { x: 0, y: 65 },
          { x: 1, y: 85 },
          { x: 2, y: 85 },
        ],
      },
      {
        name: 'Y2',
        data: [
          { x: 0, y: 65 },
          { x: 1, y: 85 },
          { x: 2, y: 85 },
        ],
      },
    ],
  };
}

function asUnitSpec(spec: ReturnType<typeof configToSpec>): UnitSpec {
  if ('layer' in spec && Array.isArray(spec.layer)) {
    throw new Error('expected unit spec');
  }
  return spec;
}

function contourMarks(spec: UnitSpec): PathMark[] {
  return compile(spec).marks.filter(
    (mark): mark is PathMark =>
      mark.type === 'path' &&
      typeof (mark.datum as Record<string, unknown> | undefined)?.contourBand === 'string',
  );
}

function pathBounds(marks: PathMark[]): { width: number; height: number } {
  const coordinates = marks.flatMap((mark) =>
    (mark.path.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number),
  );
  const xs = coordinates.filter((_value, index) => index % 2 === 0);
  const ys = coordinates.filter((_value, index) => index % 2 === 1);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe('surface contour configToSpec', () => {
  it('renders top-view surface charts as filled contour bands', () => {
    const spec = asUnitSpec(configToSpec(surfaceConfig(), surfaceData()));

    expect(spec.mark).toMatchObject({
      type: 'contour',
      contourWireframe: false,
    });
    expect(spec.encoding?.color?.scale?.domain).toEqual([
      '0.00-20.00',
      '20.00-40.00',
      '40.00-60.00',
      '60.00-80.00',
      '80.00-100.00',
    ]);
    expect(spec.encoding?.color?.legend).toMatchObject({ reverse: true });

    const marks = contourMarks(spec);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((mark) => mark.style.stroke === mark.style.fill)).toBe(true);
    expect(new Set(marks.map((mark) => mark.style.fill))).toEqual(new Set(['#8064a2', '#31859b']));
  });

  it('uses value-band legend entries instead of series legend entries', () => {
    const spec = asUnitSpec(configToSpec(surfaceConfig(), surfaceData()));
    const result = compile(spec);
    const legendText = result.legends
      .filter((mark): mark is TextMark => mark.type === 'text')
      .map((mark) => mark.text);

    expect(legendText).toEqual([
      '80.00-100.00',
      '60.00-80.00',
      '40.00-60.00',
      '20.00-40.00',
      '0.00-20.00',
    ]);
  });

  it('renders top-view wireframe surface charts as contour isolines', () => {
    const spec = asUnitSpec(configToSpec(surfaceConfig({ wireframe: true }), surfaceData()));

    expect(spec.mark).toMatchObject({
      type: 'contour',
      contourWireframe: true,
    });

    const marks = contourMarks(spec);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((mark) => mark.style.fill === undefined)).toBe(true);
    expect(
      marks.some((mark) => (mark.datum as { contourThreshold?: number }).contourThreshold === 80),
    ).toBe(true);
  });

  it('keeps the contour grid square inside rectangular chart areas', () => {
    const spec = asUnitSpec(configToSpec(surfaceConfig({ width: 14, height: 8 }), surfaceData()));
    const marks = compile(spec, undefined, {
      width: 700,
      height: 360,
      skipAxes: true,
      skipLegend: true,
      skipTitle: true,
    }).marks.filter(
      (mark): mark is PathMark =>
        mark.type === 'path' &&
        typeof (mark.datum as Record<string, unknown> | undefined)?.contourBand === 'string',
    );

    const bounds = pathBounds(marks);
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThanOrEqual(1);
  });
});
