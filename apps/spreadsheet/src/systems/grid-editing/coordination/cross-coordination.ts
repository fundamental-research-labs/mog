/**
 * Cross-Machine Coordination
 *
 * Defines how state machines communicate through the coordinator.
 * CRITICAL: Machines never import each other directly. All cross-machine
 * communication goes through these coordination rules.
 *
 * This file contains CORE selection-editor coordination:
 * - Editor ↔ Selection bidirectional communication
 * - Render invalidation (performance-critical layer updates)
 * - Editing input interception (prevents editor-selection divergence)
 *
 * Other coordination is in dedicated modules:
 * @see ../../../execution/render-context-coordination.ts - Renderer context updates
 * @see ../../../subscriptions/sheet-switch-coordination.ts - Sheet lifecycle
 * @see ../editing/editor-commit-coordination.ts - Validation + commit signaling
 *
 * @see ARCHITECTURE.md - Cross-Machine Communication section
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';

import { selectionSelectors } from '../../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { Direction } from '@mog-sdk/contracts/machines';
import type { CellCoord, LayerName } from '@mog-sdk/contracts/rendering';
import { RenderPriority } from '@mog-sdk/contracts/rendering';
import { cellsEqual } from '../../../utils/rendering-primitives';

import { moveCellSkipHidden } from '../../shared/types';

import type { rendererMachine } from '../../renderer/machines/grid-renderer-machine';
import type { clipboardMachine } from '../machines/clipboard-machine';
import { isCursorAtReferencePosition } from '../machines/editor/formula-editing';
import type { editorMachine } from '../machines/grid-editor-machine';
import type { selectionMachine } from '../machines/grid-selection-machine';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type SelectionActor = ActorRefFrom<typeof selectionMachine>;
export type EditorActor = ActorRefFrom<typeof editorMachine>;
export type ClipboardActor = ActorRefFrom<typeof clipboardMachine>;
export type RendererActor = ActorRefFrom<typeof rendererMachine>;

export type SelectionState = SnapshotFrom<typeof selectionMachine>;
export type EditorState = SnapshotFrom<typeof editorMachine>;
export type ClipboardState = SnapshotFrom<typeof clipboardMachine>;
export type RendererState = SnapshotFrom<typeof rendererMachine>;

/**
 * Callback to notify renderer of layer invalidation.
 */
export interface RenderInvalidation {
  layer: LayerName;
  priority: RenderPriority;
  regions?: CellRange[];
}

/**
 * Callback to generate structured table references.
 * @param range - The selected range
 * @param editingCell - The cell being edited
 * @returns Structured reference string (e.g., "[@Column]" or "TableName[Column]"), or undefined for A1 reference
 */
export type StructuredRefGenerator = (
  range: CellRange,
  editingCell: CellCoord,
) => string | undefined;

/**
 * Configuration for cross-coordination setup.
 */
export interface CrossCoordinationConfig {
  selectionActor: SelectionActor;
  editorActor: EditorActor;
  clipboardActor: ClipboardActor;
  /** Renderer actor — optional (not available within GridEditingSystem) */
  rendererActor?: RendererActor | null;
  onRenderInvalidation?: (invalidation: RenderInvalidation) => void;
  /**
   * Optional callback to generate structured table references.
   * When clicking cells in tables during formula editing, this callback determines
   * the appropriate reference format ([@Column], TableName[Column], or A1).
   */
  getStructuredRef?: StructuredRefGenerator;
  /** Optional visibility callbacks for hidden row/col aware commit navigation */
  getVisibilityCallbacks?: () => {
    isRowHidden?: (row: number) => boolean;
    isColHidden?: (col: number) => boolean;
  };
  /** Get the currently active sheet ID (for cross-sheet formula references) */
  getCurrentSheetId?: () => string;
  /** Get a sheet's display name by ID (sync — reads from cached worksheet metadata) */
  getSheetName?: (sheetId: string) => string;
}

// =============================================================================
// EDITOR → SELECTION COORDINATION
// =============================================================================

