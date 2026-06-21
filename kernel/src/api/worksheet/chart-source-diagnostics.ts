import type {
  ChartDescription,
  ChartConfig,
  ChartSeriesSourceDataUpdate,
  ChartSourceData,
  ChartSourceDataUpdate,
  ChartSourceRangeKind,
  ChartSourceRangeMatch,
  SheetId,
} from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ImageExportOptions,
  ResolvedChartSpecSnapshot,
  SeriesConfig,
} from '@mog-sdk/contracts/data/charts';
import { normalizeImageExportOptions } from '@mog/charts/export';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import { chartNotFound, operationFailed } from '../../errors/api';
import {
  chartUpdatesToInternal,
  serializedChartToChart,
} from '../../domain/charts/chart-public-api-converters';
import { createChartMutationOptions } from '../../domain/charts/chart-mutation-context';
import { resolveA1ChartRange } from '../../domain/charts/chart-range-references';
import { awaitSheetMaterialized, resolveChartIdInput } from './chart-api-helpers';

export interface ComparableRange {
  readonly sheetId: string;
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
}

export async function getResolvedChartSpecForWorksheetChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  options?: ImageExportOptions,
): Promise<ResolvedChartSpecSnapshot> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const normalized = normalizeImageExportOptions(options);
  const snapshot = await ctx.charts.getRenderSnapshotAtSize(
    sheetId,
    resolvedChartId,
    normalized.width,
    normalized.height,
    exportOptionsSnapshot(normalized),
  );

  if ('code' in snapshot) {
    if (snapshot.code === 'CHART_NOT_FOUND') throw chartNotFound(chartId);
    throw operationFailed('describeChart', snapshot.message);
  }

  return snapshot.resolvedChartSpec;
}

export async function describeWorksheetChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  options?: ImageExportOptions,
): Promise<ChartDescription> {
  const spec = await getResolvedChartSpecForWorksheetChart(ctx, sheetId, chartId, options);
  return describeResolvedChartSpec(spec);
}

export async function getWorksheetChartSourceData(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  options?: ImageExportOptions,
): Promise<ChartSourceData> {
  const spec = await getResolvedChartSpecForWorksheetChart(ctx, sheetId, chartId, options);
  return spec.resolved.ranges;
}

export function describeResolvedChartSpec(spec: ResolvedChartSpecSnapshot): ChartDescription {
  const sourceData = spec.resolved.ranges;
  const seriesReferencesByIndex = new Map(
    sourceData.seriesReferences.map((reference) => [reference.index, reference]),
  );

  return {
    chartId: spec.chartId,
    sheetId: spec.sheetId,
    name: spec.chartObject.name,
    title: spec.resolved.title.text,
    chartType: spec.resolved.chartType,
    subType: spec.resolved.subType,
    axes: spec.resolved.axes,
    sourceData,
    categories: spec.resolved.categories,
    series: spec.resolved.series.map((series) => ({
      index: series.index,
      name: series.name,
      type: series.type,
      axisGroup: series.axisGroup,
      source: series.source,
      ranges:
        seriesReferencesByIndex.get(series.sourceSeriesIndex) ??
        seriesReferencesByIndex.get(series.index) ??
        null,
      cachedPoints: cachedPointsForSeries(series),
      pointCount: series.pointCount,
      renderedPointCount: series.renderedPointCount,
    })),
    warnings: chartSourceWarnings(spec),
    diagnostics: {
      ranges: sourceData.diagnostics,
      compiler: spec.diagnostics.compiler,
      unsupportedFeatures: spec.diagnostics.unsupportedFeatures,
    },
    resolvedSpec: spec,
  };
}

export async function updateChartSourceData(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  sourceData: ChartSourceDataUpdate,
): Promise<void> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolvedChartId = await resolveChartIdInput(ctx, sheetId, chartId);
  const raw = (await ctx.computeBridge.getChart(
    sheetId,
    resolvedChartId,
  )) as ChartFloatingObject | null;
  if (!raw) throw chartNotFound(chartId);

  const chart = serializedChartToChart(raw);
  const updates: Partial<ChartConfig> = {};
  const identityClears: Record<string, null> = {};

  if (hasOwn(sourceData, 'dataRange')) {
    updates.dataRange = sourceData.dataRange ?? '';
    identityClears.dataRangeIdentity = null;
  }
  if (hasOwn(sourceData, 'categoryRange')) {
    updates.categoryRange = sourceData.categoryRange ?? '';
    identityClears.categoryRangeIdentity = null;
  }
  if (hasOwn(sourceData, 'seriesRange')) {
    updates.seriesRange = sourceData.seriesRange ?? '';
    identityClears.seriesRangeIdentity = null;
  }
  if (sourceData.series) {
    updates.series = applySeriesSourceDataUpdates(chart.series ?? [], sourceData.series);
  }

  const internalUpdates = { ...chartUpdatesToInternal(updates), ...identityClears };
  if (Object.keys(internalUpdates).length === 0) return;
  await ctx.computeBridge.updateChart(
    sheetId,
    resolvedChartId,
    internalUpdates,
    createChartMutationOptions(ctx, {
      operationIdPrefix: 'charts.update',
      sheetIds: [sheetId],
    }),
  );
}

