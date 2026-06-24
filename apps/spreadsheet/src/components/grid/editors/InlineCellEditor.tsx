/**
 * Inline Cell Editor Component
 *
 * Renders the inline <input> or <textarea> for normal cell editing.
 * This is the WYSIWYG in-cell editor that appears when editing a cell.
 *
 * Key features:
 * - Uses computeTextPosition() for WYSIWYG positioning (single source of truth)
 * - The DOM editor is a "dumb overlay" - just position at computed coordinates
 * - Always renders a <textarea> for both single-line and multi-line editing
 * - Uses outline (not border) to avoid layout shifts
 * - Supports IME composition for CJK input
 *
 * WYSIWYG Architecture:
 * Canvas and DOM both use computeTextPosition() for text positioning.
 * This guarantees visual match - when you click on a cell, the text doesn't shift.
 *
 * Extracted from SpreadsheetGrid.tsx as part of Editor Overlay Decomposition
 *
 * Performance Optimization:
 * Uses granular hooks (useEditorState, useEditorActions, useRendererActions) instead
 * of receiving full editor/renderer objects as props. This eliminates identity-selector
 * re-renders from parent components.
 */

import { useSelector } from '@xstate/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getCellDOMStyle } from '@mog/grid-canvas';
import { getTextMeasurementService } from '@mog/grid-renderer';
import { editorSelectors } from '../../../selectors';
import { resolveCellTextStyle } from '@mog/spreadsheet-utils/cells/cell-style';
import type { CellFormat, CellRange, WorkbookSettings } from '@mog-sdk/contracts/core';
import type { CellFormatChangedEvent } from '@mog-sdk/contracts/events';
import type { ResolvedSheetViewSkin } from '@mog-sdk/contracts/rendering/sheet-view-skin';
import type { TextPosition } from '@mog-sdk/contracts/rendering';
import {
  useCoordinator,
  useEditorActions,
  useEditorState,
  useRendererActions,
  useScrollSyncTransform,
} from '../../../hooks';
import { useActiveSheetId, useEventBus, useWorkbook } from '../../../infra/context';
import { getTheme } from '../../../infra/styles/built-in-themes';
import {
  InlineCellAutocomplete,
  type InlineCellAutocompleteHandle,
} from './InlineCellAutocomplete';
import { resolveInlineEditorDisplayColors } from './editor-display-colors';
import { FormulaHighlighter, type ReferenceColorRange } from '../../editor/FormulaHighlighter';
import { extractFormulaRanges } from '../../../domain/editor/formula-range-parser';
// =============================================================================
// Constants
// =============================================================================

/** A.5: Minimum width for the editor (cell can be smaller but editor expands) */
const MIN_EDITOR_WIDTH = 50;
/** A.5: Extra padding to prevent text from touching the edge */
const EXPANSION_PADDING = 8;
/** A.5: Maximum expansion width to prevent going off screen */
const MAX_EXPANSION_WIDTH = 500;

// Module-level persistent rect — survives React mount/unmount cycles.
// When the editor mounts fresh for a new cell and cellToViewport() initially
// returns null (cell not yet scrolled into view), we fall back to the last
// known rect so the editor stays mounted and keeps keyboard focus while the
// scroll animation completes. Once the animation finishes and
// useScrollSyncTransform fires, the editor is repositioned to the correct
// coordinates via CSS transform.
let _lastKnownCellRect: { x: number; y: number; width: number; height: number } | null = null;

// Module-level off-DOM canvas for measuring textarea content width.
// Reused across renders to avoid per-render allocation. Lazily created so
// SSR/test environments without `document` don't fail at import time.
let _measurementCanvas: HTMLCanvasElement | null = null;
let _measurementContext: CanvasRenderingContext2D | null = null;
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (_measurementContext) return _measurementContext;
  if (typeof document === 'undefined') return null;
  _measurementCanvas = document.createElement('canvas');
  _measurementContext = _measurementCanvas.getContext('2d');
  return _measurementContext;
}

// =============================================================================
// Types
// =============================================================================

interface InlineCellEditorProps {
  workbookSettings: WorkbookSettings;
  rendererSkin: ResolvedSheetViewSkin;
}