/**
 * Set up editor → selection coordination.
 *
 * Rules:
 * - When editor enters formulaEditing, selection enters formula range mode
 * - When editor exits formulaEditing, selection exits formula range mode
 * - When editor commits with direction, selection moves accordingly
 */
export function setupEditorToSelectionCoordination(
  editorActor: EditorActor,
  selectionActor: SelectionActor,
  getActiveCell: () => CellCoord,
  getVisibilityCallbacks?: () => {
    isRowHidden?: (row: number) => boolean;
    isColHidden?: (col: number) => boolean;
  },
  getCurrentSheetId?: () => string,
): () => void {
  let previousState: EditorState | null = null;
  // Capture the viewed sheet at commit start. Cross-sheet formula commits may restore
  // the origin sheet before this coordinator sees `committing -> inactive`.
  let commitStartedOnSheetId: string | null = null;

  const subscription = editorActor.subscribe((state) => {
    const wasFormulaEditing = previousState?.matches('formulaEditing') ?? false;
    const isFormulaEditing = state.matches('formulaEditing');

    // Editor entered formula mode
    if (!wasFormulaEditing && isFormulaEditing) {
      selectionActor.send({
        type: 'ENTER_FORMULA_RANGE_MODE',
        color: state.context.currentRangeColor,
      });
    }

    // Editor exited formula mode
    if (wasFormulaEditing && !isFormulaEditing) {
      selectionActor.send({ type: 'EXIT_FORMULA_RANGE_MODE' });

      const previousContext = previousState?.context;
      const editingCell = previousContext?.editingCell;
      const currentSheetId = getCurrentSheetId?.();
      const isSameSheetAsFormulaOwner =
        !previousContext?.sheetId || !currentSheetId || previousContext.sheetId === currentSheetId;
      const shouldRestoreFormulaOwnerSelection =
        editingCell &&
        isSameSheetAsFormulaOwner &&
        !state.context.wasRemotelyDeleted &&
        !state.context.wasSheetDeleted &&
        !state.context.wasStructurallyCancelled;

      if (shouldRestoreFormulaOwnerSelection) {
        const restoreRanges = previousContext.editStartSelectionRanges?.length
          ? previousContext.editStartSelectionRanges.map((range) => ({ ...range }))
          : [
              {
                startRow: editingCell.row,
                startCol: editingCell.col,
                endRow: editingCell.row,
                endCol: editingCell.col,
              },
            ];

        selectionActor.send({
          type: 'SET_SELECTION',
          ranges: restoreRanges,
          activeCell: { ...editingCell },
        });
      }
    }

    // Editor is committing - move selection based on direction
    const wasCommitting = previousState?.matches('committing') ?? false;
    const isCommitting = state.matches('committing');
    const isInactive = state.matches('inactive');

    if (!wasCommitting && isCommitting) {
      commitStartedOnSheetId = getCurrentSheetId?.() ?? null;
    }
    if (wasCommitting && !isCommitting && !isInactive) {
      commitStartedOnSheetId = null;
    }

    if (wasCommitting && isInactive && previousState?.context.commitDirection) {
      const direction = previousState.context.commitDirection;
      const commitKey = previousState.context.commitKey;
      const editingSheetId = previousState.context.sheetId;
      const currentSheetId = getCurrentSheetId?.();
      const committedFromDifferentSheet =
        editingSheetId && commitStartedOnSheetId && editingSheetId !== commitStartedOnSheetId;
      commitStartedOnSheetId = null;

      // Origin-sheet selection restoration handles cross-sheet commit navigation.
      if (
        committedFromDifferentSheet ||
        (editingSheetId && currentSheetId && editingSheetId !== currentSheetId)
      ) {
        previousState = state;
        return;
      }

      if (direction !== 'none') {
        if (commitKey === 'tab' || commitKey === 'shift-tab') {
          // Route through KEY_TAB so selection machine tracks tabOriginCol
          selectionActor.send({ type: 'KEY_TAB', shiftKey: commitKey === 'shift-tab' });
        } else if (commitKey === 'enter' || commitKey === 'shift-enter') {
          // Route through KEY_ENTER so selection machine uses tabOriginCol if set
          selectionActor.send({ type: 'KEY_ENTER', shiftKey: commitKey === 'shift-enter' });
        } else {
          // Arrow key commit: use SET_SELECTION (correctly clears tabOriginCol)
          const activeCell = previousState.context.editingCell ?? getActiveCell();
          const visibility = getVisibilityCallbacks?.();
          const newCell = moveCellSkipHidden(
            activeCell,
            direction as Direction,
            1,
            visibility?.isRowHidden,
            visibility?.isColHidden,
          );
          selectionActor.send({
            type: 'SET_SELECTION',
            ranges: [
              {
                startRow: newCell.row,
                startCol: newCell.col,
                endRow: newCell.row,
                endCol: newCell.col,
              },
            ],
            activeCell: newCell,
          });
        }
      }
    }

    previousState = state;
  });

  return () => subscription.unsubscribe();
}

