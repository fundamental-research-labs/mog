import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  ChartUpdatedEvent,
  ColumnsDeletedEvent,
  ColumnsInsertedEvent,
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
  RowsDeletedEvent,
  RowsInsertedEvent,
  SheetDeletedEvent,
} from '@mog-sdk/contracts/events';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { resolveChartRangeReferences } from '../chart-range-references';
import { getAll as getAllCharts, update as updateChart } from '../chart-store';
import {
  buildStructuralRangeUpdate,
  type StructuralRangeUpdate,
} from './chart-structural-range-updates';
import { hasImportStatus, isChartPayload } from './import-render-status';
import { isPositionOnlyUpdate } from './position-only-update';

export interface ChartBridgeSubscriptionRenderCache {
  getSheetId(chartId: string): SheetId | undefined;
  setSheetId(chartId: string, sheetId: SheetId): void;
  deleteSheetId(chartId: string, sheetId?: SheetId): boolean;
  deleteSheet(sheetId: SheetId): string[];
  deleteChartCaches(chartId: string, sheetId?: SheetId): void;
  syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean;
}

export interface ChartBridgeSubscriptionContext {
  ctx: DocumentContext;
  renderCache: ChartBridgeSubscriptionRenderCache;
  isLive(): boolean;
  invalidateChart(chartId: string, sheetId?: SheetId): void;
  clearAllCaches(): void;
}

type MaybeLive = {
  isLive?: () => boolean;
};

type AffectedChartInvalidation = {
  chartId: string;
  sheetId?: SheetId;
};

/**
 * Set up EventBus subscriptions for reactive chart updates.
 *
 * The returned cleanup deactivates this subscription generation before it
 * unsubscribes, so async fire-and-forget handlers from a previous start()
 * cannot mutate caches after stop() or after a later restart().
 */
