/**
 * Zustand UI Store
 *
 * =============================================================================
 * ARCHITECTURE DECISION: ZUSTAND vs XSTATE
 * =============================================================================
 *
 * This codebase uses TWO state management approaches. Choose wisely:
 *
 * USE XSTATE MACHINES (state/machines/) when:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ - Complex state graphs (5+ states with non-linear transitions) │
 * │ - Cross-machine coordination (selection ↔ editor ↔ clipboard) │
 * │ - Async operations with loading/error states │
 * │ - Invalid state transitions would cause bugs │
 * │ - User interactions with multiple modes (selecting, editing, dragging) │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Examples: selection-machine, editor-machine, clipboard-machine, chart-machine
 *
 * USE THIS ZUSTAND STORE when:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ - Simple toggles (dialog open/closed) │
 * │ - Linear state flows (format painter: inactive → active → inactive) │
 * │ - UI preferences (show formulas, calculation mode) │
 * │ - No complex coordination with other state │
 * │ - "Just data" that components read/write │
 * └─────────────────────────────────────────────────────────────────────────┘
 * Examples: dialog states, formatPainter, zoomLevels
 *
 * USE COORDINATOR (state/coordinator/) when:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ - Session-local rendering concerns (scroll position, container size) │
 * │ - Side effects from machine state changes │
 * │ - Cross-machine orchestration │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * =============================================================================
 *
 * Cell data lives in Yjs (see store/).
 * This store is created per-document by DocumentProvider.
 * Use useUIStore() hook from document-context.tsx to access it.
 */

import { create, useStore, type StoreApi } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { SheetId } from '@mog-sdk/contracts/core';

import {
  createAccessibilityCheckerSlice,
  createAccessibilitySlice,
  createActiveRibbonTabSlice,
  createActiveSheetSlice,
  createAdvancedFilterDialogSlice,
  createAutofillOptionsSlice,
  createBackstageSlice,
  createBordersPickerSlice,
  createCFDialogSlice,
  createChartClipboardSlice,
  createChartUISlice,
  createCommentsUISlice,
  createConsolidateDialogSlice,
  createContextMenuSlice,
  createContextualTabsSlice,
  createCornerRotationSlice,
  createCreateNamesDialogSlice,
  createCtrlAStateSlice,
  createCustomListsDialogSlice,
  createDVDialogSlice,
  createDataTableDialogSlice,
  createDataToolsSlice,
  createDeleteSheetConfirmDialogSlice,
  createDisplayModeSlice,
  createQuickAnalysisSlice,
  createDialogStackSlice,
  createDragDropOverwriteDialogSlice,
  createEquationDialogSlice,
  createErrorCheckingDialogSlice,
  createEvaluateFormulaDialogSlice,
  createFillColorPickerSlice,
  createFillContextMenuSlice,
  createFillMergeConflictDialogSlice,
  createFillSeriesDialogSlice,
  createFlashFillSlice,
  createFloatingObjectsSlice,
  createFontColorPickerSlice,
  createFontFamilyPickerSlice,
  createFormatCellsDialogSlice,
  createFormulaErrorDialogSlice,
  createFormatPainterSlice,
  createPendingCellFormatSlice,
  createFormulaBarSlice,
  createFormulasSlice,
  createFunctionArgumentsDialogSlice,
  createGoToDialogSlice,
  createGoToSpecialDialogSlice,
  createGoalSeekDialogSlice,
  createHyperlinkDialogSlice,
  createInkSlice,
  createInsertCellsDialogSlice,
  createInsertChartWizardDialogSlice,
  createLargeFillDialogSlice,
  createMRUFunctionsSlice,
  createMergeWarningDialogSlice,
  createNLFormulaBarSlice,
  createMiscSlice,
  createMissingFontsDialogSlice,
  createMoreColorsDialogSlice,
  createNamedRangesDialogSlice,
  createNumberFormatDropdownSlice,
  createObjectClipboardSlice,
  createPanelTogglesSlice,
  createPasteMismatchDialogSlice,
  createPasteOverwriteConfirmDialogSlice,
  createPasteOptionsSlice,
  createPastePreviewSlice,
  createPasteValidationSlice,
  createPdfExportDialogSlice,
  createPictureDialogsSlice,
  createPivotDialogSlice,
  createProtectSheetDialogSlice,
  createProtectWorkbookDialogSlice,
  createUnprotectSheetDialogSlice,
  createRangeSelectionModeSlice,
  createRepeatActionSlice,
  createResizeDialogsSlice,
  createRibbonDropdownsSlice,
  createRibbonSlice,
  createScenarioManagerDialogSlice,
  createSchemaBrowserSlice,
  createWorkbookLinksPanelSlice,
  createSelectDataDialogSlice,
  createSelectionCheckpointSlice,
  createSelectionModesSlice,
  createSettingsSlice,
  createShapeClipboardSlice,
  createSheetOperationsSlice,
  createSheetViewStateSlice,
  createSlicerClipboardSlice,
  createSlicerConnectionsDialogSlice,
  createSlicerDialogSlice,
  createSlicerReportConnectionsDialogSlice,
  createSlicerSizePropertiesDialogSlice,
  createDiagramUISlice,
  createSortDialogSlice,
  createSparklineDialogsSlice,
  createSpellingDialogSlice,
  createSplitViewSlice,
  createSubtotalDialogSlice,
  createTableAutoCorrectOptionsSlice,
  createTableClickSelectionSlice,
  createTableDesignSlice,
  createTableDialogsSlice,
  createTableProgressiveSelectionSlice,
  createToolbarSlice,
  createTotalRowDropdownSlice,
  createTraceArrowsSlice,
  createTransientVisualFeedbackSlice,
  createUndoSlice,
  createValidationCirclesSlice,
  createValidationErrorDialogSlice,
  createValidationTooltipSlice,
  createValidationWarningDialogSlice,
  createWatchWindowSlice,
  createTextEffectSlice,
  createZoomSlice,
  // NOTE: NavigationSlice and RecordDetailSlice moved to shell-store.ts
  // They are shell-level (app-wide) state, not document-specific state.
  // Use useShellStore() from shell-context.tsx to access them.
  selectChartTooltip,
  selectEditingChartTitleId,
  selectHasAnyChartErrors,
  selectHasTraceArrows,
  selectIsChartTitleEditorOpen,
  selectIsChartTooltipVisible,
  selectIsPastePreviewActive,
  selectIsProgressiveSelectionActive,
  selectPastePreviewCells,
  selectProgressiveSelectionInfo,
  selectTraceArrowsForSheet,
} from './slices';
import type { UIState } from './types';

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create a UI store instance for a document.
 * Called by DocumentProvider after initialization.
 *
 * Refactored to use Zustand slice pattern.
 *
 * @param initialSheetId - Valid sheet ID from Sheets.getFirstId(ctx)
 * @param undoService - Optional undo service for reactive undo/redo state tracking
 */