// =============================================================================
// SELECTION → EDITOR COORDINATION
// =============================================================================

/**
 * Set up selection → editor coordination.
 *
 * Rules:
 * - When selection changes during formula mode, insert range into editor
 *
 * @param getStructuredRef - Optional callback to generate structured references for table cells
 * @param getEditingCell - Callback to get the cell currently being edited
 */
export function setupSelectionToEditorCoordination(
  selectionActor: SelectionActor,
  editorActor: EditorActor,
  getStructuredRef?: StructuredRefGenerator,
  getEditingCell?: () => CellCoord | null,
  getCurrentSheetId?: () => string,
  getSheetName?: (sheetId: string) => string,
): () => void {
  let previousState: SelectionState | null = null;

  const subscription = selectionActor.subscribe((state) => {
    const isFormulaMode = state.matches('selectingRangeForFormula');
    const wasFormulaMode = previousState?.matches('selectingRangeForFormula') ?? false;

    // In formula mode — detect selection changes to update formula reference.
    //
    // NOTE: We intentionally do NOT suppress events when the active sheet changes.
    // The previous design used a `sheetChanged` guard to prevent spurious
    // FORMULA_RANGE_SELECTED from the SET_SELECTION restoration that fires after
    // a sheet switch. However, setupSheetSwitchCoordination already sets anchor=null
    // during formula editing, so `anchorChanged` is always false for restorations
    // (null anchor → no event). The guard was therefore redundant AND harmful: it
    // suppressed legitimate user clicks on the new sheet when those clicks arrived
    // before the renderer's SET_SELECTION restoration fired (a race condition that
    // left the formula stuck at "=" instead of "='My Sheet'!A1").
    if (isFormulaMode && wasFormulaMode) {
      const prevAnchor = previousState?.context.anchor;
      const currAnchor = state.context.anchor;

      // Detect anchor change (plain arrow key via moveTo, or click)
      const anchorChanged = currAnchor && (!prevAnchor || !cellsEqual(prevAnchor, currAnchor));

      // Detect range changes (Shift+Arrow/Shift+click): the anchor may stay
      // the same, or may be initialized from null on the first Shift action.
      const prevRanges = previousState ? selectionSelectors.ranges(previousState) : undefined;
      const currRanges = selectionSelectors.ranges(state);
      const prevLastRange = prevRanges?.[prevRanges.length - 1];
      const currLastRange = currRanges?.[currRanges.length - 1];
      const rangeChanged =
        currAnchor &&
        currLastRange &&
        prevLastRange &&
        (currLastRange.startRow !== prevLastRange.startRow ||
          currLastRange.startCol !== prevLastRange.startCol ||
          currLastRange.endRow !== prevLastRange.endRow ||
          currLastRange.endCol !== prevLastRange.endCol);

      if (anchorChanged || rangeChanged) {
        // For anchor change (plain arrow / click): range is the single anchor cell
        // For range changes (Shift+Arrow/Shift+click): use the actual selection range
        const range: CellRange = rangeChanged
          ? currLastRange!
          : {
              startRow: currAnchor!.row,
              startCol: currAnchor!.col,
              endRow: currAnchor!.row,
              endCol: currAnchor!.col,
            };

        // Try to get structured reference for table cells
        let structuredRef: string | undefined;
        if (getStructuredRef && getEditingCell) {
          const editingCell = getEditingCell();
          if (editingCell) {
            structuredRef = getStructuredRef(range, editingCell);
          }
        }

        const currentSheetId = getCurrentSheetId?.();
        const targetSheetName = currentSheetId ? getSheetName?.(currentSheetId) : undefined;

        editorActor.send({
          type: 'FORMULA_RANGE_SELECTED',
          range,
          color: state.context.formulaRangeColor ?? '#4285f4',
          ...(structuredRef ? { structuredRef } : {}),
          ...(currentSheetId ? { sheetId: currentSheetId } : {}),
          ...(targetSheetName ? { sheetName: targetSheetName } : {}),
        });
      }
    }

    previousState = state;
  });

  return () => subscription.unsubscribe();
}

