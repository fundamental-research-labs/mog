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

  it('applies manual plot, title, and legend layout hints', () => {
    const result = compile(
      makeBarSpec({
        title: 'Manual Layout',
        data: {
          values: [
            { category: 'A', value: 10, group: 'North' },
            { category: 'B', value: 20, group: 'South' },
            { category: 'C', value: 30, group: 'North' },
          ],
        },
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'value', type: 'quantitative' },
          color: { field: 'group', type: 'nominal' },
        },
        config: {
          layoutHints: {
            manualPlotArea: { xMode: 'edge', yMode: 'edge', x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
            manualTitle: { xMode: 'edge', yMode: 'edge', x: 0.2, y: 0.05, w: 0.5, h: 0.1 },
            manualLegend: {
              xMode: 'edge',
              yMode: 'edge',
              wMode: 'edge',
              hMode: 'edge',
              x: 0.65,
              y: 0.1,
              w: 0.95,
              h: 0.3,
            },
          },
        },
      }),
    );

    const layout = extractChartLayout(result);

    expect(layout.plotArea.left).toBeCloseTo(60 * PX_TO_PT, 5);
    expect(layout.plotArea.top).toBeCloseTo(80 * PX_TO_PT, 5);
    expect(layout.plotArea.width).toBeCloseTo(300 * PX_TO_PT, 5);
    expect(layout.plotArea.height).toBeCloseTo(160 * PX_TO_PT, 5);

    expect(layout.title).toBeDefined();
    expect(layout.title!.left).toBeCloseTo(120 * PX_TO_PT, 5);
    expect(layout.title!.top).toBeCloseTo(20 * PX_TO_PT, 5);
    expect(layout.title!.width).toBeCloseTo(300 * PX_TO_PT, 5);
    expect(layout.title!.height).toBeCloseTo(40 * PX_TO_PT, 5);

    expect(layout.legend).toBeDefined();
    expect(layout.legend!.left).toBeCloseTo(390 * PX_TO_PT, 5);
    expect(layout.legend!.top).toBeCloseTo(40 * PX_TO_PT, 5);
    expect(layout.legend!.width).toBeCloseTo(180 * PX_TO_PT, 5);
    expect(layout.legend!.height).toBeCloseTo(80 * PX_TO_PT, 5);
  });

  it('applies factor manual coordinates relative to the auto layout rectangle', () => {
    const result = compile(
      makeBarSpec({
        title: 'Factor Layout',
        config: {
          layoutHints: {
            manualTitle: {
              xMode: 'factor',
              yMode: 'factor',
              x: 0.1,
              y: 0.1,
              w: 0.5,
              h: 0.2,
            },
          },
        },
      }),
    );

    const layout = extractChartLayout(result);

    expect(layout.title).toBeDefined();
    expect(layout.title!.left).toBeCloseTo(60 * PX_TO_PT, 5);
    expect(layout.title!.top).toBeCloseTo(60 * PX_TO_PT, 5);
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

  it('extracts data-label bounds from generated text marks', () => {
    const result = compile({
      width: 400,
      height: 200,
      data: {
        values: [
          {
            category: 'A',
            value: 10,
            __mogDataLabelVisible: true,
            __mogPointIndex: 0,
            __mogSeriesIndex: 0,
            __mogDataLabelText: '10',
            __mogDataLabelLayoutX: 0.25,
            __mogDataLabelLayoutY: 0.3,
          },
        ],
      },
      layer: [
        {
          mark: 'bar',
          encoding: {
            x: { field: 'category', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
        },
        {
          mark: {
            type: 'text',
            xField: '__mogDataLabelLayoutX',
            yField: '__mogDataLabelLayoutY',
            coordinateSystem: 'chartFraction',
            align: 'left',
            textBaseline: 'top',
          },
          encoding: {
            text: { field: '__mogDataLabelText', type: 'nominal' },
          },
        },
      ],
    });
    const layout = extractChartLayout(result);

    expect(layout.dataLabels).toHaveLength(1);
    expect(layout.dataLabels[0]).toMatchObject({
      left: 100 * PX_TO_PT,
      top: 60 * PX_TO_PT,
      seriesIndex: 0,
      pointIndex: 0,
    });
    expect(layout.dataLabels[0].width).toBeGreaterThan(0);
  });

  it('includes data-table bounds when layout reserves a table band', () => {
    const result = compile(
      makeBarSpec({
        config: {
          layoutHints: {
            dataTable: { rowCount: 3, height: 62 },
          },
        },
      }),
    );
    const layout = extractChartLayout(result);

    expect(layout.dataTable).toBeDefined();
    expect(layout.dataTable!.top).toBeGreaterThan(layout.plotArea.top);
    expect(layout.dataTable!.width).toBeCloseTo(layout.plotArea.width, 5);
  });
});
