/**
 * FormulaBarContainer Component
 *
 * Container component that bridges the editor state machine to the presentational FormulaBar.
 * This ensures the formula bar uses the same editing state as OptimizedGridV2, fixing the
 * bug where edits always went to A1 regardless of selected cell.
 *
 * Architecture: See docs/renderer/README.md - Machine Owns State, Coordinator Owns Execution
 *
 * ONE API Migration: Uses Worksheet (ws.getCell, ws.getRawCellData, ws.getValueForEditing,
 * ws.viewport.getActiveCellData) and Workbook (wb.on('structureChanged')) instead of
 * domain-layer Cells imports. Fully migrated to Workbook/Worksheet API.
 *
 * Excel parity quickwin B5: Formula Bar Context Menu
 * - Local state management for context menu position
 * - Text operations (Cut/Copy/Paste) via native browser APIs
 * - Insert Function via unified action system
 *
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useActionDependencies,
  useActiveCell,
  useActiveSheetId,
  useCoordinator,
  useEditorActions,
  useEditorState,
  useFocus,
  useReadOnly,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { CellFormat, CellValue } from '@mog-sdk/contracts/core';
import { toA1 } from '@mog/spreadsheet-utils/a1';
import { ensureFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import { dispatch } from '../../actions';
import { FormulaArgumentHint } from '../../components/editor/FormulaArgumentHint';
import type { ReferenceColorRange } from '../../components/editor/FormulaHighlighter';
import { FunctionSuggestions } from '../../components/editor/FunctionSuggestions';
import { resolveCalculatedColumnCellContext } from '../../coordinator/tables/calculated-column-context';
import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { extractFormulaRanges } from '../../domain/editor/formula-range-parser';
import { useFormulaAutocomplete } from '../../hooks/editing/use-formula-autocomplete';
import { useFormulaBarContextMenuActions } from '../../hooks/toolbar/use-formula-bar-context-menu-actions';
import {
  FORMULA_BAR_REFRESH_REQUESTED,
  type FormulaBarRefreshDetail,
} from '../../infra/events/formula-bar-refresh';
import { FormulaBar } from './FormulaBar';
import { FormulaBarContextMenu } from './FormulaBarContextMenu';
import { subscribeToFormulaBarWorkbookRefreshes } from './formula-bar-refresh-subscriptions';
// =============================================================================
// Component
// =============================================================================

function isStructuredReferenceFormula(formula: string): boolean {
  return /\[[^\]]+\]/.test(formula);
}

/**
 * Container that connects the FormulaBar to the editor state machine.
 *
 * Must be rendered inside SpreadsheetCoordinatorProvider.
 *
 * @example
 * ```tsx
 * <SpreadsheetCoordinatorProvider>
 * <FormulaBarContainer />
 * <OptimizedGridV2 />
 * </SpreadsheetCoordinatorProvider>
 * ```
 */
/**
 * FormulaBarContainer - Performance Optimized
 *
 * This component uses granular subscriptions to minimize re-renders:
 * - useActiveCell() for active cell position (only re-renders on position change)
 * - useEditorState() for editing state (granular hook, avoids identity selector)
 * - useEditorActions() for editor actions (stable references, no re-renders)
 *
 * It does NOT use useSelection() which would cause re-renders on every
 * selection range change (591 re-renders during drag operations).
 *
 */