// =============================================================================
// STATE → RENDERER COORDINATION
// =============================================================================

/**
 * Set up state change → renderer invalidation coordination.
 *
 * Rules:
 * - Selection changes → invalidate selection layer
 * - Editor value changes → invalidate cells layer
 * - Clipboard cut state → invalidate UI layer (marching ants)
 */
export function setupRenderInvalidationCoordination(
  selectionActor: SelectionActor,
  editorActor: EditorActor,
  clipboardActor: ClipboardActor,
  onInvalidation: (invalidation: RenderInvalidation) => void,
): () => void {
  const cleanupFns: (() => void)[] = [];

  // Selection changes → selection layer
  let prevSelectionRanges: CellRange[] = [];
  const selectionSub = selectionActor.subscribe((state) => {
    const ranges = selectionSelectors.ranges(state);

    // Check if ranges actually changed
    const rangesChanged =
      ranges.length !== prevSelectionRanges.length ||
      ranges.some((r, i) => {
        const prev = prevSelectionRanges[i];
        return (
          !prev ||
          r.startRow !== prev.startRow ||
          r.startCol !== prev.startCol ||
          r.endRow !== prev.endRow ||
          r.endCol !== prev.endCol
        );
      });

    if (rangesChanged) {
      onInvalidation({
        layer: 'selection',
        priority: RenderPriority.CRITICAL,
        regions: ranges,
      });
      prevSelectionRanges = [...ranges];
    }
  });
  cleanupFns.push(() => selectionSub.unsubscribe());

  // Editor changes → cells layer
  // Use editingCell from editor context (stable during formula point mode).
  let prevEditingCell: CellCoord | null = null;
  const editorSub = editorActor.subscribe((state) => {
    // Use editingCell from editor context; falls back to selection.activeCell
    const isActive = !state.matches('inactive');
    const editingCell = isActive
      ? (state.context.editingCell ?? selectionActor.getSnapshot().context.activeCell)
      : null;

    // If editing cell changed, invalidate both old and new
    if (editingCell && (!prevEditingCell || !cellsEqual(editingCell, prevEditingCell))) {
      const regions: CellRange[] = [];
      if (prevEditingCell) {
        regions.push({
          startRow: prevEditingCell.row,
          startCol: prevEditingCell.col,
          endRow: prevEditingCell.row,
          endCol: prevEditingCell.col,
        });
      }
      regions.push({
        startRow: editingCell.row,
        startCol: editingCell.col,
        endRow: editingCell.row,
        endCol: editingCell.col,
      });

      onInvalidation({
        layer: 'cells',
        priority: RenderPriority.USER_BLOCKING,
        regions,
      });
    }

    // If stopped editing, invalidate the cell that was being edited
    if (prevEditingCell && !editingCell) {
      onInvalidation({
        layer: 'cells',
        priority: RenderPriority.USER_BLOCKING,
        regions: [
          {
            startRow: prevEditingCell.row,
            startCol: prevEditingCell.col,
            endRow: prevEditingCell.row,
            endCol: prevEditingCell.col,
          },
        ],
      });
    }

    prevEditingCell = editingCell;
  });
  cleanupFns.push(() => editorSub.unsubscribe());

  // Clipboard hasCut → UI layer (marching ants)
  let prevHasCut = false;
  const clipboardSub = clipboardActor.subscribe((state) => {
    const hasCut = state.matches('hasCut');

    if (hasCut !== prevHasCut) {
      onInvalidation({
        layer: 'ui',
        priority: hasCut ? RenderPriority.NORMAL : RenderPriority.LOW,
        regions: state.context.sourceRanges ?? undefined,
      });
      prevHasCut = hasCut;
    }
  });
  cleanupFns.push(() => clipboardSub.unsubscribe());

  return () => {
    cleanupFns.forEach((fn) => fn());
  };
}

