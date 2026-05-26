/**
 * Comment Action Types
 *
 * Action types for comment operations in the unified action system.
 * These actions are dispatched from keyboard shortcuts, toolbar, and context menu.
 *
 */

// =============================================================================
// Comment Action Types
// =============================================================================

/**
 * Comment-related action types.
 * These integrate with the Unified Action System.
 *
 * Excel standard shortcuts:
 * - Shift+F2: Insert/Edit Comment
 * - Ctrl+Shift+O: Show All Comments
 * - Ctrl+Alt+M: New Comment (Google Sheets style alternative)
 */
export type CommentActionType =
  /** Insert a new comment on the active cell (opens popover in compose mode) */
  | 'INSERT_COMMENT'
  /** Edit the existing comment on the active cell (opens popover in edit mode) */
  | 'EDIT_COMMENT'
  /** Delete all comments on the active cell */
  | 'DELETE_COMMENT'
  /** Toggle visibility of all comments in the sheet */
  | 'SHOW_HIDE_COMMENTS'
  /** Navigate to next cell with a comment */
  | 'NEXT_COMMENT'
  /** Navigate to previous cell with a comment */
  | 'PREVIOUS_COMMENT';