export function createUIStore(
  initialSheetId: SheetId,
  undoService?: {
    subscribe: (
      handler: (event: { state: { undoStackSize: number; redoStackSize: number } }) => void,
    ) => void;
  },
): StoreApi<UIState> {
  const zustandStore = create<UIState>()(
    subscribeWithSelector((...args) => ({
      // Combine all slices
      ...createActiveSheetSlice(initialSheetId)(...args),
      // Unified Keytip Router: ribbon tab + picker slices
      ...createActiveRibbonTabSlice(...args),
      // Unified Keytip Router: named ribbon-dropdown open-state map
      ...createRibbonDropdownsSlice(...args),
      ...createBordersPickerSlice(...args),
      ...createFillColorPickerSlice(...args),
      ...createFontColorPickerSlice(...args),
      ...createFontFamilyPickerSlice(...args),
      ...createNumberFormatDropdownSlice(...args),
      ...createBackstageSlice(...args),
      ...createCFDialogSlice(...args),
      ...createDVDialogSlice(...args),
      ...createPivotDialogSlice(...args),
      ...createSheetOperationsSlice(...args),
      ...createFillSeriesDialogSlice(...args),
      ...createFillContextMenuSlice(...args),
      ...createFlashFillSlice(...args),
      ...createFormatCellsDialogSlice(...args),
      ...createFormulaErrorDialogSlice(...args),
      ...createFormatPainterSlice(...args),
      ...createPendingCellFormatSlice(...args),
      ...createZoomSlice(...args),
      ...createRibbonSlice(...args),
      ...createFormulasSlice(...args),
      ...createFunctionArgumentsDialogSlice(...args),
      ...createGoToDialogSlice(...args),
      ...createGoToSpecialDialogSlice(...args),
      ...createUndoSlice(...args),
      ...createContextMenuSlice(...args),
      ...createCtrlAStateSlice(...args),
      ...createCornerRotationSlice(...args),
      ...createResizeDialogsSlice(...args),
      ...createDataToolsSlice(...args),
      ...createQuickAnalysisSlice(...args),
      ...createSettingsSlice(...args),
      ...createDisplayModeSlice(...args),
      ...createHyperlinkDialogSlice(...args),
      ...createInsertCellsDialogSlice(...args),
      ...createSparklineDialogsSlice(...args),
      ...createFloatingObjectsSlice(...args),
      ...createPictureDialogsSlice(...args),
      ...createTableDesignSlice(...args),
      ...createTableDialogsSlice(...args),
      ...createSubtotalDialogSlice(...args),
      ...createTraceArrowsSlice(...args),
      ...createValidationCirclesSlice(...args),
      ...createNamedRangesDialogSlice(...args),
      ...createCreateNamesDialogSlice(...args),
      ...createSortDialogSlice(...args),
      ...createSlicerDialogSlice(...args),
      ...createSlicerConnectionsDialogSlice(...args),
      ...createSheetViewStateSlice(...args),
      ...createPasteOptionsSlice(...args),
      ...createPastePreviewSlice(...args),
      ...createPasteMismatchDialogSlice(...args),
      ...createPasteOverwriteConfirmDialogSlice(...args),
      ...createMiscSlice(...args),
      ...createMRUFunctionsSlice(...args),
      ...createSelectionModesSlice(...args),
      ...createAutofillOptionsSlice(...args),
      ...createRepeatActionSlice(...args),
      ...createChartClipboardSlice(...args),
      ...createChartUISlice(...args),
      ...createShapeClipboardSlice(...args),
      ...createMoreColorsDialogSlice(...args),
      ...createDragDropOverwriteDialogSlice(...args),
      ...createValidationTooltipSlice(...args),
      ...createValidationErrorDialogSlice(...args),
      ...createValidationWarningDialogSlice(...args),
      ...createTableProgressiveSelectionSlice(...args),
      ...createTableClickSelectionSlice(...args),
      ...createProtectSheetDialogSlice(...args),
      ...createUnprotectSheetDialogSlice(...args),
      ...createProtectWorkbookDialogSlice(...args),
      ...createFormulaBarSlice(...args),
      ...createNLFormulaBarSlice(...args),
      ...createMergeWarningDialogSlice(...args),
      ...createTotalRowDropdownSlice(...args),
      ...createSelectionCheckpointSlice(...args),
      ...createRangeSelectionModeSlice(...args),
      ...createSelectDataDialogSlice(...args),
      ...createCommentsUISlice(...args),
      ...createPanelTogglesSlice(...args),
      ...createAccessibilitySlice(...args),
      ...createAccessibilityCheckerSlice(...args),
      ...createMissingFontsDialogSlice(...args),
      ...createPdfExportDialogSlice(...args),
      ...createAdvancedFilterDialogSlice(...args),
      ...createInsertChartWizardDialogSlice(...args),
      ...createFillMergeConflictDialogSlice(...args),
      ...createLargeFillDialogSlice(...args),
      ...createCustomListsDialogSlice(...args),
      ...createPasteValidationSlice(...args),
      ...createGoalSeekDialogSlice(...args),
      ...createConsolidateDialogSlice(...args),
      ...createSpellingDialogSlice(...args),
      ...createWatchWindowSlice(...args),
      ...createErrorCheckingDialogSlice(...args),
      ...createEvaluateFormulaDialogSlice(...args),
      ...createTableAutoCorrectOptionsSlice(...args),
      ...createTransientVisualFeedbackSlice(...args),
      ...createToolbarSlice(...args),
      ...createContextualTabsSlice(...args),
      ...createInkSlice(...args),
      ...createDataTableDialogSlice(...args),
      ...createDeleteSheetConfirmDialogSlice(...args),
      ...createScenarioManagerDialogSlice(...args),
      ...createSplitViewSlice(...args),
      ...createDiagramUISlice(...args),
      ...createTextEffectSlice(...args),
      ...createEquationDialogSlice(...args),
      ...createDialogStackSlice(...args),
      ...createSchemaBrowserSlice(...args),
      ...createWorkbookLinksPanelSlice(...args),
      ...createObjectClipboardSlice(...args),
      ...createSlicerClipboardSlice(...args),
      ...createSlicerReportConnectionsDialogSlice(...args),
      ...createSlicerSizePropertiesDialogSlice(...args),
      // NOTE: NavigationSlice and RecordDetailSlice moved to shell-store.ts
      // They are shell-level (app-wide) state, not document-specific.
    })),
  );

  // Subscribe to kernel UndoService for reactive undo/redo state
  if (undoService) {
    undoService.subscribe((event) => {
      const state = zustandStore.getState();
      const { undoStackSize: newUndoSize, redoStackSize: newRedoSize } = event.state;

      // Only update if changed to avoid unnecessary re-renders
      if (state.undoStackSize !== newUndoSize) {
        state.setUndoStackSize(newUndoSize);
      }
      if (state.redoStackSize !== newRedoSize) {
        state.setRedoStackSize(newRedoSize);
      }
    });
  }

  return zustandStore;
}