// =============================================================================
// EDITING INPUT INTERCEPTION
// =============================================================================

/**
 * Configuration for editing input interception.
 *
 * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
 */
export interface EditingInputInterceptionConfig {
  editorActor: EditorActor;
  selectionActor: SelectionActor;
  /** Called when a commit-and-move sequence should occur */
  onCommitAndMove: (targetCell: CellCoord, shiftKey?: boolean, ctrlKey?: boolean) => void;
  /** Get the currently active sheet ID (the sheet the click happens on) */
  getCurrentSheetId?: () => string;
  /** Get a sheet's display name by ID (sync — reads from cached worksheet metadata) */
  getSheetName?: (sheetId: string) => string;
}

/**
 * Result from setting up editing input interception.
 */
export interface EditingInputInterceptionResult {
  /** Cleanup function */
  cleanup: () => void;
  /**
   * Handle a cell click. If editing, returns true and triggers commit-then-move.
   * If not editing, returns false and the caller should proceed with normal selection.
   *
   * This is the key method that prevents selection from changing during editing.
   * The flow is:
   * 1. User clicks cell B5 while editing A1
   * 2. interceptCellClick returns true, stores B5 as pending
   * 3. Editor commits to A1 (via coordinator.commitEdit)
   * 4. On COMMIT_COMPLETE, selection moves to B5
   * 5. No divergence possible because selection only changes AFTER commit
   */
  interceptCellClick: (cell: CellCoord, shiftKey?: boolean, ctrlKey?: boolean) => boolean;
  /**
   * Check if there's a pending selection after commit.
   * Used by coordinator to know if a commit was triggered by click interception.
   */
  hasPendingSelection: () => boolean;
  /**
   * Clear pending selection (called if commit is cancelled).
   */
  clearPendingSelection: () => void;
}

function canInsertFormulaReference(context: EditorState['context']): boolean {
  const isReplacingActiveRef =
    context.formulaRefInsertStart !== null &&
    context.formulaRefInsertEnd !== null &&
    context.cursorPosition === context.formulaRefInsertEnd;

  return isReplacingActiveRef || isCursorAtReferencePosition(context.value, context.cursorPosition);
}

/**
 * Set up editing input interception.
 *
 * This is THE critical coordination that prevents editor-selection divergence.
 *
 * ## The Problem (Before This Fix)
 *
 * ```
 * User clicks B5 while editing A1:
 * → MOUSE_DOWN sent to selection
 * → selection.activeCell = B5
 * → editor.editingCell = A1 (DIVERGED! 💀)
 * ```
 *
 * ## The Solution (This Fix)
 *
 * ```
 * User clicks B5 while editing A1:
 * → interceptCellClick returns true (editing in progress)
 * → Stores B5 as pending target
 * → Commits edit to A1
 * → On commit complete: moves selection to B5
 * → No divergence ever possible!
 * ```
 *
 * This follows the Google Sheets model where clicking another cell while editing
 * commits the current edit first, then moves to the new cell.
 *
 * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md - Full analysis
 */