// =============================================================================
// Component
// =============================================================================

export function InlineCellEditor({ workbookSettings, rendererSkin }: InlineCellEditorProps) {
  // ===========================================================================
  // GRANULAR HOOKS (Performance Optimization)
  // Using granular hooks instead of full editor/renderer objects to eliminate
  // identity-selector re-renders from parent components.
  // ===========================================================================

  // Workbook API for viewport data access
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const eventBus = useEventBus();

  // Editor state (isEditing, editingCell, value)
  const {
    isEditing,
    editingCell,
    sheetId: editingSheetId,
    value,
    cursorPosition,
    selectionAnchor,
    hasSelection,
  } = useEditorState();
  const isEditingOnActiveSheet = isEditing && editingSheetId === activeSheetId;

  // Editor actions (input, commit, imeStart, imeUpdate, imeEnd)
  const editorActions = useEditorActions();

  // Renderer actions (getGeometry, getZoom)
  const rendererActions = useRendererActions();

  // Get coordinator for direct access to actors
  const coordinator = useCoordinator();
  const editorActor = coordinator.grid.access.actors.editor;

  // Focus state - only subscribe to whether focus is on formula bar
  // When editing via formula bar, we show the editor but don't give it focus (no cursor)
  const focusActor = coordinator.input.access.actors.paneFocus;
  const isFormulaBarFocused = useSelector(focusActor, (state) => state.value === 'formulaBar');

  // Subscribe to mergeBounds separately (not in useEditorState for minimal coupling)
  // This is needed for sizing the editor on merged cells
  const mergeBounds = useSelector(
    editorActor,
    (state): CellRange | null => editorSelectors.mergeBounds(state),
    (a, b) =>
      a === b ||
      (a !== null &&
        b !== null &&
        a.startRow === b.startRow &&
        a.endRow === b.endRow &&
        a.startCol === b.startCol &&
        a.endCol === b.endCol),
  );

  // F.1: Track local IME composing state for styling
  // We use local state rather than editor.isIMEComposing to avoid
  // React re-renders during rapid composition updates.
  const [isComposing, setIsComposing] = useState(false);
  const [imeDisplayValue, setImeDisplayValue] = useState<string | null>(null);
  const imeBaseRef = useRef<{ value: string; cursorPosition: number } | null>(null);
  const isComposingRef = useRef(false);

  // Format change reactivity: when a cell's format changes while editing (e.g.
  // user changes font via toolbar), the viewport buffer updates but nothing in
  // our dependency graph changes. Subscribe to cell:format-changed on the event
  // bus and bump a version counter to invalidate the textPosition useMemo.
  const [formatVersion, setFormatVersion] = useState(0);
  useEffect(() => {
    if (!isEditing || !editingCell) return;
    const editRow = editingCell.row;
    const editCol = editingCell.col;
    return eventBus.on<CellFormatChangedEvent>('cell:format-changed', (event) => {
      if (event.sheetId === activeSheetId && event.row === editRow && event.col === editCol) {
        setFormatVersion((v) => v + 1);
      }
    });
  }, [eventBus, activeSheetId, isEditing, editingCell?.row, editingCell?.col]);

  // A.5: Track expanded width for content that overflows cell bounds
  const [expandedWidth, setExpandedWidth] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const focusedEditSessionRef = useRef<string | null>(null);

  // Scroll sync: wrapper div ref that receives imperative CSS transforms on scroll
  const scrollSyncRef = useRef<HTMLDivElement>(null);

  // A.5: Measure content width and expand editor if needed
  // useLayoutEffect ensures measurement happens before paint
  //
  // Subtlety: textareas with `whiteSpace: pre-wrap` wrap text, so
  // `scrollWidth` always equals `offsetWidth` (the wrapped content fits
  // horizontally by definition). To detect content overflow we measure
  // each line with an off-DOM 2D canvas using the same font the editor
  // renders, since the cell-text formula scenario demands the overlay
  // grow horizontally past cell boundaries (Excel parity, /
  //
  const editorDisplayValue = imeDisplayValue ?? value;

  useLayoutEffect(() => {
    if (!inputRef.current) return;

    // Measure the longest line of `value` against the editor's current
    // font. Reuse a module-level canvas to avoid per-render allocation.
    const lines = editorDisplayValue.length === 0 ? [''] : editorDisplayValue.split('\n');
    let maxLineWidth = 0;
    const fontStr = window.getComputedStyle(inputRef.current).font;
    const ctx = getMeasurementContext();
    if (ctx) {
      ctx.font = fontStr;
      for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxLineWidth) maxLineWidth = w;
      }
    }

    const contentWidth = maxLineWidth + 2 * EXPANSION_PADDING;
    const currentWidth = inputRef.current.offsetWidth;

    // If content is wider than the editor, expand it
    if (contentWidth > currentWidth) {
      // Expand to fit content plus padding, but cap at maximum
      const newWidth = Math.min(contentWidth + EXPANSION_PADDING, MAX_EXPANSION_WIDTH);
      setExpandedWidth(newWidth);
    } else if (expandedWidth !== null) {
      // Content fits - check if we need to shrink back. Compare against the
      // ORIGINAL cell width, not the editor's current bounding rect:
      // getBoundingClientRect() returns the already-expanded width when
      // expandedWidth !== null, so the inequality reduces to
      // `contentWidth <= contentWidth + (pad - pad)` which is always true,
      // producing an expand→shrink→expand infinite loop that crashes the
      // app on any formula wider than its cell.
      // Why: cellWidth comes from the layout coordinator's per-cell rect
      // (kernel state), not the DOM element being mutated.
      const cellWidth = effectiveCellRect?.width;
      if (cellWidth !== undefined && contentWidth <= cellWidth - EXPANSION_PADDING) {
        setExpandedWidth(null);
      }
    }
    // effectiveCellRect intentionally omitted from deps: this effect must
    // re-run only on content change (value) or after expansion (expandedWidth);
    // re-running on every cell-rect identity change would itself be a thrash.
    // The closure captures the latest effectiveCellRect from each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorDisplayValue, expandedWidth]);

  const editSessionKey =
    isEditingOnActiveSheet && editingCell
      ? `${editingSheetId}:${editingCell.row}:${editingCell.col}`
      : null;

  // React autoFocus is not reliable after the grid's double-click path focuses
  // the canvas container first. The inline textarea owns the edit keystream, so
  // focus it once when a new in-cell edit session mounts.
  useLayoutEffect(() => {
    if (!editSessionKey || isFormulaBarFocused) {
      focusedEditSessionRef.current = null;
      return;
    }
    const el = inputRef.current;
    if (!el || focusedEditSessionRef.current === editSessionKey) return;

    focusedEditSessionRef.current = editSessionKey;
    const selectionStart = hasSelection
      ? Math.min(cursorPosition, selectionAnchor)
      : cursorPosition;
    const selectionEnd = hasSelection ? Math.max(cursorPosition, selectionAnchor) : cursorPosition;
    el.focus({ preventScroll: true });
    if (el.selectionStart !== selectionStart || el.selectionEnd !== selectionEnd) {
      el.setSelectionRange(selectionStart, selectionEnd);
    }
  }, [editSessionKey, isFormulaBarFocused, cursorPosition, selectionAnchor, hasSelection]);

  // Sync textarea cursor position from editor state.
  //
  // The machine is authoritative for the cursor — but only for *programmatic*
  // moves (selectAll, formula range insert, moveCursorLeft, IME commit, etc.).
  // During native typing the DOM is already correct because the INPUT event
  // now mirrors the real `selectionStart` into the machine. The no-op guard
  // is required: without it, every keystroke triggers a redundant
  // `setSelectionRange` mid-input and reintroduces the original
  // mid-string-edit corruption under timing edge cases (IME, rapid input,
  // browser caret updates that have not yet flushed).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || !isEditing || isFormulaBarFocused) return;
    const selectionStart = hasSelection
      ? Math.min(cursorPosition, selectionAnchor)
      : cursorPosition;
    const selectionEnd = hasSelection ? Math.max(cursorPosition, selectionAnchor) : cursorPosition;
    if (el.selectionStart !== selectionStart || el.selectionEnd !== selectionEnd) {
      el.setSelectionRange(selectionStart, selectionEnd);
    }
  }, [cursorPosition, selectionAnchor, hasSelection, isFormulaBarFocused, isEditing]);

  // Get theme for styling
  const theme = getTheme(workbookSettings.themeId);

  // Get current zoom level for WYSIWYG font scaling
  const zoom = rendererActions.getZoom();

  // Compute cell rect (memoized) — needed for scroll sync hook and positioning
  const cellRect = useMemo(() => {
    if (!isEditingOnActiveSheet || !editingCell) return null;

    const geometry = rendererActions.getGeometry();
    if (!geometry) return null;

    if (mergeBounds) {
      const rects = geometry.getRangeRects(mergeBounds);
      return rects[0] ?? null;
    } else {
      return geometry.getCellRect(editingCell);
    }
  }, [isEditingOnActiveSheet, editingCell, mergeBounds, activeSheetId, rendererActions]);

  // Keep the last known non-null cellRect so the editor stays mounted during
  // scroll animations (e.g. the 100ms animateScrollTo triggered by
  // setupEditorScrollCoordination). When cellToViewport transiently returns
  // null because the cell is momentarily outside the rendered viewport, we fall
  // back to the stale rect. useScrollSyncTransform will update the CSS
  // transform imperatively once the cell comes back into view, so the visual
  // position stays correct even though React didn't re-render.
  //
  // We use a module-level variable (_lastKnownCellRect) rather than a useRef
  // so the fallback survives component unmount/remount cycles. Without this,
  // the first render for a new cell (after the component remounts) would see
  // lastCellRectRef.current = null, effectiveCellRect = null, and immediately
  // return null again — defeating the whole purpose of the fallback.
  if (cellRect !== null) {
    _lastKnownCellRect = cellRect;
  }
  const effectiveCellRect = isEditingOnActiveSheet ? (cellRect ?? _lastKnownCellRect) : null;

  // Scroll sync: imperatively track cell position on scroll via CSS transform
  // Must be called before early returns (rules of hooks)
  useScrollSyncTransform(
    scrollSyncRef,
    activeSheetId,
    editingCell,
    mergeBounds,
    effectiveCellRect ? { x: effectiveCellRect.x, y: effectiveCellRect.y } : null,
  );

  // =========================================================================
  // FORMULA AUTOCOMPLETE (sibling component — H6 fix)
  // Autocomplete lives in a sibling component (InlineCellAutocomplete) to
  // eliminate the duplicate subscription to value/cursorPosition that
  // occurred when useFormulaAutocomplete() and useEditorState() both
  // subscribed to the same editor actor fields in this component.
  // The sibling exposes a keyboard interceptor and input element setter
  // via imperative handle.
  // =========================================================================
  const autocompleteRef = useRef<InlineCellAutocompleteHandle>(null);

  // Set the input element ref for both local measurement and autocomplete positioning
  const handleInputRef = useCallback((el: HTMLInputElement | HTMLTextAreaElement | null) => {
    (inputRef as React.MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>).current =
      el;
    autocompleteRef.current?.setInputElement(el);
  }, []);

  // Handle keyboard events: delegate to autocomplete first, then handle local keys.
  // Depends only on stable refs — no unstable object deps (M10 fix).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Let autocomplete handle suggestion navigation keys first
      if (autocompleteRef.current?.handleKeyDown(e)) {
        return;
      }

      if ((e.key === 'Home' || e.key === 'End') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.currentTarget;
        const target = e.key === 'Home' ? 0 : el.value.length;
        e.preventDefault();

        if (e.shiftKey) {
          const anchor = el.selectionStart ?? cursorPosition;
          el.setSelectionRange(Math.min(anchor, target), Math.max(anchor, target));
          editorActor.send({
            type: 'TEXT_SELECTION_CHANGED',
            anchor,
            cursorPosition: target,
          });
          return;
        }

        el.setSelectionRange(target, target);
        editorActions.setCursor(target);
        return;
      }

      // Alt+Enter: pre-apply newline to DOM before React reconciliation
      if (e.key === 'Enter' && e.altKey) {
        const textarea = inputRef.current as HTMLTextAreaElement | null;
        if (textarea) {
          const selStart = textarea.selectionStart ?? textarea.value.length;
          const selEnd = textarea.selectionEnd ?? textarea.value.length;
          textarea.setRangeText('\n', selStart, selEnd, 'end');
        }
      }
    },
    [cursorPosition, editorActions, editorActor],
  );

  // WYSIWYG: Compute text position using the SINGLE SOURCE OF TRUTH
  // This is the same computation canvas uses, guaranteeing visual match
  const textPosition = useMemo((): TextPosition | null => {
    if (!effectiveCellRect || !editingCell) return null;

    // Get cell value and format
    const cellData = ws.viewport.getCellData(editingCell.row, editingCell.col);
    const cellValue = cellData?.value ?? null;
    const cellFormat = (cellData?.format ?? undefined) as CellFormat | undefined;

    // Compute position using TextMeasurementService - the SINGLE SOURCE OF TRUTH
    // Pass zoom level so DOM editor font scales to match canvas rendering
    const textMeasurementService = getTextMeasurementService();
    return textMeasurementService.computeTextPosition({
      text: editorDisplayValue,
      value: cellValue,
      format: cellFormat,
      cellBounds: effectiveCellRect,
      theme,
      zoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCellRect, editorDisplayValue, editingCell, ws, theme, zoom, formatVersion]);

  // Compute suggestions position below the cell being edited
  // Must be before early return to satisfy Rules of Hooks
  const suggestionsPosition = useMemo(() => {
    if (!effectiveCellRect) return { x: 0, y: 0 };
    return { x: effectiveCellRect.x, y: effectiveCellRect.y + effectiveCellRect.height + 2 };
  }, [effectiveCellRect]);

  const referenceColors = useMemo((): ReferenceColorRange[] | undefined => {
    if (!value.startsWith('=')) {
      return undefined;
    }

    const ranges = extractFormulaRanges(value);
    if (ranges.length === 0) {
      return undefined;
    }

    return ranges.map((ref) => ({
      startPos: ref.startPos,
      endPos: ref.endPos,
      color: ref.color,
    }));
  }, [value]);

  const syncDomSelection = useCallback(
    (el: HTMLInputElement | HTMLTextAreaElement) => {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start === null || end === null) return;
      if (start !== end) {
        editorActor.send({ type: 'TEXT_SELECTION_CHANGED', anchor: start, cursorPosition: end });
        return;
      }
      if (start !== cursorPosition || hasSelection) {
        editorActions.setCursor(start);
      }
    },
    [cursorPosition, editorActions, editorActor, hasSelection],
  );

  // Only render when editing and have a cell.
  // Use effectiveCellRect (falls back to last known rect during scroll animations)
  // so the editor stays mounted — and keyboard-focused — while animateScrollTo()
  // temporarily pushes the cell outside the rendered viewport. Without this,
  // InlineCellEditor unmounts, the textarea loses focus, and subsequent typed
  // characters are silently dropped.
  if (!isEditingOnActiveSheet || !editingCell || !effectiveCellRect) {
    return null;
  }

  // Get cell format for styling
  const cellData2 = ws.viewport.getCellData(editingCell.row, editingCell.col);
  const cellFormat = (cellData2?.format ?? undefined) as CellFormat | undefined;
  const cellValue = cellData2?.value ?? null;

  // Get resolved style for font, color, and background
  const style = resolveCellTextStyle(cellFormat, cellValue);
  const editorColors = resolveInlineEditorDisplayColors(cellFormat, rendererSkin);

  // Always use textarea — supports both single-line and multi-line editing

  // A.5: Calculate final editor width (expanded or original cell width)
  // Use whichever is larger: cell width, expanded width, or minimum width
  const editorWidth = Math.max(
    MIN_EDITOR_WIDTH,
    expandedWidth ?? effectiveCellRect.width,
    effectiveCellRect.width,
  );

  // WYSIWYG fallback: Use getCellDOMStyle if textPosition is not available
  // This maintains backwards compatibility while we transition to computeTextPosition
  const cellStyles = getCellDOMStyle(
    cellFormat,
    effectiveCellRect.height,
    editorColors.backgroundColor,
    theme,
    undefined,
    undefined,
    cellValue,
  );

  // Compute paddingTop for vertical alignment in textarea
  // Textarea is a replaced element — display:flex/alignItems has no effect on its
  // internal text positioning. We use paddingTop to push text to the correct position.
  const lineCount = (editorDisplayValue.match(/\n/g) || []).length + 1;
  const scaledFontSize = textPosition ? textPosition.scaledFontSize : style.fontSize;
  const scaledLineHeight = scaledFontSize * 1.2; // DEFAULT_LINE_HEIGHT_FACTOR
  const totalTextHeight = lineCount * scaledLineHeight;
  const paddingY = style.paddingX; // Canvas uses paddingX for vertical too
  const remainingLineBoxSpace = effectiveCellRect.height - totalTextHeight;

  let verticalPaddingTop: number;
  switch (style.verticalAlign) {
    case 'top':
      verticalPaddingTop = paddingY;
      break;
    case 'middle':
      verticalPaddingTop = Math.max(0, remainingLineBoxSpace / 2);
      break;
    case 'bottom':
    default:
      verticalPaddingTop = Math.max(0, remainingLineBoxSpace);
      break;
  }

  // Single source of truth for the editor's glyph typography. BOTH the
  // caret-owning <textarea> and (for formulas) the FormulaHighlighter overlay
  // read from this, so the visible text and the caret can never drift out of
  // size/baseline alignment again.
  //
  // The size is the cell's *resolved* font scaled by zoom (textPosition.
  // scaledFont) — never a hardcoded value — so large user fonts and any zoom
  // level flow through to the editor automatically.
  //
  // IMPORTANT: never merge this with `undefined` font longhands in the same
  // style object. React writes '' for undefined style values, and a trailing
  // `fontFamily: undefined` after the `font` shorthand clears the shorthand,
  // collapsing the layer back to the inherited 16px default (the regression
  // that made formula text huge and misaligned).
  const textTypography: React.CSSProperties = textPosition
    ? { font: textPosition.scaledFont, lineHeight: `${scaledLineHeight}px` }
    : {
        fontFamily: cellStyles.fontFamily,
        fontSize: cellStyles.fontSize,
        fontWeight: cellStyles.fontWeight,
        lineHeight: cellStyles.lineHeight,
      };

  const baseEditorStyle = textPosition
    ? {
        // WYSIWYG: Use exact position from computeTextPosition()
        // This is the same position canvas draws text at
        position: 'absolute' as const,
        left: effectiveCellRect.x,
        top: effectiveCellRect.y,
        // Editor spans full cell width for user interaction
        width: editorWidth,
        height: effectiveCellRect.height,
        // Typography from resolved style - use scaledFont for zoom-correct rendering
        // Canvas uses ctx.scale(zoom) to scale text; DOM needs explicit font size scaling
        ...textTypography,
        color: editorColors.textColor,
        backgroundColor: editorColors.backgroundColor,
        // Padding matching canvas
        paddingLeft: style.paddingX,
        paddingRight: style.paddingX,
        // Border/margin reset
        border: 'none',
        margin: 0,
        boxSizing: 'border-box' as const,
        // Text alignment - uses CSS alignment to match computeTextPosition
        textAlign: style.textAlign,
        // Vertical alignment via computed paddingTop
        // (flexbox display/alignItems has no effect on textarea internal text)
        paddingTop: verticalPaddingTop,
        // Textarea styles (always applied)
        resize: 'none' as const,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap' as const,
      }
    : {
        // Fallback to CSS-based positioning (for backwards compatibility)
        position: 'absolute' as const,
        left: effectiveCellRect.x,
        top: effectiveCellRect.y,
        width: editorWidth,
        height: effectiveCellRect.height,
        ...cellStyles,
        color: editorColors.textColor,
        backgroundColor: editorColors.backgroundColor,
        lineHeight: `${scaledLineHeight}px`,
        // Override any flex/alignment from cellStyles — use paddingTop instead
        paddingTop: verticalPaddingTop,
        // Textarea styles (always applied)
        resize: 'none' as const,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap' as const,
      };
  const isFormulaOverlay = value.startsWith('=');

  // Common props for both input and textarea
  const deriveCompositionText = (nextValue: string): string => {
    const base = imeBaseRef.current;
    if (!base) return nextValue;

    const before = base.value.slice(0, base.cursorPosition);
    const after = base.value.slice(base.cursorPosition);
    if (nextValue.startsWith(before) && nextValue.endsWith(after)) {
      return nextValue.slice(before.length, nextValue.length - after.length);
    }
    return nextValue;
  };

  const renderCompositionValue = (compositionText: string): string => {
    const base = imeBaseRef.current ?? { value, cursorPosition };
    return (
      base.value.slice(0, base.cursorPosition) +
      compositionText +
      base.value.slice(base.cursorPosition)
    );
  };

  const editorProps = {
    // A.5: Add ref for measuring content width + autocomplete positioning
    ref: handleInputRef,
    // / app-eval instrumentation: stable test-id so the
    // `__dt.getCellEditorBuffer()` readback can identify the active cell
    // editor input via `activeElement.getAttribute('data-testid')`. Used
    // by alt-mode "no-leak" scenarios that assert the keystream did not
    // bleed into the editor while a different mode owned the keys.
    'data-testid': 'inline-cell-editor',
    // The textarea is a focusable overlay that owns its own pointer behavior:
    // a click landing on it must position the text caret / drag a selection,
    // NOT be reinterpreted by the grid's native pointerdown path. Without this
    // opt-out, clicking inside the cell you are currently editing bubbles to
    // the grid container listener (use-grid-mouse handlePointerDown), which —
    // while editing — preventDefault()s the native caret placement and routes
    // the click through interceptCellClick. In edit mode (e.g. after a
    // double-click) that path sends COMMIT, so the click silently commits the
    // formula and exits the editor instead of moving the caret. Clicks on OTHER
    // cells land on the canvas (no data-no-grid-pointer) and still flow through
    // the grid for commit-and-move / formula-reference insertion.
    'data-no-grid-pointer': true,
    // Only auto-focus when not editing via formula bar
    // When formula bar has focus, show the editor but don't steal focus
    autoFocus: !isFormulaBarFocused,
    value: editorDisplayValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (isComposingRef.current) {
        const nextValue = e.target.value;
        const compositionText = deriveCompositionText(nextValue);
        setImeDisplayValue(nextValue);
        editorActions.imeUpdate(compositionText);
        return;
      }
      editorActions.input(e.target.value, e.target.selectionStart ?? e.target.value.length);
    },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      syncDomSelection(e.currentTarget);
    },
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        syncDomSelection(e.currentTarget);
      }
    },
    // Autocomplete keyboard routing: Tab/Arrow/Escape when suggestions are open.
    // When suggestions are closed, KeyboardCoordinator handles navigation keys at document level.
    onKeyDown: handleKeyDown,
    // No onBlur: blur is a side effect, not an intent. The editor stays open
    // until an explicit user action (Enter / Tab / Esc / click another cell)
    // triggers COMMIT / CANCEL via dedicated dispatch paths:
    // - Keyboard: handled by editing keymap (COMMIT_ENTER, COMMIT_TAB, ...)
    // - Click another cell: setupEditingInputInterception → COMMIT
    // - Sheet switch (non-formula): setupSheetSwitchCoordination → COMMIT
    // - Dialog open: DIALOG_OPENED event pauses editor
    // The IME carveout lives in the machine's imeComposing state.
    // IME composition events for CJK input
    // These events fire BEFORE the 'input' event during IME composition.
    // The editor machine transitions to imeComposing state to:
    // 1. Prevent shortcuts from firing during composition (Layer 2 defense)
    // 2. Track composition text for cross-browser consistency
    // F.1: Also update local isComposing state for CSS styling
    onCompositionStart: () => {
      isComposingRef.current = true;
      setIsComposing(true);
      imeBaseRef.current = { value, cursorPosition };
      setImeDisplayValue(value);
      editorActions.imeStart();
    },
    onCompositionUpdate: (e: React.CompositionEvent) => {
      if (typeof e.data === 'string' && e.data.length > 0) {
        setImeDisplayValue(renderCompositionValue(e.data));
        editorActions.imeUpdate(e.data);
      }
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const finalText = e.data || deriveCompositionText(e.currentTarget.value);
      isComposingRef.current = false;
      setIsComposing(false);
      setImeDisplayValue(null);
      imeBaseRef.current = null;
      editorActions.imeUpdate(finalText);
      editorActions.imeEnd(finalText);
    },
    // ARCHITECTURE: Canvas owns all cell border rendering (selection-layer.ts)
    // The InlineCellEditor is a "transparent text overlay" with no visual border.
    // This eliminates the double-border issue when editing via formula bar.
    // F.1: Add 'ime-composing' class during IME composition for visual styling
    className: `absolute z-ss-overlay pointer-events-auto outline-none${isComposing ? ' ime-composing' : ''}`,
    style: isFormulaOverlay
      ? {
          ...baseEditorStyle,
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          color: 'transparent',
          // The parent formula-edit-overlay div paints the opaque cell fill, so
          // the textarea itself MUST be transparent — otherwise its opaque
          // background would cover the FormulaHighlighter glyphs beneath it.
          backgroundColor: 'transparent',
          caretColor: editorColors.textColor,
          // Sit ABOVE the highlighter overlay (zIndex:2). The native text caret
          // is painted in this textarea's layer; any element stacked above it —
          // even a transparent one — occludes the caret. Keeping the textarea
          // on top makes the caret visible while the (transparent-text) value
          // still lets the highlighter's colored glyphs show through.
          zIndex: 3,
        }
      : baseEditorStyle,
  };

  // Wrap in scroll-sync container: absolute inset-0 so child absolute positioning
  // is relative to the grid container. The container receives imperative CSS transforms
  // on scroll to keep the editor aligned with its cell.
  // pointer-events-none on wrapper, pointer-events-auto on editor for correct hit testing.
  //
  // z-index:1 is required because will-change:transform creates a new CSS stacking
  // context, making position:fixed descendants (FunctionSuggestions autocomplete)
  // participate in *this* stacking context rather than the viewport root. The
  // canvas elements are appended to the grid container after React renders (via
  // useEffect / coordinator.renderer.mount), so they sit last in DOM order and
  // would otherwise cover the autocomplete at z-index:auto. A z-index of 1
  // ensures this wrapper (and its autocomplete child) stack above the canvas while
  // remaining below all modals (z-ss-overlay: 300, z-ss-modal: 1000).

  return (
    <div
      ref={scrollSyncRef}
      className="absolute inset-0 pointer-events-none"
      style={{ willChange: 'transform', zIndex: 1 }}
    >
      {isFormulaOverlay ? (
        <div
          data-testid="formula-edit-overlay"
          className="absolute pointer-events-none"
          style={{
            left: effectiveCellRect.x,
            top: effectiveCellRect.y,
            width: editorWidth,
            height: effectiveCellRect.height,
            backgroundColor: editorColors.backgroundColor,
          }}
        >
          <div
            className="absolute inset-0 overflow-hidden"
            style={{
              // Same typography object the caret-owning textarea uses, so the
              // highlighted formula text renders at the exact size/baseline as
              // the caret (and as the canvas would draw it).
              ...textTypography,
              paddingLeft: style.paddingX,
              paddingRight: style.paddingX,
              paddingTop: verticalPaddingTop,
              color: editorColors.textColor,
              textAlign: style.textAlign,
              whiteSpace: 'pre-wrap',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <FormulaHighlighter
              formula={value}
              cursorPosition={cursorPosition}
              isEditing
              referenceColors={referenceColors}
            />
          </div>
          {React.createElement('textarea', editorProps)}
        </div>
      ) : (
        React.createElement('textarea', editorProps)
      )}

      {/* Formula autocomplete — sibling component with its own subscription (H6 fix) */}
      <InlineCellAutocomplete
        ref={autocompleteRef}
        isFormulaBarFocused={isFormulaBarFocused}
        suggestionsPosition={suggestionsPosition}
      />
    </div>
  );
}
