import type {
  AxisConfig,
  AxisType,
  Chart,
  ChartConfig,
  LegendConfig,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';
import type { ChartAxisRole } from '@mog-sdk/contracts/data/chart-app-model';

function axisKeyForRole(role: ChartAxisRole): keyof AxisConfig {
  switch (role) {
    case 'category':
      return 'categoryAxis';
    case 'value':
      return 'valueAxis';
    case 'secondaryCategory':
      return 'secondaryCategoryAxis';
    case 'secondaryValue':
      return 'secondaryValueAxis';
    case 'series':
      return 'seriesAxis';
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

function toAxisType(value: string | undefined): AxisType | undefined {
  return value === 'category' || value === 'value' || value === 'time' || value === 'log'
    ? value
    : undefined;
}

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

export function mergeAxisRoleConfig(
  axis: AxisConfig | undefined,
  role: ChartAxisRole,
  patch: Partial<SingleAxisConfig>,
): AxisConfig {
  const key = axisKeyForRole(role);
  const current = axisForRole(axis, role);
  const type = current?.type ?? toAxisType(current?.axisType) ?? defaultAxisType(role);
  const next: SingleAxisConfig = {
    ...(type ? { type, axisType: type } : {}),
    visible: current?.visible ?? current?.show ?? true,
    show: current?.show ?? current?.visible ?? true,
    ...current,
    ...patch,
  };
  const nextAxis: AxisConfig = {
    ...(axis ?? {}),
    [key]: next,
  };
  if (role === 'category') nextAxis.xAxis = next;
  if (role === 'value') nextAxis.yAxis = next;
  if (role === 'secondaryValue') nextAxis.secondaryYAxis = next;
  return nextAxis;
}

export function legendVisibilityUpdate(chart: Chart, visible: boolean): Partial<ChartConfig> {
  const previous = chart.legend;
  const previousPosition =
    previous?.position && previous.position !== 'none' ? previous.position : 'bottom';
  const legend: LegendConfig = {
    show: visible,
    visible,
    position: visible ? previousPosition : (previous?.position ?? 'bottom'),
    ...(previous ?? {}),
  };
  legend.show = visible;
  legend.visible = visible;
  if (visible && legend.position === 'none') legend.position = 'bottom';
  return { legend };
}

export function axisVisibilityUpdate(
  chart: Chart,
  role: ChartAxisRole,
  visible: boolean,
): Partial<ChartConfig> {
  return {
    axis: mergeAxisRoleConfig(chart.axis, role, { visible, show: visible }),
  };
}

export function axisTitleUpdate(
  chart: Chart,
  role: ChartAxisRole,
  title: string,
): Partial<ChartConfig> {
  const normalizedTitle = title.trim() ? title : '';
  return {
    axis: mergeAxisRoleConfig(chart.axis, role, {
      title: normalizedTitle,
      titleVisible: Boolean(normalizedTitle),
    }),
  };
}

export function chartTitleVisibilityUpdate(chart: Chart, visible: boolean): Partial<ChartConfig> {
  if (visible) {
    return {
      title: chart.title || chart.chartTitle?.text || 'Chart Title',
      autoTitleDeleted: false,
      chartTitle: {
        ...(chart.chartTitle ?? {}),
        visible: true,
      },
    };
  }
  return {
    title: null,
    autoTitleDeleted: true,
    chartTitle: {
      ...(chart.chartTitle ?? {}),
      visible: false,
    },
  };
}