export function setupEditingInputInterception(
  config: EditingInputInterceptionConfig,
): EditingInputInterceptionResult {
  const { editorActor, selectionActor, onCommitAndMove } = config;

  // Pending selection target after commit completes
  let pendingSelection: { cell: CellCoord; shiftKey: boolean; ctrlKey: boolean } | null = null;

  // Track previous state to detect commit completion
  let previousState: EditorState | null = null;

  // Subscribe to editor state to detect commit completion
  const subscription = editorActor.subscribe((state) => {
    const wasCommitting = previousState?.matches('committing') ?? false;
    const isNowInactive = state.matches('inactive');

    // Commit just completed - process pending selection
    if (wasCommitting && isNowInactive && pendingSelection) {
      const { cell, shiftKey, ctrlKey } = pendingSelection;
      pendingSelection = null;

      // Now it's safe to change selection - editing is done
      onCommitAndMove(cell, shiftKey, ctrlKey);
    }

    // Also clear pending if editing was cancelled (went inactive without committing)
    const wasEditing =
      previousState?.matches('editing') ||
      previousState?.matches('formulaEditing') ||
      previousState?.matches('activating');
    if (wasEditing && isNowInactive && !wasCommitting) {
      // Editing was cancelled, clear pending selection
      pendingSelection = null;
    }

    previousState = state;
  });

  return {
    cleanup: () => subscription.unsubscribe(),

    interceptCellClick: (cell: CellCoord, shiftKey = false, ctrlKey = false): boolean => {
      const editorState = editorActor.getSnapshot();

      // Not editing - don't intercept
      if (editorState.matches('inactive')) {
        return false;
      }

      // Formula editing in Enter Mode - insert cell reference instead of committing
      // When editing a formula and in Enter Mode (not Edit Mode), clicking a cell should:
      // - Insert the cell reference into the formula at the cursor position
      // - Ctrl+click adds the reference (same as regular click in Enter Mode)
      // - Shift+click extends the current range selection
      const isFormulaEditing = editorState.matches('formulaEditing');
      const isInEnterMode = !editorState.context.isEditMode;

      if (isFormulaEditing && isInEnterMode) {
        if (!canInsertFormulaReference(editorState.context)) {
          editorActor.send({ type: 'CANCEL' });
          return false;
        }

        selectionActor.send({
          type: 'MOUSE_DOWN',
          cell,
          shiftKey,
          ctrlKey,
        });
        selectionActor.send({ type: 'MOUSE_UP' });
        return true;
      }

      // Currently editing (not formula Enter Mode) - intercept the click.
      // Store the target cell for after commit.
      pendingSelection = { cell, shiftKey, ctrlKey };

      // Trigger commit with 'none' direction (we'll handle movement ourselves).
      // This is the SOLE click-as-commit path during a regular edit. The
      // editor machine no longer reacts to raw BLUR in editing/formulaEditing/
      // richTextEditing — DOM blur is a side effect, not an intent — so this
      // explicit COMMIT is load-bearing for "click another cell on the same
      // sheet during a regular edit → commits". For formulaEditing in Enter
      // Mode the branch above inserts a range reference instead (Excel parity).
      editorActor.send({ type: 'COMMIT', direction: 'none' });

      return true; // Signal that we intercepted the click
    },

    hasPendingSelection: () => pendingSelection !== null,

    clearPendingSelection: () => {
      pendingSelection = null;
    },
  };
}

// =============================================================================
// MASTER COORDINATION SETUP
// =============================================================================

/**
 * Set up all cross-machine coordination.
 *
 * Returns a cleanup function that removes all subscriptions.
 */
export function setupCrossCoordination(config: CrossCoordinationConfig): () => void {
  const {
    selectionActor,
    editorActor,
    clipboardActor,
    onRenderInvalidation,
    getStructuredRef,
    getCurrentSheetId,
    getSheetName,
  } = config;

  const cleanupFns: (() => void)[] = [];

  // Editor → Selection
  cleanupFns.push(
    setupEditorToSelectionCoordination(
      editorActor,
      selectionActor,
      () => selectionActor.getSnapshot().context.activeCell,
      config.getVisibilityCallbacks,
      getCurrentSheetId,
    ),
  );

  // Selection → Editor
  cleanupFns.push(
    setupSelectionToEditorCoordination(
      selectionActor,
      editorActor,
      getStructuredRef,
      () => selectionActor.getSnapshot().context.activeCell,
      getCurrentSheetId,
      getSheetName,
    ),
  );

  // State → Renderer (via callback)
  if (onRenderInvalidation) {
    cleanupFns.push(
      setupRenderInvalidationCoordination(
        selectionActor,
        editorActor,
        clipboardActor,
        onRenderInvalidation,
      ),
    );
  }

  return () => {
    cleanupFns.forEach((fn) => fn());
  };
}
