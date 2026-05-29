/**
 * Comment Popover Component
 *
 * Excel-style comment popover that appears on cell hover/click.
 * Displays threaded comments with author, timestamp, and rich text content.
 *
 * Features:
 * - View mode: Display existing comments with reply/edit/delete actions
 * - Edit mode: Inline editing of existing comment
 * - Compose mode: Add new comment
 * - Thread support: Comments can have replies
 * - Resolve/unresolve threads
 *
 * ARCHITECTURE:
 * - Self-contained component - uses useCommentPopover hook internally
 * - No props required - just render <CommentPopover /> and it handles everything
 * - Uses Radix Popover for positioning (handles viewport boundaries, flip, shift)
 * - Uses XState comment actor for UI state management
 *
 * @see engine/src/hooks/use-comment-popover.ts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AddSvg, CheckmarkCircleSvg, CloseSvg, DeleteSvg, EditSvg } from '@mog/icons';
import type { Comment } from '@mog-sdk/contracts/comments';
import { toPlainText } from '@mog/spreadsheet-utils/rich-text';
import { useCoordinator, useRendererActions } from '../../hooks';
import { useCommentPopover } from '../../hooks/comments/use-comment-popover';
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  type Measurable,
} from '@mog/shell/components/ui';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format timestamp for display.
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    // Today - show time
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    // Show full date
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

// =============================================================================
// Sub-components
// =============================================================================

interface CommentItemProps {
  comment: Comment;
  isEditing: boolean;
  editContent: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditContentChange: (content: string) => void;
  onDelete: () => void;
  onReply: () => void;
  canEdit: boolean; // true if current user is author
  /**
   * Whether to render the Reply (`+`) button on this item.
   *
   * True for ThreadVariant (threads always support per-item reply).
   * False for NoteVariant (notes hide per-item thread affordances;
   * promotion lives in a dedicated footer button instead).
   */
  showReply: boolean;
}

