/**
 * Pivot Event Bridge
 *
 * Bridge between the Event Bus and Pivot rendering system.
 * Subscribes to state change events and triggers pivot recalculation/refresh.
 *
 * This enables reactive pivot updates regardless of change source:
 * - User edits in source data range
 * - Formula recalculation affecting source data
 * - XLSX imports
 * - Remote collaboration
 * - Programmatic API calls
 *
 */

import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  PivotCreatedEvent,
  PivotDeletedEvent,
  PivotExpansionChangedEvent,
  PivotUpdatedEvent,
} from '@mog-sdk/contracts/events';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { PivotTableConfig } from './compute/compute-types.gen';

import type { PivotBridge } from './pivot-bridge';

/**
 * Configuration for the pivot event bridge
 */
export interface PivotEventBridgeConfig {
  /** The sheet ID to filter events for */
  sheetId: SheetId;
  /** PivotBridge instance (from React context) */
  pivotBridge: PivotBridge;
  /** Event bus instance (per-document) */
  eventBus: IEventBus;
  /** Resolve a sheet ID to its name (needed for legacy pivot configs without sourceSheetId) */
  getSheetName: (sheetId: SheetId) => Promise<string | null>;
  /** Enable debug logging */
  debug?: boolean;
  /** Callback when pivot display needs refresh */
  onPivotRefresh?: (pivotId: string) => void;
  /** Callback when a pivot is deleted */
  onPivotDeleted?: (pivotId: string) => void;
}

/**
 * Check if a cell position is within a range
 */
function isCellInRange(row: number, col: number, range: CellRange): boolean {
  return (
    row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol
  );
}

/**
 * Check if any cells from changes are within a range
 */
function areAnyCellsInRange(
  changes: Array<{ row: number; col: number }>,
  range: CellRange,
): boolean {
  return changes.some((cell) => isCellInRange(cell.row, cell.col, range));
}

/**
 * Get all pivot tables that depend on a specific sheet as source data.
 * Uses sourceSheetId when present; resolves the source sheet name only for legacy configs.
 */
async function getPivotsWithSourceSheet(
  pivotBridge: PivotBridge,
  sheetId: SheetId,
  sourceSheetId: SheetId,
  getSheetName: (id: SheetId) => Promise<string | null>,
): Promise<PivotTableConfig[]> {
  const sourceName = await getSheetName(sourceSheetId);
  const pivots = await pivotBridge.getAllPivots(sheetId);
  return pivots.filter((p) => {
    if (p.sourceSheetId) {
      return p.sourceSheetId === sourceSheetId;
    }
    return sourceName !== null && p.sourceSheetName === sourceName;
  });
}

/**
 * Connect the pivot rendering system to the event bus.
 *
 * The bridge subscribes to relevant events and triggers pivot
 * recalculation when source data changes.
 *
 * @param config - Bridge configuration (includes pivotBridge from context)
 * @returns Cleanup function to disconnect the bridge
 *
 * @example
 * ```typescript
 * // In a React component - get ctx from context
 * const ctx = useDocumentContext();
 *
 * useEffect(() => {
 *   const disconnect = connectPivotToEventBus({
 *     sheetId: activeSheetId,
 *     pivotBridge: ctx.pivot,
 *     onPivotRefresh: (pivotId) => {
 *       // Trigger re-render for this pivot
 *       ctx.pivot.refresh(activeSheetId, pivotId);
 *     },
 *   });
 *   return disconnect;
 * }, [activeSheetId, ctx.pivot]);
 * ```
 */
