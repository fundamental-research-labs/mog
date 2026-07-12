import type {
  Chart,
  ChartConfig,
  ChartReadOptions,
  ChartTarget,
  SheetId,
} from '@mog-sdk/contracts/api';
import type { SeriesConfig } from '@mog-sdk/contracts/data/charts';
import { detectSeriesOrientation } from '@mog/charts';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import {
  chartUpdatesToInternal,
  serializedChartToChart,
  unsupportedNativeXlsxChartType,
} from '../../domain/charts/chart-public-api-converters';
import {
  createChartMutationOptions,
  nextChartMutationOptions,
  type ChartMutationOptions,
  type ChartMutationOptionsInput,
} from '../../domain/charts/chart-mutation-context';
import {
  chartNotFound,
  chartTargetAmbiguous,
  invalidChartConfig,
  operationFailed,
  type ChartTargetCandidate,
} from '../../errors/api';
import { callNativeChartMutation } from '../../errors/chart';
import { KernelError } from '../../errors/kernel-error';

export function assertSupportedNativeXlsxChartConfig(
  config: Partial<Pick<ChartConfig, 'type'>>,
): void {
  const unsupportedType = unsupportedNativeXlsxChartType(config);
  if (unsupportedType) {
    throw invalidChartConfig(
      `Chart type "${unsupportedType}" is not supported because it has no native Excel XLSX chart representation`,
    );
  }
}

export async function awaitSheetMaterialized(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<void> {
  await ctx.awaitMaterialized?.(sheetId);
}

export async function awaitChartReadScope(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: ChartReadOptions,
): Promise<void> {
  const materialization = options?.materialization ?? 'sheet';
  if (materialization === 'available') {
    return;
  }
  if (materialization === 'complete') {
    await ctx.awaitMaterialized?.('allSheets');
    return;
  }
  if (materialization === 'sheet') {
    await awaitSheetMaterialized(ctx, sheetId);
  }
}

export function chartMutationOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
  operationIdPrefix: string,
): ChartMutationOptions {
  return createChartMutationOptions(ctx, {
    operationIdPrefix,
    sheetIds: [sheetId],
  });
}

type NormalizedChartTarget =
  | { readonly kind: 'bare'; readonly value: string }
  | { readonly kind: 'id'; readonly value: string }
  | { readonly kind: 'name'; readonly value: string };

export interface ResolvedChartTarget {
  readonly resolvedChartId: string;
  readonly raw: ChartFloatingObject;
}

function safeReceived(target: unknown): unknown {
  try {
    const serialized = JSON.stringify(target);
    return serialized === undefined ? String(target) : JSON.parse(serialized);
  } catch {
    return String(target);
  }
}

function normalizeChartTarget(target: ChartTarget): NormalizedChartTarget {
  if (typeof target === 'string') return { kind: 'bare', value: target };

  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const keys = Object.keys(target);
    if (keys.length === 1 && keys[0] === 'id' && typeof target.id === 'string') {
      return { kind: 'id', value: target.id };
    }
    if (keys.length === 1 && keys[0] === 'name' && typeof target.name === 'string') {
      return { kind: 'name', value: target.name };
    }
  }

  throw new KernelError(
    'API_INVALID_ARGUMENT',
    'chartTarget must be a string, { id: string }, or { name: string }',
    {
      path: ['chartTarget'],
      suggestion:
        'Pass a chart ID or exact name directly, or use an explicit selector such as { id: "chart-1" }',
      context: {
        paramName: 'chartTarget',
        expected: 'string | { id: string } | { name: string }',
        received: safeReceived(target),
      },
    },
  );
}

function candidateName(chart: ChartFloatingObject): string {
  return typeof chart.name === 'string' ? chart.name : '';
}

function importedIdAlias(normalized: NormalizedChartTarget, sheetId: SheetId): string | null {
  if (normalized.kind === 'name' || !/^chart-import-\d+$/.test(normalized.value)) return null;
  return `${normalized.value}-${sheetId}`;
}

