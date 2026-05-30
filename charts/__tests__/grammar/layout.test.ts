/**
 * Tests for Layout Calculator
 */

import {
  calculateLayout,
  clampToPlotArea,
  DEFAULT_LAYOUT,
  getChartArea,
  getInnerDimensions,
  getXRange,
  getYRange,
  isInPlotArea,
} from '../../src/grammar/layout';
import type { ChartSpec } from '../../src/grammar/spec';

// =============================================================================
// Basic Layout Tests
// =============================================================================

describe('Layout Calculator', () => {
  test('calculates layout with default dimensions', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const layout = calculateLayout(spec);

    expect(layout.width).toBe(DEFAULT_LAYOUT.width);
    expect(layout.height).toBe(DEFAULT_LAYOUT.height);
    expect(layout.plotArea.width).toBeGreaterThan(0);
    expect(layout.plotArea.height).toBeGreaterThan(0);
  });

  test('respects explicit dimensions in spec', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      width: 800,
      height: 500,
    };

    const layout = calculateLayout(spec);

    expect(layout.width).toBe(800);
    expect(layout.height).toBe(500);
  });

  test('respects explicit dimensions in options', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      width: 600,
      height: 400,
    };

    const layout = calculateLayout(spec, { width: 1000, height: 700 });

    expect(layout.width).toBe(1000);
    expect(layout.height).toBe(700);
  });
});

// =============================================================================
// Margin Tests
// =============================================================================

describe('Margin Calculation', () => {
  test('calculates margins for axes', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const layout = calculateLayout(spec);

    // Should have positive margins
    expect(layout.margin.left).toBeGreaterThan(0);
    expect(layout.margin.bottom).toBeGreaterThan(0);
    expect(layout.margin.top).toBeGreaterThan(0);
    expect(layout.margin.right).toBeGreaterThan(0);
  });

  test('increases margins for axis titles', () => {
    const specWithoutTitles: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal', axis: {} },
        y: { field: 'value', type: 'quantitative', axis: {} },
      },
    };

    const specWithTitles: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal', axis: { title: 'Category' } },
        y: { field: 'value', type: 'quantitative', axis: { title: 'Value' } },
      },
    };

    const layoutWithout = calculateLayout(specWithoutTitles);
    const layoutWith = calculateLayout(specWithTitles);

    expect(layoutWith.margin.left).toBeGreaterThanOrEqual(layoutWithout.margin.left);
    expect(layoutWith.margin.bottom).toBeGreaterThanOrEqual(layoutWithout.margin.bottom);
  });

  test('increases top margin for title', () => {
    const specWithoutTitle: ChartSpec = {
      mark: 'bar',
    };

    const specWithTitle: ChartSpec = {
      mark: 'bar',
      title: 'My Chart',
    };

    const layoutWithout = calculateLayout(specWithoutTitle);
    const layoutWith = calculateLayout(specWithTitle);

    expect(layoutWith.margin.top).toBeGreaterThan(layoutWithout.margin.top);
  });

  test('handles padding from config', () => {
    const specWithPadding: ChartSpec = {
      mark: 'bar',
      config: {
        padding: 20,
      },
    };

    const layout = calculateLayout(specWithPadding);

    expect(layout.margin.top).toBeGreaterThanOrEqual(20);
    expect(layout.margin.right).toBeGreaterThanOrEqual(20);
    expect(layout.margin.bottom).toBeGreaterThanOrEqual(20);
    expect(layout.margin.left).toBeGreaterThanOrEqual(20);
  });

  test('handles object padding from config', () => {
    const specWithPadding: ChartSpec = {
      mark: 'bar',
      config: {
        padding: { top: 10, right: 20, bottom: 30, left: 40 },
      },
    };

    const layout = calculateLayout(specWithPadding);

    expect(layout.margin.top).toBeGreaterThanOrEqual(10);
    expect(layout.margin.right).toBeGreaterThanOrEqual(20);
    expect(layout.margin.bottom).toBeGreaterThanOrEqual(30);
    expect(layout.margin.left).toBeGreaterThanOrEqual(40);
  });

  test('uses imported value-axis label width hints for the left gutter', () => {
    const baseSpec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative', axis: {} },
      },
    };
    const shortLabelSpec: ChartSpec = {
      ...baseSpec,
      config: { layoutHints: { yAxisLabelWidth: 43 } },
    };
    const longLabelSpec: ChartSpec = {
      ...baseSpec,
      config: { layoutHints: { yAxisLabelWidth: 72 } },
    };

    const shortLayout = calculateLayout(shortLabelSpec, { width: 796, height: 436 });
    const longLayout = calculateLayout(longLabelSpec, { width: 796, height: 436 });

    expect(shortLayout.plotArea.x).toBe(93);
    expect(longLayout.plotArea.x).toBe(122);
    expect(shortLayout.plotArea.width).toBeGreaterThan(longLayout.plotArea.width);
  });

  test('uses imported bottom margin hints as the final x-axis gutter', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal', axis: {} },
        y: { field: 'value', type: 'quantitative', axis: {} },
      },
      config: { layoutHints: { bottomMargin: 29 } },
    };

    const layout = calculateLayout(spec, { width: 796, height: 436 });

    expect(layout.margin.bottom).toBe(29);
    expect(layout.plotArea.y + layout.plotArea.height).toBe(407);
  });
});

// =============================================================================
// Title Area Tests
// =============================================================================

