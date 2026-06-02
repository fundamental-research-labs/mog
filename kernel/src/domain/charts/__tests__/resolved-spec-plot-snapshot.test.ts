import type { ChartConfig, ChartData } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import {
  snapshotBarGeometry,
  snapshotCartesianGeometry,
} from '../bridge/resolved-spec-plot-snapshot';

describe('resolved spec plot snapshot helpers', () => {
  it('snapshots Excel bar geometry for renderable bar-like combo series', () => {
    const config: ChartConfig = {
      type: 'combo',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      gapWidth: 100,
      overlap: 50,
      series: [
        { name: 'Revenue', type: 'column' },
        { name: 'Trend', type: 'line' },
        { name: 'Hidden bar', type: 'bar', format: { fill: { type: 'none' } } },
      ],
    };
    const chartData: ChartData = {
      categories: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Revenue', data: [] },
        { name: 'Trend', data: [] },
        { name: 'Hidden bar', data: [] },
      ],
    };
    const layout: ResolvedChartSpecSnapshot['resolved']['layout'] = {
      plotArea: { left: 0, top: 0, width: 300, height: 200 },
    };

    expect(snapshotBarGeometry(config, chartData, layout)).toEqual([
      {
        groupKey: 'bar:0:vertical:clustered',
        orientation: 'vertical',
        grouping: 'clustered',
        sourceGapWidth: 100,
        sourceOverlap: 50,
        gapWidth: 100,
        overlap: 50,
        seriesIndices: [0],
        categoryAxisRole: 'x',
        valueAxisRole: 'y',
        categoryPositionPolicy: 'between',
        categoryCrossing: 'between',
        valueCrossing: 'automatic',
        baselineValue: 0,
        axisLayoutStatus: 'verifiedDefault',
        geometryStatus: 'verifiedDefault',
        plotAreaSource: 'auto',
        categoryAxisLength: 300,
        visibleCategoryCount: 3,
        categoryPitch: 100,
        barSize: 50,
        offsets: [{ seriesIndex: 0, offset: 25 }],
      },
    ]);
  });

  it('omits bar geometry when no renderable bar-like series remain', () => {
    const config: ChartConfig = {
      type: 'combo',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      series: [
        { name: 'Trend', type: 'line' },
        { name: 'Hidden bar', type: 'bar', format: { fill: { type: 'none' } } },
      ],
    };
    const chartData: ChartData = {
      categories: ['Jan'],
      series: [
        { name: 'Trend', data: [] },
        { name: 'Hidden bar', data: [] },
      ],
    };

    expect(snapshotBarGeometry(config, chartData, null)).toBeUndefined();
  });

  it('snapshots imported scatter quantitative x geometry across series', () => {
    const config: ChartConfig = {
      type: 'scatter',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      extra: { sourceDialect: 'ooxml' },
      series: [{ xRole: 'quantitative' }, { xRole: 'quantitative' }],
    };
    const chartData: ChartData = {
      categories: [-0.065, 0.145],
      series: [
        {
          name: 'Cluster 1',
          data: [
            { x: -0.065, y: 1 },
            { x: 0.145, y: 2 },
          ],
        },
        {
          name: 'Cluster 2',
          data: [
            { x: 0.135, y: 3 },
            { x: -0.063, y: 4 },
            { x: 0.093, y: 5 },
          ],
        },
      ],
    };

    const geometry = snapshotCartesianGeometry(config, chartData);

    expect(geometry?.x.modes).toEqual(['quantitative']);
    expect(geometry?.x.quantitative).toMatchObject({ mode: 'quantitative', field: 'x' });
    expect(geometry?.series.map((series) => series.xRole)).toEqual([
      'quantitative',
      'quantitative',
    ]);
  });

  it('snapshots one-series imported percent-stacked area geometry', () => {
    const config: ChartConfig = {
      type: 'area',
      subType: 'percentStacked',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      extra: { sourceDialect: 'ooxml' },
    };
    const chartData: ChartData = {
      categories: ['A', 'B'],
      series: [
        {
          name: 'Series 1',
          data: [
            { x: 'A', y: 5 },
            { x: 'B', y: 10 },
          ],
        },
      ],
    };

    expect(snapshotCartesianGeometry(config, chartData)?.area).toMatchObject({
      stackMode: 'normalize',
      baseline: 0,
      percentDomain: [0, 100],
      groups: [{ axisGroup: 'primary', xRole: 'category', seriesIndices: [0] }],
    });
  });

  it('snapshots imported bubble size normalization metadata', () => {
    const config: ChartConfig = {
      type: 'bubble',
      anchorRow: 0,
      anchorCol: 0,
      width: 4,
      height: 5,
      extra: { sourceDialect: 'ooxml' },
      sizeRepresents: 'w',
      bubbleScale: 250,
      showNegBubbles: true,
    };
    const chartData: ChartData = {
      categories: [1, 2],
      series: [
        {
          name: 'Bubbles',
          data: [
            { x: 1, y: 10, size: 5 },
            { x: 2, y: 20, size: -10 },
          ],
        },
      ],
    };

    expect(snapshotCartesianGeometry(config, chartData)?.bubble).toEqual({
      sizeRepresents: 'w',
      bubbleScale: 250,
      showNegBubbles: true,
      maxRenderableMagnitude: 10,
      maxRenderedArea: 16000,
      normalizedSizeField: 'size',
      rawSizeField: '__mogRawBubbleSize',
    });
  });
});
