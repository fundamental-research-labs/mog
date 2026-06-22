import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
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

import {
  handleChartFloatingObjectCreated,
  handleChartFloatingObjectDeleted,
  handleChartFloatingObjectUpdated,
  handleChartSheetDeleted,
} from './chart-floating-object-events';
import { handleCellChange, handleCellsBatchChange } from './chart-bridge-cell-events';
import type { ChartBridgeSubscriptionContext } from './chart-bridge-subscription-context';
import { isPositionOnlyUpdate } from './position-only-update';
import {
  handleColumnsDeleted,
  handleColumnsInserted,
  handleRowsDeleted,
  handleRowsInserted,
} from './chart-bridge-structural-events';

export {
  chartReferencesCell,
  getAllChartsInWorkbook,
  getChartsAffectedByRange,
} from './chart-reference-invalidation';
export type {
  ChartBridgeSubscriptionContext,
  ChartBridgeSubscriptionRenderCache,
} from './chart-bridge-subscription-context';
export { handleCellChange, handleCellsBatchChange } from './chart-bridge-cell-events';
export {
  handleColumnsDeleted,
  handleColumnsInserted,
  handleRowsDeleted,
  handleRowsInserted,
} from './chart-bridge-structural-events';

type FloatingObjectSheetIdentityEvent = {
  sheetId: string;
  containerId?: string;
};

type FloatingObjectPreviousSheetIdentityEvent = FloatingObjectSheetIdentityEvent & {
  previousSheetId?: string;
  previousContainerId?: string;
};

function floatingObjectEventSheetId(event: FloatingObjectSheetIdentityEvent): SheetId {
  return toSheetId(event.containerId ?? event.sheetId);
}

function previousFloatingObjectEventSheetId(
  event: FloatingObjectPreviousSheetIdentityEvent,
): SheetId | undefined {
  const previousContainerId = event.previousContainerId ?? event.previousSheetId;
  return previousContainerId === undefined ? undefined : toSheetId(previousContainerId);
}

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
      if (isPositionOnlyUpdate(event.changedFields ?? [])) return;
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
  // event containerId/sheetId branding, then delegate chart-specific
  // floating-object policy. Prefer containerId during the transition; sheetId
  // remains the legacy fallback for older/manual events.
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
        floatingObjectEventSheetId(event),
      );
    }),
  );

  cleanups.push(
    deps.ctx.eventBus.on<FloatingObjectUpdatedEvent>('floatingObject:updated', (event) => {
      if (!liveDeps.isLive()) return;
      const previousSheetId = previousFloatingObjectEventSheetId(event);
      handleChartFloatingObjectUpdated(
        deps,
        {
          objectId: event.objectId,
          data: event.data,
          changes: event.changes,
          changedFields: event.changedFields,
          ...(previousSheetId !== undefined ? { previousSheetId } : {}),
        },
        floatingObjectEventSheetId(event),
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
        floatingObjectEventSheetId(event),
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
