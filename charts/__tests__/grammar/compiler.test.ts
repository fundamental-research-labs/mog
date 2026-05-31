/**
 * Tests for Grammar Compiler
 */

import { compile, type ChartSpec, type DataRow } from '../../src/grammar';

// =============================================================================
// Test Data
// =============================================================================

const barChartData: DataRow[] = [
  { category: 'A', value: 30 },
  { category: 'B', value: 50 },
  { category: 'C', value: 20 },
  { category: 'D', value: 40 },
];

const lineChartData: DataRow[] = [
  { date: '2024-01', sales: 100 },
  { date: '2024-02', sales: 150 },
  { date: '2024-03', sales: 120 },
  { date: '2024-04', sales: 180 },
];

const scatterData: DataRow[] = [
  { x: 1, y: 2, category: 'A', size: 10 },
  { x: 2, y: 4, category: 'A', size: 20 },
  { x: 3, y: 3, category: 'B', size: 15 },
  { x: 4, y: 6, category: 'B', size: 25 },
  { x: 5, y: 5, category: 'A', size: 30 },
];

const pieData: DataRow[] = [
  { category: 'Slice A', value: 30 },
  { category: 'Slice B', value: 40 },
  { category: 'Slice C', value: 30 },
];

// =============================================================================
// Bar Chart Tests
// =============================================================================

describe('Bar Chart Compilation', () => {
  test('compiles basic bar chart', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(4);
    expect(result.marks.every((m) => m.type === 'rect')).toBe(true);
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  test('centers category axis labels within band slots', () => {
    const spec: ChartSpec = {
      data: { values: barChartData.slice(0, 2) },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
      width: 300,
      height: 200,
    };

    const result = compile(spec);
    const firstBar = result.marks.find(
      (mark) => mark.type === 'rect' && (mark as any).datum?.category === 'A',
    ) as any;
    const firstLabel = result.axes.find(
      (mark) => mark.type === 'text' && (mark as any).datum?.role === 'x-axis' && mark.text === 'A',
    ) as any;

    expect(firstBar).toBeDefined();
    expect(firstLabel).toBeDefined();
    expect(firstLabel.x).toBeCloseTo(firstBar.x + firstBar.width / 2, 6);
  });

  test('compiles bar chart with color encoding', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(4);
    // Each bar should have a different fill color
    const colors = result.marks.map((m) => m.style.fill);
    expect(new Set(colors).size).toBe(4);
  });

  test('compiles horizontal bar chart', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'value', type: 'quantitative' },
        y: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(4);
    // For horizontal bars, heights should be roughly equal (band width)
    const heights = result.marks.map((m) => (m as any).height);
    expect(new Set(heights).size).toBe(1);
  });

  test('applies corner radius from mark spec', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: { type: 'bar', cornerRadius: 5 },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks.every((m) => m.style.cornerRadius === 5)).toBe(true);
  });
});

// =============================================================================
// Line Chart Tests
// =============================================================================