export async function resolveWorksheetSourceRangeInput(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: string | CellRange,
  operation: string,
): Promise<ComparableRange> {
  if (typeof range !== 'string') {
    return normalizeComparableRange(range, sheetId);
  }

  const diagnostics: Array<{ message: string }> = [];
  const resolved = await resolveA1ChartRange(
    ctx,
    sheetId,
    'dataRange',
    range,
    diagnostics as never,
  );
  if (!resolved) {
    throw operationFailed(operation, diagnostics[0]?.message ?? `Invalid range "${range}"`);
  }
  return normalizeComparableRange(resolved.range, sheetId);
}

export function sourceRangeMatches(
  description: ChartDescription,
  targetRange: ComparableRange,
  sheetIdByName?: ReadonlyMap<string, string>,
): ChartSourceRangeMatch[] {
  const matches: ChartSourceRangeMatch[] = [];
  const sourceData = description.sourceData;

  pushRangeMatch(
    matches,
    description,
    'dataRange',
    sourceData.dataRange,
    targetRange,
    undefined,
    sheetIdByName,
  );
  pushRangeMatch(
    matches,
    description,
    'categoryRange',
    sourceData.categoryRange,
    targetRange,
    undefined,
    sheetIdByName,
  );
  pushRangeMatch(
    matches,
    description,
    'seriesRange',
    sourceData.seriesRange,
    targetRange,
    undefined,
    sheetIdByName,
  );

  for (const seriesReference of sourceData.seriesReferences) {
    pushRangeMatch(
      matches,
      description,
      'seriesName',
      seriesReference.name,
      targetRange,
      seriesReference.index,
      sheetIdByName,
    );
    pushRangeMatch(
      matches,
      description,
      'seriesValues',
      seriesReference.values,
      targetRange,
      seriesReference.index,
      sheetIdByName,
    );
    pushRangeMatch(
      matches,
      description,
      'seriesCategories',
      seriesReference.categories,
      targetRange,
      seriesReference.index,
      sheetIdByName,
    );
    pushRangeMatch(
      matches,
      description,
      'seriesBubbleSizes',
      seriesReference.bubbleSize,
      targetRange,
      seriesReference.index,
      sheetIdByName,
    );
  }

  return matches;
}

export async function findWorksheetChartsBySourceRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: string | CellRange,
  listCharts: () => Promise<readonly { id: string }[]>,
  describeChart: (chartId: string) => Promise<ChartDescription>,
): Promise<ChartSourceRangeMatch[]> {
  const targetRange = await resolveWorksheetSourceRangeInput(
    ctx,
    sheetId,
    range,
    'findChartsBySourceRange',
  );
  const charts = await listCharts();
  const sheetIdByName = await loadSheetIdByDisplayName(ctx);
  const matches: ChartSourceRangeMatch[] = [];

  for (const chart of charts) {
    matches.push(...sourceRangeMatches(await describeChart(chart.id), targetRange, sheetIdByName));
  }

  return matches;
}

function cachedPointsForSeries(
  series: ResolvedChartSpecSnapshot['resolved']['series'][number],
): ChartDescription['series'][number]['cachedPoints'] {
  const count = Math.max(
    series.pointCount,
    series.categories.length,
    series.xValues.length,
    series.values.length,
    series.bubbleSizes.length,
  );
  return Array.from({ length: count }, (_, index) => ({
    index,
    category: series.categories[index] ?? null,
    xValue: series.xValues[index] ?? null,
    value: series.values[index] ?? null,
    ...(series.renderedValues && index < series.renderedValues.length
      ? { renderedValue: series.renderedValues[index] ?? null }
      : {}),
    ...(index < series.bubbleSizes.length ? { bubbleSize: series.bubbleSizes[index] ?? null } : {}),
    blank: series.blankMask[index] ?? false,
  }));
}

function chartSourceWarnings(spec: ResolvedChartSpecSnapshot): string[] {
  const warnings = spec.resolved.ranges.diagnostics.map((diagnostic) => diagnostic.message);
  const hasAnyResolvedSource =
    Boolean(spec.resolved.ranges.dataRange) ||
    Boolean(spec.resolved.ranges.categoryRange) ||
    Boolean(spec.resolved.ranges.seriesRange) ||
    spec.resolved.ranges.seriesReferences.some(
      (reference) =>
        Boolean(reference.name) ||
        Boolean(reference.values) ||
        Boolean(reference.categories) ||
        Boolean(reference.bubbleSize),
    );

  if (!hasAnyResolvedSource) {
    warnings.push('Chart has no resolved source ranges');
  }

  for (const series of spec.resolved.series) {
    if (series.pointCount === 0) {
      warnings.push(`Series ${series.index} has no cached points`);
    } else if (series.blankMask.length > 0 && series.blankMask.every(Boolean)) {
      warnings.push(`Series ${series.index} has only blank cached points`);
    }
  }

  return [...new Set(warnings)];
}

