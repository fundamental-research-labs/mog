/**
 * Chart range reference resolution.
 *
 * A1 strings accept Excel absolute markers and optional sheet names.
 * CellIdRange references resolve through ComputeBridge at render time.
 */

import type { CellIdRange } from '@mog-sdk/contracts/cell-identity';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import { hasRenderableChartPointCache } from './chart-point-cache';

export type ChartRangeKind =
  | 'dataRange'
  | 'categoryRange'
  | 'seriesRange'
  | 'seriesName'
  | 'seriesValues'
  | 'seriesCategories'
  | 'seriesBubbleSizes';

export interface ResolvedChartRangeReference {
  kind: ChartRangeKind;
  range: CellRange;
  source: 'identity' | 'a1';
  ref?: string;
}

export interface ChartRangeDiagnostic {
  kind: ChartRangeKind;
  code: 'MISSING_REF' | 'MALFORMED_A1' | 'UNKNOWN_SHEET' | 'DELETED_CELLS' | 'NO_CHART_SHEET';
  ref?: string;
  sheetName?: string;
  message: string;
}

export interface ResolvedChartRangeReferences {
  dataRange: ResolvedChartRangeReference | null;
  categoryRange: ResolvedChartRangeReference | null;
  seriesRange: ResolvedChartRangeReference | null;
  seriesReferences: ResolvedChartSeriesReference[];
  diagnostics: ChartRangeDiagnostic[];
}

export interface ResolvedChartSeriesReference {
  index: number;
  name?: ResolvedChartRangeReference | null;
  values: ResolvedChartRangeReference | null;
  categories: ResolvedChartRangeReference | null;
  bubbleSizes?: ResolvedChartRangeReference | null;
}

/**
 * Resolve a CellIdRange to a position-based CellRange.
 *
 * Called at render/extraction time, NOT stored.
 * Positions are derived from ComputeBridge.getCellPosition().
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - CellIdRange with corner CellIds
 * @returns Position-based CellRange, or null if either corner cell was deleted
 */
export async function resolveCellIdRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellIdRange,
): Promise<CellRange | null> {
  const [topLeft, bottomRight] = await Promise.all([
    ctx.computeBridge.getCellPosition(sheetId, range.topLeftCellId),
    ctx.computeBridge.getCellPosition(sheetId, range.bottomRightCellId),
  ]);

  if (!topLeft || !bottomRight) return null;

  return {
    sheetId,
    startRow: topLeft.row,
    startCol: topLeft.col,
    endRow: bottomRight.row,
    endCol: bottomRight.col,
  };
}

