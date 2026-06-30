import type { Chart, ChartMutationReceipt, SingleAxisConfig } from '@mog-sdk/contracts/api';
import type { ChartAxisRole } from '@mog-sdk/contracts/data/chart-app-model';

interface ChartCompatibilityMethodSource {
  getAxisItem(
    chartId: string,
    type: 'category' | 'value' | 'series',
    group: 'primary' | 'secondary',
  ): Promise<SingleAxisConfig | null>;
  setAxisTitle(
    chartId: string,
    axisRole: ChartAxisRole,
    title: string,
  ): Promise<ChartMutationReceipt>;
  setAxisVisible(
    chartId: string,
    axisRole: ChartAxisRole,
    visible: boolean,
  ): Promise<ChartMutationReceipt>;
  updateRaw(chartId: string, fields: Record<string, unknown>): Promise<void>;
}

export function withChartCompatibilityMethods(
  chart: Chart,
  source: ChartCompatibilityMethodSource,
): Chart {
  Object.defineProperties(chart, {
    getAxisItem: {
      configurable: true,
      enumerable: false,
      value: (type: string, group: 'primary' | 'secondary' = 'primary') => {
        const axisRole = normalizeChartAxisRole(type, group);
        const axisInput = axisItemInputForRole(axisRole);
        return {
          chartId: chart.id,
          axisRole,
          getConfig: () => source.getAxisItem(chart.id, axisInput.type, axisInput.group),
          setTitle: (title: string) => source.setAxisTitle(chart.id, axisRole, title),
          setVisible: (visible: boolean) => source.setAxisVisible(chart.id, axisRole, visible),
        };
      },
    },
    updateRaw: {
      configurable: true,
      enumerable: false,
      value: (fields: Record<string, unknown>) => source.updateRaw(chart.id, fields),
    },
  });

  return chart;
}

function normalizeChartAxisRole(value: string, group: 'primary' | 'secondary'): ChartAxisRole {
  switch (value.trim()) {
    case 'category':
    case 'categoryAxis':
    case 'x':
    case 'xAxis':
      return group === 'secondary' ? 'secondaryCategory' : 'category';
    case 'value':
    case 'valueAxis':
    case 'y':
    case 'yAxis':
      return group === 'secondary' ? 'secondaryValue' : 'value';
    case 'secondaryCategory':
    case 'secondaryCategoryAxis':
      return 'secondaryCategory';
    case 'secondaryValue':
    case 'secondaryValueAxis':
      return 'secondaryValue';
    case 'series':
    case 'seriesAxis':
      return 'series';
    default:
      return group === 'secondary' ? 'secondaryValue' : 'value';
  }
}

function axisItemInputForRole(axisRole: ChartAxisRole): {
  type: 'category' | 'value' | 'series';
  group: 'primary' | 'secondary';
} {
  switch (axisRole) {
    case 'category':
      return { type: 'category', group: 'primary' };
    case 'secondaryCategory':
      return { type: 'category', group: 'secondary' };
    case 'series':
      return { type: 'series', group: 'primary' };
    case 'secondaryValue':
      return { type: 'value', group: 'secondary' };
    case 'value':
    default:
      return { type: 'value', group: 'primary' };
  }
}