function CommentItem({
  comment,
  isEditing,
  editContent,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditContentChange,
  onDelete,
  onReply,
  canEdit,
  showReply,
}: CommentItemProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const contentText = toPlainText(comment.content);

  if (isEditing) {
    return (
      <div className="border-b border-ss-border-light last:border-b-0 p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-body text-text">{comment.author}</span>
          <span className="text-caption text-ss-text-secondary">
            {formatTimestamp(comment.modifiedAt ?? comment.createdAt)}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => onEditContentChange(e.target.value)}
          className="w-full px-2 py-1.5 border border-ss-border rounded text-body resize-none focus:outline-none focus:ring-2 focus:ring-ss-primary focus:border-transparent"
          rows={3}
          placeholder="Edit your comment..."
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" size="sm" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={onSaveEdit} disabled={!editContent.trim()}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-ss-border-light last:border-b-0 p-3 group">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-body text-text">{comment.author}</span>
          <span className="text-caption text-ss-text-secondary">
            {formatTimestamp(comment.modifiedAt ?? comment.createdAt)}
          </span>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {showReply && (
            <button
              type="button"
              data-testid="add-reply"
              className="p-1 rounded text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover transition-colors"
              title="Reply"
              aria-label="Reply to comment"
              onClick={onReply}
            >
              <AddSvg style={{ width: 14, height: 14 }} />
            </button>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                className="p-1 rounded text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover transition-colors"
                title="Edit"
                onClick={onStartEdit}
              >
                <EditSvg style={{ width: 14, height: 14 }} />
              </button>
              <button
                type="button"
                className="p-1 rounded text-ss-text-secondary hover:text-ss-error hover:bg-ss-error-bg transition-colors"
                title="Delete"
                onClick={onDelete}
              >
                <DeleteSvg style={{ width: 14, height: 14 }} />
              </button>
            </>
          )}
        </div>
      </div>
      <p className="text-body text-text whitespace-pre-wrap">{contentText}</p>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * CommentPopover - Self-contained floating popover for cell comments.
 *
 * Uses the useCommentPopover hook to:
 * - Read UI state (isVisible, mode, target, comments)
 * - Send commands (close, save, cancel, updateDraft, etc.)
 *
 * Uses Radix Popover for positioning:
 * - Automatically handles viewport boundaries (flip/shift)
 * - Positions to the right of the cell, aligned with top
 * - Falls back to left side if no space on right
 *
 * @example
 * ```tsx
 * // Just render it - no props needed!
 * function App() {
 * return (
 * <>
 * <SpreadsheetGrid />
 * <CommentPopover />
 * </>
 * );
 * }
 * ```
 */
export function CommentPopover() {
  const {
    isVisible,
    mode,
    target,
    comments,
    currentAuthor,
    currentAuthorId,
    editingCommentId,
    close,
    save,
    cancel,
    addComment,
    updateComment,
    deleteComment,
    replyToComment,
    resolveThread,
    convertNoteToThread,
    startEdit,
    startCompose,
  } = useCommentPopover();

  const { getGeometry } = useRendererActions();
  const coordinator = useCoordinator();

  // Local UI state for editing within the popover
  // The hook provides mode from state machine, but we also need local state
  // for tracking which comment is being edited and the edit content
  const [localMode, setLocalMode] = useState<'view' | 'edit' | 'compose' | 'reply'>('view');
  const [localEditingCommentId, setLocalEditingCommentId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newContent, setNewContent] = useState('');

  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  // Create virtual reference for Radix Popover positioning
  // This positions the popover relative to the cell's right edge
  //
  // IMPORTANT: getBoundingClientRect() computes position dynamically to avoid stale closures.
  // Previously, cellRect was captured when the effect ran, causing incorrect positioning
  // after scrolling. Now we recompute on every call so Radix always gets the current position.
  const virtualRef = useRef<Measurable>({
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  });

  // Update virtual ref when target or visibility changes
  // The getBoundingClientRect function captures target but computes cellRect dynamically
  useEffect(() => {
    if (!isVisible || !target) return;

    // Create a virtual anchor at the cell's right edge
    // Radix will position the popover relative to this anchor
    // Note: We compute cellRect dynamically inside getBoundingClientRect() to avoid stale closures
    virtualRef.current = {
      getBoundingClientRect: () => {
        const geometry = getGeometry();
        if (!geometry) return new DOMRect(0, 0, 0, 0);

        // getCellPageRect returns page-coords directly (browser absolute
        // coordinates suitable for DOM overlays and popovers).
        const pageRect = geometry.getCellPageRect({ row: target.row, col: target.col });
        if (!pageRect) return new DOMRect(0, 0, 0, 0);

        return new DOMRect(
          pageRect.x + pageRect.width, // Right edge of cell (page-relative)
          pageRect.y, // Top of cell (page-relative)
          0, // No width (point anchor)
          pageRect.height, // Height of cell for alignment
        );
      },
    };
  }, [isVisible, target, getGeometry]);

  // Sync local mode with hook mode
  useEffect(() => {
    if (mode === 'compose') {
      setLocalMode('compose');
    } else if (mode === 'edit' && editingCommentId) {
      setLocalMode('edit');
      setLocalEditingCommentId(editingCommentId);
    } else if (mode === 'view') {
      setLocalMode('view');
    }
  }, [mode, editingCommentId]);

  // Focus new comment textarea when in compose mode
  useEffect(() => {
    if (localMode === 'compose' && newCommentRef.current) {
      newCommentRef.current.focus();
    }
  }, [localMode]);

  // Reset state when popover closes
  useEffect(() => {
    if (!isVisible) {
      setLocalMode('view');
      setLocalEditingCommentId(null);
      setReplyingToId(null);
      setEditContent('');
      setNewContent('');
    }
  }, [isVisible]);

  // If no comments and visible, start in compose mode
  useEffect(() => {
    if (isVisible && comments.length === 0) {
      setLocalMode('compose');
    } else if (isVisible && comments.length > 0 && localMode === 'compose') {
      // If we have comments now, switch to view mode (unless machine says compose)
      if (mode !== 'compose') {
        setLocalMode('view');
      }
    }
  }, [isVisible, comments.length, localMode, mode]);

  // Handlers
  const handleStartEdit = useCallback(
    (comment: Comment) => {
      setLocalMode('edit');
      setLocalEditingCommentId(comment.id);
      setEditContent(toPlainText(comment.content));
      startEdit(comment.id, comment.content);
    },
    [startEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setLocalMode('view');
    setLocalEditingCommentId(null);
    setEditContent('');
    cancel();
  }, [cancel]);

  const handleSaveEdit = useCallback(async () => {
    if (localEditingCommentId && editContent.trim()) {
      await updateComment(localEditingCommentId, editContent.trim());
      setLocalMode('view');
      setLocalEditingCommentId(null);
      setEditContent('');
      save();
      close();
    }
  }, [localEditingCommentId, editContent, updateComment, save, close]);

  const handleStartReply = useCallback((commentId: string) => {
    setLocalMode('reply');
    setReplyingToId(commentId);
    setNewContent('');
  }, []);

  const handleCancelReply = useCallback(() => {
    setLocalMode('view');
    setReplyingToId(null);
    setNewContent('');
  }, []);

  const handleSubmitReply = useCallback(async () => {
    if (replyingToId && newContent.trim()) {
      await replyToComment(replyingToId, newContent.trim());
      handleCancelReply();
    }
  }, [replyingToId, newContent, replyToComment, handleCancelReply]);

  const handleStartCompose = useCallback(() => {
    setLocalMode('compose');
    setNewContent('');
    startCompose();
  }, [startCompose]);

  const handleCancelCompose = useCallback(() => {
    if (comments.length > 0) {
      setLocalMode('view');
    } else {
      close();
    }
    setNewContent('');
    cancel();
  }, [comments.length, close, cancel]);

  const handleSubmitComment = useCallback(async () => {
    if (newContent.trim()) {
      await addComment(newContent.trim());
      setNewContent('');
      setLocalMode('view');
      // Close the popover after a successful "Add Comment" — matches Excel
      // behavior (the popover dismisses, the cell now shows a comment
      // indicator the user can hover/click to reopen). Closing also frees
      // the cells underneath the popover for subsequent clicks; a popover
      // that stays open over neighboring cells silently blocks pointer
      // events on them. `close()` dispatches CLOSE → resetContext, which
      // also unwedges the machine from `composing`.
      close();
    }
  }, [newContent, addComment, close]);

  const handleResolve = useCallback(() => {
    if (comments.length > 0) {
      const threadId = comments[0].threadId ?? comments[0].id;
      const isResolved = comments[0].resolved ?? false;
      resolveThread(threadId, !isResolved);
    }
  }, [comments, resolveThread]);

  const handleDelete = useCallback(
    async (commentId: string) => {
      await deleteComment(commentId);
    },
    [deleteComment],
  );

  // Handle open state change from Radix (escape key, click outside)
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close();
      }
    },
    [close],
  );

  // Belt-and-braces Escape handler. Radix's `useEscapeKeydown` only fires on
  // the highest DismissableLayer in the stack, and the grid's persistent
  // Radix ContextMenu wrapper (which never fully unmounts after a right-click
  // → menuitem cycle) leaves its layer alive in `context.layers`, leaving
  // ours non-highest. Our test harness's `dismissCommentPopover` then sends
  // Escape and Radix silently drops it. Hook into `keydown` ourselves while
  // visible and call `close()` directly so dismiss-via-Escape works reliably
  // regardless of the layer stack.
  useEffect(() => {
    if (!isVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isVisible, close]);

  // Prevent auto-focus from stealing focus from the grid
  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
  }, []);

  // =============================================================================
  // HOVER COORDINATION
  // =============================================================================
  //
  // Notify the hover coordinator when mouse enters/leaves the popover.
  // This enables "safe zone" behavior - the mouse can travel from the cell's
  // comment indicator to the popover without the popover closing.
  //
  // The hover coordinator will:
  // - Cancel the hide timer when mouse enters popover
  // - Start the hide timer when mouse leaves popover
  //
  // These methods are null-safe in case hover coordination isn't set up yet.
  // =============================================================================

  const handlePopoverMouseEnter = useCallback(() => {
    coordinator.grid.commentHover.notifyPopoverMouseEnter?.();
  }, [coordinator]);

  const handlePopoverMouseLeave = useCallback(() => {
    coordinator.grid.commentHover.notifyPopoverMouseLeave?.();
  }, [coordinator]);

  const isResolved = comments.length > 0 && comments[0].resolved;

  // Variant dispatch — `commentType` is now required end-to-end (Tracks 1+2a).
  // `comments[0]?.commentType` is undefined only when `comments` is empty,
  // i.e. compose mode for a fresh cell. Default to `'threadedComment'` since
  // "New Comment" creates threads (Excel default).
  const variant: 'note' | 'threadedComment' = comments[0]?.commentType ?? 'threadedComment';

  // NoteVariant: the Reply (`+`) button is repurposed as silent promotion —
  // call convertNoteToThread, then transition into reply mode against that
  // comment id (it's now the thread root). The poll-loop in the hook will
  // pick up the new commentType within ≤1s and re-render as ThreadVariant.
  const handleConvertAndReply = useCallback(
    async (commentId: string) => {
      try {
        await convertNoteToThread(commentId);
      } catch (err) {
        console.error('[CommentPopover] convertNoteToThread failed', err);
        return;
      }
      // Local-state transition into reply mode keyed off the converted
      // comment's id — it's the new thread root. When the poll-loop
      // refreshes `comments` the variant flips to ThreadVariant; the
      // reply textarea (gated on localMode === 'reply') is already
      // visible, so the transition is seamless.
      handleStartReply(commentId);
    },
    [convertNoteToThread, handleStartReply],
  );

  // Memoize the virtual ref object for stability
  const virtualRefObject = useMemo(() => virtualRef, []);

  // Shared body for both variants. Extracted so the only difference between
  // ThreadVariant and NoteVariant is the header (Resolve button) and the
  // CommentItem onReply behavior — everything else (compose textarea, reply
  // textarea, "Add Comment" button) is identical.
  const renderCommentsList = (
    onReplyForComment: (commentId: string) => void,
    showReplyOnItems = true,
  ) => (
    <div className="flex-1 overflow-auto">
      {comments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          isEditing={localEditingCommentId === comment.id}
          editContent={editContent}
          onStartEdit={() => handleStartEdit(comment)}
          onCancelEdit={handleCancelEdit}
          onSaveEdit={handleSaveEdit}
          onEditContentChange={setEditContent}
          onDelete={() => handleDelete(comment.id)}
          onReply={() => onReplyForComment(comment.id)}
          canEdit={!currentAuthorId || comment.authorId === currentAuthorId}
          showReply={showReplyOnItems}
        />
      ))}

      {/* Reply input (when replying) */}
      {localMode === 'reply' && (
        <div className="p-3 bg-ss-surface-secondary">
          <div className="text-caption text-ss-text-secondary mb-2">
            Replying as {currentAuthor}
          </div>
          <textarea
            ref={newCommentRef}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="w-full px-2 py-1.5 border border-ss-border rounded text-body resize-none focus:outline-none focus:ring-2 focus:ring-ss-primary focus:border-transparent"
            rows={2}
            placeholder="Write a reply..."
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={handleCancelReply}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmitReply}
              disabled={!newContent.trim()}
            >
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const renderComposeFooter = () => (
    <>
      {/* New comment input (when composing or no comments) */}
      {(localMode === 'compose' || comments.length === 0) && localMode !== 'reply' && (
        <div className="p-3 border-t border-ss-border bg-ss-surface-secondary">
          <div className="text-caption text-ss-text-secondary mb-2">
            {comments.length === 0
              ? `New comment as ${currentAuthor}`
              : `Add comment as ${currentAuthor}`}
          </div>
          <textarea
            ref={newCommentRef}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            className="w-full px-2 py-1.5 border border-ss-border rounded text-body resize-none focus:outline-none focus:ring-2 focus:ring-ss-primary focus:border-transparent"
            rows={3}
            placeholder="Write a comment..."
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            {comments.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleCancelCompose}>
                Cancel
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmitComment}
              disabled={!newContent.trim()}
            >
              {comments.length === 0 ? 'Add Comment' : 'Comment'}
            </Button>
          </div>
        </div>
      )}

      {/* Add comment button (when viewing existing comments) */}
      {localMode === 'view' && comments.length > 0 && (
        <div className="px-3 py-2 border-t border-ss-border shrink-0">
          <Button variant="secondary" size="sm" onClick={handleStartCompose} className="w-full">
            <AddSvg style={{ width: 14, height: 14 }} />
            Add Comment
          </Button>
        </div>
      )}
    </>
  );

  // ===========================================================================
  // ThreadVariant — existing UI verbatim. Header has Close + Resolve.
  // CommentItem's Reply (+) button calls handleStartReply (regular reply path).
  // ===========================================================================
  const ThreadVariant = (
    <>
      <div className="px-3 py-2 border-b border-ss-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-caption font-medium text-ss-text-secondary">Comment</span>
          {isResolved && (
            <span className="text-caption text-ss-success flex items-center gap-1">
              <CheckmarkCircleSvg style={{ width: 12, height: 12 }} />
              Resolved
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {comments.length > 0 && (
            <button
              type="button"
              data-testid="resolve-thread"
              className="p-1 rounded text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover transition-colors"
              title={isResolved ? 'Unresolve' : 'Resolve'}
              onClick={handleResolve}
            >
              <CheckmarkCircleSvg style={{ width: 16, height: 16 }} />
            </button>
          )}
          <button
            type="button"
            className="p-1 rounded text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover transition-colors"
            title="Close"
            onClick={close}
          >
            <CloseSvg style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {renderCommentsList(handleStartReply)}
      {renderComposeFooter()}
    </>
  );

  // ===========================================================================
  // NoteVariant — legacy notes from XLSX import.
  // Header has Close only (no Resolve — notes are not threads).
  // Per-item Reply buttons are hidden (notes are not threads). A dedicated
  // footer button offers silent promotion: clicking it converts the note to
  // a thread and opens the reply textarea in one motion (Excel-parity UX).
  // ===========================================================================
  const NoteVariant = (
    <>
      <div className="px-3 py-2 border-b border-ss-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-caption font-medium text-ss-text-secondary">Note</span>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="p-1 rounded text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover transition-colors"
            title="Close"
            onClick={close}
          >
            <CloseSvg style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {renderCommentsList(handleConvertAndReply, false)}
      {renderComposeFooter()}

      {localMode === 'view' && comments.length > 0 && (
        <div className="px-3 py-2 border-t border-ss-border shrink-0">
          <Button
            variant="secondary"
            size="sm"
            data-testid="promote-note"
            onClick={() => comments[0] && handleConvertAndReply(comments[0].id)}
            className="w-full"
          >
            <AddSvg style={{ width: 14, height: 14 }} />
            Reply (convert to thread)
          </Button>
        </div>
      )}
    </>
  );

  return (
    <Popover open={isVisible && !!target} onOpenChange={handleOpenChange}>
      <PopoverAnchor virtualRef={virtualRefObject} />
      <PopoverContent
        data-testid="comment-editor"
        side="right"
        align="start"
        sideOffset={8}
        className="w-[280px] max-h-[400px] flex flex-col overflow-hidden p-0"
        onOpenAutoFocus={handleOpenAutoFocus}
        onMouseEnter={handlePopoverMouseEnter}
        onMouseLeave={handlePopoverMouseLeave}
        onPointerDownOutside={(e) => {
          // Prevent closing when interacting with editing controls
          if (localMode === 'edit' || localMode === 'compose' || localMode === 'reply') {
            // Allow closing only if clicking far outside
            const target = e.target as HTMLElement;
            if (target.closest('textarea, input, button')) {
              e.preventDefault();
            }
          }
        }}
      >
        {variant === 'note' ? NoteVariant : ThreadVariant}
      </PopoverContent>
    </Popover>
  );
}

export default CommentPopover;
