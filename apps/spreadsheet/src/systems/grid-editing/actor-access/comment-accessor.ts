/**
 * Comment Actor Access Implementation
 *
 * Implements CommentAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/comment
 */

import { commentSelectors } from '../../../selectors';
import type { CommentAccessor, CommentState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for comment accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type CommentActor = { getSnapshot(): CommentState };

/**
 * Creates a CommentAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState comment actor
 * @returns CommentAccessor interface for handlers
 */
export function createCommentAccessor(actor: CommentActor): CommentAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getTarget: () => commentSelectors.target(snap()),
    getEditingCommentId: () => commentSelectors.editingCommentId(snap()),
    getDraftContent: () => commentSelectors.draftContent(snap()),
    getDeletingCommentId: () => commentSelectors.deletingCommentId(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isClosed: () => commentSelectors.isClosed(snap()),
    isViewing: () => commentSelectors.isViewing(snap()),
    isComposing: () => commentSelectors.isComposing(snap()),
    isEditing: () => commentSelectors.isEditing(snap()),
    isConfirmingDelete: () => commentSelectors.isConfirmingDelete(snap()),

    // ===========================================================================
    // Derived Accessors
    // ===========================================================================

    isVisible: () => commentSelectors.isVisible(snap()),
    isInEditMode: () => commentSelectors.isInEditMode(snap()),
    hasDraftContent: () => commentSelectors.hasDraftContent(snap()),
    getStateName: () => commentSelectors.stateName(snap()),
  };
}
