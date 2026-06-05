import type { ChartConfig, SingleAxisConfig } from '@mog-sdk/contracts/data/charts';

export type AxisModelRole = 'category' | 'value' | 'series';

export type AxisConfigSlot =
  | 'categoryAxis'
  | 'xAxis'
  | 'xValueAxis'
  | 'valueAxis'
  | 'yAxis'
  | 'yValueAxis'
  | 'secondaryCategoryAxis'
  | 'secondaryValueAxis'
  | 'secondaryYAxis'
  | 'seriesAxis';

const CATEGORY_AXIS_SLOTS = new Set<AxisConfigSlot>([
  'categoryAxis',
  'xAxis',
  'secondaryCategoryAxis',
]);
const VALUE_AXIS_SLOTS = new Set<AxisConfigSlot>([
  'xValueAxis',
  'valueAxis',
  'yAxis',
  'yValueAxis',
  'secondaryValueAxis',
  'secondaryYAxis',
]);

export function isXYValueAxisChartType(type: string | null | undefined): boolean {
  return type === 'scatter' || type === 'bubble' || type === 'bubble3DEffect';
}

export function axisModelRole(
  axis: SingleAxisConfig | undefined,
  slot?: AxisConfigSlot,
): AxisModelRole | undefined {
  if (!axis) return undefined;
  const explicitRole = explicitAxisModelRole(axis);
  if (explicitRole) return explicitRole;
  if (slot === 'seriesAxis') return 'series';
  if (slot && VALUE_AXIS_SLOTS.has(slot)) return 'value';
  if (slot && CATEGORY_AXIS_SLOTS.has(slot)) return 'category';
  return undefined;
}

export function isCategoryDateAxis(
  axis: SingleAxisConfig | undefined,
  slot?: AxisConfigSlot,
): boolean {
  return axisModelRole(axis, slot) === 'category';
}

export function isValueAxis(axis: SingleAxisConfig | undefined, slot?: AxisConfigSlot): boolean {
  return axisModelRole(axis, slot) === 'value';
}

export function semanticCategoryAxisForModel(
  config: Pick<ChartConfig, 'axis' | 'type'>,
): SingleAxisConfig | undefined {
  const axis = config.axis;
  if (!axis) return undefined;
  if (isCategoryDateAxis(axis.categoryAxis, 'categoryAxis')) return axis.categoryAxis;
  if (isXYValueAxisChartType(config.type)) {
    return explicitAxisModelRole(axis.xAxis) === 'category' ? axis.xAxis : undefined;
  }
  return isCategoryDateAxis(axis.xAxis, 'xAxis') ? axis.xAxis : undefined;
}

export function secondarySemanticCategoryAxisForModel(
  config: Pick<ChartConfig, 'axis'>,
): SingleAxisConfig | undefined {
  const axis = config.axis;
  if (!axis) return undefined;
  return isCategoryDateAxis(axis.secondaryCategoryAxis, 'secondaryCategoryAxis')
    ? axis.secondaryCategoryAxis
    : undefined;
}

export function primaryValueAxisForModel(
  config: Pick<ChartConfig, 'axis' | 'type'>,
): SingleAxisConfig | undefined {
  if (isXYValueAxisChartType(config.type)) return yValueAxisForModel(config);
  const axis = config.axis;
  if (!axis) return undefined;
  const valueAxis = axis.valueAxis ?? axis.yAxis;
  return isValueAxis(valueAxis, 'valueAxis') ? valueAxis : undefined;
}

export function secondaryValueAxisForModel(
  config: Pick<ChartConfig, 'axis'>,
): SingleAxisConfig | undefined {
  const axis = config.axis;
  if (!axis) return undefined;
  const valueAxis = axis.secondaryValueAxis ?? axis.secondaryYAxis;
  return isValueAxis(valueAxis, 'secondaryValueAxis') ? valueAxis : undefined;
}

export function xValueAxisForModel(
  config: Pick<ChartConfig, 'axis' | 'type'>,
): SingleAxisConfig | undefined {
  if (!isXYValueAxisChartType(config.type)) return undefined;
  const axis = config.axis;
  if (!axis) return undefined;
  if (isValueAxis(axis.xAxis, 'xValueAxis')) return axis.xAxis;
  if (!axis.xAxis && isValueAxis(axis.valueAxis, 'valueAxis')) return axis.valueAxis;
  return undefined;
}

export function yValueAxisForModel(
  config: Pick<ChartConfig, 'axis' | 'type'>,
): SingleAxisConfig | undefined {
  if (!isXYValueAxisChartType(config.type)) return undefined;
  const axis = config.axis;
  if (!axis) return undefined;
  const valueAxis = axis.yAxis ?? axis.secondaryValueAxis ?? axis.secondaryYAxis ?? axis.valueAxis;
  return isValueAxis(valueAxis, 'yValueAxis') ? valueAxis : undefined;
}

function explicitAxisModelRole(axis: SingleAxisConfig | undefined): AxisModelRole | undefined {
  if (!axis) return undefined;
  const raw = axis.axisType ?? axis.type;
  if (!raw) return undefined;
  const normalized = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  switch (normalized) {
    case 'catax':
    case 'category':
    case 'dateax':
    case 'dateaxis':
    case 'time':
      return 'category';
    case 'valax':
    case 'value':
    case 'log':
      return 'value';
    case 'serax':
    case 'series':
    case 'seriesaxis':
      return 'series';
    default:
      return undefined;
  }
}
