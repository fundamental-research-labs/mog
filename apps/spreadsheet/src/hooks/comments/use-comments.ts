/**
 * Comments Hook
 *
 * Provides comment management functionality - add, edit, delete, resolve comments.
 * Bridges the UI (CommentPopover) with the state layer (comments domain module).
 *
 * ARCHITECTURE
 * - Uses CellId-based comments (stable across structure changes)
 * - Comments stored in Yjs per-sheet (collaborative, persisted)
 * - Rich text content as segment array
 *
 * NOTE: This is the implementation that works directly with the
 * comments domain module. Full machine integration (comment-machine.ts)
 * will be wired up in
 *
 * @see engine/src/state/store/domains/comments.ts
 */

import { useCallback, useEffect, useState } from 'react';

import type { Comment as ApiComment } from '@mog-sdk/contracts/api';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { Comment } from '@mog-sdk/contracts/comments';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { RichText } from '@mog-sdk/contracts/rich-text';
import { fromPlainText, toPlainText } from '@mog/spreadsheet-utils/rich-text';

import { useActiveSheetId, useWorkbook } from '../../infra/context';
// PERFORMANCE: Use useActiveCell instead of useSelection to avoid re-renders on
// every selection change. This hook only needs activeCell, not the full selection state.
import { useActiveCell } from '../selection/use-active-cell';

// =============================================================================
// Types
// =============================================================================

export interface UseCommentsReturn {
  /** Comments for the currently selected cell */
  currentCellComments: Comment[];

  /** Whether the current cell has any comments */
  hasComments: boolean;

  /** Add a new comment to the current cell */
  addComment: (content: RichText | string, author: string, options?: { authorId?: string }) => void;

  /** Update an existing comment */
  updateComment: (commentId: string, content: RichText | string) => void;

  /** Delete a comment */
  deleteComment: (commentId: string) => void;

  /** Reply to an existing comment (add to thread) */
  replyToComment: (
    parentCommentId: string,
    content: RichText | string,
    author: string,
    options?: { authorId?: string },
  ) => void;

  /** Resolve/unresolve a thread */
  setThreadResolved: (threadId: string, resolved: boolean) => void;

  /** Delete all comments for the current cell */
  deleteAllCommentsForCell: () => void;

  /** Get all comments in a thread */
  getThread: (threadId: string) => Comment[];

  /** Check if a specific cell has comments (for rendering indicators) */
  cellHasComments: (row: number, col: number) => boolean;

  /** Get the CellId for a position (needed for comment operations) */
  getCellIdAtPosition: (row: number, col: number) => Promise<CellId | null>;

  /** Get comments for any cell (not just current selection) */
  getCommentsForCell: (row: number, col: number) => Comment[];
}

// =============================================================================
// Helpers
// =============================================================================

