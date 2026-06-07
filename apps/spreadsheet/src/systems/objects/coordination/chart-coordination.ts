/**
 * Chart Coordination Module
 *
 * Handles chart-specific coordination concerns.
 * This module DELEGATES the entire concern - coordinator calls setup once.
 *
 * Responsibilities:
 * - Synchronizing chart selection from objectInteractionActor to chartActor
 * - Emitting chart:selected / chart:deselected events
 *
 * NOTE: TwoCell anchor recalculation on structure changes has been removed.
 * That concern should be handled generically by the floating object system
 * for ALL TwoCell floating objects, not just charts.
 *
 * NOTE: Pointer handling (selection, drag, resize) is unified in objectInteractionActor.
 * This module syncs selection state so chartActor can track element-level features.
 *
 * @see object-coordination.ts - owns all floating object selection/drag/resize
 * @see docs/ARCHITECTURE-CHECKLIST.md - Rule #4
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { ChartActor, ObjectInteractionActor, SelectionActor } from '../../shared/actor-types';
import { getObjectInteractionSnapshot } from '../machines/object-interaction-machine';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for chart coordination setup.
 */
export interface ChartCoordinationConfig {
  /** The chart XState actor */
  chartActor: ChartActor;
  /** The selection XState actor (for deselection coordination) */
  selectionActor: SelectionActor;
  /** The object interaction actor (for unified selection/drag/resize) */
  objectInteractionActor?: ObjectInteractionActor;
  /**
   * Getter for the active sheet ID.
   * Optional — when omitted, workbook.activeSheet is used as fallback.
   */
  getActiveSheetId?: () => string;
  /** Unified Workbook API */
  workbook: Workbook;
  /**
   * Per-document event bus for coordination events.
   * Optional — when omitted, chart:selected / chart:deselected events are not emitted.
   */
  eventBus?: IEventBus;
}

/**
 * Chart snapshot for external access.
 *
 * NOTE: Drag/resize state has been removed - objectInteractionActor now owns
 * all floating object operations including charts. This snapshot only tracks
 * chart-specific state like selected chart ID for element-level features.
 */
export interface ChartSnapshot {
  /** Currently selected chart ID (synced from objectInteractionActor) */
  selectedChartId: string | null;
}

/**
 * Result returned by setupChartCoordination.
 *
 * NOTE: Pointer handlers have been removed - objectInteractionActor now owns
 * all floating object operations. This module only provides:
 * - Chart selection sync from objectInteraction to chartActor
 * - chart:selected / chart:deselected event emission
 */
export interface ChartCoordinationResult {
  /**
   * Cleanup function - MUST be called when coordinator is disposed.
   * Unsubscribes from all actors and event bus.
   */
  cleanup: () => void;
}

// =============================================================================
// SETUP FUNCTION
// =============================================================================

/**
 * Set up chart coordination.
 *
 * This function:
 * 1. Syncs chart selection from objectInteractionActor to chartActor
 * 2. Returns cleanup function for proper disposal
 *
 * NOTE: Pointer handling (selection, drag, resize) is now unified in objectInteractionActor.
 * This module syncs selection so chartActor can track element-level features.
 *
 * @param config - Configuration with actors, event bus, and getters
 * @returns Result object with cleanup
 */
export function setupChartCoordination(config: ChartCoordinationConfig): ChartCoordinationResult {
  const {
    chartActor,
    // NOTE: selectionActor is kept in the interface for API stability but no longer used here.
    // Selection->Chart deselection is handled by selection-context-coordination.ts.
    selectionActor: _selectionActor,
    objectInteractionActor,
    getActiveSheetId,
    workbook,
    eventBus,
  } = config;

  // Track cleanups to be called on dispose
  const cleanups: (() => void)[] = [];

  // ---------------------------------------------------------------------------
  // OBJECT INTERACTION -> CHART SELECTION SYNC
  // When objectInteractionActor selects a chart, sync to chartActor for
  // element-level features (title editing, series selection, etc.)
  // ---------------------------------------------------------------------------

  if (objectInteractionActor) {
    let prevSelectedChartIds: string[] = [];
    // Monotonic emission counter — guards against out-of-order async
    // resolution of chart.list() from the rapid emissions a real-UI gesture
    // produces (cell-click → cell-deselect → chart-click → chart-select).
    // Without this, an earlier emission's async resolve could overwrite the
    // later emission's SYNC_SELECTION send and reset chart-machine to idle.
    let emissionSeq = 0;
    let lastAppliedSeq = -1;

    const objectSub = objectInteractionActor.subscribe((state) => {
      const snapshot = getObjectInteractionSnapshot(state);
      const currSelectedIds = snapshot.selectedIds;
      const seq = ++emissionSeq;

      // Identify which selected objects are charts via the floating object type field.
      // We query the chart list async; the floating object pipeline sets type='chart'
      // on chart objects directly.
      //
      // Use getActiveSheetId() if provided; fall back to workbook.activeSheet (sync).
      const ws = getActiveSheetId
        ? workbook.getSheetById(toSheetId(getActiveSheetId()))
        : workbook.activeSheet;
      const activeSheetId = String(ws.sheetId);
      void ws.charts.list({ materialization: 'available' }).then((allCharts) => {
        // Drop the result if a later emission has already been applied —
        // out-of-order async resolves must not overwrite the latest state.
        if (seq <= lastAppliedSeq) return;
        lastAppliedSeq = seq;

        const chartIdSet = new Set(allCharts.map((c: { id: string }) => c.id));

        // Filter to only chart IDs from the current selection
        const currSelectedChartIds = currSelectedIds.filter((id) => chartIdSet.has(id));

        // Detect membership change for chart:selected/chart:deselected events
        // and the chart-machine SYNC_SELECTION send. keeps the
        // membership-change gate (the prior design); the harness
        // `selectChart()` no longer needs the A1 detour because we now
        // sequence emissions monotonically (the seq counter above).
        const prevSet = new Set(prevSelectedChartIds);
        const currSet = new Set(currSelectedChartIds);
        const membershipChanged =
          prevSet.size !== currSet.size ||
          [...prevSet].some((id) => !currSet.has(id)) ||
          [...currSet].some((id) => !prevSet.has(id));

        if (membershipChanged) {
          if (eventBus) {
            const timestamp = Date.now();
            // Emit deselected events for charts that were previously selected
            for (const id of prevSelectedChartIds) {
              if (!currSet.has(id)) {
                eventBus.emit({
                  type: 'chart:deselected',
                  chartId: id,
                  sheetId: activeSheetId,
                  timestamp,
                });
              }
            }
            // Emit selected events for newly selected charts
            for (const id of currSelectedChartIds) {
              if (!prevSet.has(id)) {
                eventBus.emit({
                  type: 'chart:selected',
                  chartId: id,
                  sheetId: activeSheetId,
                  timestamp,
                });
              }
            }
          }
          // Sync chart selection to chartActor using SYNC_SELECTION
          chartActor.send({ type: 'SYNC_SELECTION', chartIds: currSelectedChartIds });
          prevSelectedChartIds = currSelectedChartIds;
        }
      });
    });

    cleanups.push(() => objectSub.unsubscribe());
  }

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  function cleanup(): void {
    for (const unsub of cleanups) {
      unsub();
    }
  }

  // ---------------------------------------------------------------------------
  // RETURN RESULT
  // ---------------------------------------------------------------------------

  return {
    cleanup,
  };
}
