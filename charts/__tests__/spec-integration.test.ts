/**
 * Spec-to-render integration tests
 *
 * Tests the full compile pipeline: ChartSpec -> compile() -> marks/axes/legends.
 */
import { compile } from '../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../src/grammar/spec';

const sampleData: DataRow[] = [
  { category: 'A', value: 10 },
  { category: 'B', value: 20 },
  { category: 'C', value: 30 },
];

describe('compile: basic bar chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    data: { values: sampleData },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
    width: 400,
    height: 300,
  };

  it('produces marks', () => {
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
  });

  it('produces axes', () => {
    const result = compile(spec);
    expect(result.axes.length).toBeGreaterThan(0);
  });

  it('has correct bounds', () => {
    const result = compile(spec);
    expect(result.bounds.width).toBe(400);
    expect(result.bounds.height).toBe(300);
  });

  it('layout has plotArea', () => {
    const result = compile(spec);
    expect(result.layout.plotArea).toBeDefined();
    expect(result.layout.plotArea.width).toBeGreaterThan(0);
    expect(result.layout.plotArea.height).toBeGreaterThan(0);
  });

  it('marks are rect type for bar chart', () => {
    const result = compile(spec);
    for (const mark of result.marks) {
      expect(mark.type).toBe('rect');
    }
  });

  it('each mark has a datum', () => {
    const result = compile(spec);
    for (const mark of result.marks) {
      expect(mark.datum).toBeDefined();
    }
  });
});

describe('compile: line chart', () => {
  const spec: ChartSpec = {
    mark: 'line',
    data: { values: sampleData },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
  };

  it('produces path marks for line', () => {
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
    const pathMarks = result.marks.filter((m) => m.type === 'path');
    expect(pathMarks.length).toBeGreaterThan(0);
  });
});

describe('compile: scatter plot', () => {
  const scatterData: DataRow[] = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ];
  const spec: ChartSpec = {
    mark: 'point',
    data: { values: scatterData },
    encoding: {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
    },
  };

  it('produces symbol marks', () => {
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
    const symbolMarks = result.marks.filter((m) => m.type === 'symbol');
    expect(symbolMarks.length).toBeGreaterThan(0);
  });
});

describe('compile: pie/arc chart', () => {
  const spec: ChartSpec = {
    mark: 'arc',
    data: { values: sampleData },
    encoding: {
      theta: { field: 'value', type: 'quantitative' },
      color: { field: 'category', type: 'nominal' },
    },
  };

  it('produces arc marks', () => {
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
    const arcMarks = result.marks.filter((m) => m.type === 'arc');
    expect(arcMarks.length).toBeGreaterThan(0);
  });
});

describe('compile: with transforms', () => {
  it('applies filter transform', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      data: { values: sampleData },
      transform: [{ type: 'filter', filter: { field: 'value', gt: 15 } }],
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };
    const result = compile(spec);
    // Should only have marks for B (20) and C (30)
    expect(result.marks.length).toBe(2);
  });
});

describe('compile: options', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    data: { values: sampleData },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
  };

  it('skipAxes omits axes', () => {
    const result = compile(spec, undefined, { skipAxes: true });
    expect(result.axes).toHaveLength(0);
  });

  it('skipLegend omits legends', () => {
    const result = compile(spec, undefined, { skipLegend: true });
    expect(result.legends).toHaveLength(0);
  });

  it('skipTitle omits title', () => {
    const specWithTitle: ChartSpec = { ...spec, title: 'Test' };
    const result = compile(specWithTitle, undefined, { skipTitle: true });
    expect(result.title).toBeUndefined();
  });

  it('width/height override', () => {
    const result = compile(spec, undefined, { width: 1000, height: 800 });
    expect(result.bounds.width).toBe(1000);
    expect(result.bounds.height).toBe(800);
  });
});

describe('compile: empty data', () => {
  it('handles empty data gracefully', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      data: { values: [] },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };
    const result = compile(spec);
    expect(result.marks).toHaveLength(0);
  });

  it('handles missing data', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };
    const result = compile(spec);
    expect(result.marks).toHaveLength(0);
  });
});

describe('compile: layered chart', () => {
  it('compiles layered spec', () => {
    const spec: ChartSpec = {
      data: { values: sampleData },
      layer: [
        {
          mark: 'bar',
          encoding: {
            x: { field: 'category', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
        },
        {
          mark: 'line',
          encoding: {
            x: { field: 'category', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
        },
      ],
    };
    const result = compile(spec);
    expect(result.marks.length).toBeGreaterThan(0);
    const types = new Set(result.marks.map((m) => m.type));
    // Should have both rect (bar) and path (line) marks
    expect(types.size).toBeGreaterThanOrEqual(2);
  });
});

describe('compile: with title', () => {
  it('generates title marks from string', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      data: { values: sampleData },
      title: 'My Chart',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };
    const result = compile(spec);
    expect(result.title).toBeDefined();
    expect(result.title!.length).toBeGreaterThan(0);
  });
});

describe('compile: data passed as argument', () => {
  it('uses data parameter when spec has no data', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };
    const result = compile(spec, sampleData);
    expect(result.marks.length).toBeGreaterThan(0);
  });
});