function applySeriesSourceDataUpdates(
  existingSeries: SeriesConfig[],
  updates: readonly ChartSeriesSourceDataUpdate[],
): SeriesConfig[] {
  const series = existingSeries.map((entry) => ({ ...entry }));
  for (const update of updates) {
    if (!Number.isInteger(update.index) || update.index < 0) {
      throw operationFailed('setChartSourceData', `Series index ${update.index} out of range`);
    }
    while (series.length <= update.index) series.push({});

    const next = { ...series[update.index] };
    applyNullableSeriesField(next, 'name', update.name);
    applyNullableSeriesField(next, 'nameRef', update.nameRef);
    applyNullableSeriesField(next, 'values', update.values);
    applyNullableSeriesField(next, 'categories', update.categories);
    applyNullableSeriesField(next, 'bubbleSize', update.bubbleSize);
    series[update.index] = next;
  }
  return series;
}

function applyNullableSeriesField<K extends keyof SeriesConfig>(
  target: SeriesConfig,
  key: K,
  value: SeriesConfig[K] | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete target[key];
    return;
  }
  target[key] = value;
}

async function loadSheetIdByDisplayName(ctx: DocumentContext): Promise<Map<string, string>> {
  const ids = await ctx.computeBridge.getSheetOrder();
  const entries = await Promise.all(
    ids.map(async (id) => ({
      sheetId: String(id),
      sheetName: await ctx.computeBridge.getSheetName(id),
    })),
  );
  const sheetIdByName = new Map<string, string>();
  for (const entry of entries) {
    if (entry.sheetName) sheetIdByName.set(entry.sheetName.toLowerCase(), entry.sheetId);
  }
  return sheetIdByName;
}

function pushRangeMatch(
  matches: ChartSourceRangeMatch[],
  description: ChartDescription,
  rangeKind: ChartSourceRangeKind,
  reference: NonNullable<ChartSourceData['dataRange']> | null | undefined,
  targetRange: ComparableRange,
  seriesIndex?: number,
  sheetIdByName?: ReadonlyMap<string, string>,
): void {
  if (!reference) return;
  const sourceRange = normalizeComparableRange(
    reference.range,
    sourceSheetIdForReference(reference, description.sheetId, sheetIdByName),
  );
  if (!rangesOverlap(sourceRange, targetRange)) return;
  matches.push({
    chartId: description.chartId,
    chartName: description.name,
    chartTitle: description.title,
    rangeKind,
    seriesIndex,
    source: reference.source,
    ref: reference.ref,
    range: reference.range,
  });
}

function sourceSheetIdForReference(
  reference: NonNullable<ChartSourceData['dataRange']>,
  fallbackSheetId: string,
  sheetIdByName?: ReadonlyMap<string, string>,
): string {
  const legacySheetId = (reference.range as { sheetId?: string }).sheetId;
  if (legacySheetId) return legacySheetId;
  if (!reference.sheetName) return fallbackSheetId;
  return sheetIdByName?.get(reference.sheetName.toLowerCase()) ?? fallbackSheetId;
}

function normalizeComparableRange(
  range: Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'> & { sheetId?: string },
  fallbackSheetId: SheetId | string,
): ComparableRange {
  return {
    sheetId: range.sheetId ?? fallbackSheetId,
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function rangesOverlap(a: ComparableRange, b: ComparableRange): boolean {
  return (
    a.sheetId === b.sheetId &&
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  );
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exportOptionsSnapshot(
  normalized: ReturnType<typeof normalizeImageExportOptions>,
): ChartExportOptionsSnapshot {
  if (normalized.kind === 'vector') {
    return {
      kind: normalized.kind,
      format: normalized.format,
      width: normalized.width,
      height: normalized.height,
      backgroundColor: normalized.backgroundColor,
      fittingMode: normalized.fittingMode,
      frame: normalized.frame,
    };
  }

  return {
    kind: normalized.kind,
    format: normalized.format,
    width: normalized.width,
    height: normalized.height,
    pixelRatio: normalized.pixelRatio,
    physicalWidth: normalized.physicalWidth,
    physicalHeight: normalized.physicalHeight,
    backgroundColor: normalized.backgroundColor,
    quality: normalized.quality,
    fittingMode: normalized.fittingMode,
    frame: normalized.frame,
  };
}
