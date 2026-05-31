import type { SheetId } from '@mog-sdk/contracts/core';
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
import { getAll as getAllCharts, update as updateChart } from '../chart-store';
import {
  chartOwnerSheetId,
  chartReferencesCell,
  getAllChartsInWorkbook,
  getChartInvalidationsAffectedByRange,
} from './chart-reference-invalidation';
import {
  handleChartFloatingObjectCreated,
  handleChartFloatingObjectDeleted,
  handleChartFloatingObjectUpdated,
  handleChartSheetDeleted,
  type ChartFloatingObjectEventContext,
  type ChartFloatingObjectEventRenderCache,
} from './chart-floating-object-events';
import {
  buildStructuralRangeUpdate,
  type StructuralRangeUpdate,
} from './chart-structural-range-updates';

export interface ChartBridgeSubscriptionRenderCache extends ChartFloatingObjectEventRenderCache {}

export interface ChartBridgeSubscriptionContext extends ChartFloatingObjectEventContext {
  ctx: DocumentContext;
  renderCache: ChartBridgeSubscriptionRenderCache;
  isLive(): boolean;
  clearAllCaches(): void;
}

export {
  chartReferencesCell,
  getAllChartsInWorkbook,
  getChartsAffectedByRange,
} from './chart-reference-invalidation';

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

  // Keep the event-bus boundary here: listeners own liveness checks and raw
  // event sheetId branding, then delegate chart-specific floating-object policy.
  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectCreatedEvent>('floatingObject:created', (event) => {
      if (!liveDeps.isLive()) return;
      handleChartFloatingObjectCreated(
        deps,
        {
          objectId: event.objectId,
          objectType: event.objectType,
          data: event.data,
        },
        toSheetId(event.sheetId),
      );
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectUpdatedEvent>('floatingObject:updated', (event) => {
      if (!liveDeps.isLive()) return;
      handleChartFloatingObjectUpdated(
        deps,
        {
          objectId: event.objectId,
          data: event.data,
          changes: event.changes,
          changedFields: event.changedFields,
        },
        toSheetId(event.sheetId),
      );
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectDeletedEvent>('floatingObject:deleted', (event) => {
      if (!liveDeps.isLive()) return;
      handleChartFloatingObjectDeleted(
        deps,
        {
          objectId: event.objectId,
          objectType: event.objectType,
        },
        toSheetId(event.sheetId),
      );
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<SheetDeletedEvent>('sheet:deleted', (event) => {
      if (!liveDeps.isLive()) return;
      handleChartSheetDeleted(deps, toSheetId(event.sheetId));
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