function normalizedRange(range: CellRange, sheetId: SheetId): CellRange {
  return {
    sheetId,
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

async function resolveSheetName(ctx: DocumentContext, sheetName: string): Promise<SheetId | null> {
  const sheetIds = await ctx.computeBridge.getSheetOrder();
  const names = await Promise.all(
    sheetIds.map(async (id) => ({
      id: toSheetId(id),
      name: await ctx.computeBridge.getSheetName(toSheetId(id)),
    })),
  );
  const exact = names.find((s) => s.name === sheetName);
  if (exact) return exact.id;
  const folded = sheetName.toLocaleLowerCase();
  return names.find((s) => s.name?.toLocaleLowerCase() === folded)?.id ?? null;
}

export async function resolveA1ChartRange(
  ctx: DocumentContext,
  chartSheetId: SheetId | null,
  kind: ChartRangeKind,
  ref: string | undefined,
  diagnostics: ChartRangeDiagnostic[],
): Promise<ResolvedChartRangeReference | null> {
  if (!ref) {
    if (kind === 'dataRange') {
      diagnostics.push({
        kind,
        code: 'MISSING_REF',
        message: 'Chart has no data range reference',
      });
    }
    return null;
  }

  const parsed = parseCellRange(ref);
  if (!parsed) {
    diagnostics.push({
      kind,
      code: 'MALFORMED_A1',
      ref,
      message: `Chart ${kind} is not a valid Excel A1 range`,
    });
    return null;
  }

  let sheetId = chartSheetId;
  if (parsed.sheetName) {
    sheetId = await resolveSheetName(ctx, parsed.sheetName);
    if (!sheetId) {
      diagnostics.push({
        kind,
        code: 'UNKNOWN_SHEET',
        ref,
        sheetName: parsed.sheetName,
        message: `Chart ${kind} references unknown sheet "${parsed.sheetName}"`,
      });
      return null;
    }
  } else if (!sheetId) {
    diagnostics.push({
      kind,
      code: 'NO_CHART_SHEET',
      ref,
      message: `Chart ${kind} is unqualified and the chart has no owning sheet`,
    });
    return null;
  }

  return {
    kind,
    range: normalizedRange(parsed, sheetId),
    source: 'a1',
    ref,
  };
}

function firstSeriesCategoryRangeRef(chart: ChartFloatingObject): string | undefined {
  return chart.series?.[0]?.categories?.trim() || undefined;
}

async function resolveChartRangeReference(
  ctx: DocumentContext,
  chartSheetId: SheetId | null,
  chart: ChartFloatingObject,
  kind: ChartRangeKind,
  diagnostics: ChartRangeDiagnostic[],
): Promise<ResolvedChartRangeReference | null> {
  const identity =
    kind === 'dataRange'
      ? chart.dataRangeIdentity
      : kind === 'categoryRange'
        ? chart.categoryRangeIdentity
        : chart.seriesRangeIdentity;

  if (identity) {
    if (!chartSheetId) {
      diagnostics.push({
        kind,
        code: 'NO_CHART_SHEET',
        message: `Chart ${kind} identity is sheet-relative and the chart has no owning sheet`,
      });
      return null;
    }

    const range = await resolveCellIdRange(ctx, chartSheetId, identity);
    if (!range) {
      diagnostics.push({
        kind,
        code: 'DELETED_CELLS',
        message: `Chart ${kind} references deleted cells`,
      });
      return null;
    }
    return { kind, range: normalizedRange(range, chartSheetId), source: 'identity' };
  }

  const ref =
    kind === 'dataRange'
      ? chart.dataRange
      : kind === 'categoryRange'
        ? chart.categoryRange || firstSeriesCategoryRangeRef(chart)
        : chart.seriesRange;
  return resolveA1ChartRange(ctx, chartSheetId, kind, ref, diagnostics);
}

async function resolveSeriesRangeReferences(
  ctx: DocumentContext,
  chartSheetId: SheetId | null,
  chart: ChartFloatingObject,
  diagnostics: ChartRangeDiagnostic[],
): Promise<ResolvedChartSeriesReference[]> {
  return Promise.all(
    (chart.series ?? []).map(async (series, index) => {
      const [name, values, categories, bubbleSizes] = await Promise.all([
        resolveA1ChartRange(ctx, chartSheetId, 'seriesName', series.nameRef?.trim(), diagnostics),
        resolveA1ChartRange(ctx, chartSheetId, 'seriesValues', series.values?.trim(), diagnostics),
        resolveA1ChartRange(
          ctx,
          chartSheetId,
          'seriesCategories',
          series.categories?.trim(),
          diagnostics,
        ),
        resolveA1ChartRange(
          ctx,
          chartSheetId,
          'seriesBubbleSizes',
          series.bubbleSize?.trim(),
          diagnostics,
        ),
      ]);
      return { index, name, values, categories, bubbleSizes };
    }),
  );
}

/**
 * Resolve all chart A1/identity references to workbook-scoped ranges.
 *
 * A1 strings accept Excel absolute markers and optional sheet names. Unqualified
 * references resolve against the chart's owning sheet. The returned ranges carry
 * `sheetId` so extraction and invalidation can read the referenced sheet rather
 * than the active/chart sheet.
 */
export async function resolveChartRangeReferences(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
): Promise<ResolvedChartRangeReferences> {
  const chartSheetId = chart.sheetId ? toSheetId(chart.sheetId) : null;
  const diagnostics: ChartRangeDiagnostic[] = [];
  const hasRenderableSeriesData =
    chart.series?.some((series) => {
      if (series.values?.trim()) return true;
      return hasRenderableChartPointCache(series.valueCache);
    }) ?? false;
  const [dataRange, categoryRange, seriesRange, seriesReferences] = await Promise.all([
    hasRenderableSeriesData && !chart.dataRange?.trim()
      ? Promise.resolve(null)
      : resolveChartRangeReference(ctx, chartSheetId, chart, 'dataRange', diagnostics),
    resolveChartRangeReference(ctx, chartSheetId, chart, 'categoryRange', diagnostics),
    resolveChartRangeReference(ctx, chartSheetId, chart, 'seriesRange', diagnostics),
    resolveSeriesRangeReferences(ctx, chartSheetId, chart, diagnostics),
  ]);

  return { dataRange, categoryRange, seriesRange, seriesReferences, diagnostics };
}

/**
 * Get chart data range, resolving CellIdRange if present.
 *
 * This is the primary data range accessor for data extraction. It handles both:
 * - New CellIdRange-based charts (dataRangeIdentity)
 * - Legacy A1-string-based charts (dataRange)
 *
 * @param ctx - Store context
 * @param chart - Chart configuration
 * @returns CellRange or null if range is invalid
 */
export async function getChartDataRange(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
): Promise<CellRange | null> {
  const resolved = await resolveChartRangeReferences(ctx, chart);
  return resolved.dataRange?.range ?? null;
}
