import type {
  AxisConfig,
  AxisType,
  ChartConfig,
  LegendConfig,
  PieSliceConfig,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';
import type { StoredChartConfig } from '@mog/charts';

/**
 * Adapter from spreadsheet-app UI drafts to canonical chart contracts.
 *
 * This module does not own chart domain types. Public chart contracts stay in
 * @mog-sdk/contracts and StoredChartConfig stays in @mog/charts.
 */
export type AppLegendConfigDraft = Partial<LegendConfig>;

export type AppSingleAxisConfigDraft = Partial<SingleAxisConfig> & {
  type?: AxisType;
};

export interface AppAxisConfigDraft {
  categoryAxis?: AppSingleAxisConfigDraft;
  valueAxis?: AppSingleAxisConfigDraft;
  secondaryCategoryAxis?: AppSingleAxisConfigDraft;
  secondaryValueAxis?: AppSingleAxisConfigDraft;
  seriesAxis?: AppSingleAxisConfigDraft;
  xAxis?: AppSingleAxisConfigDraft;
  yAxis?: AppSingleAxisConfigDraft;
  secondaryYAxis?: AppSingleAxisConfigDraft;
}

export type AppPieSliceConfigDraft = Partial<PieSliceConfig> & {
  explodedIndex?: number;
  selectable?: boolean;
};

export type ChartConfigDraft = Omit<ChartConfig, 'legend' | 'axis' | 'pieSlice'> & {
  legend?: AppLegendConfigDraft;
  axis?: AppAxisConfigDraft;
  pieSlice?: AppPieSliceConfigDraft;
};

export type ChartConfigUpdateDraft = Omit<Partial<ChartConfig>, 'legend' | 'axis' | 'pieSlice'> & {
  legend?: AppLegendConfigDraft;
  axis?: AppAxisConfigDraft;
  pieSlice?: AppPieSliceConfigDraft;
};

export type StoredChartConfigDraft = Omit<StoredChartConfig, 'legend' | 'axis' | 'pieSlice'> & {
  legend?: AppLegendConfigDraft;
  axis?: AppAxisConfigDraft;
  pieSlice?: AppPieSliceConfigDraft;
};

export type StoredChartConfigCreateDraft = Omit<StoredChartConfigDraft, 'id'>;

export type StoredChartConfigUpdateDraft = Omit<
  Partial<StoredChartConfig>,
  'legend' | 'axis' | 'pieSlice'
> & {
  legend?: AppLegendConfigDraft;
  axis?: AppAxisConfigDraft;
  pieSlice?: AppPieSliceConfigDraft;
};

const DEFAULT_LEGEND: LegendConfig = {
  show: true,
  position: 'bottom',
  visible: true,
};

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeLegendConfig(input: undefined): undefined;
export function normalizeLegendConfig(input: AppLegendConfigDraft): LegendConfig;
export function normalizeLegendConfig(
  input: AppLegendConfigDraft | undefined,
): LegendConfig | undefined {
  if (!input) return undefined;

  const position = input.position ?? DEFAULT_LEGEND.position;
  const display =
    position === 'none' ? false : (input.show ?? input.visible ?? DEFAULT_LEGEND.show);

  return {
    ...input,
    show: display,
    position,
    visible: display,
  };
}

export function normalizeSingleAxisConfig(input: undefined, defaultType?: AxisType): undefined;
export function normalizeSingleAxisConfig(
  input: AppSingleAxisConfigDraft,
  defaultType?: AxisType,
): SingleAxisConfig;
export function normalizeSingleAxisConfig(
  input: AppSingleAxisConfigDraft | undefined,
  defaultType?: AxisType,
): SingleAxisConfig | undefined;
export function normalizeSingleAxisConfig(
  input: AppSingleAxisConfigDraft | undefined,
  defaultType?: AxisType,
): SingleAxisConfig | undefined {
  if (!input) return undefined;

  const type = input.type ?? defaultType;
  const axisType = input.axisType ?? type;
  const visible = input.visible ?? input.show ?? true;

  return {
    ...input,
    axisType,
    type,
    visible,
    show: visible,
  };
}

export function normalizeAxisConfig(input: undefined): undefined;
export function normalizeAxisConfig(input: AppAxisConfigDraft): AxisConfig;
export function normalizeAxisConfig(input: AppAxisConfigDraft | undefined): AxisConfig | undefined {
  if (!input) return undefined;

  const categoryAxis = normalizeSingleAxisConfig(input.categoryAxis ?? input.xAxis, 'category');
  const valueAxis = normalizeSingleAxisConfig(input.valueAxis ?? input.yAxis, 'value');
  const secondaryCategoryAxis = normalizeSingleAxisConfig(input.secondaryCategoryAxis, 'category');
  const secondaryValueAxis = normalizeSingleAxisConfig(
    input.secondaryValueAxis ?? input.secondaryYAxis,
    'value',
  );
  const seriesAxis = normalizeSingleAxisConfig(input.seriesAxis);

  return {
    categoryAxis,
    valueAxis,
    secondaryCategoryAxis,
    secondaryValueAxis,
    seriesAxis,
    xAxis: categoryAxis,
    yAxis: valueAxis,
    secondaryYAxis: secondaryValueAxis,
  };
}

export function normalizePieSliceConfig(input: undefined): undefined;
export function normalizePieSliceConfig(input: AppPieSliceConfigDraft): PieSliceConfig;
export function normalizePieSliceConfig(
  input: AppPieSliceConfigDraft | undefined,
): PieSliceConfig | undefined {
  if (!input) return undefined;

  const { explodedIndex, selectable: _selectable, explodedIndices, ...rest } = input;
  const normalizedExplodedIndices =
    explodedIndices ?? (isFiniteNumber(explodedIndex) ? [explodedIndex] : undefined);

  return {
    ...rest,
    ...(normalizedExplodedIndices ? { explodedIndices: normalizedExplodedIndices } : {}),
  };
}

export function normalizeChartConfig(input: ChartConfigDraft): ChartConfig {
  const { legend, axis, pieSlice, ...rest } = input;

  return {
    ...rest,
    ...(legend !== undefined ? { legend: normalizeLegendConfig(legend) } : {}),
    ...(axis !== undefined ? { axis: normalizeAxisConfig(axis) } : {}),
    ...(pieSlice !== undefined ? { pieSlice: normalizePieSliceConfig(pieSlice) } : {}),
  };
}

export function normalizeChartConfigUpdate(input: ChartConfigUpdateDraft): Partial<ChartConfig> {
  const { legend, axis, pieSlice, ...rest } = input;

  return {
    ...rest,
    ...(legend !== undefined ? { legend: normalizeLegendConfig(legend) } : {}),
    ...(axis !== undefined ? { axis: normalizeAxisConfig(axis) } : {}),
    ...(pieSlice !== undefined ? { pieSlice: normalizePieSliceConfig(pieSlice) } : {}),
  };
}

export function normalizeStoredChartConfig(input: StoredChartConfigDraft): StoredChartConfig {
  const { legend, axis, pieSlice, ...rest } = input;

  return {
    ...rest,
    ...(legend !== undefined ? { legend: normalizeLegendConfig(legend) } : {}),
    ...(axis !== undefined ? { axis: normalizeAxisConfig(axis) } : {}),
    ...(pieSlice !== undefined ? { pieSlice: normalizePieSliceConfig(pieSlice) } : {}),
  };
}

export function normalizeStoredChartCreateConfig(
  input: StoredChartConfigCreateDraft,
): Omit<StoredChartConfig, 'id'> {
  const { legend, axis, pieSlice, ...rest } = input;

  return {
    ...rest,
    ...(legend !== undefined ? { legend: normalizeLegendConfig(legend) } : {}),
    ...(axis !== undefined ? { axis: normalizeAxisConfig(axis) } : {}),
    ...(pieSlice !== undefined ? { pieSlice: normalizePieSliceConfig(pieSlice) } : {}),
  };
}

export function normalizeStoredChartConfigUpdate(
  input: StoredChartConfigUpdateDraft,
): Partial<StoredChartConfig> {
  const { legend, axis, pieSlice, ...rest } = input;

  return {
    ...rest,
    ...(legend !== undefined ? { legend: normalizeLegendConfig(legend) } : {}),
    ...(axis !== undefined ? { axis: normalizeAxisConfig(axis) } : {}),
    ...(pieSlice !== undefined ? { pieSlice: normalizePieSliceConfig(pieSlice) } : {}),
  };
}
