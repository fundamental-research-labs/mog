/**
 * Golden-Master Snapshot Tests for Charts Grammar Compiler
 *
 * These tests capture the exact mark output of compile() for all chart types
 * BEFORE any refactoring. They serve as a regression safety net: if a refactor
 * changes the compiled output in any way, the snapshot diff will show exactly
 * what changed.
 *
 * To update snapshots after an intentional change:
 *   npx jest __tests__/golden-master/snapshot.test.ts --updateSnapshot
 */

import { compile, type CompileResult } from '../../src/grammar/compiler';
import type { ChartSpec, DataRow } from '../../src/grammar/spec';

// =============================================================================
// Shared Test Data
// =============================================================================

const SAMPLE_DATA: DataRow[] = [
  { category: 'A', value: 10, series: 'S1' },
  { category: 'B', value: 20, series: 'S1' },
  { category: 'C', value: 30, series: 'S1' },
  { category: 'A', value: 15, series: 'S2' },
  { category: 'B', value: 25, series: 'S2' },
  { category: 'C', value: 5, series: 'S2' },
];

const SCATTER_DATA: DataRow[] = [
  { x: 1, y: 10, size: 5, group: 'G1' },
  { x: 2, y: 20, size: 10, group: 'G1' },
  { x: 3, y: 15, size: 8, group: 'G2' },
  { x: 4, y: 25, size: 12, group: 'G2' },
  { x: 5, y: 30, size: 6, group: 'G1' },
];

const STOCK_DATA: DataRow[] = [
  { date: 'Mon', open: 100, high: 110, low: 95, close: 105 },
  { date: 'Tue', open: 105, high: 115, low: 100, close: 108 },
  { date: 'Wed', open: 108, high: 120, low: 102, close: 112 },
  { date: 'Thu', open: 112, high: 118, low: 105, close: 107 },
  { date: 'Fri', open: 107, high: 125, low: 103, close: 120 },
];

const FUNNEL_DATA: DataRow[] = [
  { stage: 'Visitors', count: 1000 },
  { stage: 'Signups', count: 600 },
  { stage: 'Trial', count: 300 },
  { stage: 'Paid', count: 100 },
];

const WATERFALL_DATA: DataRow[] = [
  { label: 'Revenue', value: 100 },
  { label: 'COGS', value: -40 },
  { label: 'OpEx', value: -30 },
  { label: 'Tax', value: -10 },
  { label: 'Net', value: 20 },
];

// Fixed compile options for deterministic output
const COMPILE_OPTIONS = {
  width: 600,
  height: 400,
  skipTitle: true,
} as const;

// =============================================================================
// Helper
// =============================================================================

function compileSpec(spec: ChartSpec, data?: DataRow[]): CompileResult {
  return compile(spec, data, COMPILE_OPTIONS);
}

// =============================================================================
// 1. Bar Chart
// =============================================================================

