/**
 * Sheet Switch Coordination
 *
 * Coordinates state machines when the user switches sheets:
 * 1. Saves current sheet's view state (selection + scroll position) []
 * 2. Cancels editor if editing on a different sheet
 * 3. Sends SWITCH_SHEET to renderer actor
 * 4. Restores target sheet's view state (selection) []
 *
 * @see Stream-G-TAB-STRIP.md - Architecture Fix
 */

import type { ActorRefFrom } from 'xstate';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId, type CellRange, type SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';
import { editorSelectors, selectionSelectors } from '../../../selectors';
import type { chartMachine } from '../../objects/machines/chart-machine';
import type { rendererMachine } from '../../renderer/machines/grid-renderer-machine';
import type { clipboardMachine } from '../machines/clipboard-machine';
import type { editorMachine } from '../machines/grid-editor-machine';
import type { selectionMachine } from '../machines/grid-selection-machine';
// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Per-sheet view state saved/restored during sheet switching.
 * Narrow interface matching the data shape from ui-store's SheetViewState
 * (defined locally to avoid systems/ → ui-store/ DAG violation).
 */
export interface SheetViewState {
  ranges: CellRange[];
  activeCell: CellCoord;
  anchor: CellCoord | null;
  anchorCol: number | null;
  anchorRow: number | null;
  scrollTop: number;
  scrollLeft: number;
}

export type SelectionActor = ActorRefFrom<typeof selectionMachine>;
export type EditorActor = ActorRefFrom<typeof editorMachine>;
export type ClipboardActor = ActorRefFrom<typeof clipboardMachine>;
export type RendererActor = ActorRefFrom<typeof rendererMachine>;
export type ChartActor = ActorRefFrom<typeof chartMachine>;

// =============================================================================
// SHEET SWITCH COORDINATION
// =============================================================================

/**
 * Callback type for subscribing to sheet ID changes.
 * Returns an unsubscribe function.
 *
 * Extended to provide both new and previous sheet IDs.
 * This enables saving the previous sheet's view state before switching.
 */
export type OnSheetSwitchCallback = (
  callback: (newSheetId: SheetId, prevSheetId: SheetId | null) => void,
) => () => void;

export interface SheetSwitchImportDurabilityGate {
  readonly isImportDurabilityPending: boolean;
  scheduleDeferredHydration?(): Promise<void>;
  awaitImportDurability(): Promise<void>;
}

type ImportedViewSelection = ReturnType<WorkbookInternal['mirror']['getViewSelection']>;

/**
 * Configuration for sheet switch coordination.
 */
export interface SheetSwitchCoordinationConfig {
  /** Workbook API for event subscriptions */
  workbook: WorkbookInternal;
  /** Import durability gate for host-backed XLSX documents. */
  importDurability?: SheetSwitchImportDurabilityGate;
  editorActor: EditorActor;
  clipboardActor: ClipboardActor;
  rendererActor: RendererActor;
  /** Selection actor - needed to save/restore selection state per sheet */
  selectionActor: SelectionActor;
  /** Optional chart actor - notified of sheet switches to clear chart selection */
  chartActor?: ChartActor;
  /** Callback to subscribe to sheet ID changes from UIStore */
  onSheetSwitch: OnSheetSwitchCallback;
  /** Get the current sheet ID being edited (if any) */
  getEditingSheetId: () => string | null;

  // ===========================================================================
  // Per-Sheet View State Callbacks
  // ===========================================================================

  /**
   * Get saved view state for a sheet.
   * Returns undefined if sheet has never been visited.
   */
  getSheetViewState?: (sheetId: SheetId) => SheetViewState | undefined;

  /**
   * Save view state for a sheet.
   * Called before switching away from a sheet.
   */
  saveSheetViewState?: (sheetId: SheetId, state: SheetViewState) => void;

  /**
   * Get current scroll position for saving.
   * Returns {x: 0, y: 0} if not available.
   */
  getScrollPosition?: () => Point;

  /**
   * Delete view state for a sheet.
   * Called when a sheet is deleted (
   */
  deleteSheetViewState?: (sheetId: SheetId) => void;

  /**
   * Get sheet bounds for dimension validation.
   * Used to validate that restored selection is within bounds.
   * Returns null if not available (validation will be skipped).
   */
  getSheetBounds?: () => { totalRows: number; totalCols: number } | null;

  /**
   * Get the top-left visible cell (row, col) from the current viewport.
   * Used to convert pixel scroll position to cell-level for Rust ground truth.
   * Returns null if coordinate system is not available.
   */
  getTopLeftCell?: (sheetId: SheetId) => { row: number; col: number } | null;

