import type {
  AxisConfig,
  AxisType,
  Chart,
  ChartType,
  LegendPosition,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';
import type {
  ChartAppModel,
  ChartAppModelValueSource,
  ChartAxisAppModel,
  ChartAxisRole,
} from '@mog-sdk/contracts/data/chart-app-model';

import { chartSourceBindingFromChart } from './chart-source-binding';

function axisForRole(
  axis: AxisConfig | undefined,
  role: ChartAxisRole,
): SingleAxisConfig | undefined {
  switch (role) {
    case 'category':
      return axis?.categoryAxis ?? axis?.xAxis;
    case 'value':
      return axis?.valueAxis ?? axis?.yAxis;
    case 'secondaryCategory':
      return axis?.secondaryCategoryAxis;
    case 'secondaryValue':
      return axis?.secondaryValueAxis ?? axis?.secondaryYAxis;
    case 'series':
      return axis?.seriesAxis;
  }
}

function defaultAxisType(role: ChartAxisRole): AxisType | undefined {
  switch (role) {
    case 'category':
    case 'secondaryCategory':
      return 'category';
    case 'value':
    case 'secondaryValue':
      return 'value';
    case 'series':
      return undefined;
  }
}

function chartTypeDefaultsAxes(type: Chart['type']): boolean {
  switch (type) {
    case 'pie':
    case 'doughnut':
    case 'pieExploded':
    case 'pie3d':
    case 'pie3dExploded':
    case 'doughnutExploded':
    case 'ofPie':
    case 'treemap':
    case 'sunburst':
    case 'regionMap':
    case 'funnel':
      return false;
    default:
      return true;
  }
}

function toAxisType(value: string | undefined): AxisType | undefined {
  return value === 'category' || value === 'value' || value === 'time' || value === 'log'
    ? value
    : undefined;
}

function axisModel(
  chart: Chart,
  axis: AxisConfig | undefined,
  role: ChartAxisRole,
): ChartAxisAppModel {
  const single = axisForRole(axis, role);
  const applicable = Boolean(single) || chartTypeDefaultsAxes(chart.type);
  const visible = applicable && (single ? (single.visible ?? single.show ?? true) : true);
  const title = single?.title?.trim() ? single.title : null;
  const source: ChartAppModelValueSource = single ? 'explicit' : applicable ? 'default' : 'absent';
  return {
    role,
    applicable,
    visible,
    title,
    titleVisible: Boolean(title) && single?.titleVisible !== false,
    source,
    axisType: single?.type ?? toAxisType(single?.axisType) ?? defaultAxisType(role),
  };
}

function normalizeLegendPosition(position: string | undefined): LegendPosition {
  if (
    position === 'top' ||
    position === 'bottom' ||
    position === 'left' ||
    position === 'right' ||
    position === 'topRight' ||
    position === 'top-right' ||
    position === 'tr' ||
    position === 'none' ||
    position === 'corner' ||
    position === 'custom'
  ) {
    return position;
  }
  return 'none';
}

export function chartToAppModel(chart: Chart): ChartAppModel {
  const titleText = chart.title?.trim() ? chart.title : chart.chartTitle?.text?.trim() || null;
  const titleVisible =
    chart.autoTitleDeleted === true
      ? false
      : Boolean(titleText) && chart.chartTitle?.visible !== false;
  const legend = chart.legend;
  const legendPosition = normalizeLegendPosition(legend?.position);
  const legendVisible = Boolean(
    legend && legendPosition !== 'none' && legend.show !== false && legend.visible !== false,
  );
  const secondaryCategory = axisForRole(chart.axis, 'secondaryCategory')
    ? axisModel(chart, chart.axis, 'secondaryCategory')
    : undefined;
  const secondaryValue = axisForRole(chart.axis, 'secondaryValue')
    ? axisModel(chart, chart.axis, 'secondaryValue')
    : undefined;
  const series = axisForRole(chart.axis, 'series')
    ? axisModel(chart, chart.axis, 'series')
    : undefined;

  return {
    id: chart.id,
    type: chart.type as ChartType,
    title: {
      text: titleText,
      visible: titleVisible,
      source: titleText ? 'explicit' : chart.autoTitleDeleted === true ? 'absent' : 'default',
    },
    legend: {
      visible: legendVisible,
      position: legend ? legendPosition : 'none',
      source: legend ? 'explicit' : 'absent',
    },
    axes: {
      category: axisModel(chart, chart.axis, 'category'),
      value: axisModel(chart, chart.axis, 'value'),
      ...(secondaryCategory ? { secondaryCategory } : {}),
      ...(secondaryValue ? { secondaryValue } : {}),
      ...(series ? { series } : {}),
    },
    source: chartSourceBindingFromChart(chart),
  };
}
