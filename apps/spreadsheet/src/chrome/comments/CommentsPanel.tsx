/**
 * CommentsPanel — right-side pane that lists comments in the active sheet.
 *
 * Build target for the chrome-symmetry contract:
 * - Panel root: `data-testid="panel-comments"` (assertable visibility)
 * - Visible close affordance: `data-testid="panel-comments-close"`
 * - Reopen affordance: View ribbon `[data-action="open-panel-comments"]`
 * (also tagged `data-testid="panel-comments-reopen"` per the contract).
 *
 * The pane is read-only today: it lists the active sheet's comments with
 * author + body + cell address, plus an empty-state when none exist. New
 * comments are still authored via the inline CommentPopover (Shift+F2 /
 * right-click "New comment"), which is unchanged. Reply / resolve land in
 * a follow-up — the open/close lifecycle works fully today.
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import { toPlainText } from '@mog/spreadsheet-utils/rich-text';

import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';

interface CommentSummary {
  id: string;
  text: string;
  author: string | null;
  cellAddress: string;
}

function isTextRunArray(value: unknown): value is Array<{ text: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (run) =>
        typeof run === 'object' && run !== null && 'text' in run && typeof run.text === 'string',
    )
  );
}

function normalizeCommentBodyValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (isTextRunArray(value)) return toPlainText(value);
  return '';
}

function getCommentBodyText(comment: any): string {
  return (
    normalizeCommentBodyValue(comment.content) ??
    normalizeCommentBodyValue(comment.text) ??
    normalizeCommentBodyValue(comment.body) ??
    normalizeCommentBodyValue(comment.runs) ??
    ''
  );
}

function CommentsPanelImpl() {
  const wb = useWorkbook();
  const sheetId = useActiveSheetId();
  const ws = useMemo(() => wb.getSheetById(sheetId), [wb, sheetId]);

  const setCommentsPanelVisible = useUIStore((s) => s.setCommentsPanelVisible);
  const setShowAllComments = useUIStore((s) => s.setShowAllComments);

  const [items, setItems] = useState<CommentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const list = await ws.comments.list();
        if (cancelled) return;
        const summary: CommentSummary[] = (list ?? []).map((c: any) => ({
          id: String(c.id ?? c.commentId ?? `${c.row},${c.col}`),
          text: getCommentBodyText(c),
          author: c.author ?? null,
          cellAddress:
            typeof c.row === 'number' && typeof c.col === 'number' ? toA1(c.row, c.col) : '',
        }));
        setItems(summary);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws]);

  useEffect(() => {
    return reload();
  }, [reload]);

  // Refresh on comment-related events. The `commentChanged` family is
  // emitted by the kernel after the bridge applies a comment mutation.
  useEffect(() => {
    const handlers: Array<() => void> = [];
    const subscribe = (event: string) => {
      try {
        const off = ws.on(event as any, () => reload());
        if (typeof off === 'function') handlers.push(off);
      } catch {
        // Some events may not exist on this kernel build; the panel
        // still works, it just won't auto-refresh on that channel.
      }
    };
    subscribe('commentChanged');
    subscribe('comments:changed');
    subscribe('cellChanged');
    return () => {
      for (const off of handlers) off();
    };
  }, [ws, reload]);

  const handleClose = useCallback(() => {
    setCommentsPanelVisible(false);
    setShowAllComments(false);
  }, [setCommentsPanelVisible, setShowAllComments]);

  return (
    <aside
      data-testid="panel-comments"
      role="complementary"
      aria-label="Comments"
      className="flex flex-col w-[280px] h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
    >
      {/* Header with title + visible close button (chrome-symmetry contract) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border bg-ss-surface-secondary shrink-0">
        <h2 className="text-subtitle font-semibold text-ss-text m-0">Comments</h2>
        <button
          type="button"
          onClick={handleClose}
          data-testid="panel-comments-close"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          aria-label="Close comments pane"
          title="Close (Esc)"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-body-sm text-ss-text-tertiary">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-4 text-body-sm text-ss-text-tertiary">
            No comments in this sheet yet. Right-click a cell and choose "New comment", or press
            Shift+F2.
          </div>
        ) : (
          <ul className="m-0 p-0 list-none">
            {items.map((c) => (
              <li
                key={c.id}
                className="px-4 py-3 border-b border-ss-border hover:bg-ss-surface-hover"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-body-sm font-medium text-ss-text">
                    {c.author ?? 'Unknown'}
                  </span>
                  {c.cellAddress && (
                    <span className="text-ribbon-compact text-ss-text-tertiary">
                      {c.cellAddress}
                    </span>
                  )}
                </div>
                <div className="text-body-sm text-ss-text whitespace-pre-wrap">{c.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export const CommentsPanel = memo(CommentsPanelImpl);
