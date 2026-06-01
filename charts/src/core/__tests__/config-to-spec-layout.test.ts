import type { ChartConfig, ChartData } from '../../types';
import { configToSpec } from '../config-to-spec';

describe('configToSpec layout hints', () => {
  it('projects manual plot, title, and legend layouts into grammar layout hints', () => {
    const data: ChartData = {
      categories: ['A', 'B'],
      series: [{ name: 'Revenue', data: [10, 20] }],
    };
    const config: ChartConfig = {
      type: 'column',
      anchorRow: 0,
      anchorCol: 0,
      width: 8,
      height: 5,
      title: 'Revenue',
      plotLayout: { layoutTarget: 'inner', x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
      titleLayout: { xMode: 'factor', yMode: 'factor', x: 0.2, y: 0.05 },
      legend: {
        show: true,
        visible: true,
        position: 'right',
        layout: { xMode: 'edge', wMode: 'edge', x: 0.7, w: 0.95 },
      },
    };

    const spec = configToSpec(config, data);

    expect(spec.config?.layoutHints?.manualPlotArea).toEqual({
      layoutTarget: 'inner',
      x: 0.1,
      y: 0.2,
      w: 0.7,
      h: 0.6,
    });
    expect(spec.config?.layoutHints?.manualTitle).toEqual({
      xMode: 'factor',
      yMode: 'factor',
      x: 0.2,
      y: 0.05,
    });
    expect(spec.config?.layoutHints?.manualLegend).toEqual({
      xMode: 'edge',
      wMode: 'edge',
      x: 0.7,
      w: 0.95,
    });
  });
});
