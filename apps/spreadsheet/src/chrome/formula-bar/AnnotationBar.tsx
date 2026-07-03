import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tag, TriangleAlert } from 'lucide-react';
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
 * (the `fx` analog) whose *color* carries freshness — neutral tag when fresh, an amber
 * warning when stale, muted when unchecked — so no separate status dot or chip is
 * needed. When idle and fresh it is just glyph + text.
 *
 * There is no separate "accept stale" control — that operation is subtle and reads as
 * jargon. Instead it is folded into the edit flow: a stale/unchecked note shows the ⚠
 * glyph, and confirming an edit (✓) always means "this note is correct now". If the
 * text changed we save it; if it is unchanged but the note was stale, confirming
 * re-baselines it to the current cell (clearing the warning). So ✓ has one honest
 * meaning whether or not you retyped anything.
 *
 * Editing here is inline and deliberately separate from formula editing so a user
 * can never confuse "edit the meaning" with "edit the formula". Because this is the
 * active-cell edit surface (a diagnostic surface), it may show stale/unchecked text
 * — unlike ordinary reads, which hide it. The full-featured editor still lives in the
 * Review → Cell Annotations side panel.
 */

type LoadState = 'loading' | 'ready' | 'saving' | 'error';

// Cap the expanded popover's text area; beyond this it scrolls. Mirrors the way
// the formula bar bounds a long formula's height rather than growing without end.
const ANNOTATION_BAR_MAX_TEXT_HEIGHT_PX = 140;

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
  // Long-note handling: when expanded the popover drops its single-row height and
  // wraps the text over multiple lines (echoing the formula bar's tall layout).
  const [expanded, setExpanded] = useState(false);
  // Whether the collapsed note is actually truncated — drives whether the expand
  // affordance is shown, so short fresh notes stay just glyph + text.
  const [overflowing, setOverflowing] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const textRef = useRef<HTMLButtonElement | null>(null);
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

  // Moving to another cell abandons any in-progress inline edit and collapses the
  // popover back to its quiet single-row form.
  useEffect(() => {
    setEditing(false);
    setExpanded(false);
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

  // Refocus when editing starts, and when toggling expand mid-edit (which swaps
  // the single-line input for a textarea, dropping DOM focus).
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing, expanded]);

  // Measure whether the collapsed note is truncated so the expand chevron only
  // appears when it buys the user something. Skipped while expanded/editing (the
  // measured element isn't the truncating one then).
  useLayoutEffect(() => {
    if (editing || expanded) {
      return;
    }
    const el = textRef.current;
    if (!el) {
      setOverflowing(false);
      return;
    }
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, [editing, expanded, leftPx, record?.text]);

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
    // A note long enough to truncate is more comfortable to edit wrapped, so open
    // straight into the tall layout.
    if (overflowing) setExpanded(true);
    setEditing(true);
  }, [overflowing, readOnly, record]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(record?.text ?? '');
  }, [record]);

  // Confirming an edit has one meaning: "this note is correct now."
  //  - text changed        → save it (empty removes the note)
  //  - text unchanged+stale → re-baseline to the current cell (clears the warning)
  //  - text unchanged+fresh → nothing to do
  const commitEdit = useCallback(async () => {
    if (readOnly) {
      setEditing(false);
      return;
    }
    setEditing(false);
    const trimmed = draft.trim();
    const current = record?.text ?? '';
    try {
      if (trimmed !== current) {
        setState('saving');
        if (trimmed.length === 0) {
          await worksheet.annotations.cells.remove(row, col);
          setRecord(null);
        } else {
          const saved = await worksheet.annotations.cells.set(row, col, draft);
          setRecord(saved);
        }
        setState('ready');
      } else if (record && record.status !== 'fresh') {
        setState('saving');
        const accepted = await worksheet.annotations.cells.acceptStale(row, col);
        setRecord(accepted);
        setState('ready');
      }
    } catch {
      setState('error');
      reload();
    }
  }, [col, draft, readOnly, record, reload, row, worksheet]);

  // In the tall (multi-line) layout, plain Enter inserts a line break and
  // Cmd/Ctrl+Enter commits — mirroring the formula bar's Ctrl+Enter contract.
  // In the single-line layout Enter commits.
  const isMultiLine = expanded || (editing ? draft : (record?.text ?? '')).includes('\n');

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter') {
        if (isMultiLine && !(event.metaKey || event.ctrlKey)) {
          return; // let the textarea insert a newline
        }
        event.preventDefault();
        void commitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelEdit();
      }
    },
    [cancelEdit, commitEdit, isMultiLine],
  );

  // The popover exists only when the active cell has an annotation (or one is being
  // edited into existence). No record → nothing, so plain sheets stay clean.
  if (!record && !editing) return null;

  const status = record?.status ?? 'unchecked';
  const isFresh = status === 'fresh';
  const isStale = status === 'stale';
  const glyphColor = isFresh
    ? 'text-ss-text-secondary'
    : isStale
      ? 'text-ss-warning'
      : 'text-ss-text-tertiary';
  const GlyphIcon = isStale ? TriangleAlert : Tag;
  const statusTitle = isFresh
    ? 'Annotation is up to date'
    : isStale
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
      className={`absolute top-0 z-20 max-w-[520px] flex gap-1 pl-1 pr-2 border border-ss-border rounded-b-md bg-ss-surface-secondary text-ss-text shadow-ss-md ${
        isMultiLine ? 'items-start py-1' : 'items-center overflow-hidden'
      }`}
      style={{
        height: isMultiLine ? undefined : COL_HEADER_HEIGHT,
        minHeight: COL_HEADER_HEIGHT,
        left: leftPx ?? 0,
        visibility: leftPx == null ? 'hidden' : undefined,
      }}
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
            title={record && record.status !== 'fresh' ? 'Confirm — mark up to date (Enter)' : 'Confirm (Enter)'}
            aria-label="Confirm edit"
          >
            <CheckmarkSvg className="w-3.5 h-3.5" />
          </button>
        </>
      ) : null}

      {/* Meaning glyph — the `fx` analog and the edit affordance. Its color and icon
 carry freshness (amber warning when stale); clicking it opens the inline editor. */}
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
        <GlyphIcon size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {/* Text / inline editor. Both read and edit surfaces switch to a wrapping,
 multi-line form when expanded — the annotation analog of the formula bar
 swapping its single-line input for a word-wrapping textarea on long formulas. */}
      {editing ? (
        isMultiLine ? (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            data-testid="annotation-bar-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void commitEdit()}
            placeholder="Describe this cell…"
            rows={3}
            className="flex-1 min-w-0 resize-none bg-transparent text-ribbon leading-snug text-ss-text outline-none placeholder:text-ss-text-tertiary"
            style={{
              maxHeight: ANNOTATION_BAR_MAX_TEXT_HEIGHT_PX,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
            }}
            spellCheck
          />
        ) : (
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            data-testid="annotation-bar-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void commitEdit()}
            placeholder="Describe this cell…"
            className="flex-1 min-w-0 h-[18px] bg-transparent text-ribbon text-ss-text outline-none placeholder:text-ss-text-tertiary"
            spellCheck
          />
        )
      ) : (
        <button
          type="button"
          ref={textRef}
          onClick={beginEdit}
          disabled={readOnly}
          data-testid="annotation-bar-text"
          className={`flex-1 min-w-0 text-left text-ribbon cursor-text disabled:cursor-default ${
            isMultiLine
              ? 'whitespace-pre-wrap break-words leading-snug overflow-y-auto'
              : 'truncate leading-none'
          } ${isFresh ? 'text-ss-text' : 'text-ss-text-secondary'}`}
          style={isMultiLine ? { maxHeight: ANNOTATION_BAR_MAX_TEXT_HEIGHT_PX } : undefined}
          title={isMultiLine ? undefined : (record?.text ?? '')}
        >
          {record?.text ?? ''}
        </button>
      )}

      {/* Expand / collapse — the annotation twin of the formula bar's chevron.
 Shown only when the note truncates (or is already expanded / being edited), so a
 short fresh note stays quiet. Held focus on mousedown so toggling mid-edit
 doesn't blur-commit the field first. */}
      {(expanded || overflowing || editing) && (
        <button
          type="button"
          onMouseDown={holdFocus}
          onClick={() => setExpanded((value) => !value)}
          data-testid="annotation-bar-expand"
          className="flex items-center justify-center w-[18px] h-[18px] shrink-0 self-start rounded text-ss-text-secondary hover:bg-ss-surface-hover cursor-pointer transition-colors"
          title={expanded ? 'Collapse annotation' : 'Expand annotation'}
          aria-label={expanded ? 'Collapse annotation' : 'Expand annotation'}
          aria-expanded={expanded}
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}

export const AnnotationBar = memo(AnnotationBarImpl);