describe('Title Area', () => {
  test('creates title area for string title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: 'My Chart',
    };

    const layout = calculateLayout(spec);

    expect(layout.title).toBeDefined();
    expect(layout.title!.width).toBe(layout.width);
    expect(layout.title!.height).toBeGreaterThan(0);
  });

  test('creates title area for title spec with subtitle', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      title: {
        text: 'Main Title',
        subtitle: 'Subtitle',
      },
    };

    const layout = calculateLayout(spec);

    expect(layout.title).toBeDefined();
    // Title with subtitle should be taller
    expect(layout.title!.height).toBeGreaterThan(20);
  });

  test('no title area when no title', () => {
    const spec: ChartSpec = {
      mark: 'bar',
    };

    const layout = calculateLayout(spec);

    expect(layout.title).toBeUndefined();
  });
});

// =============================================================================
// Legend Area Tests
// =============================================================================

describe('Legend Area', () => {
  test('creates legend area for color encoding', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
    };

    const layout = calculateLayout(spec);

    expect(layout.legend).toBeDefined();
    expect(layout.legend!.width).toBeGreaterThan(0);
    expect(layout.legend!.height).toBeGreaterThan(0);
  });

  test('positions legend on right by default', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        color: { field: 'category', type: 'nominal' },
      },
    };

    const layout = calculateLayout(spec);

    // Legend should be on the right side
    expect(layout.legend!.x).toBeGreaterThan(layout.width / 2);
  });

  test('no legend area when no color encoding', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    };

    const layout = calculateLayout(spec);

    expect(layout.legend).toBeUndefined();
  });

  test('no legend area when legend is null', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      encoding: {
        color: { field: 'category', type: 'nominal', legend: null },
      },
    };

    const layout = calculateLayout(spec);

    expect(layout.legend).toBeUndefined();
  });
});

// =============================================================================
// Plot Area Tests
// =============================================================================

describe('Plot Area', () => {
  test('plot area is within total bounds', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      width: 600,
      height: 400,
    };

    const layout = calculateLayout(spec);

    expect(layout.plotArea.x).toBeGreaterThanOrEqual(0);
    expect(layout.plotArea.y).toBeGreaterThanOrEqual(0);
    expect(layout.plotArea.x + layout.plotArea.width).toBeLessThanOrEqual(layout.width);
    expect(layout.plotArea.y + layout.plotArea.height).toBeLessThanOrEqual(layout.height);
  });

  test('plot area respects margins', () => {
    const spec: ChartSpec = {
      mark: 'bar',
    };

    const layout = calculateLayout(spec);

    expect(layout.plotArea.x).toBeGreaterThanOrEqual(layout.margin.left);
    expect(layout.plotArea.y).toBeGreaterThanOrEqual(layout.margin.top);
  });

  test('plot area has minimum size', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      width: 100, // Very small
      height: 100,
    };

    const layout = calculateLayout(spec);

    expect(layout.plotArea.width).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minPlotSize);
    expect(layout.plotArea.height).toBeGreaterThanOrEqual(DEFAULT_LAYOUT.minPlotSize);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('Layout Utilities', () => {
  const spec: ChartSpec = {
    mark: 'bar',
    width: 600,
    height: 400,
  };

  const layout = calculateLayout(spec);

  test('getChartArea returns plotArea', () => {
    const chartArea = getChartArea(layout);
    expect(chartArea).toEqual(layout.plotArea);
  });

  test('isInPlotArea detects points inside', () => {
    const insideX = layout.plotArea.x + layout.plotArea.width / 2;
    const insideY = layout.plotArea.y + layout.plotArea.height / 2;

    expect(isInPlotArea(layout, insideX, insideY)).toBe(true);
  });

  test('isInPlotArea detects points outside', () => {
    expect(isInPlotArea(layout, 0, 0)).toBe(false);
    expect(isInPlotArea(layout, layout.width, layout.height)).toBe(false);
  });

  test('clampToPlotArea clamps coordinates', () => {
    // Point outside top-left
    const clamped1 = clampToPlotArea(layout, 0, 0);
    expect(clamped1.x).toBe(layout.plotArea.x);
    expect(clamped1.y).toBe(layout.plotArea.y);

    // Point outside bottom-right
    const clamped2 = clampToPlotArea(layout, 1000, 1000);
    expect(clamped2.x).toBe(layout.plotArea.x + layout.plotArea.width);
    expect(clamped2.y).toBe(layout.plotArea.y + layout.plotArea.height);
  });

  test('getXRange returns horizontal extent', () => {
    const [x0, x1] = getXRange(layout);
    expect(x0).toBe(layout.plotArea.x);
    expect(x1).toBe(layout.plotArea.x + layout.plotArea.width);
  });

  test('getYRange returns inverted vertical extent', () => {
    const [y0, y1] = getYRange(layout);
    // Y is inverted for canvas coordinates
    expect(y0).toBe(layout.plotArea.y + layout.plotArea.height);
    expect(y1).toBe(layout.plotArea.y);
  });

  test('getInnerDimensions returns plot area size', () => {
    const dims = getInnerDimensions(layout);
    expect(dims.width).toBe(layout.plotArea.width);
    expect(dims.height).toBe(layout.plotArea.height);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Layout Edge Cases', () => {
  test('handles empty spec', () => {
    const spec: ChartSpec = {};

    const layout = calculateLayout(spec);

    expect(layout.width).toBe(DEFAULT_LAYOUT.width);
    expect(layout.height).toBe(DEFAULT_LAYOUT.height);
    expect(layout.plotArea).toBeDefined();
  });

  test('handles very large dimensions', () => {
    const spec: ChartSpec = {
      mark: 'bar',
      width: 10000,
      height: 10000,
    };

    const layout = calculateLayout(spec);

    expect(layout.width).toBe(10000);
    expect(layout.height).toBe(10000);
    expect(layout.plotArea.width).toBeLessThan(10000);
    expect(layout.plotArea.height).toBeLessThan(10000);
  });
});
