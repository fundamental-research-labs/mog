/**
 * Comment Action Handlers
 *
 * Pure handler functions for comment-related actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - Comment storage is in Comments domain module
 * - UI interactions go through deps.commands.comment (Actor Access Layer)
 *
 * MIGRATION NOTES
 * DELETE_COMMENT: Uses ws.comments.removeNote(row, col) via unified Worksheet API.
 * EDIT_COMMENT: Uses ws.comments.getForCell(row, col) — uses the comment's
 * own cellRef as the CellId (viewport.getCellData does not expose cellId).
 * NEXT_COMMENT / PREVIOUS_COMMENT: Uses ws.comments.list() + ws._internal.batchGetCellPositions().
 * INSERT_COMMENT: Uses ws._internal.getOrCreateCellId(row, col) via unified Worksheet API.
 */

import type { ActionHandler, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { toCellId } from '@mog-sdk/contracts/cell-identity';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Comment Handlers
// =============================================================================

/**
 * Insert a new comment on the active cell.
 * Opens the comment popover in compose mode.
 *
 * Excel shortcut: Shift+F2 (when cell has no comment)
 */
export const INSERT_COMMENT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const commentCommands = deps.commands.comment;

  if (!commentCommands) {
    return notHandled('not_implemented');
  }

  // Get or create CellId for the active cell via Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  const cellId = toCellId(await ws._internal.getOrCreateCellId(activeCell.row, activeCell.col));

  // Send event to comment machine to open popover in compose mode
  commentCommands.clickCell({
    cellId,
    sheetId,
    row: activeCell.row,
    col: activeCell.col,
  });

  // Transition to compose mode
  commentCommands.startCompose();

  return handled();
};

/**
 * Open the existing comment(s) on the active cell in the popover.
 *
 * Excel-style "Edit Comment": opens the popover in *viewing* mode so
 * the user sees the comment text first; the per-item Edit (pencil)
 * affordance is what transitions an individual CommentItem into inline
 * edit. Going straight to `editing` would replace the rendered text
 * with a textarea and break the read-back path.
 *
 * Excel shortcut: Shift+F2 (when cell has a comment)
 */
export const EDIT_COMMENT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const activeCell = deps.accessors.selection.getActiveCell();
  const commentCommands = deps.commands.comment;

  if (!commentCommands) {
    return notHandled('not_implemented');
  }

  // Resolve from the comment data itself — viewport.getCellData does
  // NOT expose cellId (it's intentionally absent from the binary
  // record; see ViewportCellData docs). The comment's own cellRef is
  // the authoritative CellId for this position.
  const comments = await ws.comments.getForCell(activeCell.row, activeCell.col);
  if (comments.length === 0) {
    // No comment to edit - treat as insert instead (fallback)
    return INSERT_COMMENT(deps);
  }

  const commentCellId = toCellId(comments[0].cellRef);
  commentCommands.clickCell({
    cellId: commentCellId,
    sheetId,
    row: activeCell.row,
    col: activeCell.col,
  });

  return handled();
};

/**
 * Delete all comments on the active cell.
 *
 * Excel shortcut: Context menu "Delete Comment"
 */
export const DELETE_COMMENT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.comments.removeNote(activeCell.row, activeCell.col);
  return handled();
};

/**
 * Toggle visibility of the comment popover on the active cell.
 *
 * Excel shortcut: Ctrl+Shift+O (context-menu "Show/Hide Comment")
 * Opens the comment popover for the active cell, the same as Edit Comment.
 */
export const SHOW_HIDE_COMMENTS: AsyncActionHandler = async (deps) => {
  const commentCommands = deps.commands.comment;
  if (!commentCommands) return notHandled('not_implemented');

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const activeCell = deps.accessors.selection.getActiveCell();

  const comments = await ws.comments.getForCell(activeCell.row, activeCell.col);
  if (comments.length === 0) return handled();

  const commentCellId = toCellId(comments[0].cellRef);
  commentCommands.clickCell({
    cellId: commentCellId,
    sheetId,
    row: activeCell.row,
    col: activeCell.col,
  });

  return handled();
};

/**
 * Navigate to the next cell with a comment.
 */
