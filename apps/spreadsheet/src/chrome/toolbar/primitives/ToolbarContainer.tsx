/**
 * ToolbarContainer
 *
 * Container component that connects TabbedToolbar to the state machine selection.
 * Must be rendered inside SpreadsheetCoordinatorProvider.
 *
 * This follows the same pattern as FormulaBarContainer - separating the
 * state machine integration from the presentational component.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 * All callback props use useCallback to ensure stable references.
 */

import React, { useCallback, useMemo } from 'react';
import {
  dispatch,
  useActiveSheetId,
  useRendererActions,
  useUIStore,
  useWorkbook,
  useZoomLevels,
} from '../../../internal-api';
import { useCalculationMode } from '../../../hooks/editing/use-calculation-mode';
import { useTableSelection } from '../../../hooks/selection/use-table-selection';
import { useWorkbookSettings } from '../../../hooks/settings/use-workbook-settings';
import { useCoordinator } from '../../../hooks/shared/use-coordinator';
import { useActionDependencies } from '../../../hooks/toolbar/use-action-dependencies';
import { useCommandRegistration } from '../../../hooks/toolbar/use-command-registration';
import { useToolbarActions } from '../../../hooks/toolbar/use-toolbar-actions';
import { useFrozenPanes } from '../../../hooks/view/use-frozen-panes';
import { useSheetViewOptions } from '../../../hooks/view/use-sheet-view-options';
import { clampZoom, getZoomLevel, zoomIn, zoomOut } from '../../../infra/utils';
import { TabbedToolbar } from './TabbedToolbar';

// =============================================================================
// Types
// =============================================================================

interface ToolbarContainerProps {
  // Save state (used by TabBar)
  isSaving?: boolean;
  onSave?: () => void;

  // Export state
  isExporting?: boolean;
  onExport?: () => void;

  // Print state (used by TabBar)
  isPrinting?: boolean;
  onPrint?: () => void;

  // PDF state (used by TabBar)
  isPdfExporting?: boolean;
  onPdfExport?: () => void;
  onOpenPrintDialog?: () => void;

  // NOTE: onDataValidation, onRemoveDuplicates, onTextToColumns props removed.
  // ToolbarContainer now uses dispatch() directly for these.
  // This ensures proper access to selection context via useActionDependencies.
  // NOTE: InsertRibbon props removed - InsertRibbon is now self-sufficient via useInsertActions hook
  // NOTE: Chart props removed - ToolbarContainer uses useChartEditorActions hook internally
  // NOTE: Clipboard props removed - ToolbarContainer uses useClipboard hook internally
  // NOTE: PageLayoutRibbon props removed - PageLayoutRibbon groups dispatch directly
  // (Page Layout dispatch). Read state via usePrintArea / usePrintSettings /
  // usePageBreaks / useSheetViewOptions in each group.
}

// =============================================================================
// Component
// =============================================================================

/**
 * ToolbarContainer - memoized to prevent re-renders when parent re-renders.
 * This component previously caused 16,733ms of wasted render time due to
 * useSelection() subscription. Now reads selection on-demand when actions are invoked.
 */