  /**
   * Called after sheet switch completes and selection is restored.
   * Use this to restore focus to the grid after the renderer is ready.
   */
  onSheetSwitchComplete?: () => void;

  /**
   * Push the active sheet's layout-predicate callbacks (isRowHidden /
   * isColHidden / getMergedRegionAt) into the selection machine.
   *
   * hidden bitmaps and viewport merges are
   * sheet-scoped, so the layout callbacks must be re-pushed every time the
   * active sheet changes. Without this, the selection machine's
   * merge-escape and hidden-skip navigation logic uses the previous
   * sheet's merges/visibility, silently producing wrong landings on the
   * new sheet.
   *
   * The callback is fired *before* `SET_SELECTION` restores the new
   * sheet's saved selection, so any merge-escape inside the restore is
   * already evaluated against the correct sheet.
   *
   */
  refreshLayoutCallbacks?: () => void;
}

function importedSelectionToViewState(selection: ImportedViewSelection): SheetViewState | null {
  if (!selection) return null;

  return {
    ranges: selection.ranges,
    activeCell: selection.activeCell,
    anchor: null,
    anchorCol: null,
    anchorRow: null,
    scrollTop: 0,
    scrollLeft: 0,
  };
}

function isDefaultA1SheetViewState(state: SheetViewState): boolean {
  const onlyA1Range =
    state.ranges.length === 1 &&
    state.ranges[0]?.startRow === 0 &&
    state.ranges[0]?.startCol === 0 &&
    state.ranges[0]?.endRow === 0 &&
    state.ranges[0]?.endCol === 0;

  return (
    state.activeCell.row === 0 &&
    state.activeCell.col === 0 &&
    onlyA1Range &&
    state.anchor === null &&
    state.anchorCol === null &&
    state.anchorRow === null
  );
}

function resolveRestorableSheetViewState(
  savedState: SheetViewState | undefined,
  importedSelection: ImportedViewSelection,
): SheetViewState | null {
  const importedState = importedSelectionToViewState(importedSelection);
  if (!savedState) return importedState;
  if (importedState && isDefaultA1SheetViewState(savedState)) return importedState;
  return savedState;
}

/**
 * Set up sheet switch coordination.
 *
 * This coordinates state machines when the user switches sheets:
 * 1. Saves current sheet's view state (selection + scroll position) []
 * 2. Cancels editor if editing on a different sheet
 * 3. Sends SWITCH_SHEET to renderer actor
 * 4. Restores target sheet's view state (selection) []
 *
 * Note: Clipboard cut state is NOT invalidated on sheet switch.
 * This matches Excel behavior where cut persists across sheet switches.
 *
 * Note: Scroll position is restored by renderer-execution.ts via getInitialScrollPosition callback.
 *
 * @see Stream-G-TAB-STRIP.md - Architecture Fix
 */
