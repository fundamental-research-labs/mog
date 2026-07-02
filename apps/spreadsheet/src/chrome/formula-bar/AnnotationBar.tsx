import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { CheckmarkSvg, CloseSvg } from '@mog/icons';
import { COL_HEADER_HEIGHT } from '@mog-sdk/contracts/rendering/constants';
import type { WorksheetCellAnnotationRecord } from '@mog-sdk/contracts/api';

import { useActiveCell, useActiveSheetId, useReadOnly, useWorkbook } from '../../internal-api';

/**
 * AnnotationBar — the cell-annotation popover.
 *
 * This is the natural evolution of the formula bar: where the formula bar shows
 * *how* the active cell is computed, this shows *what it means* — the short
 * natural-language annotation attached to the cell.
 *
 * It follows the active cell and mounts only when that cell has an annotation
 * (matching the "show only when annotation exists" product decision). Rather than
 * occupying a lane that would push the grid down, it *floats* over the top of the
 * grid at `COL_HEADER_HEIGHT`, its left edge aligned with the start of the formula
 * bar's input (just right of `fx`) and its width sized to content (capped), so it
 * never reflows the cells and covers only a few column headers.
 *
 * The chrome deliberately echoes the formula bar to stay quiet: one leading glyph
 * (the `fx` analog) whose *color* carries freshness — neutral when fresh, amber when
 * stale, muted when unchecked — so no separate status dot or chip is needed; and the
 * same ✕ / ✓ signs for actions. When idle and fresh it is just glyph + text. When a
 * stale/unchecked annotation needs attention, a single ✓ "mark up to date" appears.
 * When editing, ✕ / ✓ cancel and confirm the edit.
 *
 * Editing here is inline and deliberately separate from formula editing so a user
 * can never confuse "edit the meaning" with "edit the formula". Because this is the
 * active-cell edit surface (a diagnostic surface), it may show stale/unchecked text
 * — unlike ordinary reads, which hide it. The full-featured editor still lives in the
 * Review → Cell Annotations side panel.
 */

type LoadState = 'loading' | 'ready' | 'saving' | 'error';

function disposeSubscription(subscription: unknown): void {
  if (typeof subscription === 'function') {
    subscription();
    return;
  }
  if (
    subscription &&
    typeof subscription === 'object' &&
    'dispose' in subscription &&
    typeof (subscription as { dispose?: unknown }).dispose === 'function'
  ) {
    (subscription as { dispose: () => void }).dispose();
  }
}

