/**
 * Comment-Selection Coordination Module
 *
 * Coordinates between the selection actor and comment actor to automatically
 * close the comment popover when the user navigates away from a commented cell.
 *
 * ARCHITECTURE:
 * - Subscribes to selection actor state changes
 * - When activeCell changes to a cell without comments → closes comment popover
 * - Only triggers on stable 'idle' state (not during drag operations)
 *
 * NOTE: This module does NOT auto-open the comment popover on cell selection.
 * The popover is opened via explicit user actions only:
 * - Hover over the red comment indicator triangle (comment-hover-coordination.ts)
 * - Click the red comment indicator triangle (use-cell-interaction.ts)
 * - Right-click context menu "View comment" option
 *
 * @see engine/src/state/coordinator/features/find-replace/find-replace-coordination.ts
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import { CommentEvents } from '../../machines/comment-machine';

import type { CommentActor, SelectionActor } from '../../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for comment-selection coordination.
 */
export interface CommentSelectionCoordinationDependencies {
  /** Selection actor to subscribe to */
  selectionActor: SelectionActor;
  /** Comment actor to send events to */
  commentActor: CommentActor;
  /** Worksheet for viewport reads (comment indicators) */
  ws?: Worksheet;
  /** Dynamic worksheet resolver for sheet-aware coordination. */
  getWorksheet?: () => Worksheet | null;
}

/**
 * Result from setting up comment-selection coordination.
 */
export interface CommentSelectionCoordinationResult {
  /** Cleanup function to dispose subscriptions */
  cleanup: () => void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Set up comment-selection coordination.
 *
 * This function subscribes to selection actor state changes and
 * automatically closes the comment popover when the user navigates
 * to a cell without comments.
 *
 * @param deps - Dependencies for coordination
 * @returns Cleanup function
 */
export function setupCommentSelectionCoordination(
  deps: CommentSelectionCoordinationDependencies,
): CommentSelectionCoordinationResult {
  const { selectionActor, commentActor, ws, getWorksheet } = deps;

  // Track previous active cell to detect changes
  let previousActiveCell: { row: number; col: number } | null = null;

  const subscription = selectionActor.subscribe((state) => {
    // Don't open during drag/selection operations - only on stable 'idle' state
    // This prevents the popup from flickering during multi-cell selection
    // IMPORTANT: Check state BEFORE updating previousActiveCell to avoid bug where
    // the cell is tracked during 'selecting' state, causing 'idle' to early-return.
    if (!state.matches('idle')) {
      return;
    }

    const activeCell = state.context.activeCell;

    // Skip if active cell didn't change (comparing against last processed idle state)
    if (previousActiveCell?.row === activeCell.row && previousActiveCell?.col === activeCell.col) {
      return;
    }

    // Update tracking - only after confirming we're in idle state
    previousActiveCell = { row: activeCell.row, col: activeCell.col };

    // Only close the popover when navigating away — never auto-open.
    // Opening is handled by explicit user actions (hover indicator, click indicator, context menu).
    const activeWs = getWorksheet?.() ?? ws;
    if (!activeWs || !activeWs.viewport.hasComment(activeCell.row, activeCell.col)) {
      closeCommentPopoverIfOpen(commentActor);
    }
  });

  return {
    cleanup: () => subscription.unsubscribe(),
  };
}

/**
 * Close the comment popover if it's currently open.
 *
 * Respects editing/composing modes - don't close if user is actively
 * editing a comment (they may have clicked away accidentally).
 */
function closeCommentPopoverIfOpen(commentActor: CommentActor): void {
  const commentState = commentActor.getSnapshot();

  // Only close if in 'viewing' state
  // Don't close if:
  // - Already 'closed' (nothing to do)
  // - In 'editing' state (user is editing a comment)
  // - In 'composing' state (user is writing a new comment)
  // - In 'confirmingDelete' state (user is confirming deletion)
  if (commentState.value === 'viewing') {
    commentActor.send(CommentEvents.close());
  }
}