function collectChartTargetCandidates(
  normalized: NormalizedChartTarget,
  charts: readonly ChartFloatingObject[],
  sheetId: SheetId,
): Array<{ raw: ChartFloatingObject; candidate: ChartTargetCandidate }> {
  const matches = new Map<string, { raw: ChartFloatingObject; matchedBy: Set<'id' | 'name'> }>();
  const includeIds = normalized.kind === 'bare' || normalized.kind === 'id';
  const includeNames = normalized.kind === 'bare' || normalized.kind === 'name';
  const exactIdExists = includeIds && charts.some((chart) => chart.id === normalized.value);
  const alias = exactIdExists ? null : importedIdAlias(normalized, sheetId);

  for (const chart of charts) {
    const matchedBy = new Set<'id' | 'name'>();
    if (includeIds && (chart.id === normalized.value || (alias !== null && chart.id === alias))) {
      matchedBy.add('id');
    }
    if (includeNames && candidateName(chart) === normalized.value) matchedBy.add('name');
    if (matchedBy.size === 0) continue;

    const existing = matches.get(chart.id);
    if (existing) {
      for (const matchKind of matchedBy) existing.matchedBy.add(matchKind);
    } else {
      matches.set(chart.id, { raw: chart, matchedBy });
    }
  }

  return [...matches.values()]
    .sort(
      (left, right) =>
        left.raw.id.localeCompare(right.raw.id) ||
        candidateName(left.raw).localeCompare(candidateName(right.raw)),
    )
    .map(({ raw, matchedBy }) => ({
      raw,
      candidate: {
        id: raw.id,
        name: candidateName(raw),
        matchedBy: [...matchedBy].sort(),
      },
    }));
}

/** Resolve an optional user-facing chart target without turning zero matches into an error. */
export async function resolveOptionalChartTarget(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  diagnosticTarget: unknown = chartTarget,
): Promise<ResolvedChartTarget | null> {
  const normalized = normalizeChartTarget(chartTarget);
  if (normalized.kind === 'id') {
    const exact = (await ctx.computeBridge.getChart(
      sheetId,
      normalized.value,
    )) as ChartFloatingObject | null;
    if (exact) return { resolvedChartId: exact.id, raw: exact };

    const alias = importedIdAlias(normalized, sheetId);
    if (alias) {
      const imported = (await ctx.computeBridge.getChart(
        sheetId,
        alias,
      )) as ChartFloatingObject | null;
      if (imported) return { resolvedChartId: imported.id, raw: imported };
    }
    return null;
  }

  const getAllCharts = ctx.computeBridge.getAllCharts;
  let charts: ChartFloatingObject[];
  if (typeof getAllCharts === 'function') {
    charts = (await getAllCharts.call(ctx.computeBridge, sheetId)) as ChartFloatingObject[];
  } else {
    // Legacy/incomplete bridge adapters can only support ID resolution. The
    // production bridge always exposes getAllCharts, which is required for
    // complete bare-string ID/name collision detection.
    const exact = (await ctx.computeBridge.getChart(
      sheetId,
      normalized.value,
    )) as ChartFloatingObject | null;
    const alias = exact ? null : importedIdAlias(normalized, sheetId);
    const imported = alias
      ? ((await ctx.computeBridge.getChart(sheetId, alias)) as ChartFloatingObject | null)
      : null;
    charts = exact ? [exact] : imported ? [imported] : [];
  }

  const matches = collectChartTargetCandidates(normalized, charts, sheetId);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw chartTargetAmbiguous(
      diagnosticTarget,
      matches.map(({ candidate }) => candidate),
    );
  }
  const match = matches[0];
  return { resolvedChartId: match.raw.id, raw: match.raw };
}

/**
 * Resolve a chart operation and require the root chart to exist.
 *
 * Reads such as get()/has() intentionally remain tolerant and use
 * resolveOptionalChartTarget(). Mutations and strict chart reads use this helper so a
 * missing/stale ID cannot become a failed receipt or a silent bridge no-op.
 */
