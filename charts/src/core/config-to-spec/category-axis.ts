import type { ChartConfig, ChartData, ChartType } from '../../types';
import { CATEGORY_KEY_PREFIX, MARK_TYPE_MAP } from './constants';

export function categoryKeyForIndex(index: number): string {
  return `${CATEGORY_KEY_PREFIX}:${index}`;
}

export function categoryDisplayLabel(value: string | number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function shouldUseStableCategoryKeys(
  config: ChartConfig | undefined,
  data: ChartData,
  useExcelDateSerialCategories: boolean,
): boolean {
  if (useExcelDateSerialCategories) return false;
  if (!config?.extra && !data.categoryLevels?.length) return false;
  return hasDuplicateOrBlankCategoryLabels(data);
}

export function shouldUseDateSerialCategoryAxis(
  config: ChartConfig,
  data: ChartData,
  isHorizontal: boolean,
): boolean {
  if (!supportsContinuousCategoryAxis(config.type) || isHorizontal) return false;
  const categoryAxis = config.axis?.xAxis ?? config.axis?.categoryAxis;
  return isDateAxisConfig(categoryAxis) && hasFiniteCategorySerials(data);
}

export function shouldReverseHorizontalCategoryAxis(
  config: ChartConfig,
  isHorizontal: boolean,
): boolean {
  return isHorizontal && config.extra !== undefined;
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

export function isDateAxisConfig(
  axisConf: { axisType?: string; categoryType?: string; type?: string } | undefined,
): boolean {
  if (!axisConf) return false;
  const axisType = axisConf.axisType?.toLowerCase();
  return (
    axisType === 'dateax' ||
    axisType === 'date' ||
    axisConf.categoryType === 'dateAxis' ||
    axisConf.type === 'time'
  );
}

function hasDuplicateOrBlankCategoryLabels(data: ChartData): boolean {
  const seen = new Set<string>();
  for (const category of data.categories ?? []) {
    const label = categoryDisplayLabel(category);
    if (label === '' || seen.has(label)) return true;
    seen.add(label);
  }
  return false;
}

function supportsContinuousCategoryAxis(chartType: ChartType): boolean {
  if (chartType === 'combo') return true;
  if (chartType === 'stock') return true;
  if (chartType === 'radar') return false;
  const markType = MARK_TYPE_MAP[chartType];
  return markType === 'line' || markType === 'area';
}

function hasFiniteCategorySerials(data: ChartData): boolean {
  const categories = data.categories ?? [];
  if (categories.length === 0) return false;

  let finiteCount = 0;
  for (const category of categories) {
    const serial = toFiniteNumber(category);
    if (serial === undefined) return false;
    finiteCount += 1;
  }
  return finiteCount > 0;
}