/**
 * Type for the UIStore API with subscribeWithSelector middleware.
 * Use this instead of StoreApi<UIState> to get proper typing for selector-based subscribe.
 *
 * @example
 * ```ts
 * function setup(store: UIStoreApi) {
 * // TypeScript knows about the 2-arg subscribe!
 * store.subscribe(
 * (state) => state.activeSheetId,
 * (newId, oldId) => { ... }
 * );
 * }
 * ```
 */
export type UIStoreApi = ReturnType<typeof createUIStore>;

// =============================================================================
// Selector Hook Factory
// =============================================================================

/**
 * Create selector hooks bound to a specific store instance.
 * Called by DocumentProvider to create context-aware hooks.
 */
export function createUIStoreHooks(store: StoreApi<UIState>) {
  return {
    useUIStore: <T>(selector: (state: UIState) => T) => useStore(store, selector),
    useActiveSheetId: () => useStore(store, (s) => s.activeSheetId),
    // NOTE: useSelection removed - use useSelection() from state/hooks/use-selection.ts
    // NOTE: useViewport removed - use coordinator/renderer-execution.ts for scroll state
    // NOTE: useEditing/useIsEditing removed - use useEditor() from state/hooks instead
    // NOTE: useClipboard removed - use useClipboard() from state/hooks/use-clipboard.ts
    // NOTE: Chart hooks removed - use useChartUI() from state/hooks/use-chart.ts
    useCFDialog: () => useStore(store, (s) => s.cfDialog),
    useIsCFDialogOpen: () => useStore(store, (s) => s.cfDialog.isOpen),
    useQuickRuleDialog: () => useStore(store, (s) => s.cfDialog.quickRuleDialog),
    useIsRulesManagerOpen: () => useStore(store, (s) => s.cfDialog.rulesManagerOpen),
    useDVDialog: () => useStore(store, (s) => s.dvDialog),
    useIsDVDialogOpen: () => useStore(store, (s) => s.dvDialog.isOpen),
    usePivot: () => useStore(store, (s) => s.pivot),
    useIsPivotDialogOpen: () => useStore(store, (s) => s.pivot.isDialogOpen),
    useSelectedPivotId: () => useStore(store, (s) => s.pivot.selectedPivotId),
    useEditingPivotId: () => useStore(store, (s) => s.pivot.editingPivotId),
    usePivotTransientOverlay: () => useStore(store, (s) => s.pivot.openTransientOverlay),
    usePivotFieldPanelWidth: () => useStore(store, (s) => s.pivot.fieldPanelWidth),
    useFormatPainter: () => useStore(store, (s) => s.formatPainter),
    useIsFormatPainterActive: () => useStore(store, (s) => s.formatPainter.isActive),
    useIsInsertFunctionDialogOpen: () => useStore(store, (s) => s.insertFunctionDialogOpen),
    useZoomLevels: () => useStore(store, (s) => s.zoomLevels),
    // Ribbon Toggle (Ctrl+Shift+F1)
    useRibbonCollapsed: () => useStore(store, (s) => s.ribbonCollapsed),
    useRibbonActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          toggleRibbon: s.toggleRibbon,
        })),
      ),
    // Undo/Redo state hooks
    useUndoStackSize: () => useStore(store, (s) => s.undoStackSize),
    useRedoStackSize: () => useStore(store, (s) => s.redoStackSize),
    useCanUndo: () => useStore(store, (s) => s.undoStackSize > 0),
    useCanRedo: () => useStore(store, (s) => s.redoStackSize > 0),
    // NOTE: useUndoHistory removed - now use SpreadsheetStore.getUndoHistory() directly
    useUndoDropdownOpen: () => useStore(store, (s) => s.undoDropdownOpen),
    // Paste Special dialog hooks
    usePasteSpecialDialogOpen: () => useStore(store, (s) => s.pasteSpecialDialogOpen),
    usePastePreview: () => useStore(store, (s) => s.pastePreview),
    useIsPastePreviewActive: () => useStore(store, (s) => selectIsPastePreviewActive(s)),
    usePastePreviewCells: () => useStore(store, (s) => selectPastePreviewCells(s)),
    usePastePreviewActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showPastePreview: s.showPastePreview,
          hidePastePreview: s.hidePastePreview,
        })),
      ),
    // Context Menu hooks
    useContextMenu: () => useStore(store, (s) => s.contextMenu),
    useIsContextMenuOpen: () => useStore(store, (s) => s.contextMenu.isOpen),
    // Row/Column Resize dialog hooks
    useRowHeightDialogOpen: () => useStore(store, (s) => s.rowHeightDialogOpen),
    useColumnWidthDialogOpen: () => useStore(store, (s) => s.columnWidthDialogOpen),
    // Data Tools dialog hooks
    useRemoveDuplicatesDialogOpen: () => useStore(store, (s) => s.removeDuplicatesDialogOpen),
    useTextToColumnsDialogOpen: () => useStore(store, (s) => s.textToColumnsDialogOpen),
    // Recent Number Formats hooks
    useRecentNumberFormats: () => useStore(store, (s) => s.recentNumberFormats),
    // Calculation Mode hooks
    useCalculationMode: () => useStore(store, (s) => s.calculationMode),
    // Settings Dialog hooks (Settings & Toggles)
    useSpreadSettingsDialogOpen: () => useStore(store, (s) => s.spreadSettingsDialogOpen),
    useSheetSettingsDialogOpen: () => useStore(store, (s) => s.sheetSettingsDialogOpen),
    // Page Break Preview Mode hooks
    usePageBreakPreviewMode: () => useStore(store, (s) => s.pageBreakPreviewMode),
    // Go To Dialog hooks (Excel parity quickwin A7)
    useGoToDialog: () => useStore(store, (s) => s.goToDialog),
    useIsGoToDialogOpen: () => useStore(store, (s) => s.goToDialog.isOpen),
    // Go To Special Dialog hooks (14.1: Go To Special)
    useGoToSpecialDialog: () => useStore(store, (s) => s.goToSpecialDialog),
    useIsGoToSpecialDialogOpen: () => useStore(store, (s) => s.goToSpecialDialog.isOpen),
    useGoToSpecialDialogActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          openGoToSpecialDialog: s.openGoToSpecialDialog,
          closeGoToSpecialDialog: s.closeGoToSpecialDialog,
          setGoToSpecialType: s.setGoToSpecialType,
          setGoToSpecialValueTypeFilter: s.setGoToSpecialValueTypeFilter,
          resetGoToSpecialDialog: s.resetGoToSpecialDialog,
        })),
      ),
    // Hyperlink Dialog hooks
    useHyperlinkDialog: () => useStore(store, (s) => s.hyperlinkDialog),
    useIsHyperlinkDialogOpen: () => useStore(store, (s) => s.hyperlinkDialog.isOpen),
    // Command Palette hooks
    useCommandPaletteOpen: () => useStore(store, (s) => s.commandPaletteOpen),
    // Sparkline Dialog hooks
    useSparklineDialog: () => useStore(store, (s) => s.sparklineDialog),
    useIsSparklineDialogOpen: () => useStore(store, (s) => s.sparklineDialog.isOpen),
    // Edit Sparkline Dialog hooks
    useEditSparklineDialog: () => useStore(store, (s) => s.editSparklineDialog),
    useIsEditSparklineDialogOpen: () => useStore(store, (s) => s.editSparklineDialog.isOpen),
    // Floating Objects UI hooks
    useInsertPictureDialog: () => useStore(store, (s) => s.insertPictureDialog),
    useIsInsertPictureDialogOpen: () => useStore(store, (s) => s.insertPictureDialog.isOpen),
    useInsertShapeMenu: () => useStore(store, (s) => s.insertShapeMenu),
    useIsInsertShapeMenuOpen: () => useStore(store, (s) => s.insertShapeMenu.isOpen),
    useObjectContextMenu: () => useStore(store, (s) => s.objectContextMenu),
    useIsObjectContextMenuOpen: () => useStore(store, (s) => s.objectContextMenu.isOpen),
    // Table Design hooks
    useTableDesign: () => useStore(store, (s) => s.tableDesign),
    useSelectedTableId: () => useStore(store, (s) => s.tableDesign.selectedTableId),
    // Subtotals Dialog hooks
    useSubtotalDialog: () => useStore(store, (s) => s.subtotalDialog),
    useIsSubtotalDialogOpen: () => useStore(store, (s) => s.subtotalDialog.isOpen),
    // Format Cells Dialog hooks (Context Menu Parity)
    useIsFormatCellsDialogOpen: () => useStore(store, (s) => s.formatCellsDialogOpen),
    // Trace Arrows hooks (Formula Auditing)
    useTraceArrows: () => useStore(store, (s) => s.traceArrows),
    useTracedCellId: () => useStore(store, (s) => s.tracedCellId),
    useTracedSheetId: () => useStore(store, (s) => s.tracedSheetId),
    useHasTraceArrows: () => useStore(store, (s) => selectHasTraceArrows(s)),
    useTraceArrowsForSheet: (sheetId: SheetId) =>
      useStore(store, (s) => selectTraceArrowsForSheet(s, sheetId)),
    // Trace arrows actions (for components that need to modify state)
    useTraceArrowsActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          addPrecedentArrows: s.addPrecedentArrows,
          addDependentArrows: s.addDependentArrows,
          removeArrowsForCell: s.removeArrowsForCell,
          removeAllArrows: s.removeAllArrows,
          removePrecedentArrows: s.removePrecedentArrows,
          removeDependentArrows: s.removeDependentArrows,
          clearAllTraceArrows: s.clearAllTraceArrows,
          setTracedCell: s.setTracedCell,
        })),
      ),
    // Named Ranges Dialog hooks
    useDefineNameDialog: () => useStore(store, (s) => s.defineNameDialog),
    useIsDefineNameDialogOpen: () => useStore(store, (s) => s.defineNameDialog.isOpen),
    useNameManagerDialog: () => useStore(store, (s) => s.nameManagerDialog),
    useIsNameManagerDialogOpen: () => useStore(store, (s) => s.nameManagerDialog.isOpen),
    // Sort Dialog hooks
    useSortDialog: () => useStore(store, (s) => s.sortDialog),
    useIsSortDialogOpen: () => useStore(store, (s) => s.sortDialog.isOpen),
    useSortDialogRange: () => useStore(store, (s) => s.sortDialog.range),
    useSortDialogHasHeaders: () => useStore(store, (s) => s.sortDialog.hasHeaders),
    // Insert/Delete Cells Dialog hooks
    useInsertCellsDialog: () => useStore(store, (s) => s.insertCellsDialog),
    useIsInsertCellsDialogOpen: () => useStore(store, (s) => s.insertCellsDialog.isOpen),
    useInsertCellsDialogMode: () => useStore(store, (s) => s.insertCellsDialog.mode),
    useInsertCellsDialogDirection: () => useStore(store, (s) => s.insertCellsDialog.direction),
    // Protection Alert Dialog hooks
    useProtectionAlertOpen: () => useStore(store, (s) => s.protectionAlertOpen),
    useProtectionAlertMessage: () => useStore(store, (s) => s.protectionAlertMessage),
    useProtectionAlertActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showProtectionAlert: s.showProtectionAlert,
          dismissProtectionAlert: s.dismissProtectionAlert,
        })),
      ),
    // Slicer Dialog hooks
    useInsertSlicerDialog: () => useStore(store, (s) => s.insertSlicerDialog),
    useIsInsertSlicerDialogOpen: () => useStore(store, (s) => s.insertSlicerDialog.isOpen),
    useSlicerSettingsPanel: () => useStore(store, (s) => s.slicerSettingsPanel),
    useIsSlicerSettingsPanelOpen: () => useStore(store, (s) => s.slicerSettingsPanel.isOpen),
    useSlicerDialogActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          openInsertSlicerDialog: s.openInsertSlicerDialog,
          closeInsertSlicerDialog: s.closeInsertSlicerDialog,
          toggleSlicerColumn: s.toggleSlicerColumn,
          selectAllSlicerColumns: s.selectAllSlicerColumns,
          deselectAllSlicerColumns: s.deselectAllSlicerColumns,
          openSlicerSettingsPanel: s.openSlicerSettingsPanel,
          closeSlicerSettingsPanel: s.closeSlicerSettingsPanel,
          updateSlicerSettings: s.updateSlicerSettings,
        })),
      ),
    // Sheet View State hooks (Per-Sheet Selection Memory)
    useSheetViewStates: () => useStore(store, (s) => s.sheetViewStates),
    useSheetViewState: (sheetId: SheetId) => useStore(store, (s) => s.sheetViewStates.get(sheetId)),
    useSheetViewStateActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          saveSheetViewState: s.saveSheetViewState,
          getSheetViewState: s.getSheetViewState,
          deleteSheetViewState: s.deleteSheetViewState,
        })),
      ),
    // MRU Functions hooks (14.4: Insert Function MRU Category)
    useMRUFunctions: () => useStore(store, (s) => s.mruFunctions),
    useMRUFunctionsActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          trackMRUFunction: s.trackMRUFunction,
          loadMRUFromStorage: s.loadMRUFromStorage,
          clearMRUFunctions: s.clearMRUFunctions,
        })),
      ),
    // Selection Modes hooks:
    // useEndMode / useExtendSelectionMode / useAddToSelectionMode /
    // useSelectionModeIndicator now live in
    // hooks/selection/use-granular-selection.ts as
    // useSelectionMode('end' | 'extend' | 'additive') and
    // useSelectionModeIndicator(). They subscribe to the selection actor
    // (`ctx.modes`), not UIStore — the slice fields were retired.
    // The toggle / activate / deactivate / exit methods also moved: callers
    // use commands.selection.{setMode,exitAllModes} instead.
    // Red Border for Invalid Operations
    useSelectionError: () => useStore(store, (s) => s.selectionError),
    useHasSelectionError: () => useStore(store, (s) => s.selectionError !== null),
    useSelectionModesActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          // Red Border for Invalid Operations
          setSelectionError: s.setSelectionError,
          clearSelectionError: s.clearSelectionError,
        })),
      ),
    // AutoFill Options hooks (AutoFill Options Button)
    useAutofillOptions: () => useStore(store, (s) => s.autofillOptions),
    useIsAutofillOptionsVisible: () => useStore(store, (s) => s.autofillOptions.isVisible),
    useAutofillOptionsActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showAutofillOptionsButton: s.showAutofillOptionsButton,
          hideAutofillOptionsButton: s.hideAutofillOptionsButton,
        })),
      ),
    // Fill Context Menu hooks (Right-Click Drag Fill)
    useFillContextMenu: () => useStore(store, (s) => s.fillContextMenu),
    useIsFillContextMenuOpen: () => useStore(store, (s) => s.fillContextMenu.isOpen),
    useFillContextMenuActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showFillContextMenu: s.showFillContextMenu,
          hideFillContextMenu: s.hideFillContextMenu,
        })),
      ),
    // Repeat Action hooks (F4 Repeat Last Action)
    useLastRepeatableAction: () => useStore(store, (s) => s.lastRepeatableAction),
    useRepeatActionActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          setLastRepeatableAction: s.setLastRepeatableAction,
          clearLastRepeatableAction: s.clearLastRepeatableAction,
        })),
      ),
    // Validation Tooltip hooks (Input Message Tooltip)
    useInputMessageTooltip: () => useStore(store, (s) => s.inputMessageTooltip),
    useIsInputMessageTooltipVisible: () => useStore(store, (s) => s.inputMessageTooltip !== null),
    useValidationTooltipActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showInputMessageTooltip: s.showInputMessageTooltip,
          hideInputMessageTooltip: s.hideInputMessageTooltip,
        })),
      ),
    // Progressive Selection hooks (Table Progressive Column Selection)
    useProgressiveSelection: () =>
      useStore(
        store,
        useShallow((s) => ({
          stage: s.stage,
          tableId: s.tableId,
          columnIndex: s.columnIndex,
        })),
      ),
    useIsProgressiveSelectionActive: () =>
      useStore(store, (s) => selectIsProgressiveSelectionActive(s)),
    useProgressiveSelectionInfo: () => useStore(store, (s) => selectProgressiveSelectionInfo(s)),
    useProgressiveSelectionActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          startProgressiveSelection: s.startProgressiveSelection,
          advanceProgressiveSelection: s.advanceProgressiveSelection,
          resetProgressiveSelection: s.resetProgressiveSelection,
        })),
      ),
    // Formula Bar hooks (Ctrl+Shift+U Expand/Collapse)
    useFormulaBarExpanded: () => useStore(store, (s) => s.formulaBarExpanded),
    useFormulaBarActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          toggleFormulaBarExpand: s.toggleFormulaBarExpand,
          setFormulaBarExpanded: s.setFormulaBarExpanded,
        })),
      ),
    // Total Row Dropdown hooks (Total Row Function Dropdown)
    useTotalRowDropdown: () => useStore(store, (s) => s.totalRowDropdown),
    useIsTotalRowDropdownOpen: () => useStore(store, (s) => s.totalRowDropdown.isOpen),
    useTotalRowDropdownActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          openTotalRowDropdown: s.openTotalRowDropdown,
          closeTotalRowDropdown: s.closeTotalRowDropdown,
        })),
      ),
    usePreviewFont: () => useStore(store, (s) => s.previewFont),
    useFontPreviewActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          setPreviewFont: s.setPreviewFont,
          clearPreviewFont: s.clearPreviewFont,
        })),
      ),
    useShowAllComments: () => useStore(store, (s) => s.showAllComments),
    useCommentsUIActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          toggleShowAllComments: s.toggleShowAllComments,
          setShowAllComments: s.setShowAllComments,
        })),
      ),
    usePendingAnnouncement: () => useStore(store, (s) => s.pendingAnnouncement),
    useAccessibilityActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          announce: s.announce,
          clearAnnouncement: s.clearAnnouncement,
        })),
      ),
    useFlashFillPreview: () => useStore(store, (s) => s.flashFillPreview),
    useIsFlashFillPreviewActive: () => useStore(store, (s) => s.flashFillPreview.isShowingPreview),
    useFlashFillPreviewActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showFlashFillPreview: s.showFlashFillPreview,
          hideFlashFillPreview: s.hideFlashFillPreview,
          updateFlashFillPreviewValues: s.updateFlashFillPreviewValues,
        })),
      ),
    useMissingFontsDialog: () => useStore(store, (s) => s.missingFontsDialog),
    useIsMissingFontsDialogOpen: () => useStore(store, (s) => s.missingFontsDialog.isOpen),
    useMissingFontsDialogActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showMissingFontsDialog: s.showMissingFontsDialog,
          closeMissingFontsDialog: s.closeMissingFontsDialog,
          clearMissingFonts: s.clearMissingFonts,
        })),
      ),
    // Chart Engine Rearchitecture - Chart UI hooks
    // Chart Canvas Rendering - Title Editor hooks
    useChartTooltip: () => useStore(store, (s) => selectChartTooltip(s)),
    useIsChartTooltipVisible: () => useStore(store, (s) => selectIsChartTooltipVisible(s)),
    useChartEditorTab: () => useStore(store, (s) => s.chartEditorTab),
    useHasAnyChartErrors: () => useStore(store, (s) => selectHasAnyChartErrors(s)),
    useChartError: (chartId: string) => useStore(store, (s) => s.chartErrors.get(chartId)),
    useEditingChartTitleId: () => useStore(store, (s) => selectEditingChartTitleId(s)),
    useIsChartTitleEditorOpen: () => useStore(store, (s) => selectIsChartTitleEditorOpen(s)),
    useChartUIActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          showChartTooltip: s.showChartTooltip,
          hideChartTooltip: s.hideChartTooltip,
          setChartError: s.setChartError,
          clearChartError: s.clearChartError,
          clearAllChartErrors: s.clearAllChartErrors,
          setChartEditorTab: s.setChartEditorTab,
          openChartTitleEditor: s.openChartTitleEditor,
          closeChartTitleEditor: s.closeChartTitleEditor,
        })),
      ),
    // Toolbar Format State hooks (Zustand migration from ToolbarContext)
    // Active cell format for toolbar display - updated by toolbar-format-coordination
    useActiveCellFormat: () => useStore(store, (s) => s.activeCellFormat),
    // Selection ranges for toolbar operations - updated by toolbar-format-coordination
    useToolbarRanges: () => useStore(store, (s) => s.toolbarRanges),
    // Contextual Tabs State hooks (Sparkline/Chart/Table/Picture contextual tab visibility)
    // These booleans are updated by coordinator modules, not by component subscriptions
    useHasSparklineInActiveCell: () =>
      useStore(store, (s) => s.contextualTabs.hasSparklineInActiveCell),
    // Equation Dialog hooks
    useEquationDialog: () => useStore(store, (s) => s.equationDialog),
    useIsEquationDialogOpen: () => useStore(store, (s) => s.equationDialog.isOpen),
    useEquationLatex: () => useStore(store, (s) => s.equationDialog.latex),
    useEquationCategory: () => useStore(store, (s) => s.equationDialog.selectedCategory),
    useEquationDialogActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          openEquationDialog: s.openEquationDialog,
          openEquationDialogForEdit: s.openEquationDialogForEdit,
          closeEquationDialog: s.closeEquationDialog,
          setEquationLatex: s.setEquationLatex,
          setEquationCategory: s.setEquationCategory,
          applyEquationTemplate: s.applyEquationTemplate,
          setEquationPreviewLoading: s.setEquationPreviewLoading,
          setEquationPreviewError: s.setEquationPreviewError,
          addRecentEquationTemplate: s.addRecentEquationTemplate,
          clearRecentEquationTemplates: s.clearRecentEquationTemplates,
        })),
      ),
    // Diagram UI hooks (Excel Parity - Diagram Feature)
    // NOTE: Selection state hooks are deprecated. Use useDiagramUI() from state/hooks/use-diagram.ts instead.
    useDiagramDialogOpen: () => useStore(store, (s) => s.dialogOpen),
    /** @deprecated Use useDiagramUI().selectedObjectId instead */
    useSelectedDiagramId: () => useStore(store, (s) => s.selectedDiagramId),
    /** @deprecated Use useDiagramUI().selectedNodeIds instead */
    useSelectedNodeIds: () => useStore(store, (s) => s.selectedNodeIds),
    /** @deprecated Use useDiagramUI().editingNodeId instead */
    useEditingNodeId: () => useStore(store, (s) => s.editingNodeId),
    useTextPaneVisible: () => useStore(store, (s) => s.textPaneVisible),
    useDiagramActions: () =>
      useStore(
        store,
        useShallow((s) => ({
          openDiagramDialog: s.openDiagramDialog,
          closeDiagramDialog: s.closeDiagramDialog,
          /** @deprecated Use useDiagramUI().selectNode() instead */
          selectDiagram: s.selectDiagram,
          /** @deprecated Use useDiagramUI().deselect() instead */
          deselectDiagram: s.deselectDiagram,
          /** @deprecated Use useDiagramUI().selectNode() instead */
          selectNode: s.selectNode,
          /** @deprecated Use useDiagramUI().multiSelectNode() instead */
          selectNodes: s.selectNodes,
          /** @deprecated Use useDiagramUI().deselect() instead */
          deselectNodes: s.deselectNodes,
          /** @deprecated Use useDiagramUI().startEdit() instead */
          startEditingNode: s.startEditingNode,
          /** @deprecated Use useDiagramUI().commitEdit() or cancelEdit() instead */
          stopEditingNode: s.stopEditingNode,
          toggleTextPane: s.toggleTextPane,
          setTextPaneVisible: s.setTextPaneVisible,
        })),
      ),
    // NOTE: Navigation and RecordDetail hooks removed - they are now in ShellContext
    // Use useShellStore() from shell-context.tsx to access activeViewId, recordDetail, etc.
  };
}