export function connectPivotToEventBus(config: PivotEventBridgeConfig): () => void {
  const {
    sheetId,
    pivotBridge,
    eventBus,
    getSheetName,
    debug = false,
    onPivotRefresh,
    onPivotDeleted,
  } = config;
  const unsubscribers: Array<() => void> = [];

  const log = debug
    ? (msg: string, ...args: unknown[]) => console.log(`[PivotEventBridge] ${msg}`, ...args)
    : () => {};

  // ---------------------------------------------------------------------------
  // Pivot Lifecycle Events
  // ---------------------------------------------------------------------------

  // Pivot created → trigger initial computation and render
  unsubscribers.push(
    eventBus.on<PivotCreatedEvent>('pivot:created', (event) => {
      if (event.sheetId !== sheetId) return;

      log('pivot:created', { pivotId: event.pivotId });

      // Compute the pivot table result (fire-and-forget async)
      void pivotBridge.refresh(sheetId, event.pivotId).then(() => {
        // Notify for re-render after computation completes
        onPivotRefresh?.(event.pivotId);
      });
    }),
  );

  // Pivot updated → recompute and re-render
  unsubscribers.push(
    eventBus.on<PivotUpdatedEvent>('pivot:updated', (event) => {
      if (event.sheetId !== sheetId) return;

      log('pivot:updated', { pivotId: event.pivotId, update: event.update });

      if (event.update.refreshPolicy === 'dirtyOnly') {
        return;
      }

      // Recompute the pivot table (fire-and-forget async)
      void pivotBridge.refresh(sheetId, event.pivotId).then(() => {
        // Notify for re-render after computation completes
        onPivotRefresh?.(event.pivotId);
      });
    }),
  );

  // Pivot deleted → clean up
  unsubscribers.push(
    eventBus.on<PivotDeletedEvent>('pivot:deleted', (event) => {
      if (event.sheetId !== sheetId) return;

      log('pivot:deleted', { pivotId: event.pivotId });

      // Notify for removal from display
      onPivotDeleted?.(event.pivotId);
    }),
  );

  // Pivot expansion changed → recompute to update displayed rows/columns
  unsubscribers.push(
    eventBus.on<PivotExpansionChangedEvent>('pivot:expansion-changed', (event) => {
      if (event.sheetId !== sheetId) return;

      log('pivot:expansion-changed', {
        pivotId: event.pivotId,
        headerKey: event.headerKey,
        isExpanded: event.isExpanded,
      });

      // Recompute to reflect expansion state (fire-and-forget async)
      void pivotBridge.refresh(sheetId, event.pivotId).then(() => {
        // Notify for re-render after computation completes
        onPivotRefresh?.(event.pivotId);
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Cell Change Events → Check if source data is affected
  // ---------------------------------------------------------------------------

  // Single cell change → check all pivots for source range overlap
  unsubscribers.push(
    eventBus.on<CellChangedEvent>('cell:changed', (event) => {
      // Get all pivots that use the changed sheet as source (async)
      void getPivotsWithSourceSheet(
        pivotBridge,
        sheetId,
        toSheetId(event.sheetId),
        getSheetName,
      ).then((affectedPivots) => {
        for (const pivot of affectedPivots) {
          if (isCellInRange(event.row, event.col, pivot.sourceRange)) {
            log('cell:changed affects pivot source', {
              pivotId: pivot.id,
              cell: { row: event.row, col: event.col },
            });

            // Recompute this pivot (fire-and-forget async)
            void pivotBridge.refresh(sheetId, pivot.id).then(() => {
              // Notify for re-render after computation completes
              onPivotRefresh?.(pivot.id);
            });
          }
        }
      });
    }),
  );

  // Batch cell changes → check all pivots efficiently
  unsubscribers.push(
    eventBus.on<CellsBatchChangedEvent>('cells:batch-changed', (event) => {
      // Get all pivots that use the changed sheet as source (async)
      void getPivotsWithSourceSheet(
        pivotBridge,
        sheetId,
        toSheetId(event.sheetId),
        getSheetName,
      ).then((affectedPivots) => {
        for (const pivot of affectedPivots) {
          if (areAnyCellsInRange(event.changes, pivot.sourceRange)) {
            log('cells:batch-changed affects pivot source', {
              pivotId: pivot.id,
              changeCount: event.changes.length,
            });

            // Recompute this pivot (fire-and-forget async)
            void pivotBridge.refresh(sheetId, pivot.id).then(() => {
              // Notify for re-render after computation completes
              onPivotRefresh?.(pivot.id);
            });
          }
        }
      });
    }),
  );

  // ---------------------------------------------------------------------------
  // Return cleanup function
  // ---------------------------------------------------------------------------

  return () => {
    log('disconnecting');
    unsubscribers.forEach((unsub) => unsub());
  };
}

/**
 * Create a pivot event bridge with automatic sheet ID tracking.
 *
 * This is useful when the sheet ID may change during the component lifecycle.
 * Call `setSheetId()` when the active sheet changes.
 *
 * @param initialSheetId - Initial sheet ID to filter events for
 * @param pivotBridge - PivotBridge instance (from React context)
 * @param callbacks - Optional callbacks for pivot events
 * @param debug - Enable debug logging
 * @returns Object with setSheetId and disconnect methods
 */
export function createPivotEventBridge(
  initialSheetId: SheetId,
  pivotBridge: PivotBridge,
  eventBus: IEventBus,
  getSheetName: (sheetId: SheetId) => Promise<string | null>,
  callbacks?: {
    onPivotRefresh?: (pivotId: string) => void;
    onPivotDeleted?: (pivotId: string) => void;
  },
  debug = false,
): {
  setSheetId: (sheetId: SheetId) => void;
  disconnect: () => void;
} {
  let currentSheetId = initialSheetId;
  let currentDisconnect = connectPivotToEventBus({
    sheetId: currentSheetId,
    pivotBridge,
    eventBus,
    getSheetName,
    debug,
    ...callbacks,
  });

  return {
    setSheetId(sheetId: SheetId) {
      if (sheetId === currentSheetId) return;

      // Reconnect with new sheet ID
      currentDisconnect();
      currentSheetId = sheetId;
      currentDisconnect = connectPivotToEventBus({
        sheetId: currentSheetId,
        pivotBridge,
        eventBus,
        getSheetName,
        debug,
        ...callbacks,
      });
    },

    disconnect() {
      currentDisconnect();
    },
  };
}
