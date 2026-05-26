/**
 * Clipboard-Edit Coordination
 *
 * Coordinates clipboard clearing when user starts editing.
 * Cut cell locking - prevents editing cells that are in cut ranges.
 *
 * Excel behavior:
 * - When user starts editing ANY cell (double-click, F2, typing),
 * the clipboard is cleared and marching ants disappear.
 * - When cells are cut (Ctrl+X), those source cells are locked and uneditable
 * until the cut operation is completed (paste) or cancelled (ESC/edit elsewhere).
 *
 * ARCHITECTURE:
 * - Observes editor machine transitions to 'editing' or 'formulaEditing'
 * - Uses transition detection pattern (not current state)
 * - Checks if cell being edited is in cut ranges (blocks edit if so)
 * - Sends CELL_EDIT to clipboard machine to clear clipboard state
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { isCellInRanges } from '../../../utils/rendering-primitives';

import type { clipboardMachine } from '../machines/clipboard-machine';
import type { editorMachine } from '../machines/grid-editor-machine';
import type { selectionMachine } from '../machines/grid-selection-machine';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export type EditorActor = ActorRefFrom<typeof editorMachine>;
export type SelectionActor = ActorRefFrom<typeof selectionMachine>;
// Note: ClipboardActor is already exported from clipboard-visuals-coordination.ts
type ClipboardActor = ActorRefFrom<typeof clipboardMachine>;
type EditorState = SnapshotFrom<typeof editorMachine>;
type ClipboardState = SnapshotFrom<typeof clipboardMachine>;

/**
 * Configuration for clipboard-edit coordination.
 */
export interface ClipboardEditCoordinationConfig {
  /** The editor actor to observe */
  editorActor: EditorActor;
  /** The clipboard actor to send CELL_EDIT events to */
  clipboardActor: ClipboardActor;
  /** The selection actor to get activeCell (for cut cell locking) */
  selectionActor?: SelectionActor;
  /** Optional callback when editing is blocked due to cut cell */
  onCutCellBlocked?: (cell: CellCoord) => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the editor is in an editing state (including nested substates).
 * Matches both regular editing and formula editing states.
 */
function isInEditingState(state: EditorState): boolean {
  // Check for any editing-related state
  return (
    state.matches('editing') ||
    state.matches('formulaEditing') ||
    state.matches({ editing: 'enterMode' }) ||
    state.matches({ editing: 'editMode' }) ||
    state.matches({ formulaEditing: 'enterMode' }) ||
    state.matches({ formulaEditing: 'editMode' })
  );
}

/**
 * Check if clipboard is in hasCut state with source ranges.
 * Cut cell locking - need to check if editing a cut cell.
 */
function getCutSourceRanges(state: ClipboardState): CellRange[] | null {
  if (state.matches('hasCut') && state.context.sourceRanges) {
    return state.context.sourceRanges;
  }
  return null;
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

/**
 * Set up clipboard-edit coordination.
 *
 * This coordination module observes the editor machine and:
 * 1. Blocks editing of cut cells (sends CANCEL to editor)
 * 2. Sends CELL_EDIT to clipboard machine to clear clipboard when editing starts
 *
 * Uses the transition detection pattern:
 * - Tracks previous state
 * - Only triggers on TRANSITION to editing state
 * - Prevents duplicate events on every subscription notification
 *
 * @param config - Configuration with editor, clipboard, and selection actors
 * @returns Object with dispose function for cleanup
 */
export function setupClipboardEditCoordination(config: ClipboardEditCoordinationConfig): {
  dispose: () => void;
} {
  const { editorActor, clipboardActor, selectionActor, onCutCellBlocked } = config;
  let previousState: EditorState | null = null;

  const subscription = editorActor.subscribe((state: EditorState) => {
    const wasEditing = previousState ? isInEditingState(previousState) : false;
    const isEditing = isInEditingState(state);

    // The editor machine's `activating` state has unguarded `always` transitions,
    // so XState v5 skips past it within the same step and subscribers never see
    // an `activating` snapshot. Both cut-cell blocking and clipboard clearing
    // therefore key off the `inactive → editing|formulaEditing` transition.
    if (!wasEditing && isEditing) {
      if (selectionActor) {
        const clipboardState = clipboardActor.getSnapshot();
        const cutRanges = getCutSourceRanges(clipboardState);

        if (cutRanges) {
          const activeCell = selectionActor.getSnapshot().context.activeCell;

          if (isCellInRanges(activeCell, cutRanges)) {
            editorActor.send({ type: 'CANCEL' });
            onCutCellBlocked?.(activeCell);

            previousState = state;
            return;
          }
        }
      }

      clipboardActor.send({ type: 'CELL_EDIT' });
    }

    previousState = state;
  });

  return {
    dispose: () => subscription.unsubscribe(),
  };
}
