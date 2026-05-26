/**
 * Snapshot Accessors
 *
 * Pure functions for extracting typed snapshots from XState actors.
 * These provide read-only access to machine state for UI consumption.
 *
 * Pattern: Each function takes an ActorManager and returns a typed snapshot.
 * The SheetCoordinator delegates to these functions.
 *
 */

import type {
  ChartSnapshot,
  ClipboardSnapshot,
  EditorSnapshot,
  FocusSnapshot,
  RendererSnapshot,
  SelectionSnapshot,
} from '@mog-sdk/contracts/machines';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { getClipboardSnapshot } from '../grid-editing/machines/clipboard-machine';
import { getSelectionSnapshot as getSelectionSnapshotFromMachine } from '../grid-editing/machines/selection/derived-state';
import type { FocusCoordination } from '../input/coordination/focus-coordination';
import type { ObjectCoordinationResult } from '../objects/coordination/object-coordination';
import { getChartSnapshot } from '../objects/machines/chart-machine';
import { getRendererSnapshot } from '../renderer/machines/grid-renderer-machine';
import type { ActorManager } from './actor-manager';

// =============================================================================
// SELECTION SNAPSHOT
// =============================================================================

/**
 * Get the current selection snapshot from the selection actor.
 */
export function getSelectionSnapshotFromActors(actors: ActorManager): SelectionSnapshot {
  return getSelectionSnapshotFromMachine(actors.selection.getSnapshot());
}

// =============================================================================
// EDITOR SNAPSHOT
// =============================================================================

/**
 * Get the current editing cell from selection and editor state.
 * Returns null if not editing.
 */
export function getEditingCellFromActors(actors: ActorManager): CellCoord | null {
  const editorState = actors.editor.getSnapshot();
  if (editorState.matches('inactive')) return null;
  // Use editingCell from editor context (stable during formula point mode).
  // Falls back to selection.activeCell for backward compatibility.
  return editorState.context.editingCell ?? actors.selection.getSnapshot().context.activeCell;
}

/**
 * Get the current editor snapshot with derived editing cell.
 */
export function getEditorSnapshotFromActors(actors: ActorManager): EditorSnapshot {
  const state = actors.editor.getSnapshot();
  const isEditing = !state.matches('inactive');
  return {
    isEditing,
    isFormulaEditing: state.matches('formulaEditing'),
    editingCell: isEditing ? getEditingCellFromActors(actors) : null,
    sheetId: state.context.sheetId,
    mergeBounds: state.context.mergeBounds,
    value: state.context.value,
    hasConflict: state.context.hasConflict,
    isIMEComposing: state.matches('imeComposing'),
  };
}

/**
 * Get the editing cell with sheet ID.
 */
export function getEditingCellWithSheetFromActors(
  actors: ActorManager,
): { cell: CellCoord; sheetId: string } | null {
  const cell = getEditingCellFromActors(actors);
  if (!cell) return null;
  const sheetId = actors.editor.getSnapshot().context.sheetId ?? '';
  return { cell, sheetId };
}

// =============================================================================
// CLIPBOARD SNAPSHOT
// =============================================================================

/**
 * Get the current clipboard snapshot.
 */
export function getClipboardSnapshotFromActors(actors: ActorManager): ClipboardSnapshot {
  return getClipboardSnapshot(actors.clipboard.getSnapshot());
}

// =============================================================================
// RENDERER SNAPSHOT
// =============================================================================

/**
 * Get the current renderer snapshot.
 */
export function getRendererSnapshotFromActors(actors: ActorManager): RendererSnapshot {
  return getRendererSnapshot(actors.renderer.getSnapshot());
}

// =============================================================================
// OBJECT INTERACTION SNAPSHOT
// =============================================================================

/**
 * Get the current object interaction snapshot.
 * Requires object coordination to be initialized.
 */
export function getObjectInteractionSnapshotFromCoordination(
  objectCoordination: ObjectCoordinationResult | null,
): ReturnType<ObjectCoordinationResult['getSnapshot']> {
  if (!objectCoordination) {
    throw new Error('Object coordination not initialized');
  }
  return objectCoordination.getSnapshot();
}

// =============================================================================
// CHART UI SNAPSHOT
// =============================================================================

/**
 * Get the current chart UI snapshot.
 */
export function getChartUISnapshotFromActors(actors: ActorManager): ChartSnapshot {
  return getChartSnapshot(actors.chart.getSnapshot());
}

// =============================================================================
// FOCUS SNAPSHOT
// =============================================================================

/**
 * Get the current focus snapshot.
 * Requires focus coordination to be initialized.
 */
export function getFocusSnapshotFromCoordination(
  focusCoordination: FocusCoordination,
): FocusSnapshot {
  return focusCoordination.getSnapshot();
}