describe('Line Chart Compilation', () => {
  test('compiles basic line chart', () => {
    const spec: ChartSpec = {
      data: { values: lineChartData },
      mark: 'line',
      encoding: {
        x: { field: 'date', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    // Line chart should produce path marks
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    const pathMark = result.marks.find((m) => m.type === 'path');
    expect(pathMark?.style.stroke).toBeDefined();
  });

  test('centers categorical line points on axis labels', () => {
    const spec: ChartSpec = {
      data: { values: lineChartData.slice(0, 2) },
      mark: 'line',
      encoding: {
        x: { field: 'date', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
      },
      width: 300,
      height: 200,
    };

    const result = compile(spec);
    const firstLinePointX = firstPathPoint(result.marks.find((m) => m.type === 'path') as any).x;
    const firstLabel = result.axes.find(
      (mark) =>
        mark.type === 'text' &&
        (mark as any).datum?.role === 'x-axis' &&
        mark.text === '2024-01',
    ) as any;

    expect(firstLabel).toBeDefined();
    expect(firstLinePointX).toBeCloseTo(firstLabel.x, 6);
  });

  test('compiles multi-series line chart with color', () => {
    const multiSeriesData = [
      { date: '2024-01', sales: 100, region: 'North' },
      { date: '2024-02', sales: 150, region: 'North' },
      { date: '2024-01', sales: 80, region: 'South' },
      { date: '2024-02', sales: 120, region: 'South' },
    ];

    const spec: ChartSpec = {
      data: { values: multiSeriesData },
      mark: 'line',
      encoding: {
        x: { field: 'date', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
        color: { field: 'region', type: 'nominal' },
      },
    };

    const result = compile(spec);

    // Should produce two path marks (one per region)
    const pathMarks = result.marks.filter((m) => m.type === 'path');
    expect(pathMarks).toHaveLength(2);
  });
});

// =============================================================================
// Area Chart Tests
// =============================================================================

describe('Area Chart Compilation', () => {
  test('compiles basic area chart', () => {
    const spec: ChartSpec = {
      data: { values: lineChartData },
      mark: 'area',
      encoding: {
        x: { field: 'date', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    const pathMark = result.marks.find((m) => m.type === 'path');
    expect(pathMark?.style.fill).toBeDefined();
  });

  test('centers categorical area points on axis labels', () => {
    const spec: ChartSpec = {
      data: { values: lineChartData.slice(0, 2) },
      mark: 'area',
      encoding: {
        x: { field: 'date', type: 'ordinal' },
        y: { field: 'sales', type: 'quantitative' },
      },
      width: 300,
      height: 200,
    };

    const result = compile(spec);
    const firstAreaPointX = secondPathPoint(result.marks.find((m) => m.type === 'path') as any).x;
    const firstLabel = result.axes.find(
      (mark) =>
        mark.type === 'text' &&
        (mark as any).datum?.role === 'x-axis' &&
        mark.text === '2024-01',
    ) as any;

    expect(firstLabel).toBeDefined();
    expect(firstAreaPointX).toBeCloseTo(firstLabel.x, 6);
  });
});

// =============================================================================
// Point/Scatter Chart Tests
// =============================================================================

describe('Point Chart Compilation', () => {
  test('compiles basic scatter plot', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(5);
    expect(result.marks.every((m) => m.type === 'symbol')).toBe(true);
  });

  test('compiles scatter with size encoding', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        size: { field: 'size', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    // Points should have varying sizes
    const sizes = result.marks.map((m) => (m as any).size);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  test('compiles scatter with color encoding', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'circle',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    // Points should have different colors based on category
    const colors = result.marks.map((m) => m.style.fill);
    expect(new Set(colors).size).toBe(2);
  });
});

function pathPoints(mark: { path?: string }): Array<{ x: number; y: number }> {
  const matches = [...(mark.path ?? '').matchAll(/[ML]([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/g)];
  return matches.map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

function firstPathPoint(mark: { path?: string }): { x: number; y: number } {
  const [first] = pathPoints(mark);
  if (!first) throw new Error(`Expected path point in ${mark.path ?? '(missing path)'}`);
  return first;
}

function secondPathPoint(mark: { path?: string }): { x: number; y: number } {
  const [, second] = pathPoints(mark);
  if (!second) throw new Error(`Expected second path point in ${mark.path ?? '(missing path)'}`);
  return second;
}

// =============================================================================
// Arc/Pie Chart Tests
// =============================================================================

describe('Arc Chart Compilation', () => {
  test('compiles basic pie chart', () => {
    const spec: ChartSpec = {
      data: { values: pieData },
      mark: 'arc',
      encoding: {
        theta: { field: 'value', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(3);
    expect(result.marks.every((m) => m.type === 'arc')).toBe(true);

    // Arcs should cover full circle
    const totalAngle = result.marks.reduce((sum, m) => {
      const arc = m as any;
      return sum + (arc.endAngle - arc.startAngle);
    }, 0);
    expect(totalAngle).toBeCloseTo(Math.PI * 2, 1);
  });

  test('compiles donut chart with innerRadius', () => {
    const spec: ChartSpec = {
      data: { values: pieData },
      mark: { type: 'arc', innerRadius: 0.5 },
      encoding: {
        theta: { field: 'value', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    // All arcs should have positive innerRadius
    expect(result.marks.every((m) => (m as any).innerRadius > 0)).toBe(true);
  });
});

// =============================================================================
// Axis Generation Tests
// =============================================================================

describe('Axis Generation', () => {
  test('generates X and Y axes', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    // Should have axis marks
    expect(result.axes.length).toBeGreaterThan(0);

    // Should have axis lines (path marks)
    const axisLines = result.axes.filter((a) => a.type === 'path');
    expect(axisLines.length).toBeGreaterThan(0);

    // Should have tick labels (text marks)
    const tickLabels = result.axes.filter((a) => a.type === 'text');
    expect(tickLabels.length).toBeGreaterThan(0);
  });

  test('respects axis: null to hide axis', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal', axis: null },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    // Should still have Y axis but not X axis labels for category
    expect(result.axes.length).toBeGreaterThan(0);
  });

  test('generates grid lines when specified', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: {
          field: 'value',
          type: 'quantitative',
          axis: { grid: true },
        },
      },
    };

    const result = compile(spec);

    // Should have grid line marks
    const gridLines = result.axes.filter((a) => a.type === 'path' && (a.style.opacity ?? 1) < 1);
    expect(gridLines.length).toBeGreaterThan(0);
  });

  test('places imported automatic x-axis at the value zero crossing', () => {
    const spec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 100 },
          { category: 'B', value: -20 },
        ],
      },
      mark: 'bar',
      encoding: {
        x: {
          field: 'category',
          type: 'nominal',
          axis: { crossesAt: 'automatic' },
        },
        y: {
          field: 'value',
          type: 'quantitative',
          scale: { domain: [-20, 100], nice: false },
        },
      },
      width: 300,
      height: 200,
    };

    const result = compile(spec);
    const plotBottom = result.layout.plotArea.y + result.layout.plotArea.height;
    const expectedY = result.scales.y!(0) as number;
    const xAxisLine = result.axes.find(
      (mark) =>
        mark.type === 'path' &&
        (mark as any).datum?.role === 'x-axis' &&
        (mark as any).path.startsWith(`M${result.layout.plotArea.x},`) &&
        (mark as any).path.includes(` L${result.layout.plotArea.x + result.layout.plotArea.width},`),
    ) as any;

    expect(xAxisLine).toBeDefined();
    expect(Number(xAxisLine.path.match(/^M[^,]+,([^ ]+)/)?.[1])).toBeCloseTo(expectedY, 6);
    expect(expectedY).toBeLessThan(plotBottom);
  });

  test('applies imported grid line dash and opacity styles', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: {
          field: 'value',
          type: 'quantitative',
          axis: { grid: true, gridDash: [4, 2], gridOpacity: 0.75 },
        },
      },
    };

    const result = compile(spec);
    const gridLine = result.axes.find(
      (mark) =>
        mark.type === 'path' &&
        (mark as any).datum?.role === 'y-axis' &&
        mark.style.strokeDash?.join(',') === '4,2',
    );

    expect(gridLine?.style.opacity).toBe(0.75);
  });
});

// =============================================================================
// Legend Generation Tests
// =============================================================================

describe('Legend Generation', () => {
  test('generates legend for color encoding', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec);

    expect(result.legends.length).toBeGreaterThan(0);
  });

  test('respects legend: null to hide legend', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'category', type: 'nominal', legend: null },
      },
    };

    const result = compile(spec);

    expect(result.legends).toHaveLength(0);
  });

  test('right-aligns right legend content inside the reserved legend area', () => {
    const spec: ChartSpec = {
      data: {
        values: [
          { category: 'A', value: 10, series: 'Staffing' },
          { category: 'A', value: 20, series: 'Adjustment' },
        ],
      },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: {
          field: 'series',
          type: 'nominal',
          legend: { orient: 'right', title: null, labelFontSize: 12 },
        },
      },
      width: 796,
      height: 436,
    };

    const result = compile(spec);
    const symbols = result.legends.filter((mark) => mark.type === 'rect') as Array<{
      x: number;
      width: number;
    }>;

    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols[0].x).toBeGreaterThan(result.layout.legend!.x);
    expect(symbols[0].x + symbols[0].width).toBeLessThanOrEqual(
      result.layout.legend!.x + result.layout.legend!.width,
    );
  });
});