describe('golden-master: bar chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  };

  it('golden-master: bar chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: bar chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: bar chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: bar chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 2. Column Chart (horizontal bar)
// =============================================================================

describe('golden-master: column chart (horizontal bar)', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'value', type: 'quantitative' },
      y: { field: 'category', type: 'nominal' },
      color: { field: 'series', type: 'nominal' },
    },
  };

  it('golden-master: column chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: column chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: column chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: column chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 3. Line Chart
// =============================================================================

describe('golden-master: line chart', () => {
  const spec: ChartSpec = {
    mark: 'line',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  };

  it('golden-master: line chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: line chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: line chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: line chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 4. Area Chart
// =============================================================================

describe('golden-master: area chart', () => {
  const spec: ChartSpec = {
    mark: 'area',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  };

  it('golden-master: area chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: area chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: area chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: area chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 5. Pie Chart
// =============================================================================

describe('golden-master: pie chart', () => {
  const spec: ChartSpec = {
    mark: 'arc',
    encoding: {
      theta: { field: 'value', type: 'quantitative' },
      color: { field: 'category', type: 'nominal' },
    },
  };

  it('golden-master: pie chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: pie chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: pie chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: pie chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 6. Doughnut Chart
// =============================================================================

describe('golden-master: doughnut chart', () => {
  const spec: ChartSpec = {
    mark: { type: 'arc', innerRadius: 0.5 },
    encoding: {
      theta: { field: 'value', type: 'quantitative' },
      color: { field: 'category', type: 'nominal' },
    },
  };

  it('golden-master: doughnut chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: doughnut chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: doughnut chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: doughnut chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 7. Scatter Chart
// =============================================================================

describe('golden-master: scatter chart', () => {
  const spec: ChartSpec = {
    mark: 'point',
    encoding: {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
    },
  };

  it('golden-master: scatter chart marks', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: scatter chart marks count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: scatter chart axes count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: scatter chart legends count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 8. Bubble Chart
// =============================================================================

describe('golden-master: bubble chart', () => {
  const spec: ChartSpec = {
    mark: 'point',
    encoding: {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
      size: { field: 'size', type: 'quantitative' },
      color: { field: 'group', type: 'nominal' },
    },
  };

  it('golden-master: bubble chart marks', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: bubble chart marks count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: bubble chart axes count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: bubble chart legends count', () => {
    const result = compileSpec(spec, SCATTER_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 9. Combo Chart (layer: bar + line)
// =============================================================================

describe('golden-master: combo chart', () => {
  const spec: ChartSpec = {
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

  it('golden-master: combo chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: combo chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: combo chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: combo chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 10. Radar Chart (line with closed path approximation)
// =============================================================================

describe('golden-master: radar chart', () => {
  const spec: ChartSpec = {
    mark: 'line',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
  };

  it('golden-master: radar chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: radar chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: radar chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: radar chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 11. Stock Chart (bar with OHLC data)
// =============================================================================

describe('golden-master: stock chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'date', type: 'nominal' },
      y: { field: 'close', type: 'quantitative' },
    },
  };

  it('golden-master: stock chart marks', () => {
    const result = compileSpec(spec, STOCK_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: stock chart marks count', () => {
    const result = compileSpec(spec, STOCK_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: stock chart axes count', () => {
    const result = compileSpec(spec, STOCK_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: stock chart legends count', () => {
    const result = compileSpec(spec, STOCK_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 12. Funnel Chart (horizontal bar with funnel data)
// =============================================================================

describe('golden-master: funnel chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'count', type: 'quantitative' },
      y: { field: 'stage', type: 'nominal' },
    },
  };

  it('golden-master: funnel chart marks', () => {
    const result = compileSpec(spec, FUNNEL_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: funnel chart marks count', () => {
    const result = compileSpec(spec, FUNNEL_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: funnel chart axes count', () => {
    const result = compileSpec(spec, FUNNEL_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: funnel chart legends count', () => {
    const result = compileSpec(spec, FUNNEL_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 13. Waterfall Chart (bar with stacking config)
// =============================================================================

describe('golden-master: waterfall chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'label', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'label', type: 'nominal' },
    },
    config: { stack: 'zero' },
  };

  it('golden-master: waterfall chart marks', () => {
    const result = compileSpec(spec, WATERFALL_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: waterfall chart marks count', () => {
    const result = compileSpec(spec, WATERFALL_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: waterfall chart axes count', () => {
    const result = compileSpec(spec, WATERFALL_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: waterfall chart legends count', () => {
    const result = compileSpec(spec, WATERFALL_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 14. Stacked Bar Chart
// =============================================================================

describe('golden-master: stacked bar chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
    config: { stack: 'zero' },
  };

  it('golden-master: stacked bar chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: stacked bar chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: stacked bar chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: stacked bar chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 15. Percent-Stacked Bar Chart
// =============================================================================

describe('golden-master: percent-stacked bar chart', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
    config: { stack: 'normalize' },
  };

  it('golden-master: percent-stacked bar chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: percent-stacked bar chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: percent-stacked bar chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: percent-stacked bar chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});

// =============================================================================
// 16. Stacked Area Chart
// =============================================================================

describe('golden-master: stacked area chart', () => {
  const spec: ChartSpec = {
    mark: 'area',
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
    config: { stack: 'zero' },
  };

  it('golden-master: stacked area chart marks', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks).toMatchSnapshot();
  });

  it('golden-master: stacked area chart marks count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.marks.length).toMatchSnapshot();
  });

  it('golden-master: stacked area chart axes count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.axes.length).toMatchSnapshot();
  });

  it('golden-master: stacked area chart legends count', () => {
    const result = compileSpec(spec, SAMPLE_DATA);
    expect(result.legends.length).toMatchSnapshot();
  });
});