export function setupSheetSwitchCoordination(config: SheetSwitchCoordinationConfig): () => void {
  const {
    workbook,
    importDurability,
    editorActor,
    rendererActor,
    selectionActor,
    chartActor,
    onSheetSwitch,
    getEditingSheetId,
    // Per-sheet view state callbacks
    getSheetViewState,
    saveSheetViewState,
    getScrollPosition,
    deleteSheetViewState,
    getSheetBounds,
    getTopLeftCell,
    onSheetSwitchComplete,
    refreshLayoutCallbacks,
  } = config;

  // Subscribe to renderer state to detect when sheet switch completes
  // Used to restore selection after renderer is ready
  let pendingRestoreSheetId: string | null = null;
  let disposed = false;
  let pendingScrollFlush: Promise<void> | null = null;
  const pendingScrollPositions = new Map<SheetId, { topRow: number; leftCol: number }>();

  const flushPendingScrollPositions = (): void => {
    const positions = [...pendingScrollPositions.entries()];
    pendingScrollPositions.clear();
    for (const [pendingSheetId, position] of positions) {
      void workbook
        .getSheetById(pendingSheetId)
        .view.setScrollPosition(position.topRow, position.leftCol)
        .catch((err) => {
          console.warn('[SheetSwitchCoordination] Failed to persist scroll position:', err);
        });
    }
  };

  const scheduleScrollFlushAfterDurability = (): void => {
    if (pendingScrollFlush) return;

    const waitForDurability =
      importDurability?.scheduleDeferredHydration?.bind(importDurability) ??
      importDurability?.awaitImportDurability.bind(importDurability);
    if (!waitForDurability) {
      flushPendingScrollPositions();
      return;
    }

    pendingScrollFlush = waitForDurability()
      .then(() => {
        if (!disposed) {
          flushPendingScrollPositions();
        }
      })
      .catch((err) => {
        pendingScrollPositions.clear();
        console.warn('[SheetSwitchCoordination] Failed to wait for import durability:', err);
      })
      .finally(() => {
        pendingScrollFlush = null;
        if (!disposed && pendingScrollPositions.size > 0) {
          scheduleScrollFlushAfterDurability();
        }
      });
  };

  const persistScrollPosition = (sheetId: SheetId, topRow: number, leftCol: number): void => {
    const write = () => {
      void workbook
        .getSheetById(sheetId)
        .view.setScrollPosition(topRow, leftCol)
        .catch((err) => {
          console.warn('[SheetSwitchCoordination] Failed to persist scroll position:', err);
        });
    };

    if (!importDurability) {
      write();
      return;
    }

    pendingScrollPositions.set(sheetId, { topRow, leftCol });
    scheduleScrollFlushAfterDurability();
  };

  const refreshActiveSheetRuntimeAfterCheckout = (): void => {
    refreshLayoutCallbacks?.();

    const selectionSnapshot = selectionActor.getSnapshot();
    const selectionState = selectionSnapshot.context;
    const isFormulaEditing = editorSelectors.isFormulaEditing(editorActor.getSnapshot());

    selectionActor.send({
      type: 'SET_SELECTION',
      ranges: selectionSelectors.ranges(selectionSnapshot),
      activeCell: selectionState.activeCell,
      anchor: isFormulaEditing ? null : selectionState.anchor,
      anchorCol: isFormulaEditing ? null : selectionState.anchorCol,
      anchorRow: isFormulaEditing ? null : selectionState.anchorRow,
      source: 'restore',
    });

    onSheetSwitchComplete?.();

    if (chartActor) {
      chartActor.send({ type: 'SHEET_SWITCHED' });
    }
  };

  const rendererSub = rendererActor.subscribe((state) => {
    // When renderer enters 'ready' state after a sheet switch, restore selection
    if (state.value === 'ready' && pendingRestoreSheetId !== null) {
      const targetSheetId = pendingRestoreSheetId;
      pendingRestoreSheetId = null;

      // refresh layout-predicate callbacks
      // (isRowHidden / isColHidden / getMergedRegionAt) so the selection
      // machine's merge-escape and hidden-skip logic resolve against the
      // *new* sheet's layout for the rest of this restore + any subsequent
      // user input. Fires before SET_SELECTION below so the categorical
      // source-aware mode reset (which clears modes on `source: 'restore'`)
      // also runs against the correct sheet.
      refreshLayoutCallbacks?.();

      // Restore selection state for the new sheet
      if (getSheetViewState) {
        const targetTypedSheetId = toSheetId(targetSheetId);
        const savedState = resolveRestorableSheetViewState(
          getSheetViewState(targetTypedSheetId),
          workbook.mirror.getViewSelection(targetTypedSheetId),
        );

        if (savedState) {
          // Validate saved selection is within bounds
          // If rows/columns were deleted remotely, the saved selection might be out of bounds
          const posIndex = getSheetBounds?.();
          let isValid = true;

          if (posIndex) {
            const maxRow = posIndex.totalRows - 1;
            const maxCol = posIndex.totalCols - 1;

            isValid =
              savedState.activeCell.row <= maxRow &&
              savedState.activeCell.col <= maxCol &&
              savedState.ranges.every(
                (r) =>
                  r.startRow <= maxRow &&
                  r.endRow <= maxRow &&
                  r.startCol <= maxCol &&
                  r.endCol <= maxCol,
              );
          }

          if (isValid) {
            // During formula editing, suppress anchor restoration to prevent
            // setupSelectionToEditorCoordination from detecting an anchor change
            // and firing a spurious FORMULA_RANGE_SELECTED that corrupts the formula.
            const isFormulaEditing = editorSelectors.isFormulaEditing(editorActor.getSnapshot());

            // Restore valid saved selection state. source: 'restore' suppresses
            // the viewport-follow emit so this restore doesn't fight the
            // per-sheet scroll restoration applied in parallel.
            selectionActor.send({
              type: 'SET_SELECTION',
              ranges: savedState.ranges,
              activeCell: savedState.activeCell,
              anchor: isFormulaEditing ? null : savedState.anchor,
              anchorCol: isFormulaEditing ? null : savedState.anchorCol,
              anchorRow: isFormulaEditing ? null : savedState.anchorRow,
              source: 'restore',
            });
          } else {
            // Invalid selection - fallback to A1 (still a restore, not user nav)
            selectionActor.send({
              type: 'SET_SELECTION',
              ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
              activeCell: { row: 0, col: 0 },
              anchor: null,
              anchorCol: null,
              anchorRow: null,
              source: 'restore',
            });
          }
        } else {
          // First visit to this sheet - default to A1 (restore semantics)
          selectionActor.send({
            type: 'SET_SELECTION',
            ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
            activeCell: { row: 0, col: 0 },
            anchor: null,
            anchorCol: null,
            anchorRow: null,
            source: 'restore',
          });
        }
      }

      // Restore focus to the grid after selection is set.
      // Without this, DOM focus remains on the clicked tab button,
      // so keyboard events (type-to-edit) don't reach the grid.
      onSheetSwitchComplete?.();
    }
  });

  const unsubSheetSwitch = onSheetSwitch((newSheetId, prevSheetId) => {
    // Save current sheet's view state BEFORE switching
    if (prevSheetId && saveSheetViewState) {
      const selectionSnapshot = selectionActor.getSnapshot();
      const selectionState = selectionSnapshot.context;
      const scrollPos = getScrollPosition?.() ?? { x: 0, y: 0 };

      saveSheetViewState(prevSheetId, {
        // Selection state (persistent fields only)
        ranges: selectionSelectors.ranges(selectionSnapshot),
        activeCell: selectionState.activeCell,
        anchor: selectionState.anchor,
        anchorCol: selectionState.anchorCol,
        anchorRow: selectionState.anchorRow,
        // Scroll position
        scrollTop: scrollPos.y,
        scrollLeft: scrollPos.x,
      });

      // Write cell-level scroll position to Rust ground truth (fire-and-forget).
      // The Rust store persists across sessions (XLSX round-trip), while UIStore is ephemeral.
      // Convert pixel scroll position to cell-level using the coordinate system's visible range.
      const topLeft = getTopLeftCell?.(prevSheetId);
      if (topLeft) {
        persistScrollPosition(prevSheetId, topLeft.row, topLeft.col);
      }
    }

    // 1. Handle editor on sheet switch
    const editorState = editorActor.getSnapshot();
    const isEditing = editorSelectors.isEditing(editorState);

    // Use prevSheetId (not getEditingSheetId()) because by the time this callback
    // fires, the UIStore activeSheetId has already been updated to newSheetId.
    // getEditingSheetId() reads activeSheetId and would return newSheetId, making
    // the editingSheetId !== newSheetId guard always false (commit never sent).
    if (isEditing && prevSheetId && prevSheetId !== newSheetId) {
      // If in formula editing mode (building a formula), keep the editor alive
      // so the user can build cross-sheet references (e.g. Sheet2!A1).
      // Otherwise, commit the edit (Excel behavior on sheet switch).
      //
      // This explicit COMMIT is the SOLE sheet-switch commit path. The editor
      // machine no longer reacts to raw BLUR in editing/formulaEditing/
      // richTextEditing — DOM blur is a side effect, not an intent — so this
      // dispatch is load-bearing. Removing it would leave a regular edit
      // hanging when the user clicks a different sheet tab.
      const isFormulaEditing = editorSelectors.isFormulaEditing(editorState);
      if (!isFormulaEditing) {
        editorActor.send({ type: 'COMMIT', direction: 'none' });
      }
      // Formula editing: do NOT cancel or commit — let user build cross-sheet refs
    }

    // 2. Switch renderer to the new sheet
    // The renderer machine handles the SWITCH_SHEET event and transitions
    // through switchingSheet state, applying frozen panes for the new sheet
    // Store the target sheet ID for selection restoration after renderer is ready
    pendingRestoreSheetId = newSheetId;
    rendererActor.send({ type: 'SWITCH_SHEET', sheetId: newSheetId });

    // 3. Clear chart selection/editing state
    // Charts are per-sheet, so selection doesn't persist across sheet switches
    if (chartActor) {
      chartActor.send({ type: 'SHEET_SWITCHED' });
    }
  });

  // Clean up stored view state when a sheet is deleted
  const sheetDeletedUnsub = deleteSheetViewState
    ? workbook.on('sheet:deleted', (event) => {
        deleteSheetViewState(toSheetId(event.sheetId));
      })
    : () => {}; // No-op if callback not provided

  const versionCheckoutMaterializedUnsub = workbook.on(
    'workbook:version-checkout-materialized',
    () => {
      const currentSheetId = rendererActor.getSnapshot().context.currentSheetId;
      if (currentSheetId) {
        refreshActiveSheetRuntimeAfterCheckout();
      }
    },
  );

  // Return cleanup function
  return () => {
    disposed = true;
    pendingScrollPositions.clear();
    rendererSub.unsubscribe();
    unsubSheetSwitch();
    sheetDeletedUnsub();
    versionCheckoutMaterializedUnsub();
  };
}
