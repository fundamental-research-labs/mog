import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig } from '@mog-sdk/contracts/data/charts';

import type { ResolvedChartRangeReferences } from '../chart-range-references';
import {
  isNoFillNoLineSeriesConfig,
  type SourceLinkedAxisNumberFormatResolution,
  type SourceLinkedAxisNumberFormatResolutions,
  type SourceLinkedAxisRole,
} from './chart-render-data-normalizer';
import { isCellHidden, type HiddenCellVisibility } from './hidden-visibility';

type ResolvedFormatBridge = {
  getResolvedFormat?: (
    sheetId: SheetId,
    row: number,
    col: number,
  ) => Promise<{ numberFormat?: string | null } | null | undefined>;
};

type ResolveLiveSourceLinkedAxisNumberFormatsOptions = {
  config: ChartConfig;
  resolvedRanges: ResolvedChartRangeReferences;
  hiddenVisibility: HiddenCellVisibility | undefined;
  bridge: ResolvedFormatBridge | undefined;
};

const GENERAL_FORMAT = 'General';
const SOURCE_LINKED_AXIS_ROLES: SourceLinkedAxisRole[] = [
  'category',
  'secondary category',
  'value',
  'secondary value',
];

function sourceLinkedAxisForRole(
  config: ChartConfig,
  role: SourceLinkedAxisRole,
): NonNullable<ChartConfig['axis']>['categoryAxis'] | undefined {
  const axis = config.axis;
  if (!axis) return undefined;
  switch (role) {
    case 'category':
      return axis.categoryAxis ?? axis.xAxis;
    case 'secondary category':
      return axis.secondaryCategoryAxis;
    case 'value':
      return axis.valueAxis ?? axis.yAxis;
    case 'secondary value':
      return axis.secondaryValueAxis ?? axis.secondaryYAxis;
  }
}

function axisGroupForRole(role: SourceLinkedAxisRole): 0 | 1 {
  return role === 'secondary category' || role === 'secondary value' ? 1 : 0;
}

function isSeriesBoundToAxis(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  axisGroup: 0 | 1,
): boolean {
  if (!series) return false;
  return axisGroup === 1 ? series.yAxisIndex === 1 : series.yAxisIndex !== 1;
}

function firstVisibleCellInRange(
  range: CellRange,
  hiddenVisibility: HiddenCellVisibility | undefined,
): { row: number; col: number } | undefined {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!isCellHidden(String(range.sheetId), row, col, hiddenVisibility)) {
        return { row, col };
      }
    }
  }
  return undefined;
}

function normalizeSourceFormatCode(formatCode: string | null | undefined): string {
  const normalized = formatCode?.trim();
  return normalized ? normalized : GENERAL_FORMAT;
}

function sourceFormatResolutionFromFormats(
  formatCodes: string[],
): SourceLinkedAxisNumberFormatResolution | undefined {
  const formatCode = formatCodes[0];
  if (!formatCode) return undefined;
  return {
    formatCode,
    missingSource: false,
    conflictingFormats: formatCodes.some((candidate) => candidate !== formatCode),
  };
}

function liveSourceRangesForAxisRole(
  config: ChartConfig,
  resolvedRanges: ResolvedChartRangeReferences,
  role: SourceLinkedAxisRole,
): CellRange[] {
  const axisGroup = axisGroupForRole(role);
  const sourceKind = role === 'category' || role === 'secondary category' ? 'categories' : 'values';
  const ranges: CellRange[] = [];

  for (const reference of resolvedRanges.seriesReferences) {
    const series = config.series?.[reference.index];
    if (!isSeriesBoundToAxis(series, axisGroup)) continue;
    if (isNoFillNoLineSeriesConfig(series)) continue;

    const range = reference[sourceKind]?.range;
    if (range) ranges.push(range);
  }

  return ranges;
}

async function resolveLiveSourceLinkedAxisNumberFormat(
  role: SourceLinkedAxisRole,
  config: ChartConfig,
  resolvedRanges: ResolvedChartRangeReferences,
  hiddenVisibility: HiddenCellVisibility | undefined,
  bridge: ResolvedFormatBridge,
): Promise<SourceLinkedAxisNumberFormatResolution | undefined> {
  const ranges = liveSourceRangesForAxisRole(config, resolvedRanges, role);
  const formatCodes: string[] = [];

  for (const range of ranges) {
    const cell = firstVisibleCellInRange(range, hiddenVisibility);
    if (!cell) continue;
    try {
      const format = await bridge.getResolvedFormat?.(
        toSheetId(String(range.sheetId)),
        cell.row,
        cell.col,
      );
      formatCodes.push(normalizeSourceFormatCode(format?.numberFormat));
    } catch {
      // Fall back to imported caches for this axis when live format lookup fails.
    }
  }

  return sourceFormatResolutionFromFormats(formatCodes);
}

export async function resolveLiveSourceLinkedAxisNumberFormats({
  config,
  resolvedRanges,
  hiddenVisibility,
  bridge,
}: ResolveLiveSourceLinkedAxisNumberFormatsOptions): Promise<
  SourceLinkedAxisNumberFormatResolutions | undefined
> {
  if (!bridge?.getResolvedFormat || !config.axis) return undefined;

  const resolutions: SourceLinkedAxisNumberFormatResolutions = {};
  await Promise.all(
    SOURCE_LINKED_AXIS_ROLES.map(async (role) => {
      if (!sourceLinkedAxisForRole(config, role)?.linkNumberFormat) return;
      const resolution = await resolveLiveSourceLinkedAxisNumberFormat(
        role,
        config,
        resolvedRanges,
        hiddenVisibility,
        bridge,
      );
      if (resolution) resolutions[role] = resolution;
    }),
  );

  return SOURCE_LINKED_AXIS_ROLES.some((role) => resolutions[role]) ? resolutions : undefined;
}