export const NEXT_COMMENT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  const ws = deps.workbook.getSheetById(sheetId);
  const allComments = await ws.comments.list();
  if (allComments.length === 0) {
    return handled(); // No comments to navigate to
  }

  // Get unique cellRefs from comments (Comment.cellRef is the stable CellId UUID;
  // comment.cellId does not exist on the Comment type — cellRef is the correct field).
  // Use ws._internal.getCellPosition (sheet-scoped) rather than batchGetCellPositions
  // (which calls compute_resolve_cell_positions without sheetId and cannot find
  // cells that were registered in a specific sheet's cell registry).
  const seenCellRefs = new Set<string>();
  const cellsWithComments: Array<{ row: number; col: number }> = [];
  for (const comment of allComments) {
    const commentCellId = toCellId(comment.cellRef);
    if (seenCellRefs.has(commentCellId)) continue;
    seenCellRefs.add(commentCellId);
    const position = await ws._internal.getCellPosition(commentCellId);
    if (position) {
      cellsWithComments.push({ row: position.row, col: position.col });
    }
  }

  if (cellsWithComments.length === 0) {
    return handled();
  }

  // Sort by row, then column
  cellsWithComments.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  // Find the next cell after current position
  let nextCell = cellsWithComments[0]; // Default to first
  for (const cell of cellsWithComments) {
    if (cell.row > activeCell.row || (cell.row === activeCell.row && cell.col > activeCell.col)) {
      nextCell = cell;
      break;
    }
  }

  // Navigate to the cell via selection command
  deps.commands.selection.goTo(nextCell);

  return handled();
};

/**
 * Navigate to the previous cell with a comment.
 */
export const PREVIOUS_COMMENT: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const activeCell = deps.accessors.selection.getActiveCell();

  const ws = deps.workbook.getSheetById(sheetId);
  const allComments = await ws.comments.list();
  if (allComments.length === 0) {
    return handled(); // No comments to navigate to
  }

  // Get unique cellRefs from comments (Comment.cellRef is the stable CellId UUID;
  // comment.cellId does not exist on the Comment type — cellRef is the correct field).
  // Use ws._internal.getCellPosition (sheet-scoped) rather than batchGetCellPositions
  // (which calls compute_resolve_cell_positions without sheetId and cannot find
  // cells that were registered in a specific sheet's cell registry).
  const seenCellRefs = new Set<string>();
  const cellsWithComments: Array<{ row: number; col: number }> = [];
  for (const comment of allComments) {
    const commentCellId = toCellId(comment.cellRef);
    if (seenCellRefs.has(commentCellId)) continue;
    seenCellRefs.add(commentCellId);
    const position = await ws._internal.getCellPosition(commentCellId);
    if (position) {
      cellsWithComments.push({ row: position.row, col: position.col });
    }
  }

  if (cellsWithComments.length === 0) {
    return handled();
  }

  // Sort by row, then column (descending for previous)
  cellsWithComments.sort((a, b) => {
    if (a.row !== b.row) return b.row - a.row;
    return b.col - a.col;
  });

  // Find the previous cell before current position
  let prevCell = cellsWithComments[0]; // Default to last (first in reverse order)
  for (const cell of cellsWithComments) {
    if (cell.row < activeCell.row || (cell.row === activeCell.row && cell.col < activeCell.col)) {
      prevCell = cell;
      break;
    }
  }

  // Navigate to the cell via selection command
  deps.commands.selection.goTo(prevCell);

  return handled();
};

/**
 * Toggle visibility of all comments in the sheet.
 *
 * This action toggles the "Show All Comments" state in UIStore and opens/closes
 * the review comments pane with the same state.
 *
 * Architecture: Uses UIStore slice (ephemeral UI state) via getUIStore helper.
 */
export const TOGGLE_SHOW_ALL_COMMENTS: ActionHandler = (deps) => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('not_implemented');
  }

  const ui = uiStore.getState();
  const nextShowAllComments = !ui.showAllComments;
  ui.setShowAllComments(nextShowAllComments);
  ui.setCommentsPanelVisible(nextShowAllComments);
  return handled();
};