function FormulaBarContainerImpl() {
  const readOnly = useReadOnly();

  // PREFERRED: Granular hooks for better performance
  const { isEditing, value } = useEditorState();
  const editorActions = useEditorActions();

  // Granular subscription: only re-renders when active cell position changes
  // NOT when selection ranges change during drag operations
  const { row: activeCellRow, col: activeCellCol, activeCell } = useActiveCell();
  const wb = useWorkbook();
  const coordinator = useCoordinator();
  const paneFocusCommands = coordinator.input.access.commands.paneFocus;
  const activeSheetId = useActiveSheetId();
  const focus = useFocus();
  const deps = useActionDependencies();
  const ws = wb.getSheetById(activeSheetId);

  // Protection alert for blocked edits
  const showProtectionAlert = useUIStore((s) => s.showProtectionAlert);

  // Formula Bar Expand/Collapse (Ctrl+Shift+U)
  const formulaBarExpanded = useUIStore((s) => s.formulaBarExpanded);
  const formulaBarHeightPx = useUIStore((s) => s.formulaBarHeightPx);
  const toggleFormulaBarExpand = useUIStore((s) => s.toggleFormulaBarExpand);
  const setFormulaBarHeightPx = useUIStore((s) => s.setFormulaBarHeightPx);

  // NL Formula Bar toggle
  const nlBarVisible = useUIStore((s) => s.nlBarVisible);
  const toggleNLBar = useUIStore((s) => s.toggleNLBar);

  // Chrome-symmetry: close affordance lives on the formula bar; reopen via
  // View ribbon "Show formula bar" (data-action="open-panel-formula-bar").
  const setFormulaBarVisible = useUIStore((s) => s.setFormulaBarVisible);
  const handleClosePanel = useCallback(() => {
    setFormulaBarVisible(false);
  }, [setFormulaBarVisible]);

  // Autocomplete hook
  const autocomplete = useFormulaAutocomplete();

  // Ref to pass to FormulaBar for autocomplete positioning and context menu actions
  const inputRef = useRef<HTMLInputElement>(null);

  // ==========================================================================
  // Context Menu State (Excel parity quickwin B5)
  // ==========================================================================

  // Local state for context menu (not global UIStore)
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({ isOpen: false, x: 0, y: 0 });

  // Context menu actions hook
  const contextMenuActions = useFormulaBarContextMenuActions(inputRef);

  // Structure version for reactivity when row/column structure changes
  // This forces rawValue to recompute when cell positions change
  const [structureVersion, setStructureVersion] = useState(0);

  // Subscribe to structure changes that affect cell positions
  useEffect(() => {
    const unsub = wb.on('structureChanged', () => setStructureVersion((v) => v + 1));
    return unsub;
  }, [wb]);

  // When sheet references are rewritten, the formula bar must re-fetch the active
  // cell's formula text even if the active cell position hasn't changed.
  useEffect(() => {
    return subscribeToFormulaBarWorkbookRefreshes(wb, () => setStructureVersion((v) => v + 1));
  }, [wb]);

  useEffect(() => {
    const clipboardActor = coordinator.grid.access.actors.clipboard;
    let wasPasting = clipboardActor.getSnapshot().matches('pasting');
    const sub = clipboardActor.subscribe((snapshot) => {
      const isPasting = snapshot.matches('pasting');
      if (wasPasting && !isPasting) {
        setStructureVersion((v) => v + 1);
      }
      wasPasting = isPasting;
    });
    return () => sub.unsubscribe();
  }, [coordinator]);

  // The active-cell useEffect below depends on (activeCellRow, activeCellCol),
  // so it doesn't re-fire when the value at the same cell changes (e.g. paste
  // into the currently selected cell). Subscribe to cellChanged for the active
  // position and bump structureVersion to force the cellData re-fetch.
  useEffect(() => {
    const eventTouchesCell = (
      ev: {
        row?: number;
        col?: number;
        changes?: Array<{ row: number; col: number }>;
      },
      cell: { row: number; col: number },
    ) => {
      if (typeof ev.row === 'number' && typeof ev.col === 'number') {
        return ev.row === cell.row && ev.col === cell.col;
      }
      return ev.changes?.some((c) => c.row === cell.row && c.col === cell.col) ?? false;
    };
    const unsub = wb.on('cellChanged', (event) => {
      const currentActiveCell =
        coordinator.grid.access.actors.selection.getSnapshot().context.activeCell;
      const ev = event as {
        sheetId?: string;
        row?: number;
        col?: number;
        changes?: Array<{ row: number; col: number }>;
      };
      if (ev.sheetId && ev.sheetId !== activeSheetId) return;
      if (eventTouchesCell(ev, currentActiveCell)) {
        setStructureVersion((v) => v + 1);
        return;
      }

      window.setTimeout(() => {
        const settledActiveCell =
          coordinator.grid.access.actors.selection.getSnapshot().context.activeCell;
        if (eventTouchesCell(ev, settledActiveCell)) {
          setStructureVersion((v) => v + 1);
        }
      }, 0);
    })();
    return unsub;
  }, [wb, activeSheetId, coordinator]);

  useEffect(() => {
    const rangeTouchesCell = (
      detail: FormulaBarRefreshDetail,
      cell: { row: number; col: number },
    ) => {
      if (detail.sheetIds && !detail.sheetIds.includes(activeSheetId)) return false;
      if (!detail.ranges || detail.ranges.length === 0) return true;
      return detail.ranges.some(
        (range) =>
          cell.row >= range.startRow &&
          cell.row <= range.endRow &&
          cell.col >= range.startCol &&
          cell.col <= range.endCol,
      );
    };

    const onRefreshRequested = (event: Event) => {
      const detail = (event as CustomEvent<FormulaBarRefreshDetail>).detail ?? {};
      const currentActiveCell =
        coordinator.grid.access.actors.selection.getSnapshot().context.activeCell;
      if (rangeTouchesCell(detail, currentActiveCell)) {
        setStructureVersion((v) => v + 1);
      }
    };

    window.addEventListener(FORMULA_BAR_REFRESH_REQUESTED, onRefreshRequested);
    return () => {
      window.removeEventListener(FORMULA_BAR_REFRESH_REQUESTED, onRefreshRequested);
    };
  }, [activeSheetId, coordinator]);

  // Cell address from active cell (granular subscription)
  const cellAddress = useMemo(
    () => toA1(activeCellRow, activeCellCol),
    [activeCellRow, activeCellCol],
  );

  // Active cell metadata for formula bar (region, isFormulaHidden, etc.)
  // fix: must be async to flush the refreshActiveCell cache first so
  // the formula bar sees up-to-date metadata (e.g. region.kind for CSE /
  // Data Table cells). Without the refresh, _activeCellData is stale or
  // null and the {=…} brace display never fires.
  const [activeCellData, setActiveCellData] = useState(() => ws.viewport.getActiveCellData());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Refresh the compute bridge's active-cell cache for the new position,
      // then read back the updated data so the formula bar reflects metadata.region.
      await ws.refreshActiveCellData(activeCellRow, activeCellCol);
      if (!cancelled) {
        setActiveCellData(ws.viewport.getActiveCellData());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, activeCellRow, activeCellCol, structureVersion]);

  // Get cell data via ONE API (Worksheet)
  const [cellData, setCellData] = useState<
    | {
        raw: CellValue;
        computed: CellValue;
        formula?: FormulaA1;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cell = await ws.getCell(activeCellRow, activeCellCol);
      const rawData = await ws.getRawCellData(activeCellRow, activeCellCol, true);
      const calculatedColumnContext = await resolveCalculatedColumnCellContext(
        activeSheetId,
        activeCellRow,
        activeCellCol,
        wb,
      );
      if (cancelled) return;
      const calculatedFormula = calculatedColumnContext?.calculatedFormula;
      const formulaText =
        calculatedFormula && isStructuredReferenceFormula(calculatedFormula)
          ? calculatedFormula
          : rawData.formula;
      const formula = formulaText ? ensureFormulaA1(formulaText) : undefined;
      if (cell.value === null && !formula) {
        setCellData(undefined);
        return;
      }
      setCellData({
        raw: rawData.value,
        computed: cell.value,
        formula,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ws, wb, activeSheetId, activeCellRow, activeCellCol, structureVersion]);

  // Get raw value from the cell data for formula bar display
  const rawValue = useMemo(() => {
    if (!cellData) return '';

    // Formula cells: use the formula string directly
    if (cellData.formula) {
      return cellData.formula;
    }

    // Non-formulas use raw value
    if (cellData.raw != null) {
      const rawNum = cellData.raw;

      // Check if raw value is a number with date format
      if (typeof rawNum === 'number') {
        // Use Rust's pre-computed edit_text for date/time cells
        if (activeCellData?.editText) {
          return activeCellData.editText;
        }
      }

      return String(rawNum);
    }

    return '';
  }, [cellData, activeCellData, structureVersion]);

  // D5 (projection-family unification): brace policy is a per-region.kind
  // switch. The Rust mirror's `cell_render_at` chokepoint surfaces a
  // unified `RegionMeta` (CSE / dynamic-array spill / Data Table) on
  // `ActiveCellData.metadata.region`. Brace-wrap (`{=…}`) for `cseArray`
  // (legacy Ctrl+Shift+Enter) and `dataTable` (Excel parity); `arraySpill`
  // (modern dynamic-array spill, e.g. `=SEQUENCE(5)`) is NOT brace-wrapped
  // — Excel doesn't show braces for dynamic-array formulas.
  //
  // The legacy boolean derivation (CSE-anchor flag OR array-formula flag)
  // is fully replaced; back-compat flags continue to flow on the wire
  // (D3 keeps them as derivations of `region`) but the formula bar no
  // longer reads them.
  const shouldBraceWrap = useMemo(() => {
    const metadata = activeCellData?.metadata as Record<string, unknown> | null | undefined;
    const region = metadata?.region as { kind?: string } | null | undefined;
    return region?.kind === 'cseArray' || region?.kind === 'dataTable';
  }, [activeCellData]);

  // Check if formula should be hidden (protected sheet + formulaHidden format)
  // When hidden, show the calculated result instead of the formula
  // Use ViewportBuffer's activeCellData.is_formula_hidden (combines isProtected + isHidden)
  const shouldHideFormula = useMemo(() => {
    return activeCellData?.isFormulaHidden ?? false;
  }, [activeCellData]);

  // Get calculated value for when formula is hidden
  const calculatedValue = useMemo(() => {
    if (!shouldHideFormula) return null;
    // Use already-fetched cellData (async) instead of re-fetching
    // StoreCellData uses 'computed' for calculated value and 'raw' for raw input
    // Use computed value for formulas, raw value for non-formula cells
    return cellData?.formula !== undefined ? cellData.computed : (cellData?.raw ?? '');
  }, [cellData, shouldHideFormula]);

  // Check if cell has forced text mode (apostrophe prefix)
  // Use ViewportBuffer's activeCellData.format instead of Properties.getFormat()
  const isForcedText = useMemo(() => {
    return (activeCellData?.format as CellFormat | undefined)?.forcedTextMode === true;
  }, [activeCellData]);

  // Value: show editor value if editing, otherwise raw cell value (or calculated if formula hidden)
  // Brace-wrap region cells whose `region.kind` calls for it (cseArray,
  // dataTable). `arraySpill` does NOT brace-wrap.
  // Prefix with apostrophe if forcedTextMode is true (Excel parity)
  const displayValue = useMemo(() => {
    if (isEditing) {
      return value;
    }
    // If formula is hidden on protected sheet, show calculated value
    if (shouldHideFormula && typeof rawValue === 'string' && rawValue.startsWith('=')) {
      return String(calculatedValue ?? '');
    }
    const cellValue = String(rawValue ?? '');
    // Wrap CSE/DataTable region cells with curly braces — Excel parity.
    if (shouldBraceWrap && cellValue.startsWith('=')) {
      return `{${cellValue}}`;
    }
    // Prefix with apostrophe in formula bar when forcedTextMode is true
    // This matches Excel behavior where the apostrophe is visible in the formula bar
    // but not in the cell itself
    if (isForcedText && cellValue.length > 0) {
      return `'${cellValue}`;
    }
    return cellValue;
  }, [
    isEditing,
    value,
    shouldHideFormula,
    rawValue,
    calculatedValue,
    shouldBraceWrap,
    isForcedText,
  ]);

  // ==========================================================================
  // Formula Range Colors (Excel parity - synced with grid range boxes)
  // ==========================================================================

  /**
   * Extract formula ranges for syntax highlighting.
   * When editing a formula, compute the cell references with their colors
   * so the formula bar highlighting matches the range box colors in the grid.
   */
  const referenceColors = useMemo((): ReferenceColorRange[] | undefined => {
    // Only extract when editing a formula
    if (!isEditing || !value.startsWith('=')) {
      return undefined;
    }

    const ranges = extractFormulaRanges(value);
    if (ranges.length === 0) {
      return undefined;
    }

    // Map to ReferenceColorRange format
    return ranges.map((ref) => ({
      startPos: ref.startPos,
      endPos: ref.endPos,
      color: ref.color,
    }));
  }, [isEditing, value]);

  // ==========================================================================
  // Handlers - bridge FormulaBar events to state machine
  // ==========================================================================

  const handleChange = useCallback(
    (newValue: string, cursorPosition: number) => {
      editorActions.input(newValue, cursorPosition);
    },
    [editorActions],
  );

  const handleSelectionChange = useCallback(
    (selectionStart: number, selectionEnd: number) => {
      if (selectionStart === selectionEnd) {
        editorActions.setCursor(selectionEnd);
      } else {
        editorActions.setTextSelection(selectionEnd, selectionStart);
      }
    },
    [editorActions],
  );

  const handleCommit = useCallback(() => {
    dispatch('COMMIT_IN_PLACE', deps);
    paneFocusCommands?.resetToGrid();
    // Pop the formula bar focus layer when committing
    if (focus.isFormulaBar) {
      focus.popLayer();
    }
  }, [deps, focus, paneFocusCommands]);

  const handleCancel = useCallback(() => {
    // / O-A: tag any thrown error from this fire-and-forget chain
    // as 'handler:CANCEL_EDIT' so it surfaces in __dt.recentErrors.
    const result = dispatch('CANCEL_EDIT', deps);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void withHandlerErrors('CANCEL_EDIT', () => result as Promise<unknown>);
    }
    paneFocusCommands?.resetToGrid();
    // Pop the formula bar focus layer when cancelling
    if (focus.isFormulaBar) {
      focus.popLayer();
    }
  }, [deps, focus, paneFocusCommands]);

  /**
   * A.1: Handle focus with optional cursor position from click.
   * When user clicks in formula bar, the click position is passed here
   * so we can start editing with the cursor at the click position.
   */
  const handleFocus = useCallback(
    async (cursorPosition?: number) => {
      // Push formula bar focus layer first (so inline editor doesn't render)
      if (!focus.isFormulaBar) {
        focus.pushLayer('formulaBar', 'formula-bar');
      }
      paneFocusCommands?.focusPane('formulaBar');
      // Then start editing if not already editing
      if (!isEditing) {
        // Check if edit was blocked by protection
        // A.3: Pass 'formulaBar' as entryMode to enter Edit Mode (not Enter Mode)
        // Edit Mode means arrow keys move cursor in text, not insert references
        // A.1: Pass cursorPosition so cursor is positioned at click location
        const result = await editorActions.startEditing(
          activeCell,
          activeSheetId,
          undefined,
          'formulaBar',
          cursorPosition,
        );
        if (!result.success && result.reason?.includes('protected')) {
          showProtectionAlert(result.reason);
          // Pop the focus layer since we're not actually editing
          focus.popLayer();
        }
      }
    },
    [
      isEditing,
      editorActions,
      activeCell,
      activeSheetId,
      focus,
      paneFocusCommands,
      showProtectionAlert,
    ],
  );

  const handleFxClick = useCallback(() => {
    // Excel parity quickwin A8: fx button opens Function Arguments dialog
    // when editing a formula with a function at cursor, or Insert Function otherwise
    if (isEditing && value.startsWith('=')) {
      dispatch('OPEN_FUNCTION_ARGUMENTS_DIALOG', deps);
    } else {
      dispatch('OPEN_INSERT_FUNCTION_DIALOG', deps);
    }
  }, [deps, isEditing, value]);

  // ==========================================================================
  // Autocomplete handlers
  // ==========================================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Handle autocomplete navigation when suggestions are open
      if (autocomplete.isSuggestionsOpen && autocomplete.totalSuggestionCount > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          autocomplete.navigateSuggestions('down');
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          autocomplete.navigateSuggestions('up');
          return;
        }
        if (e.key === 'Tab') {
          // Tab accepts the highlighted suggestion (Excel parity: Enter does NOT accept)
          if (
            autocomplete.functionSuggestions.length > 0 ||
            autocomplete.nameSuggestions.length > 0
          ) {
            e.preventDefault();
            autocomplete.acceptCurrentSuggestion();
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          autocomplete.dismissSuggestions();
          return;
        }
      }
    },
    [autocomplete],
  );

  // Set input element ref for autocomplete positioning
  const handleInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
      autocomplete.setInputElement(el);
    },
    [autocomplete],
  );

  // ==========================================================================
  // Context Menu Handlers (Excel parity quickwin B5)
  // ==========================================================================

  /**
   * Handle right-click on formula bar input.
   * Opens context menu at mouse position.
   */
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    e.preventDefault();
    setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
  }, []);

  /**
   * Close context menu.
   */
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // ==========================================================================
  // IME composition handlers
  // ==========================================================================
  // These handlers bridge composition events from FormulaBar's <Input> to the
  // editor state machine. They enable CJK input by:
  // 1. Transitioning to imeComposing state to prevent shortcuts
  // 2. Tracking composition text for cross-browser consistency

  const handleCompositionStart = useCallback(() => {
    editorActions.imeStart();
  }, [editorActions]);

  const handleCompositionUpdate = useCallback(
    (compositionText: string) => {
      editorActions.imeUpdate(compositionText);
    },
    [editorActions],
  );

  const handleCompositionEnd = useCallback(
    (finalText: string) => {
      editorActions.imeEnd(finalText);
    },
    [editorActions],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="relative">
      <FormulaBar
        cellAddress={cellAddress}
        value={displayValue}
        isEditing={isEditing}
        readOnly={readOnly}
        onChange={handleChange}
        onSelectionChange={handleSelectionChange}
        onCommit={handleCommit}
        onCancel={handleCancel}
        onFocus={handleFocus}
        onFxClick={handleFxClick}
        onKeyDown={handleKeyDown as (event: React.KeyboardEvent) => void}
        inputRef={handleInputRef}
        onContextMenu={handleContextMenu as (event: React.MouseEvent) => void}
        // Formula Bar Expand/Collapse (Ctrl+Shift+U)
        isExpanded={formulaBarExpanded}
        heightPx={formulaBarHeightPx}
        onToggleExpand={toggleFormulaBarExpand}
        onResizeHeight={setFormulaBarHeightPx}
        // IME composition handlers
        onCompositionStart={handleCompositionStart}
        onCompositionUpdate={handleCompositionUpdate}
        onCompositionEnd={handleCompositionEnd}
        // Excel parity: Formula range colors synced with grid
        referenceColors={referenceColors}
        onClosePanel={handleClosePanel}
        nlBarVisible={nlBarVisible}
        onToggleNLBar={toggleNLBar}
      />

      {/* Formula Bar Context Menu (Excel parity quickwin B5) */}
      {contextMenu.isOpen && (
        <FormulaBarContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
          onCut={contextMenuActions.cut}
          onCopy={contextMenuActions.copy}
          onPaste={contextMenuActions.paste}
          onSelectAll={contextMenuActions.selectAll}
          onInsertFunction={contextMenuActions.insertFunction}
          hasSelection={contextMenuActions.hasSelection}
          canPaste={contextMenuActions.canPaste}
        />
      )}

      {/* Function Suggestions Popup — only render when formula bar has focus.
 When editing in-cell, InlineCellEditor renders suggestions near the cell. */}
      {focus.isFormulaBar &&
        autocomplete.isSuggestionsOpen &&
        autocomplete.functionSuggestions.length > 0 && (
          <FunctionSuggestions
            prefix={autocomplete.formulaContext?.functionPrefix ?? ''}
            allFunctions={autocomplete.functionSuggestions}
            selectedIndex={autocomplete.selectedSuggestionIndex}
            onSelect={autocomplete.acceptSuggestion}
            onNavigate={autocomplete.navigateSuggestions}
            onDismiss={autocomplete.dismissSuggestions}
            position={autocomplete.suggestionsPosition}
          />
        )}

      {/* Argument Hint Tooltip */}
      {autocomplete.isArgumentHintOpen &&
        autocomplete.currentFunctionInfo &&
        autocomplete.argumentHintAnchor && (
          <FormulaArgumentHint
            functionInfo={autocomplete.currentFunctionInfo}
            currentArgIndex={autocomplete.formulaContext?.currentArgIndex ?? 0}
            anchor={autocomplete.argumentHintAnchor}
            preferredPlacement={autocomplete.argumentHintPlacement}
          />
        )}
    </div>
  );
}

/**
 * Memoized FormulaBarContainer export.
 *
 * React.memo ensures the component doesn't re-render from parent prop changes.
 * Combined with useActiveCell() granular subscription, this ensures FormulaBarContainer
 * ONLY re-renders when:
 * 1. Active cell position changes (different row or col)
 * 2. Editor state changes (started/stopped editing)
 * 3. Cell value at active position changes
 *
 * It does NOT re-render during:
 * - Selection drag (ranges changing)
 * - Fill handle drag
 * - Column/row resize
 *
 */
export const FormulaBarContainer = memo(FormulaBarContainerImpl);
