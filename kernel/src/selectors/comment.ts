/**
 * Comment Actor Selectors
 *
 * Pure functions that extract data from comment state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { CommentState } from '@mog-sdk/contracts/actors/comment';

export { type CommentState } from '@mog-sdk/contracts/actors/comment';

export const commentSelectors = {
  // ===========================================================================
  // Value Selectors (context fields)
  // ===========================================================================

  /** Get the target cell for comment operations */
  target: (state: CommentState) => state.context.target,

  /** Get the comment ID being edited (null when composing new or viewing) */
  editingCommentId: (state: CommentState) => state.context.editingCommentId,

  /** Get the draft content while editing/composing */
  draftContent: (state: CommentState) => state.context.draftContent,

  /** Get the comment ID pending deletion */
  deletingCommentId: (state: CommentState) => state.context.deletingCommentId,

  // ===========================================================================
  // State Matching Selectors (state.matches())
  // ===========================================================================

  /** Check if in closed state (no popover visible) */
  isClosed: (state: CommentState): boolean => state.matches('closed'),

  /** Check if in viewing state (showing existing comments, read-only) */
  isViewing: (state: CommentState): boolean => state.matches('viewing'),

  /** Check if in composing state (writing a new comment) */
  isComposing: (state: CommentState): boolean => state.matches('composing'),

  /** Check if in editing state (editing an existing comment) */
  isEditing: (state: CommentState): boolean => state.matches('editing'),

  /** Check if in confirmingDelete state (showing delete confirmation) */
  isConfirmingDelete: (state: CommentState): boolean => state.matches('confirmingDelete'),

  // ===========================================================================
  // Derived Selectors (computed from multiple values)
  // ===========================================================================

  /** Check if popover should be visible (any state except closed) */
  isVisible: (state: CommentState): boolean => !state.matches('closed'),

  /** Check if in an editing mode (composing or editing) */
  isInEditMode: (state: CommentState): boolean =>
    state.matches('composing') || state.matches('editing'),

  /** Check if draft has content (non-empty text) */
  hasDraftContent: (state: CommentState): boolean =>
    state.context.draftContent.some((segment) => segment.text.trim().length > 0),

  /**
   * Get the current state name.
   */
  stateName: (
    state: CommentState,
  ): 'closed' | 'viewing' | 'composing' | 'editing' | 'confirmingDelete' => {
    if (state.matches('closed')) return 'closed';
    if (state.matches('viewing')) return 'viewing';
    if (state.matches('composing')) return 'composing';
    if (state.matches('editing')) return 'editing';
    if (state.matches('confirmingDelete')) return 'confirmingDelete';
    return 'closed'; // Fallback
  },
};
