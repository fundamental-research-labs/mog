/**
 * Tests for layout-snapshot.ts — extractChartLayout()
 *
 * Verifies that:
 * 1. Plot area bounds are positive and within chart bounds
 * 2. Title bounds are present when title is specified
 * 3. Legend bounds are present when color encoding is used
 * 4. All values are in points (px * 0.75)
 * 5. Layout updates when chart dimensions change
 */

import { compile } from '../compiler';
import { extractChartLayout } from '../layout-snapshot';
import type { ChartSpec } from '../spec';

const PX_TO_PT = 72 / 96; // 0.75

// =============================================================================
// Helpers
// =============================================================================

function makeBarSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    mark: 'bar',
    width: 600,
    height: 400,
    data: {
      values: [
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
        { category: 'C', value: 30 },
      ],
    },
    encoding: {
      x: { field: 'category', type: 'nominal' },
      y: { field: 'value', type: 'quantitative' },
    },
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('extractChartLayout', () => {
  it('produces plotArea bounds that are positive and within chart bounds', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    // Chart bounds
    expect(layout.chart.left).toBe(0);
    expect(layout.chart.top).toBe(0);
    expect(layout.chart.width).toBeGreaterThan(0);
    expect(layout.chart.height).toBeGreaterThan(0);

    // Plot area within chart
    expect(layout.plotArea.left).toBeGreaterThanOrEqual(0);
    expect(layout.plotArea.top).toBeGreaterThanOrEqual(0);
    expect(layout.plotArea.width).toBeGreaterThan(0);
    expect(layout.plotArea.height).toBeGreaterThan(0);
    expect(layout.plotArea.left + layout.plotArea.width).toBeLessThanOrEqual(
      layout.chart.width + 0.01,
    );
    expect(layout.plotArea.top + layout.plotArea.height).toBeLessThanOrEqual(
      layout.chart.height + 0.01,
    );
  });

  it('produces inside dimensions equal to outer dimensions (no insets yet)', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    expect(layout.plotArea.insideLeft).toBe(layout.plotArea.left);
    expect(layout.plotArea.insideTop).toBe(layout.plotArea.top);
    expect(layout.plotArea.insideWidth).toBe(layout.plotArea.width);
    expect(layout.plotArea.insideHeight).toBe(layout.plotArea.height);
  });

  it('includes title bounds when title is specified', () => {
    const result = compile(makeBarSpec({ title: 'My Chart' }));
    const layout = extractChartLayout(result);

    expect(layout.title).toBeDefined();
    expect(layout.title!.width).toBeGreaterThan(0);
    expect(layout.title!.height).toBeGreaterThan(0);
  });

  it('omits title when no title is specified', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    expect(layout.title).toBeUndefined();
  });

  it('includes legend when color encoding is used', () => {
    const spec = makeBarSpec({
      data: {
        values: [
          { category: 'A', value: 10, group: 'X' },
          { category: 'B', value: 20, group: 'Y' },
          { category: 'C', value: 30, group: 'X' },
        ],
      },
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
        color: { field: 'group', type: 'nominal' },
      },
    });
    const result = compile(spec);
    const layout = extractChartLayout(result);

    expect(layout.legend).toBeDefined();
    expect(layout.legend!.width).toBeGreaterThan(0);
    expect(layout.legend!.height).toBeGreaterThan(0);
    // Should have entries tagged with entryIndex
    expect(layout.legend!.entries.length).toBeGreaterThan(0);
    // Entries should be sorted by index
    for (let i = 1; i < layout.legend!.entries.length; i++) {
      expect(layout.legend!.entries[i].index).toBeGreaterThan(layout.legend!.entries[i - 1].index);
    }
  });

  it('omits legend when no color encoding is used', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    expect(layout.legend).toBeUndefined();
  });

  it('returns all values in points (px * 0.75)', () => {
    const widthPx = 600;
    const heightPx = 400;
    const result = compile(makeBarSpec({ width: widthPx, height: heightPx }));
    const layout = extractChartLayout(result);

    // Chart dimensions should be exact px-to-pt conversion
    expect(layout.chart.width).toBeCloseTo(widthPx * PX_TO_PT, 5);
    expect(layout.chart.height).toBeCloseTo(heightPx * PX_TO_PT, 5);

    // Plot area values should also be exact px-to-pt conversion of internal layout
    const internalPlot = result.layout.plotArea;
    expect(layout.plotArea.left).toBeCloseTo(internalPlot.x * PX_TO_PT, 5);
    expect(layout.plotArea.top).toBeCloseTo(internalPlot.y * PX_TO_PT, 5);
    expect(layout.plotArea.width).toBeCloseTo(internalPlot.width * PX_TO_PT, 5);
    expect(layout.plotArea.height).toBeCloseTo(internalPlot.height * PX_TO_PT, 5);
  });

  it('updates layout when chart dimensions change', () => {
    const smallResult = compile(makeBarSpec({ width: 300, height: 200 }));
    const largeResult = compile(makeBarSpec({ width: 900, height: 600 }));
    const smallLayout = extractChartLayout(smallResult);
    const largeLayout = extractChartLayout(largeResult);

    expect(largeLayout.chart.width).toBeGreaterThan(smallLayout.chart.width);
    expect(largeLayout.chart.height).toBeGreaterThan(smallLayout.chart.height);
    expect(largeLayout.plotArea.width).toBeGreaterThan(smallLayout.plotArea.width);
    expect(largeLayout.plotArea.height).toBeGreaterThan(smallLayout.plotArea.height);
  });

  it('includes axis layouts for x and y axes', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    expect(layout.axes.length).toBeGreaterThanOrEqual(2);

    const xAxis = layout.axes.find((a) => a.channel === 'x');
    const yAxis = layout.axes.find((a) => a.channel === 'y');

    expect(xAxis).toBeDefined();
    expect(yAxis).toBeDefined();
    expect(xAxis!.width).toBeGreaterThan(0);
    expect(yAxis!.height).toBeGreaterThan(0);
  });

  it('returns empty dataLabels array (placeholder)', () => {
    const result = compile(makeBarSpec());
    const layout = extractChartLayout(result);

    expect(layout.dataLabels).toEqual([]);
  });
});
