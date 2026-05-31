/**
 * Structure Change Coordination Module
 *
 * Subscribes to structural change events from EventBus (rows/columns inserted/deleted)
 * and forwards them as STRUCTURE_CHANGE events to state machines.
 *
 * This is the critical wiring that ensures selection, editor, and clipboard machines
 * adjust their positions when the grid structure changes - preventing state desync.
 *
 * Architecture:
 * - EventBus emits: rows:inserted, rows:deleted, columns:inserted, columns:deleted
 * - This module forwards: STRUCTURE_CHANGE to selection and clipboard always
 * - For editor: coordinator filters based on getEditingCell()
 *
 * @see ISSUE-1-STRUCTURE-CHANGE-COORDINATION.md - Problem analysis
 * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md - Editor filtering
 * @see position-adjusters.ts - Pure functions for position adjustment
 */

import type { CellCoord } from '@mog-sdk/contracts/rendering';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { ClipboardActor, EditorActor, SelectionActor } from '../../../shared/actor-types';
import type { StructureChange } from '../../../shared/utils';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for setting up structure change coordination.
 */
export interface StructureCoordinationConfig {
  /** Workbook API for event subscriptions */
  workbook: Workbook;

  /** Selection actor - adjusts selection positions */
  selectionActor: SelectionActor;

  /** Editor actor - cancels editing if affected cell changes */
  editorActor: EditorActor;

  /** Clipboard actor - adjusts source ranges for cut/copy */
  clipboardActor: ClipboardActor;

  /**
   * Get the current sheet ID.
   * Used to scope structure changes to the active sheet.
   */
  getCurrentSheetId: () => string;

  /**
   * Get the cell currently being edited
   * Returns null if not editing.
   * Used to filter STRUCTURE_CHANGE events before sending to editor.
   * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
   */
  getEditingCell: () => CellCoord | null;

  /**
   * Get the sheet ID of the cell being edited
   * Returns null if not editing.
   */
  getEditingSheetId: () => string | null;
}

/**
 * Result returned by setupStructureCoordination.
 */
export interface StructureCoordinationResult {
  /**
   * Cleanup function - unsubscribes from all events.
   */
  cleanup: () => void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Set up structure change coordination.
 *
 * Subscribes to structural change events from EventBus and forwards them
 * as STRUCTURE_CHANGE events to the selection, editor, and clipboard machines.
 *
 * This ensures all UI state (selection positions, editing state, clipboard ranges)
 * stays in sync when rows/columns are inserted or deleted.
 *
 * @param config - Dependencies (actors and getCurrentSheetId)
 * @returns Result with cleanup function
 */
export function setupStructureCoordination(
  config: StructureCoordinationConfig,
): StructureCoordinationResult {
  const {
    workbook,
    selectionActor,
    editorActor,
    clipboardActor,
    getCurrentSheetId,
    getEditingCell,
    getEditingSheetId,
  } = config;

  // Cleanup registry
  const cleanups: (() => void)[] = [];

  /**
   * Check if a structure change affects the editing cell.
   * Coordinator filters events before sending to editor.
   * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
   */
  const structureChangeAffectsEdit = (sheetId: string, change: StructureChange): boolean => {
    const editingCell = getEditingCell();
    const editingSheetId = getEditingSheetId();

    if (!editingCell || editingSheetId !== sheetId) {
      return false;
    }

    switch (change.type) {
      case 'rows:deleted':
        // Cell deleted if row is in deletion range
        return (
          editingCell.row >= change.startRow && editingCell.row < change.startRow + change.count
        );
      case 'columns:deleted':
        // Cell deleted if col is in deletion range
        return (
          editingCell.col >= change.startCol && editingCell.col < change.startCol + change.count
        );
      case 'rows:inserted':
        // Cell position shifts if at or after insert point
        return editingCell.row >= change.startRow;
      case 'columns:inserted':
        // Cell position shifts if at or after insert point
        return editingCell.col >= change.startCol;
      default:
        return false;
    }
  };

  /**
   * Forward a structure change to machines.
   *
   * Selection and clipboard always receive the event.
   * Editor only receives the event if it affects the editing cell.
   * @see ISSUE-3-EDITOR-SELECTION-SYNC-INVARIANT.md
   *
   * Capture edit affectedness BEFORE sending STRUCTURE_CHANGE to selection.
   * XState processes events synchronously, so selection.activeCell changes immediately.
   * If we check after sending, we'd be checking against the already-adjusted position.
   * @see ISSUE-5-REMOTE-COLLABORATION-EVENTS.md - Race Condition Analysis
   */
  const forwardStructureChange = (sheetId: string, change: StructureChange) => {
    const affectsActiveSheet = getCurrentSheetId() === sheetId;

    // Determine if edit is affected BEFORE any state changes
    // This must happen before selectionActor.send() which modifies activeCell synchronously
    const affectsEdit = affectsActiveSheet && structureChangeAffectsEdit(sheetId, change);

    // Send active-sheet structural changes to selection for position adjustment.
    // NOTE: This synchronously modifies selection.activeCell!
    if (affectsActiveSheet) {
      selectionActor.send({
        type: 'STRUCTURE_CHANGE',
        sheetId,
        change,
      });
    }

    // Clipboard tracks its source sheet independently, so it must see all
    // structure events and filter against its own source range.
    clipboardActor.send({
      type: 'STRUCTURE_CHANGE',
      sheetId,
      change,
    });

    // Only send to editor if it affects the editing cell
    // This is the coordinator filtering pattern - guards removed from editor machine
    // NOTE: Using CAPTURED affectsEdit from before position adjustment
    if (affectsEdit) {
      editorActor.send({
        type: 'STRUCTURE_CHANGE',
        sheetId,
        change,
      });
    }
  };

  // ---------------------------------------------------------------------------
  // ROW EVENTS
  // ---------------------------------------------------------------------------

  const rowsInsertedUnsub = workbook.on('rows:inserted', (event) => {
    const change: StructureChange = {
      type: 'rows:inserted',
      sheetId: event.sheetId,
      startRow: event.startRow,
      count: event.count,
    };
    forwardStructureChange(event.sheetId, change);
  });
  cleanups.push(rowsInsertedUnsub);

  const rowsDeletedUnsub = workbook.on('rows:deleted', (event) => {
    const change: StructureChange = {
      type: 'rows:deleted',
      sheetId: event.sheetId,
      startRow: event.startRow,
      count: event.count,
    };
    forwardStructureChange(event.sheetId, change);
  });
  cleanups.push(rowsDeletedUnsub);

  // ---------------------------------------------------------------------------
  // COLUMN EVENTS
  // ---------------------------------------------------------------------------

  const columnsInsertedUnsub = workbook.on('columns:inserted', (event) => {
    const change: StructureChange = {
      type: 'columns:inserted',
      sheetId: event.sheetId,
      startCol: event.startCol,
      count: event.count,
    };
    forwardStructureChange(event.sheetId, change);
  });
  cleanups.push(columnsInsertedUnsub);

  const columnsDeletedUnsub = workbook.on('columns:deleted', (event) => {
    const change: StructureChange = {
      type: 'columns:deleted',
      sheetId: event.sheetId,
      startCol: event.startCol,
      count: event.count,
    };
    forwardStructureChange(event.sheetId, change);
  });
  cleanups.push(columnsDeletedUnsub);

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------

  const cleanup = () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch (error) {
        console.error('[StructureCoordination] Error in cleanup:', error);
      }
    });
    cleanups.length = 0;
  };

  return { cleanup };
}