// =============================================================================
// Title Generation Tests
// =============================================================================

describe('Title Generation', () => {
  test('generates title from string', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      title: 'My Chart',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.title).toBeDefined();
    expect(result.title!.some((m) => m.type === 'text' && (m as any).text === 'My Chart')).toBe(
      true,
    );
  });

  test('generates title with subtitle', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      title: {
        text: 'Main Title',
        subtitle: 'Subtitle text',
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.title).toBeDefined();
    expect(result.title!.length).toBe(2);
  });
});

// =============================================================================
// Layout Tests
// =============================================================================

describe('Layout Calculation', () => {
  test('respects explicit dimensions', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      width: 800,
      height: 500,
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.layout.width).toBe(800);
    expect(result.layout.height).toBe(500);
  });

  test('uses default dimensions when not specified', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.layout.width).toBeGreaterThan(0);
    expect(result.layout.height).toBeGreaterThan(0);
  });

  test('plot area is within bounds', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    const { plotArea } = result.layout;
    expect(plotArea.x).toBeGreaterThanOrEqual(0);
    expect(plotArea.y).toBeGreaterThanOrEqual(0);
    expect(plotArea.x + plotArea.width).toBeLessThanOrEqual(result.layout.width);
    expect(plotArea.y + plotArea.height).toBeLessThanOrEqual(result.layout.height);
  });
});

