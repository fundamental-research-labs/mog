import type { EncodingSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData } from '../../types';
import { explicitDomainBound, isHorizontalBarType } from './axis';
import { categoryDisplayLabel, categoryKeyForIndex } from './category-axis';
import { MARK_TYPE_MAP } from './constants';
import { resolveStackMode } from './subtypes';

function hasBarSpacingConfig(config: ChartConfig): boolean {
  return typeof config.gapWidth === 'number' || typeof config.overlap === 'number';
}

export function applyBarCategorySpacingScale(
  config: ChartConfig,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar' || !hasBarSpacingConfig(config)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  categoryChannel.scale = {
    ...(categoryChannel.scale ?? {}),
    paddingInner: 0,
    paddingOuter: 0,
  };
}

export function applyCategoryAxisLabels(
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
  useStableCategoryKeys: boolean,
): void {
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel || categoryChannel.axis === null) return;

  const labelTextByValue: Record<string, string> = {};
  if (useStableCategoryKeys) {
    data.categories.forEach((category, index) => {
      labelTextByValue[categoryKeyForIndex(index)] = categoryDisplayLabel(category);
    });
  }

  const labelFormatByValue: Record<string, string> = {};
  if (data.categoryFormatCodes?.some(Boolean)) {
    data.categories.forEach((category, index) => {
      const formatCode = data.categoryFormatCodes?.[index];
      if (formatCode) {
        const key = useStableCategoryKeys ? categoryKeyForIndex(index) : String(category);
        labelFormatByValue[key] = formatCode;
      }
    });
  }
  if (Object.keys(labelTextByValue).length === 0 && Object.keys(labelFormatByValue).length === 0) {
    return;
  }

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
    ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
  };
  if (categoryChannel.secondaryAxis !== null && categoryChannel.secondaryAxis !== undefined) {
    categoryChannel.secondaryAxis = {
      ...categoryChannel.secondaryAxis,
      ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
      ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
    };
  }
}

export function applyStackedValueDomain(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  const stack = resolveStackMode(config);
  if (!stack || stack === 'normalize') return;

  const chartType = config.type;
  const valueChannel = isHorizontalBarType(chartType) ? encoding.x : encoding.y;
  if (!valueChannel) return;

  const existingDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const explicitMin = explicitDomainBound(existingDomain, 0);
  const explicitMax = explicitDomainBound(existingDomain, 1);

  let maxPositive = 0;
  let minNegative = 0;
  for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of data.series) {
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    if (positive > maxPositive) maxPositive = positive;
    if (negative < minNegative) minNegative = negative;
  }

  if (maxPositive === 0 && minNegative === 0) return;

  const isAutoDivergingStack =
    explicitMin === undefined && explicitMax === undefined && minNegative < 0 && maxPositive > 0;

  valueChannel.scale = {
    ...(valueChannel.scale ?? {}),
    domain: [explicitMin ?? minNegative, explicitMax ?? maxPositive],
    ...(isAutoDivergingStack ? { nice: valueChannel.scale?.nice ?? 6 } : {}),
  };

  if (isAutoDivergingStack) {
    valueChannel.axis = {
      ...(valueChannel.axis ?? {}),
      tickCount: valueChannel.axis?.tickCount ?? 6,
    };
  }
}

export function applyAutomaticCategoryAxisCrossing(encoding: EncodingSpec): void {
  const x = encoding.x;
  const y = encoding.y;
  if (!x || !y || x.type !== 'nominal' || y.type !== 'quantitative') return;
  if (x.axis === null || x.axis?.crossesAt !== undefined) return;

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return;

  x.axis = {
    ...(x.axis ?? {}),
    crossesAt: 'automatic',
  };
}