// =============================================================================
// Re-exports
// =============================================================================

// Re-export types
export { DEFAULT_SHEET_VIEW_STATE } from './slices';
// Red Border for Invalid Operations
export type { SelectionError } from './slices';
// Selection Undo/Redo Checkpointing
export type { SelectionCheckpoint } from './types';
// Pivot Dialog types
export type { PivotLocationMode } from './slices/dialogs/pivot-dialog';
export type {
  CFDialogState,
  DVDialogState,
  DVValidationType,
  DefineNameDialogState,
  EditSparklineDialogState,
  // Equation Dialog
  EquationDialogState,
  EquationTemplate,
  EquationTemplateCategory,
  // Fill Context Menu (right-click drag fill)
  FillContextMenuState,
  FillOptionType,
  FlashFillPreviewValue,
  FormatPainterState,
  HyperlinkDialogState,
  InsertCellsDialogState,
  InsertDeleteMode,
  InsertPictureDialogState,
  InsertShapeMenuState,
  InsertSlicerDialogState,
  NameManagerDialogState,
  NameManagerFilter,
  ObjectContextMenuState,
  PivotUIState,
  QuickRuleDialogType,
  SheetViewState,
  ShiftDirection,
  SlicerColumnOption,
  SlicerPivotFieldOption,
  SlicerSettingsPanelState,
  SortDialogState,
  SparklineDialogState,
  SubtotalDialogState,
  TableDesignState,
  TraceArrowsSliceActions,
  TraceArrowsSliceState,
  UIState,
  UndoHistoryEntry,
} from './types';

// =============================================================================
// Shell-level aliases (for backward compatibility)
// =============================================================================

/**
 * Shell-level alias for createUIStore.
 * Creates a shell UI store instance for a document.
 */
export { createUIStore as createShellUIStore };

/**
 * Shell-level alias for createUIStoreHooks.
 * Creates selector hooks bound to a specific store instance.
 */
export { createUIStoreHooks as createShellUIStoreHooks };