/** Map API Comment to contracts Comment shape (used by UI components). */
function toContractsComment(c: ApiComment): Comment {
  return {
    id: c.id,
    cellRef: toCellId(c.cellRef),
    author: c.author,
    createdAt: c.createdAt ?? Date.now(),
    content: fromPlainText(c.content ?? c.runs.map((run) => run.text).join('')),
    threadId: c.threadId ?? undefined,
    parentId: c.parentId ?? undefined,
    resolved: c.resolved,
    commentType: c.commentType,
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useComments(): UseCommentsReturn {
  const { activeCell } = useActiveCell();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();

  // Local state for current cell comments (subscribed to Yjs changes)
  const [currentCellComments, setCurrentCellComments] = useState<Comment[]>([]);

  // Load comments for the current cell via unified Worksheet API (async)
  useEffect(() => {
    const ws = wb.getSheetById(activeSheetId);
    if (!ws) {
      setCurrentCellComments([]);
      return;
    }

    let cancelled = false;

    const loadComments = () => {
      void ws.comments.getForCell(activeCell.row, activeCell.col).then((comments) => {
        if (!cancelled) setCurrentCellComments(comments.map(toContractsComment));
      });
    };

    // Initial load
    loadComments();

    const unsubscribeCommentsChanged = wb.on('comments:cleared', (event) => {
      if (event.sheetId === activeSheetId) {
        loadComments();
      }
    });

    // Poll for changes (no subscribe available)
    const interval = setInterval(() => {
      loadComments();
    }, 1000);

    return () => {
      cancelled = true;
      unsubscribeCommentsChanged();
      clearInterval(interval);
    };
  }, [wb, activeSheetId, activeCell.row, activeCell.col]);

  /**
   * Get CellId for a position via viewport buffer (sync).
   */
  const getCellIdAtPosition = useCallback(
    async (row: number, col: number): Promise<CellId | null> => {
      const cellId = await wb.getSheetById(activeSheetId)._internal.getCellIdAt(row, col);
      return cellId ? toCellId(cellId) : null;
    },
    [wb, activeSheetId],
  );

  /**
   * Check if a cell has comments (for rendering indicators).
   */
  const cellHasComments = useCallback(
    (row: number, col: number): boolean => {
      const viewport = wb.getSheetById(activeSheetId).viewport;
      return viewport.hasComment(row, col);
    },
    [wb, activeSheetId],
  );

  /**
   * Get comments for any cell.
   * NOTE: Returns cached currentCellComments for the active cell, or [] for other cells.
   * For off-active-cell comments, callers should use ws.comments.getForCell() directly.
   */
  const getCommentsForCell = useCallback(
    (row: number, col: number): Comment[] => {
      // Sync path: if this is the active cell, return cached comments
      if (row === activeCell.row && col === activeCell.col) {
        return currentCellComments;
      }
      // For other cells, cannot do sync reads (async only)
      // Return empty — callers needing off-cell comments should use ws.comments.getForCell() directly
      return [];
    },
    [activeCell.row, activeCell.col, currentCellComments],
  );

  /**
   * Add a new comment to the current cell.
   */
  const addComment = useCallback(
    (content: RichText | string, author: string, _options?: { authorId?: string }) => {
      const text = typeof content === 'string' ? content : toPlainText(content);
      const ws = wb.getSheetById(activeSheetId);
      if (!ws) {
        console.warn('[use-comments] Cannot add comment: sheet not found');
        return;
      }
      void ws.comments.add(activeCell.row, activeCell.col, text, author);
    },
    [wb, activeSheetId, activeCell.row, activeCell.col],
  );

  /**
   * Update an existing comment.
   */
  const updateComment = useCallback(
    (commentId: string, content: RichText | string) => {
      const text = typeof content === 'string' ? content : toPlainText(content);
      const ws = wb.getSheetById(activeSheetId);
      if (!ws) return;
      void ws.comments.update(commentId, { text });
    },
    [wb, activeSheetId],
  );

  /**
   * Delete a comment.
   */
  const deleteComment = useCallback(
    (commentId: string) => {
      const ws = wb.getSheetById(activeSheetId);
      if (!ws) return;
      void ws.comments.remove(commentId);
    },
    [wb, activeSheetId],
  );

  /**
   * Reply to an existing comment (add to thread).
   * NOTE: ws.comments.add does not support parentId yet — reply is added as top-level comment.
   */
  const replyToComment = useCallback(
    (
      _parentCommentId: string,
      content: RichText | string,
      author: string,
      _options?: { authorId?: string },
    ) => {
      const text = typeof content === 'string' ? content : toPlainText(content);
      const ws = wb.getSheetById(activeSheetId);
      if (!ws) {
        console.warn('[use-comments] Cannot reply: sheet not found');
        return;
      }
      void ws.comments.add(activeCell.row, activeCell.col, text, author);
    },
    [wb, activeSheetId, activeCell.row, activeCell.col],
  );

  /**
   * Resolve/unresolve a thread.
   */
  const setThreadResolved = useCallback(
    (threadId: string, resolved: boolean) => {
      const ws = wb.getSheetById(activeSheetId);
      if (!ws) return;
      setCurrentCellComments((current) =>
        current.map((comment) =>
          comment.threadId === threadId || comment.id === threadId
            ? { ...comment, resolved }
            : comment,
        ),
      );
      void ws.comments.resolveThread(threadId, resolved).then(() =>
        ws.comments.getForCell(activeCell.row, activeCell.col).then((comments) => {
          setCurrentCellComments(comments.map(toContractsComment));
        }),
      );
    },
    [wb, activeSheetId, activeCell.row, activeCell.col],
  );

  /**
   * Delete all comments for the current cell.
   * Fetches all comments for the cell then deletes each.
   */
  const deleteAllCommentsForCell = useCallback(() => {
    const ws = wb.getSheetById(activeSheetId);
    if (!ws) return;

    void ws.comments.getForCell(activeCell.row, activeCell.col).then((comments) => {
      for (const comment of comments) {
        void ws.comments.remove(comment.id);
      }
    });
  }, [wb, activeSheetId, activeCell.row, activeCell.col]);

  /**
   * Get all comments in a thread.
   * No getThread API available — filter from cached currentCellComments.
   */
  const getThread = useCallback(
    (threadId: string): Comment[] => {
      return currentCellComments.filter((c) => c.threadId === threadId);
    },
    [currentCellComments],
  );

  return {
    currentCellComments,
    hasComments: currentCellComments.length > 0,
    addComment,
    updateComment,
    deleteComment,
    replyToComment,
    setThreadResolved,
    deleteAllCommentsForCell,
    getThread,
    cellHasComments,
    getCellIdAtPosition,
    getCommentsForCell,
  };
}

// =============================================================================
// Additional Hook: useHasComment (for render context)
// =============================================================================

/**
 * Returns a function to check if a cell has comments.
 * Designed for use in RenderContext.hasComment.
 *
 * This is a lightweight hook that doesn't subscribe to individual cell changes,
 * making it suitable for use in the renderer.
 */
export function useHasComment(): (sheetId: SheetId, row: number, col: number) => boolean {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  return useCallback(
    (_sheetId: SheetId, row: number, col: number): boolean => {
      const viewport = wb.getSheetById(activeSheetId).viewport;
      return viewport.hasComment(row, col);
    },
    [wb, activeSheetId],
  );
}