export const ToolbarContainer = React.memo(function ToolbarContainer({
  isSaving = false,
  onSave,
  isExporting = false,
  onExport,
  isPrinting = false,
  onPrint,
  isPdfExporting = false,
  onPdfExport,
  onOpenPrintDialog,
}: ToolbarContainerProps) {
  const deps = useActionDependencies();
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  // NOTE: Removed useSelection() subscription - this was causing 16,733ms of wasted render time
  // Selection data is now read on-demand when toolbar actions are invoked via coordinator.grid.getSelectionSnapshot()
  const zoomLevels = useZoomLevels();
  const setZoomLevel = useUIStore((s) => s.setZoomLevel);
  const openUndoDropdown = useUIStore((s) => s.openUndoDropdown);
  const closeUndoDropdown = useUIStore((s) => s.closeUndoDropdown);
  const formulaBarVisible = useUIStore((s) => s.formulaBarVisible);
  const toggleFormulaBarVisible = useUIStore((s) => s.toggleFormulaBarVisible);
  const pageBreakPreviewMode = useUIStore((s) => s.pageBreakPreviewMode);
  const togglePageBreakPreviewMode = useUIStore((s) => s.togglePageBreakPreviewMode);
  const { setZoom } = useRendererActions();
  const coordinator = useCoordinator();

  // View options (Freeze Panes & View Options)
  const { viewOptions, toggleGridlines, toggleHeadings, toggleShowFormulas } =
    useSheetViewOptions(activeSheetId);

  // Frozen panes (reactive via EventBus)
  const { frozenPanes } = useFrozenPanes(activeSheetId);

  // NOTE: Page breaks, print settings removed - PageLayoutRibbon groups dispatch
  // directly (Page Layout dispatch) and read state via small focused hooks.

  // Scrollbar visibility (Issue 7: View Options)
  const { settings: workbookSettings, toggleSetting: toggleWorkbookSetting } =
    useWorkbookSettings();
  const handleToggleHorizontalScrollbar = useCallback(() => {
    toggleWorkbookSetting('showHorizontalScrollbar');
  }, [toggleWorkbookSetting]);
  const handleToggleVerticalScrollbar = useCallback(() => {
    toggleWorkbookSetting('showVerticalScrollbar');
  }, [toggleWorkbookSetting]);

  // Table selection
  const tableSelection = useTableSelection();

  // NOTE: Chart editor actions removed - InsertRibbon is now self-sufficient via useInsertActions hook

  // Settings dialogs use dispatch - handlers below (Architecture Alignment)
  // NOTE: Page break preview mode removed - handled by ViewRibbon directly via UIStore

  // Get undo/redo state from the hook (now works because we're inside the provider)
  // NOTE: HomeRibbon actions removed - HomeRibbon groups get these from their own hooks
  // NOTE: InsertRibbon handlers removed - InsertRibbon is now self-sufficient via useInsertActions hook
  // NOTE: Formatting handlers removed - all use dispatch() directly now (Architecture Rule 1)
  const {
    // Undo/redo state for TabBar
    canUndo,
    canRedo,
  } = useToolbarActions();

  // ===========================================================================
  // CLIPBOARD (Clipboard & Paste Special)
  // ===========================================================================

  // NOTE: Removed useClipboard() subscription - this caused unnecessary re-renders
  // when clipboard state changed. ToolbarContainer only needs clipboard actions
  // for command registration, not clipboard state for rendering.
  // All clipboard operations now use dispatch() per Architecture Rule 1.

  // Open paste special dialog via dispatch
  const handlePasteSpecialDialog = useCallback(() => {
    dispatch('OPEN_PASTE_SPECIAL_DIALOG', deps);
  }, [deps]);

  // ===========================================================================
  // ZOOM HANDLERS
  // ===========================================================================

  const currentZoom = getZoomLevel(zoomLevels, activeSheetId);

  const handleZoomChange = useCallback(
    (newZoom: number) => {
      const clampedZoom = clampZoom(newZoom);
      // Update UIStore (persists zoom per sheet)
      setZoomLevel(activeSheetId, clampedZoom);
      // Update renderer immediately
      setZoom(clampedZoom);
    },
    [activeSheetId, setZoomLevel, setZoom],
  );

  const handleZoomIn = useCallback(() => {
    const newZoom = zoomIn(currentZoom);
    handleZoomChange(newZoom);
  }, [currentZoom, handleZoomChange]);

  const handleZoomOut = useCallback(() => {
    const newZoom = zoomOut(currentZoom);
    handleZoomChange(newZoom);
  }, [currentZoom, handleZoomChange]);

  // Zoom to selection - fit selection in view
  const handleZoomToSelection = useCallback(() => {
    coordinator.renderer.zoomToSelection();
  }, [coordinator]);

  // Has selection - for zoom to selection button
  // We always have at least an active cell, so this is always true
  // (Unlike subscribed selection state, this doesn't trigger re-renders)
  const hasSelection = true;

  // ===========================================================================
  // FREEZE PANES HANDLERS
  // ===========================================================================

  // NOTE: frozenPanes state now comes from useFrozenPanes hook (see above)
  // The hook subscribes to 'freeze:changed' events via EventBus for reactive updates.
  // This fixes the Unfreeze Panes Menu Item Stays Disabled issue

  const handleFreezePanes = useCallback(() => {
    void dispatch('FREEZE_PANES', deps);
  }, [deps]);

  const handleFreezeTopRow = useCallback(() => {
    void dispatch('FREEZE_TOP_ROW', deps);
  }, [deps]);

  const handleFreezeFirstColumn = useCallback(() => {
    void dispatch('FREEZE_FIRST_COLUMN', deps);
  }, [deps]);

  const handleUnfreeze = useCallback(() => {
    void dispatch('UNFREEZE_PANES', deps);
  }, [deps]);

  // NOTE: Print area, page setup, page break handlers removed.
  // PageLayoutRibbon groups dispatch via the Unified Action System
  // (Page Layout dispatch) — no shared hook wrapper.

  // ===========================================================================
  // UNDO HISTORY DROPDOWN HANDLERS
  // ===========================================================================

  // Get undo history from Workbook API (single source of truth)
  // We depend on undoStackSize to trigger re-computation when stack changes
  const undoStackSize = useUIStore((s) => s.undoStackSize);
  const undoHistory = useMemo(
    () => wb.history.list(),
    [wb, undoStackSize], // re-read whenever the stack depth changes
  );
  const undoDropdownOpen = useUIStore((s) => s.undoDropdownOpen);

  const handleOpenUndoDropdown = useCallback(() => {
    openUndoDropdown();
  }, [openUndoDropdown]);

  const handleCloseUndoDropdown = useCallback(() => {
    closeUndoDropdown();
  }, [closeUndoDropdown]);

  // Undo to a specific entry by index (entries are in most-recent-first order)
  const handleUndoToEntry = useCallback(
    (entryId: string) => {
      // Extract index from entry ID (format: "undo-{index}")
      const match = entryId.match(/^undo-(\d+)$/);
      if (!match) return;

      // The index in the ID refers to the original stack position
      // But since history.list() returns reversed (most recent first),
      // we need to find the entry's position in the reversed list
      const history = wb.history.list();
      const entryIndex = history.findIndex((e) => e.id === entryId);
      if (entryIndex === -1) return;

      void wb.history.goToIndex(entryIndex);
      closeUndoDropdown();
    },
    [wb, closeUndoDropdown],
  );

  // ===========================================================================
  // COMMAND REGISTRATION (Command Palette)
  // ===========================================================================

  // Calculation mode for F9/Shift+F9 commands
  const { calculateNow, calculateSheet, setCalculationMode, calculationMode } =
    useCalculationMode();

  // openInsertFunctionDialog uses dispatch in command registration below

  // Toggle calculation mode handler
  const handleToggleCalculationMode = useCallback(() => {
    setCalculationMode(calculationMode === 'auto' ? 'manual' : 'auto');
  }, [calculationMode, setCalculationMode]);

  // Register all built-in commands with the Command Palette
  // Architecture Rule 1: All user interactions go through dispatch()
  useCommandRegistration({
    // Edit commands - all use dispatch() for Architecture Rule 1 compliance
    // This avoids useClipboard() subscription which caused unnecessary re-renders
    copy: () => dispatch('COPY', deps),
    cut: () => dispatch('CUT', deps),
    paste: () => dispatch('PASTE', deps),
    pasteSpecial: handlePasteSpecialDialog,
    undo: () => dispatch('UNDO', deps),
    redo: () => dispatch('REDO', deps),
    clearFormat: () => dispatch('CLEAR_FORMATS', deps),

    // Format - Text (all via dispatch)
    toggleBold: () => dispatch('TOGGLE_BOLD', deps),
    toggleItalic: () => dispatch('TOGGLE_ITALIC', deps),
    toggleUnderline: () => dispatch('TOGGLE_UNDERLINE', deps),
    toggleStrikethrough: () => dispatch('TOGGLE_STRIKETHROUGH', deps),

    // Format - Alignment (all via dispatch with payloads)
    alignLeft: () => dispatch('SET_HORIZONTAL_ALIGN', deps, { align: 'left' }),
    alignCenter: () => dispatch('SET_HORIZONTAL_ALIGN', deps, { align: 'center' }),
    alignRight: () => dispatch('SET_HORIZONTAL_ALIGN', deps, { align: 'right' }),
    alignTop: () => dispatch('SET_VERTICAL_ALIGN', deps, { align: 'top' }),
    alignMiddle: () => dispatch('SET_VERTICAL_ALIGN', deps, { align: 'middle' }),
    alignBottom: () => dispatch('SET_VERTICAL_ALIGN', deps, { align: 'bottom' }),
    toggleWordWrap: () => dispatch('TOGGLE_WRAP_TEXT', deps),

    // Format - Number (all via dispatch with payloads)
    formatNumber: () => dispatch('SET_NUMBER_FORMAT', deps, { format: '#,##0.00' }),
    formatCurrency: () => dispatch('SET_NUMBER_FORMAT', deps, { format: '$#,##0.00' }),
    formatPercentage: () => dispatch('SET_NUMBER_FORMAT', deps, { format: '0%' }),
    formatDate: () => dispatch('SET_NUMBER_FORMAT', deps, { format: 'M/D/YY' }),
    formatTime: () => dispatch('SET_NUMBER_FORMAT', deps, { format: 'h:mm AM/PM' }),
    formatScientific: () => dispatch('SET_NUMBER_FORMAT', deps, { format: '0.00E+00' }),
    formatGeneral: () => dispatch('SET_NUMBER_FORMAT', deps, { format: 'General' }),

    // View
    toggleShowFormulas,
    toggleGridlines,
    zoomIn: handleZoomIn,
    zoomOut: handleZoomOut,
    zoomReset: () => handleZoomChange(1),
    zoomToSelection: handleZoomToSelection,
    freezePanes: handleFreezePanes,
    freezeTopRow: handleFreezeTopRow,
    freezeFirstColumn: handleFreezeFirstColumn,
    unfreezePanes: handleUnfreeze,

    // Insert - using dispatch for self-sufficient InsertRibbon pattern
    insertChart: () => dispatch('CREATE_EMBEDDED_CHART', deps, { type: 'bar' }),
    insertPivotTable: () => dispatch('OPEN_PIVOT_DIALOG', deps),
    insertHyperlink: () => dispatch('OPEN_HYPERLINK_DIALOG', deps),
    openInsertFunctionDialog: () => dispatch('OPEN_INSERT_FUNCTION_DIALOG', deps),

    // Data - using dispatch for unified action system
    removeDuplicates: () => dispatch('OPEN_REMOVE_DUPLICATES_DIALOG', deps),
    textToColumns: () => dispatch('OPEN_TEXT_TO_COLUMNS_DIALOG', deps),

    // Formulas
    calculateNow,
    calculateSheet,
    toggleCalculationMode: handleToggleCalculationMode,

    // File
    exportXlsx: onExport,
    print: onPrint,
    printPreview: onOpenPrintDialog,
  });

  // NOTE: HomeRibbon props removed - HomeRibbon is now self-sufficient
  // Font, alignment, number format, clipboard state/callbacks handled by UIStore + group hooks
  return (
    <TabbedToolbar
      // Undo/Redo (used by TabBar) - using dispatch for Architecture Rule 1
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={() => dispatch('UNDO', deps)}
      onRedo={() => dispatch('REDO', deps)}
      undoHistory={undoHistory}
      undoDropdownOpen={undoDropdownOpen}
      onOpenUndoDropdown={handleOpenUndoDropdown}
      onCloseUndoDropdown={handleCloseUndoDropdown}
      onUndoToEntry={handleUndoToEntry}
      // Save (used by TabBar)
      onSave={onSave}
      isSaving={isSaving}
      // Export (used by TabBar)
      onExport={onExport}
      isExporting={isExporting}
      // Print/PDF (used by TabBar)
      onPrint={onPrint}
      isPrinting={isPrinting}
      onPdfExport={onPdfExport}
      isPdfExporting={isPdfExporting}
      onOpenPrintDialog={onOpenPrintDialog}
      // Data ribbon - using dispatch for unified action system
      onDataValidation={() => dispatch('OPEN_DV_DIALOG', deps)}
      onRemoveDuplicates={() => dispatch('OPEN_REMOVE_DUPLICATES_DIALOG', deps)}
      onTextToColumns={() => dispatch('OPEN_TEXT_TO_COLUMNS_DIALOG', deps)}
      // NOTE: InsertRibbon props removed - InsertRibbon is now self-sufficient
      // View ribbon - zoom
      currentZoom={currentZoom}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onZoomChange={handleZoomChange}
      onZoomToSelection={handleZoomToSelection}
      hasSelection={hasSelection}
      frozenRows={frozenPanes.rows}
      frozenCols={frozenPanes.cols}
      onFreezePanes={handleFreezePanes}
      onFreezeTopRow={handleFreezeTopRow}
      onFreezeFirstColumn={handleFreezeFirstColumn}
      onUnfreeze={handleUnfreeze}
      showGridlines={viewOptions.showGridlines}
      onToggleGridlines={toggleGridlines}
      showHeadings={viewOptions.showRowHeaders && viewOptions.showColumnHeaders}
      onToggleHeadings={toggleHeadings}
      showFormulaBar={formulaBarVisible}
      onToggleFormulaBar={toggleFormulaBarVisible}
      // Scrollbar visibility (Issue 7: View Options)
      showHorizontalScrollbar={workbookSettings.showHorizontalScrollbar}
      onToggleHorizontalScrollbar={handleToggleHorizontalScrollbar}
      showVerticalScrollbar={workbookSettings.showVerticalScrollbar}
      onToggleVerticalScrollbar={handleToggleVerticalScrollbar}
      onOpenSpreadSettings={() => dispatch('OPEN_SPREAD_SETTINGS_DIALOG', deps)}
      onOpenSheetSettings={() => dispatch('OPEN_SHEET_SETTINGS_DIALOG', deps)}
      pageBreakPreviewMode={pageBreakPreviewMode}
      onTogglePageBreakPreview={togglePageBreakPreviewMode}
      // NOTE: PageLayoutRibbon props removed - PageLayoutRibbon is now self-sufficient
      // Table Design
      isInTable={tableSelection.isInTable}
      tableName={tableSelection.tableName}
      tableStylePreset={tableSelection.stylePreset}
      tableShowBandedRows={tableSelection.showBandedRows}
      tableShowBandedColumns={tableSelection.showBandedColumns}
      tableShowFirstColumnHighlight={tableSelection.showFirstColumnHighlight}
      tableShowLastColumnHighlight={tableSelection.showLastColumnHighlight}
      tableHasHeaderRow={tableSelection.hasHeaderRow}
      tableHasTotalRow={tableSelection.hasTotalRow}
      tableShowFilterButtons={tableSelection.showFilterButtons}
      onRenameTable={tableSelection.renameTable}
      onSetTableStylePreset={tableSelection.setStylePreset}
      onToggleTableBandedRows={tableSelection.toggleBandedRows}
      onToggleTableBandedColumns={tableSelection.toggleBandedColumns}
      onToggleTableFirstColumnHighlight={tableSelection.toggleFirstColumnHighlight}
      onToggleTableLastColumnHighlight={tableSelection.toggleLastColumnHighlight}
      onToggleTableHeaderRow={tableSelection.toggleHeaderRow}
      onToggleTableTotalRow={tableSelection.toggleTotalRow}
      onToggleTableFilterButtons={tableSelection.toggleFilterButtons}
      onDeleteTable={tableSelection.deleteTable}
      onConvertTableToRange={tableSelection.convertToRange}
    />
  );
});
