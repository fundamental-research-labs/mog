import type { ChartConfig, ChartData } from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { snapshotBarGeometry } from '../bridge/resolved-spec-plot-snapshot';

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
        orientation: 'vertical',
        grouping: 'clustered',
        sourceGapWidth: 100,
        sourceOverlap: 50,
        gapWidth: 100,
        overlap: 50,
        gapWidthClamped: undefined,
        overlapClamped: undefined,
        seriesIndices: [0],
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
});