export function setupChartBridgeSubscriptions(deps: ChartBridgeSubscriptionContext): () => void {
  let active = true;
  const liveDeps: ChartBridgeSubscriptionContext = {
    ...deps,
    isLive: () => active && deps.isLive(),
  };

  const cleanups: Array<() => void> = [];

  // Event-bus seam: event payloads carry sheetId as raw string (see
  // CellChangedEvent / CellsBatchChangedEvent). Brand at subscription entry
  // until a follow-up round migrates event types to SheetId.
  cleanups.push(
    deps.ctx.eventBus.on<CellChangedEvent>('cell:changed', (event) => {
      void handleCellChange(liveDeps, toSheetId(event.sheetId), event.row, event.col);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<CellsBatchChangedEvent>('cells:batch-changed', (event) => {
      void handleCellsBatchChange(liveDeps, toSheetId(event.sheetId), event.changes);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<ChartUpdatedEvent>('chart:updated', (event) => {
      if (!liveDeps.isLive()) return;
      deps.invalidateChart(event.chartId, toSheetId(event.sheetId));
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on('workbook:theme-changed', () => {
      if (!liveDeps.isLive()) return;
      deps.clearAllCaches();
    }),
  );

  // Subscribe to floating object events for chart-type objects.
  // This handles the live mutation path: when charts are created or updated
  // as floating objects, we invalidate the marks cache so the next render
  // fetches fresh data from ComputeBridge.
  //
  // The handlers also maintain chartId -> sheetId state so the sync paint path
  // can resolve the sheet in O(1) without awaiting.
  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectCreatedEvent>('floatingObject:created', (event) => {
      if (!liveDeps.isLive()) return;
      if (event.objectType === 'chart' || isChartPayload(event.data)) {
        const eventSheetId = toSheetId(event.sheetId);
        deps.renderCache.setSheetId(event.objectId, eventSheetId);
        if (!deps.renderCache.syncImportRenderStatus(event.objectId, event.data, eventSheetId)) {
          deps.invalidateChart(event.objectId, eventSheetId);
        }
      }
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectUpdatedEvent>('floatingObject:updated', (event) => {
      if (!liveDeps.isLive()) return;
      if (isChartPayload(event.data)) {
        const eventSheetId = toSheetId(event.sheetId);
        if (deps.renderCache.getSheetId(event.objectId) !== eventSheetId) {
          deps.renderCache.setSheetId(event.objectId, eventSheetId);
        }
        const importStatusPayload = hasImportStatus(event.changes) ? event.changes : event.data;
        const hasTerminalImportStatus = deps.renderCache.syncImportRenderStatus(
          event.objectId,
          importStatusPayload,
          eventSheetId,
        );
        if (hasTerminalImportStatus) return;

        const fields = event.changedFields ?? [];
        if (!isPositionOnlyUpdate(fields)) {
          deps.invalidateChart(event.objectId, eventSheetId);
        }
      }
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectDeletedEvent>('floatingObject:deleted', (event) => {
      if (!liveDeps.isLive()) return;
      if (event.objectType === 'chart') {
        const eventSheetId = toSheetId(event.sheetId);
        deps.renderCache.deleteSheetId(event.objectId, eventSheetId);
        deps.renderCache.deleteChartCaches(event.objectId, eventSheetId);
      }
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<SheetDeletedEvent>('sheet:deleted', (event) => {
      if (!liveDeps.isLive()) return;
      const deletedSheetId = toSheetId(event.sheetId);
      deps.renderCache.deleteSheet(deletedSheetId);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<RowsInsertedEvent>('rows:inserted', (event) => {
      void handleRowsInserted(liveDeps, toSheetId(event.sheetId), event.startRow, event.count);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<RowsDeletedEvent>('rows:deleted', (event) => {
      void handleRowsDeleted(liveDeps, toSheetId(event.sheetId), event.startRow, event.count);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<ColumnsInsertedEvent>('columns:inserted', (event) => {
      void handleColumnsInserted(liveDeps, toSheetId(event.sheetId), event.startCol, event.count);
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<ColumnsDeletedEvent>('columns:deleted', (event) => {
      void handleColumnsDeleted(liveDeps, toSheetId(event.sheetId), event.startCol, event.count);
    }),
  );

  return () => {
    active = false;
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

/**
 * Handle a cell change - invalidate any charts that reference this cell.
 */
export async function handleCellChange(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<void> {
  if (!deps.isLive()) return;

  const charts = await getAllChartsInWorkbook(deps.ctx);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const referencesCell = await chartReferencesCell(deps.ctx, chart, sheetId, row, col);
    if (!deps.isLive()) return;
    if (referencesCell) {
      deps.invalidateChart(chart.id, chartOwnerSheetId(chart) ?? sheetId);
    }
  }
}

export async function handleCellsBatchChange(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  changes: CellsBatchChangedEvent['changes'],
): Promise<void> {
  if (!deps.isLive() || changes.length === 0) return;

  let startRow = Number.POSITIVE_INFINITY;
  let startCol = Number.POSITIVE_INFINITY;
  let endRow = Number.NEGATIVE_INFINITY;
  let endCol = Number.NEGATIVE_INFINITY;

  for (const change of changes) {
    startRow = Math.min(startRow, change.row);
    startCol = Math.min(startCol, change.col);
    endRow = Math.max(endRow, change.row);
    endCol = Math.max(endCol, change.col);
  }

  const affected = await getChartInvalidationsAffectedByRange(
    deps.ctx,
    sheetId,
    {
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    },
    { isLive: deps.isLive },
  );
  if (!deps.isLive()) return;
  for (const chart of affected) {
    deps.invalidateChart(chart.chartId, chart.sheetId);
  }
}

export async function getAllChartsInWorkbook(ctx: DocumentContext): Promise<ChartFloatingObject[]> {
  const sheetIds = await ctx.computeBridge.getSheetOrder();
  const perSheet = await Promise.all(sheetIds.map((id) => getAllCharts(ctx, toSheetId(id))));
  return perSheet.flat();
}

/**
 * Check if a chart's data range includes a specific cell.
 */
export async function chartReferencesCell(
  ctx: DocumentContext,
  chart: ChartFloatingObject,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  const resolved = await resolveChartRangeReferences(ctx, chart);
  const ranges = resolvedChartReferenceRanges(resolved);

  return ranges.some((entry) => {
    const range = entry?.range;
    return (
      range?.sheetId === sheetId &&
      row >= range.startRow &&
      row <= range.endRow &&
      col >= range.startCol &&
      col <= range.endCol
    );
  });
}

/**
 * Handle rows inserted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleRowsInserted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startRow: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'row', 'insert', startRow, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle rows deleted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleRowsDeleted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startRow: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'row', 'delete', startRow, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle columns inserted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleColumnsInserted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startCol: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'column', 'insert', startCol, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

/**
 * Handle columns deleted - update legacy A1-string chart ranges for affected charts.
 */
export async function handleColumnsDeleted(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  startCol: number,
  count: number,
): Promise<void> {
  if (!deps.isLive()) return;
  const charts = await getAllCharts(deps.ctx, sheetId);
  if (!deps.isLive()) return;

  for (const chart of charts) {
    if (!deps.isLive()) return;
    const result = buildStructuralRangeUpdate(chart, 'column', 'delete', startCol, count);
    await commitStructuralRangeUpdate(deps, sheetId, chart, result);
  }
}

async function commitStructuralRangeUpdate(
  deps: ChartBridgeSubscriptionContext,
  sheetId: SheetId,
  chart: ChartFloatingObject,
  result: StructuralRangeUpdate,
): Promise<void> {
  const hasUpdates = Object.keys(result.updates).length > 0;
  if (!hasUpdates && !result.invalidate) return;

  if (hasUpdates) {
    await updateChart(deps.ctx, sheetId, chart.id, result.updates);
    if (!deps.isLive()) return;
  }

  deps.invalidateChart(chart.id, sheetId);
}

/**
 * Get charts that are affected by changes in a specific cell range.
 */
export async function getChartsAffectedByRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: MaybeLive = {},
): Promise<string[]> {
  return (await getChartInvalidationsAffectedByRange(ctx, sheetId, range, options)).map(
    (chart) => chart.chartId,
  );
}

async function getChartInvalidationsAffectedByRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: MaybeLive = {},
): Promise<AffectedChartInvalidation[]> {
  if (options.isLive && !options.isLive()) return [];

  const charts = await getAllChartsInWorkbook(ctx);
  if (options.isLive && !options.isLive()) return [];

  const affected: AffectedChartInvalidation[] = [];

  for (const chart of charts) {
    if (options.isLive && !options.isLive()) return affected;
    const resolved = await resolveChartRangeReferences(ctx, chart);
    if (options.isLive && !options.isLive()) return affected;
    const ranges = resolvedChartReferenceRanges(resolved);
    const overlaps = ranges.some((entry) => {
      const chartRange = entry?.range;
      return (
        chartRange?.sheetId === sheetId &&
        range.startRow <= chartRange.endRow &&
        range.endRow >= chartRange.startRow &&
        range.startCol <= chartRange.endCol &&
        range.endCol >= chartRange.startCol
      );
    });

    if (overlaps) {
      affected.push({ chartId: chart.id, sheetId: chartOwnerSheetId(chart) });
    }
  }

  return affected;
}

function resolvedChartReferenceRanges(
  resolved: Awaited<ReturnType<typeof resolveChartRangeReferences>>,
) {
  return [
    resolved.dataRange,
    resolved.categoryRange,
    resolved.seriesRange,
    ...resolved.seriesReferences.flatMap((series) => [
      series.values,
      series.categories,
      series.bubbleSizes,
    ]),
  ];
}

function chartOwnerSheetId(chart: ChartFloatingObject): SheetId | undefined {
  return chart.sheetId ? toSheetId(chart.sheetId) : undefined;
}