export async function requireChartTarget(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  diagnosticTarget: unknown = chartTarget,
): Promise<ResolvedChartTarget> {
  await awaitSheetMaterialized(ctx, sheetId);
  const resolved = await resolveOptionalChartTarget(ctx, sheetId, chartTarget, diagnosticTarget);
  if (resolved) return resolved;
  throw chartNotFound(diagnosticTarget);
}

export async function requireChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<Chart> {
  const { raw } = await requireChartTarget(ctx, sheetId, chartTarget);
  return serializedChartToChart(raw);
}

export async function requireChartWithSeries(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
): Promise<{ chart: Chart; series: SeriesConfig[] }> {
  const chart = await requireChart(ctx, sheetId, chartTarget);
  const series = [...(chart.series ?? [])];
  return { chart, series };
}

function inferredRangeSeriesMutationCapacity(chart: Chart): number {
  if (!chart.dataRange) return 0;
  const dataRange = parseCellRange(chart.dataRange);
  if (!dataRange) return 0;

  const rowCount = dataRange.endRow - dataRange.startRow + 1;
  const colCount = dataRange.endCol - dataRange.startCol + 1;
  if (rowCount <= 0 || colCount <= 0) return 0;

  if (rowCount === 1 || colCount === 1) return 1;

  const orientation = chart.seriesOrientation ?? detectSeriesOrientation(dataRange);
  if (orientation === 'columns') {
    return Math.max(0, colCount - (chart.categoryRange ? 0 : 1));
  }
  return Math.max(0, rowCount - (chart.categoryRange ? 0 : 1));
}

export function chartSeriesCount(chart: Chart): number {
  return chart.series?.length ?? 0;
}

function chartSeriesMutationCapacity(chart: Chart): number {
  const explicitSeriesCount = chartSeriesCount(chart);
  return explicitSeriesCount > 0 ? explicitSeriesCount : inferredRangeSeriesMutationCapacity(chart);
}

export async function requireChartSeriesForMutation(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  seriesIndex: number,
  operation: string,
): Promise<{ chart: Chart; series: SeriesConfig[] }> {
  const { chart, series } = await requireChartWithSeries(ctx, sheetId, chartTarget);
  if (!Number.isInteger(seriesIndex) || seriesIndex < 0) {
    throw operationFailed(operation, `Series index ${seriesIndex} out of range`);
  }

  const capacity = chartSeriesMutationCapacity(chart);
  if (seriesIndex >= capacity) {
    throw operationFailed(
      operation,
      `Series index ${seriesIndex} out of range (0-${capacity - 1})`,
    );
  }

  while (series.length <= seriesIndex) {
    series.push({});
  }
  return { chart, series };
}

export async function applyUpdate(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartTarget: ChartTarget,
  updates: Partial<ChartConfig>,
  admissionOptions?: ChartMutationOptionsInput,
): Promise<void> {
  const { resolvedChartId, raw: existing } = await requireChartTarget(ctx, sheetId, chartTarget);
  await applyResolvedChartUpdate(
    ctx,
    sheetId,
    resolvedChartId,
    existing,
    updates,
    admissionOptions,
    chartTarget,
  );
}

/** Apply an update to an already-resolved stable ID without reinterpreting it as a name. */
export async function applyResolvedChartUpdate(
  ctx: DocumentContext,
  sheetId: SheetId,
  resolvedChartId: string,
  existing: ChartFloatingObject,
  updates: Partial<ChartConfig>,
  admissionOptions?: ChartMutationOptionsInput,
  diagnosticTarget: unknown = { id: resolvedChartId },
): Promise<void> {
  const internalUpdates = chartUpdatesToInternal(updates);
  if (internalUpdates.anchor && existing.anchor) {
    internalUpdates.anchor = { ...existing.anchor, ...internalUpdates.anchor };
  }
  await callNativeChartMutation(
    diagnosticTarget,
    () =>
      ctx.computeBridge.updateChart(
        sheetId,
        resolvedChartId,
        internalUpdates,
        nextChartMutationOptions(admissionOptions) ??
          createChartMutationOptions(ctx, {
            operationIdPrefix: 'charts.update',
            sheetIds: [sheetId],
          }),
      ),
    resolvedChartId,
  );
}