// =============================================================================
// Transform Integration Tests
// =============================================================================

describe('Transform Integration', () => {
  test('applies filter transform before compilation', () => {
    const data = [
      { category: 'A', value: 30, active: true },
      { category: 'B', value: 50, active: false },
      { category: 'C', value: 20, active: true },
    ];

    const spec: ChartSpec = {
      data: { values: data },
      transform: [{ type: 'filter', filter: { field: 'active', equal: true } }],
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(2);
  });

  test('applies aggregate transform', () => {
    const data = [
      { category: 'A', value: 10 },
      { category: 'A', value: 20 },
      { category: 'B', value: 30 },
    ];

    const spec: ChartSpec = {
      data: { values: data },
      transform: [
        {
          type: 'aggregate',
          aggregate: [
            {
              groupby: ['category'],
              aggregate: [{ op: 'sum', field: 'value', as: 'total' }],
            },
          ],
        },
      ],
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'total', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(2);
  });
});

// =============================================================================
// Layer Composition Tests
// =============================================================================

describe('Layer Composition', () => {
  test('compiles layered chart', () => {
    const spec: ChartSpec = {
      data: { values: lineChartData },
      layer: [
        {
          mark: 'line',
          encoding: {
            x: { field: 'date', type: 'ordinal' },
            y: { field: 'sales', type: 'quantitative' },
          },
        },
        {
          mark: 'point',
          encoding: {
            x: { field: 'date', type: 'ordinal' },
            y: { field: 'sales', type: 'quantitative' },
          },
        },
      ],
    };

    const result = compile(spec);

    // Should have both path marks (lines) and symbol marks (points)
    expect(result.marks.some((m) => m.type === 'path')).toBe(true);
    expect(result.marks.some((m) => m.type === 'symbol')).toBe(true);
  });
});

// =============================================================================
// Options Tests
// =============================================================================

describe('Compile Options', () => {
  test('skipAxes option removes axes', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { skipAxes: true });

    expect(result.axes).toHaveLength(0);
  });

  test('skipLegend option removes legend', () => {
    const spec: ChartSpec = {
      data: { values: scatterData },
      mark: 'point',
      encoding: {
        x: { field: 'x', type: 'quantitative' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const result = compile(spec, undefined, { skipLegend: true });

    expect(result.legends).toHaveLength(0);
  });

  test('skipTitle option removes title', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      title: 'My Chart',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { skipTitle: true });

    expect(result.title).toBeUndefined();
  });

  test('dimension overrides work', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
      width: 600,
      height: 400,
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, undefined, { width: 1000, height: 800 });

    expect(result.layout.width).toBe(1000);
    expect(result.layout.height).toBe(800);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  test('handles empty data', () => {
    const spec: ChartSpec = {
      data: { values: [] },
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec);

    expect(result.marks).toHaveLength(0);
  });

  test('handles missing encoding', () => {
    const spec: ChartSpec = {
      data: { values: barChartData },
      mark: 'bar',
    };

    const result = compile(spec);

    // Should not crash, may produce empty or minimal marks
    expect(result).toBeDefined();
  });

  test('handles data provided separately', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const result = compile(spec, barChartData);

    expect(result.marks).toHaveLength(4);
  });
});
