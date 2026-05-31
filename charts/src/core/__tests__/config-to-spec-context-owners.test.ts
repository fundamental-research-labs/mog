import { jest } from '@jest/globals';
import * as axisModule from '../config-to-spec/axis';
import { buildLayoutHints } from '../config-to-spec/layout-hints';
import type { ChartConfig, ChartData } from '../../types';

describe('configToSpec context owner threading', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('maps secondary y-axis layout hints with chart config and owner context', () => {
    const mapAxisSpy = jest.spyOn(axisModule, 'mapAxisConfigToAxisSpec');
    const config: ChartConfig = {
      type: 'combo',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      axis: {
        secondaryValueAxis: {
          show: true,
          min: 1000,
          max: 2000,
          numberFormat: '#,##0',
        },
      },
      series: [{ yAxisIndex: 1 }],
    } as ChartConfig;
    const data: ChartData = {
      categories: ['A'],
      series: [
        {
          name: 'Secondary',
          yAxisIndex: 1,
          data: [{ x: 'A', y: 1500 }],
        },
      ],
    };

    expect(buildLayoutHints(config, undefined, data)?.rightYAxisLabelWidth).toBeGreaterThan(0);
    expect(mapAxisSpy).toHaveBeenCalledWith(
      config.axis?.secondaryValueAxis,
      config,
      'secondaryValueAxis',
    );
  });
});