function AnnotationBarImpl(): React.JSX.Element | null {
  const workbook = useWorkbook();
  const sheetId = useActiveSheetId();
  const worksheet = useMemo(() => workbook.getSheetById(sheetId), [workbook, sheetId]);
  const { row, col } = useActiveCell();
  const readOnly = useReadOnly();

  const [record, setRecord] = useState<WorksheetCellAnnotationRecord | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Left offset (px, relative to the grid container) that lines the popover up with
  // the START of the formula bar's input — just right of `fx`. Measured rather than
  // hardcoded because `fx`, the confirm/cancel buttons, and the Name Box all appear
  // or disappear with read-only mode and ribbon visibility toggles.
  const [leftPx, setLeftPx] = useState<number | null>(null);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // Load the active cell's annotation. Diagnostics.get so we can surface stale/
  // unchecked text in this edit surface (ordinary reads would hide it).
  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void (async () => {
      try {
        const next = await worksheet.annotations.cells.diagnostics.get(row, col, {
          includeStale: true,
          includeUnchecked: true,
        });
        if (cancelled) return;
        setRecord(next);
        setState('ready');
      } catch {
        if (cancelled) return;
        setRecord(null);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [col, reloadToken, row, worksheet]);

  // Moving to another cell abandons any in-progress inline edit.
  useEffect(() => {
    setEditing(false);
  }, [col, row, sheetId]);

  // Keep the popover live as annotations and the anchored cell change (freshness).
  useEffect(() => {
    const subscriptions = [
      workbook.on('cellAnnotation:changed', (event: any) => {
        if (event.sheetId === sheetId && event.row === row && event.col === col) reload();
      }),
      workbook.on('cellAnnotations:cleared', (event: any) => {
        if (event.sheetId === sheetId) reload();
      }),
      workbook.on('cell:changed', (event: any) => {
        if (event.sheetId === sheetId && event.row === row && event.col === col) reload();
      }),
      workbook.on('cells:batch-changed', (event: any) => {
        if (
          event.sheetId === sheetId &&
          Array.isArray(event.changes) &&
          event.changes.some((change: any) => change.row === row && change.col === col)
        ) {
          reload();
        }
      }),
    ];
    return () => {
      for (const subscription of subscriptions) disposeSubscription(subscription);
    };
  }, [col, reload, row, sheetId, workbook]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Align the popover's left edge with the formula bar's input field. The input and
  // this popover share the same left origin (both stacked in the app's flex column),
  // and the popover's offsetParent is the grid container, so the input's left edge
  // relative to that container is exactly the offset we want.
  useLayoutEffect(() => {
    const findInput = (): HTMLElement | null =>
      document.querySelector<HTMLElement>('[data-formula-bar] [data-testid="formula-bar-input"]');
    const measure = (): void => {
      const parent = barRef.current?.offsetParent as HTMLElement | null;
      const input = findInput();
      if (!parent || !input) {
        setLeftPx((prev) => prev ?? 0);
        return;
      }
      setLeftPx(input.getBoundingClientRect().left - parent.getBoundingClientRect().left);
    };
    measure();
    // The input is flex-1, so it resizes (and its left edge moves) whenever `fx` or
    // the confirm/cancel buttons show/hide — observing it catches those toggles.
    const input = findInput();
    const observer = input ? new ResizeObserver(measure) : null;
    observer?.observe(input as HTMLElement);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [readOnly, record?.id, editing]);

  const beginEdit = useCallback(() => {
    if (readOnly) return;
    setDraft(record?.text ?? '');
    setEditing(true);
  }, [readOnly, record]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(record?.text ?? '');
  }, [record]);

  const commitEdit = useCallback(async () => {
    if (readOnly) {
      setEditing(false);
      return;
    }
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === (record?.text ?? '')) return; // no change
    setState('saving');
    try {
      if (trimmed.length === 0) {
        await worksheet.annotations.cells.remove(row, col);
        setRecord(null);
      } else {
        const saved = await worksheet.annotations.cells.set(row, col, draft);
        setRecord(saved);
      }
      setState('ready');
    } catch {
      setState('error');
      reload();
    }
  }, [col, draft, readOnly, record, reload, row, worksheet]);

  const acceptStale = useCallback(async () => {
    if (readOnly || !record) return;
    setState('saving');
    try {
      const accepted = await worksheet.annotations.cells.acceptStale(row, col);
      setRecord(accepted);
      setState('ready');
    } catch {
      setState('error');
      reload();
    }
  }, [col, readOnly, record, reload, row, worksheet]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    },
    [cancelEdit, commitEdit],
  );

  // The popover exists only when the active cell has an annotation (or one is being
  // edited into existence). No record → nothing, so plain sheets stay clean.
  if (!record && !editing) return null;

  const status = record?.status ?? 'unchecked';
  const isFresh = status === 'fresh';
  const glyphColor = isFresh
    ? 'text-ss-text-secondary'
    : status === 'stale'
      ? 'text-ss-warning'
      : 'text-ss-text-tertiary';
  const statusTitle = isFresh
    ? 'Annotation is up to date'
    : status === 'stale'
      ? 'Annotation may be out of date — the cell changed since it was written'
      : 'Annotation freshness was not checked';

  // Keep clicks on the action buttons from blurring the input first (which would
  // commit and defeat Cancel). preventDefault on mousedown holds focus on the input.
  const holdFocus = (event: React.MouseEvent): void => event.preventDefault();

  return (
    <div
      ref={barRef}
      data-testid="annotation-bar"
      data-annotation-bar
      role="dialog"
      aria-label="Cell annotation"
      className="absolute top-0 z-20 max-w-[520px] flex items-center gap-1 pl-1 pr-2 border border-ss-border rounded-b-md bg-ss-surface-secondary text-ss-text overflow-hidden shadow-ss-md"
      style={{ height: COL_HEADER_HEIGHT, left: leftPx ?? 0, visibility: leftPx == null ? 'hidden' : undefined }}
    >
      {/* ✕ / ✓ signs — same vocabulary as the formula bar. */}
      {!readOnly && editing ? (
        <>
          <button
            type="button"
            onMouseDown={holdFocus}
            onClick={cancelEdit}
            data-testid="annotation-bar-cancel"
            className="flex items-center justify-center w-[20px] h-[20px] shrink-0 rounded text-ss-error hover:bg-ss-error/10 transition-colors"
            title="Cancel (Escape)"
            aria-label="Cancel edit"
          >
            <CloseSvg className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={holdFocus}
            onClick={() => void commitEdit()}
            data-testid="annotation-bar-confirm"
            className="flex items-center justify-center w-[20px] h-[20px] shrink-0 rounded text-ss-success hover:bg-ss-success/10 transition-colors"
            title="Confirm (Enter)"
            aria-label="Confirm edit"
          >
            <CheckmarkSvg className="w-3.5 h-3.5" />
          </button>
        </>
      ) : !readOnly && !isFresh && record ? (
        <button
          type="button"
          onClick={() => void acceptStale()}
          data-testid="annotation-bar-accept"
          className="flex items-center justify-center w-[20px] h-[20px] shrink-0 rounded text-ss-success hover:bg-ss-success/10 transition-colors"
          title="Mark up to date"
          aria-label="Mark annotation up to date"
        >
          <CheckmarkSvg className="w-3.5 h-3.5" />
        </button>
      ) : null}

      {/* Meaning glyph — the `fx` analog and the edit affordance. Its color
 carries freshness; clicking it opens the inline editor. */}
      <button
        type="button"
        onClick={beginEdit}
        disabled={readOnly || editing}
        data-testid="annotation-bar-glyph"
        className={`flex items-center justify-center w-[18px] h-[18px] shrink-0 rounded transition-colors ${glyphColor} ${
          readOnly || editing ? 'cursor-default' : 'hover:bg-ss-surface-hover cursor-pointer'
        }`}
        title={readOnly ? statusTitle : `${statusTitle} · Click to edit`}
        aria-label={readOnly ? statusTitle : 'Edit annotation'}
      >
        <Tag size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {/* Text / inline editor */}
      {editing ? (
        <input
          ref={inputRef}
          data-testid="annotation-bar-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => void commitEdit()}
          placeholder="Describe this cell…"
          className="flex-1 min-w-0 h-[18px] bg-transparent text-ribbon text-ss-text outline-none placeholder:text-ss-text-tertiary"
          spellCheck
        />
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          disabled={readOnly}
          data-testid="annotation-bar-text"
          className={`flex-1 min-w-0 text-left truncate text-ribbon leading-none cursor-text disabled:cursor-default ${
            isFresh ? 'text-ss-text' : 'italic text-ss-text-secondary'
          }`}
          title={record?.text ?? ''}
        >
          {record?.text ?? ''}
        </button>
      )}
    </div>
  );
}

export const AnnotationBar = memo(AnnotationBarImpl);
