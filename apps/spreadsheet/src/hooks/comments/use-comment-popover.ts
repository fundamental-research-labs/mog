/**
 * Comment Popover Hook
 *
 * Provides comment popover UI state management for the active cell.
 * Bridges the UI (CommentPopover) with the state layer (comment actor + Comments domain module).
 *
 * ARCHITECTURE:
 * - Uses XState comment actor for editor UI state (isVisible, mode, target, draftContent)
 * - Uses Comments domain module for persisted comment data
 * - Uses CellId-based comments (stable across structure changes)
 *
 * This hook follows the XState actor pattern (like useNotes), combining:
 * 1. XState selectors for reactive UI state
 * 2. Commands for sending events to the state machine
 * 3. Domain module access for persisted data
 *
 * @see spreadsheet-model/src/comments.ts - Data layer
 * @see state-machines/src/comment-machine.ts - UI state machine
 */

import { useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { commentSelectors } from '../../selectors';
import type { CommentCommands, CommentState, CommentTarget } from '@mog-sdk/contracts/actors';
import type { Comment as ApiComment } from '@mog-sdk/contracts/api';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { Comment } from '@mog-sdk/contracts/comments';
import type { RichText } from '@mog-sdk/contracts/rich-text';
import { fromPlainText, toPlainText } from '@mog/spreadsheet-utils/rich-text';

import { createCommentCommands } from '../../coordinator/actor-access';
import { useActiveSheetId, useWorkbook } from '../../infra/context';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Helpers
// =============================================================================

/** Map API Comment to contracts Comment shape (used by UI components).
 *
 * The API surface (kernel/types-api) is the Rust-generated wire shape:
 * `cellRef`, `runs[]` (flat per-run formatting). The contracts shape used
 * by the popover components is `cellRef` (same), `content: RichText`
 * (segments with nested optional `format`). We pass `text` through; rich
 * formatting can be carried forward later if needed by the UI.
 */
function toContractsComment(c: ApiComment): Comment {
  return {
    id: c.id,
    cellRef: toCellId(c.cellRef),
    author: c.author,
    createdAt: c.createdAt ?? Date.now(),
    content: c.runs.map((run) => ({ text: run.text })),
    threadId: c.threadId ?? undefined,
    resolved: c.resolved,
    commentType: c.commentType,
  };
}

// Type-safe selector wrapper to handle XState snapshot type compatibility

type AnySelector<T> = (state: any) => T;
const asSelector = <T>(selector: (state: CommentState) => T): AnySelector<T> => selector;

// =============================================================================
// Types
// =============================================================================

export type CommentPopoverMode = 'view' | 'edit' | 'compose' | 'reply' | 'confirmDelete';

export interface UseCommentPopoverReturn {
  /** Whether the comment popover should be visible */
  isVisible: boolean;

  /** Current mode of the popover */
  mode: CommentPopoverMode;

  /** Target cell for the comment popover (row/col for positioning) */
  target: CommentTarget | null;

  /** Comments for the current target cell */
  comments: Comment[];

  /** Draft content while editing/composing */
  draftContent: RichText;

  /** Current author name for new comments */
  currentAuthor: string;

  /** Current author ID (optional) */
  currentAuthorId?: string;

  /** Comment ID currently being edited (null if composing new) */
  editingCommentId: string | null;

  /** Comment ID pending deletion */
  deletingCommentId: string | null;

  /** Close the popover */
  close: () => void;

  /** Save the current draft (create or update comment) */
  save: () => void;

  /** Cancel the current edit/compose operation */
  cancel: () => void;

  /** Update draft content while editing/composing */
  updateDraft: (content: RichText | string) => void;

  /** Add a new comment to the current cell */
  addComment: (content: RichText | string) => Promise<void>;

  /** Update an existing comment */
  updateComment: (commentId: string, content: RichText | string) => Promise<void>;

  /** Delete a comment */
  deleteComment: (commentId: string) => Promise<void>;

  /** Reply to an existing comment */
  replyToComment: (parentCommentId: string, content: RichText | string) => Promise<void>;

  /** Resolve/unresolve a thread */
  resolveThread: (threadId: string, resolved: boolean) => void;

  /**
   * Convert a legacy note into a threaded comment (silent promotion).
   *
   * Calls the kernel API to flip `commentType` to `'threadedComment'`,
   * clear the four note-only geometry fields, and assign `thread_id`.
   * Then transitions the popover into reply compose mode so the user
   * can immediately type their reply (Excel-parity UX — clicking
   * "Reply" on a note converts and opens compose in one motion).
   */
  convertNoteToThread: (commentId: string) => Promise<void>;

  /** Start editing an existing comment */
  startEdit: (commentId: string, content: RichText) => void;

  /** Start composing a new comment */
  startCompose: () => void;

  /** Request to delete a comment (shows confirmation) */
  requestDelete: (commentId: string) => void;

  /** Confirm deletion of pending comment */
  confirmDelete: () => void;

  /** Cancel delete operation */
  cancelDelete: () => void;

  /** Open comment popover for a cell (used by "New Comment" action) */
  openForCell: (row: number, col: number) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing the comment popover UI.
 *
 * Provides both read access to persisted comment data (via Comments domain module)
 * and UI state management (via XState comment actor).
 *
 * @example
 * ```tsx
 * function CommentPopover() {
 * const {
 * isVisible,
 * mode,
 * target,
 * comments,
 * draftContent,
 * close,
 * save,
 * updateDraft,
 * addComment,
 * } = useCommentPopover;
 *
 * if (!isVisible || !target) return null;
 *
 * // Render popover UI...
 * }
 * ```
 */
export function useCommentPopover(): UseCommentPopoverReturn {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const coordinator = useCoordinator();

  // Get the comment actor from grid editing system
  const commentActor = coordinator.grid.access.actors.comment;

  // Log warning if comment actor is unavailable (defensive check)
  if (!commentActor) {
    console.warn('[CommentPopover] Comment actor not available from coordinator');
  }

  // Subscribe to comment actor UI state using selectors
  const isVisible = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.isVisible) : () => false,
  );

  const target = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.target) : () => null,
  );

  const draftContent = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.draftContent) : () => [] as RichText,
  );

  const editingCommentId = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.editingCommentId) : () => null,
  );

  const deletingCommentId = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.deletingCommentId) : () => null,
  );

  const stateName = useSelector(
    commentActor,
    commentActor ? asSelector(commentSelectors.stateName) : () => 'closed' as const,
  );

  // Local state for comments at the target cell
  const [comments, setComments] = useState<Comment[]>([]);

  // TODO: Get current author from user context/auth
  // For now, use a placeholder
  const currentAuthor = 'User';
  const currentAuthorId = undefined;

  // Convert state name to popover mode
  const mode: CommentPopoverMode = useMemo(() => {
    switch (stateName) {
      case 'viewing':
        return 'view';
      case 'composing':
        return 'compose';
      case 'editing':
        return 'edit';
      case 'confirmingDelete':
        return 'confirmDelete';
      default:
        return 'view';
    }
  }, [stateName]);

  // Load comments when target changes via Worksheet API (async)
  useEffect(() => {
    if (!target) {
      setComments([]);
      return;
    }

    let cancelled = false;

    const ws = wb.getSheetById(target.sheetId);
    const loadComments = () => {
      void ws.comments.getForCell(target.row, target.col).then((loadedComments) => {
        if (!cancelled) setComments(loadedComments.map(toContractsComment));
      });
    };

    // Initial load
    loadComments();

    // Reactive load. The kernel emits comments:cleared as the comment-change
    // signal for set/update/delete/resolve; subscribers re-query Rust for data.
    const unsubscribeCommentsChanged = wb.on('comments:cleared', (event) => {
      if (event.sheetId === target.sheetId) {
        loadComments();
      }
    });

    // Poll for changes (Worksheet API has no subscribe)
    const interval = setInterval(() => {
      loadComments();
    }, 1000);

    return () => {
      cancelled = true;
      unsubscribeCommentsChanged();
      clearInterval(interval);
    };
  }, [wb, target]);

  // Create comment commands from the actor
  const commands: CommentCommands | null = useMemo(() => {
    if (!commentActor) {
      return null;
    }
    return createCommentCommands(commentActor);
  }, [commentActor]);

  // Helper to convert string content to RichText
  const toRichText = useCallback((content: RichText | string): RichText => {
    if (typeof content === 'string') {
      return fromPlainText(content);
    }
    return content;
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Commands (send events to state machine)
  // ═══════════════════════════════════════════════════════════════════════════

  const close = useCallback(() => {
    commands?.close();
  }, [commands]);

  // `save()` ONLY transitions the comment state machine. The data writes are
  // owned by the direct callbacks below (`addComment`, `updateComment`,
  // `replyToComment`) which are invoked by the popover's submit handlers
  // BEFORE they call `save()`. Doing a write here too would double-fire the
  // bridge — the popover's local `editContent` / `newContent` is the user's
  // typed-in source of truth; the machine's `draftContent` is only updated
  // via `updateDraft(...)`, which the popover does not call. The two used
  // to race here, with the machine's stale `draftContent` clobbering the
  // popover's fresh write.
  const save = useCallback(() => {
    commands?.save();
  }, [commands]);

  const cancel = useCallback(() => {
    commands?.cancel();
  }, [commands]);

  const updateDraft = useCallback(
    (content: RichText | string) => {
      commands?.updateDraft(toRichText(content));
    },
    [commands, toRichText],
  );

  const startEdit = useCallback(
    (commentId: string, content: RichText) => {
      commands?.startEdit(commentId, content);
    },
    [commands],
  );

  const startCompose = useCallback(() => {
    commands?.startCompose();
  }, [commands]);

  const requestDelete = useCallback(
    (commentId: string) => {
      commands?.requestDelete(commentId);
    },
    [commands],
  );

  const confirmDelete = useCallback(() => {
    if (!commands || !target || !deletingCommentId) return;

    const ws = wb.getSheetById(target.sheetId);
    if (!ws) return;

    // Actually delete the comment via Worksheet API (fire-and-forget)
    void ws.comments.remove(deletingCommentId);
    commands.confirmDelete();
  }, [commands, target, deletingCommentId, wb]);

  const cancelDelete = useCallback(() => {
    commands?.cancelDelete();
  }, [commands]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Direct Comment Operations (for UI that bypasses state machine)
  // ═══════════════════════════════════════════════════════════════════════════

  const addComment = useCallback(
    async (content: RichText | string) => {
      if (!target) return;

      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;

      const text = typeof content === 'string' ? content : toPlainText(content);
      await ws.comments.add(target.row, target.col, text, currentAuthor);
    },
    [wb, target, currentAuthor],
  );

  const updateComment = useCallback(
    async (commentId: string, content: RichText | string) => {
      if (!target) return;
      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;
      const text = typeof content === 'string' ? content : toPlainText(content);
      await ws.comments.update(commentId, { text });
    },
    [wb, target],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!target) return;
      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;
      await ws.comments.remove(commentId);
    },
    [wb, target],
  );

  const replyToComment = useCallback(
    async (parentCommentId: string, content: RichText | string) => {
      if (!target) return;

      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;

      const text = typeof content === 'string' ? content : toPlainText(content);
      await ws.comments.addReply(parentCommentId, text, currentAuthor);
    },
    [wb, target, currentAuthor],
  );

  const convertNoteToThread = useCallback(
    async (commentId: string) => {
      if (!target) return;
      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;

      // Flip commentType + drop note-only geometry on the kernel side.
      // The poll-loop in the comments effect picks up the new commentType
      // value within ≤1s, at which point CommentPopover re-renders as
      // ThreadVariant. The popover's NoteVariant Reply button is
      // responsible for transitioning the popover's local state into
      // reply mode against this commentId after this resolves; the hook
      // only owns the kernel-side flip.
      await ws.comments.convertNoteToThread(commentId);
    },
    [wb, target],
  );

  const resolveThread = useCallback(
    (threadId: string, resolved: boolean) => {
      if (!target) return;
      const ws = wb.getSheetById(target.sheetId);
      if (!ws) return;
      setComments((current) =>
        current.map((comment) =>
          comment.threadId === threadId || comment.id === threadId
            ? { ...comment, resolved }
            : comment,
        ),
      );
      void ws.comments.resolveThread(threadId, resolved).then(() =>
        ws.comments.getForCell(target.row, target.col).then((updatedComments) => {
          setComments(updatedComments.map(toContractsComment));
        }),
      );
    },
    [wb, target],
  );

  /**
   * Open comment popover for a specific cell.
   * Used by "Review -> New Comment" menu action.
   */
  const openForCell = useCallback(
    (row: number, col: number) => {
      if (!commands) {
        console.warn('[use-comment-popover] Cannot open: comment actor unavailable');
        return;
      }

      void (async () => {
        const ws = wb.getSheetById(activeSheetId);
        const existingComments = await ws.comments.getForCell(row, col);
        const cellId =
          existingComments[0]?.cellRef !== undefined
            ? toCellId(existingComments[0].cellRef)
            : toCellId(await ws._internal.getOrCreateCellId(row, col));

        const commentTarget: CommentTarget = {
          cellId,
          sheetId: activeSheetId,
          row,
          col,
        };

        // Click cell to open popover, then start compose if no comments
        commands.clickCell(commentTarget);

        if (existingComments.length === 0) {
          // Use setTimeout to ensure the state machine has processed clickCell first
          setTimeout(() => {
            commands.startCompose();
          }, 0);
        }
      })();
    },
    [commands, activeSheetId, wb],
  );

  return {
    isVisible,
    mode,
    target,
    comments,
    draftContent,
    currentAuthor,
    currentAuthorId,
    editingCommentId,
    deletingCommentId,
    close,
    save,
    cancel,
    updateDraft,
    addComment,
    updateComment,
    deleteComment,
    replyToComment,
    resolveThread,
    convertNoteToThread,
    startEdit,
    startCompose,
    requestDelete,
    confirmDelete,
    cancelDelete,
    openForCell,
  };
}
