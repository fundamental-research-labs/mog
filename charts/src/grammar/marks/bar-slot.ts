import {
  effectiveBarGeometryFromSpec,
  excelBarSlotGeometry,
  hasExcelBarGeometrySpec,
} from '../../core/chart-ir/bar-geometry';
import { SERIES_ORDER_FIELD } from '../../core/chart-ir/fields';
import type { AnyScale, ScaleMap } from '../encoding-resolver';
import type { BarGeometrySpec, ConfigSpec, DataRow, EncodingSpec } from '../spec';

export interface BarSlotContext {
  isHorizontal: boolean;
  categoryField: string;
  groupField?: string;
  isStacked: boolean;
  isGrouped: boolean;
  useAutoGrouping: boolean;
  numGroups: number;
  uniqueGroups: string[];
  reverseGroupOrder: boolean;
  barGeometry?: BarGeometrySpec;
  processOrder: number[];
  autoGroupIndexByDataIndex: Map<number, number>;
}

function datumNumber(datum: DataRow, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const value = datum[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scaleStep(scale: AnyScale, fallback: number): number {
  const raw = typeof scale.step === 'function' ? scale.step() : fallback;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function scaleDomain(scale: AnyScale | undefined): string[] | undefined {
  const raw = typeof scale?.domain === 'function' ? scale.domain() : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((value) => String(value));
}

function orderedUniqueValues(data: DataRow[], field: string, domain?: string[]): string[] {
  if (domain && domain.length > 0) return domain;

  const values = new Map<string, { firstIndex: number; seriesOrder: number }>();

  for (let index = 0; index < data.length; index += 1) {
    const row = data[index];
    const value = String(row[field]);
    if (values.has(value)) continue;
    values.set(value, {
      firstIndex: index,
      seriesOrder: datumNumber(row, SERIES_ORDER_FIELD) ?? index,
    });
  }

  return [...values.entries()]
    .sort(([, a], [, b]) => a.seriesOrder - b.seriesOrder || a.firstIndex - b.firstIndex)
    .map(([value]) => value);
}

function isHorizontalBarEncoding(encoding: EncodingSpec | undefined): boolean {
  return encoding?.x?.type === 'quantitative' && encoding?.y?.type !== 'quantitative';
}

function isStacked(config: ConfigSpec | undefined): boolean {
  return config?.stack === 'normalize' || config?.stack === 'zero' || config?.stack === 'center';
}

function shouldReverseGroupOrder(barGeometry: BarGeometrySpec | undefined): boolean {
  return barGeometry?.seriesSlotOrder === 'reverse';
}

function buildAutoGroupIndexByDataIndex(
  data: DataRow[],
  categoryField: string,
  processOrder: number[],
): Map<number, number> {
  const groupIndexByDataIndex = new Map<number, number>();
  const seenByCategory = new Map<string, number>();

  for (const dataIndex of processOrder) {
    const datum = data[dataIndex];
    const category = String(datum?.[categoryField] ?? '');
    const groupIndex = seenByCategory.get(category) ?? 0;
    groupIndexByDataIndex.set(dataIndex, groupIndex);
    seenByCategory.set(category, groupIndex + 1);
  }

  return groupIndexByDataIndex;
}

function groupedProcessOrder(data: DataRow[], categoryField: string): number[] {
  const categoryGroups = new Map<string, number[]>();
  const categoryOrder: string[] = [];

  for (let index = 0; index < data.length; index += 1) {
    const category = String(data[index][categoryField] ?? '');
    if (!categoryGroups.has(category)) {
      categoryGroups.set(category, []);
      categoryOrder.push(category);
    }
    categoryGroups.get(category)!.push(index);
  }

  return categoryOrder.flatMap((category) => categoryGroups.get(category)!);
}

export function createBarSlotContext(
  data: DataRow[],
  encoding: EncodingSpec | undefined,
  config: ConfigSpec | undefined,
  scales: ScaleMap = {},
  options: { preferScaleDomain?: boolean } = {},
): BarSlotContext | undefined {
  if (!encoding?.x || !encoding.y) return undefined;

  const isHorizontal = isHorizontalBarEncoding(encoding);
  const categoryField = isHorizontal ? encoding.y.field : encoding.x.field;
  if (!categoryField) return undefined;

  const stacked = isStacked(config);
  const colorField = encoding.color?.field;
  const colorMatchesCategory = colorField === categoryField;
  const isGrouped = Boolean(colorField && !colorMatchesCategory && !stacked);

  let uniqueGroups: string[] = [];
  if (isGrouped && colorField) {
    uniqueGroups = orderedUniqueValues(
      data,
      colorField,
      options.preferScaleDomain ? scaleDomain(scales.color) : undefined,
    );
  }

  let maxPerCategory = 1;
  if (!stacked && !isGrouped) {
    const categoryCounts = new Map<string, number>();
    for (const datum of data) {
      const category = String(datum[categoryField] ?? '');
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    maxPerCategory = Math.max(1, ...categoryCounts.values());
  }

  const useAutoGrouping = maxPerCategory > 1 && !isGrouped;
  const numGroups = useAutoGrouping
    ? maxPerCategory
    : isGrouped
      ? Math.max(uniqueGroups.length, 1)
      : 1;
  const barGeometry = hasExcelBarGeometrySpec(config)
    ? effectiveBarGeometryFromSpec(config)
    : undefined;
  const processOrder = useAutoGrouping
    ? groupedProcessOrder(data, categoryField)
    : data.map((_, index) => index);

  return {
    isHorizontal,
    categoryField,
    ...(colorField ? { groupField: colorField } : {}),
    isStacked: stacked,
    isGrouped,
    useAutoGrouping,
    numGroups,
    uniqueGroups,
    reverseGroupOrder: shouldReverseGroupOrder(barGeometry),
    ...(barGeometry ? { barGeometry } : {}),
    processOrder,
    autoGroupIndexByDataIndex: useAutoGrouping
      ? buildAutoGroupIndexByDataIndex(data, categoryField, processOrder)
      : new Map(),
  };
}

export function groupIndexForDatum(
  context: BarSlotContext,
  datum: DataRow,
  dataIndex: number,
): number {
  if (context.useAutoGrouping) {
    return context.autoGroupIndexByDataIndex.get(dataIndex) ?? 0;
  }
  if (context.isGrouped && context.groupField) {
    const groupValue = String(datum[context.groupField] ?? '');
    const groupIndex = context.uniqueGroups.indexOf(groupValue);
    return groupIndex === -1 ? 0 : groupIndex;
  }
  return 0;
}

export function visualGroupIndex(context: BarSlotContext, groupIndex: number): number {
  if (!context.reverseGroupOrder || context.numGroups <= 1) return groupIndex;
  return context.numGroups - 1 - groupIndex;
}

export function barSlotForDatum(
  context: BarSlotContext,
  categoryScale: AnyScale,
  fullBandSize: number,
  datum: DataRow,
  dataIndex: number,
) {
  const groupIndex = visualGroupIndex(context, groupIndexForDatum(context, datum, dataIndex));
  if (context.barGeometry) {
    return excelBarSlotGeometry(
      scaleStep(categoryScale, fullBandSize),
      context.numGroups,
      groupIndex,
      context.barGeometry,
    );
  }
  return {
    offset: groupIndex * (fullBandSize / context.numGroups),
    size: fullBandSize / context.numGroups,
  };
}

export function barSlotCenterOffset(
  context: BarSlotContext | undefined,
  categoryScale: AnyScale | undefined,
  datum: DataRow,
  dataIndex: number,
): number {
  if (!context || !categoryScale) return 0;
  const fullBandSize =
    typeof categoryScale.bandwidth === 'function' ? categoryScale.bandwidth() : 0;
  if (!Number.isFinite(fullBandSize) || fullBandSize < 0) return 0;
  if (context.barGeometry) {
    const categoryStep = scaleStep(categoryScale, fullBandSize);
    if (!Number.isFinite(categoryStep) || categoryStep <= 0) return 0;
    const slot = barSlotForDatum(context, categoryScale, fullBandSize, datum, dataIndex);
    if (context.barGeometry.categoryPositionPolicy === 'onCategory') {
      return slot.offset + slot.size / 2;
    }
    const bandSize = fullBandSize > 0 ? fullBandSize : categoryStep;
    return slot.offset + slot.size / 2 - bandSize / 2;
  }
  if (fullBandSize <= 0) return 0;
  const slot = barSlotForDatum(context, categoryScale, fullBandSize, datum, dataIndex);
  return slot.offset + slot.size / 2 - fullBandSize / 2;
}
