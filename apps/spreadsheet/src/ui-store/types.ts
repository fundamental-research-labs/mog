/**
 * UI Store Types
 *
 * Combined type definition for the UI store.
 * Re-exports all slice types for convenience.
 */

import type { ChartClipboardSlice } from './slices/charts/chart-clipboard';
import type { ChartUISlice } from './slices/charts/chart-ui';
import type { PasteOptionsSlice } from './slices/clipboard/paste-options';
import type { PastePreviewSlice } from './slices/clipboard/paste-preview';
import type { PasteValidationSlice } from './slices/clipboard/paste-validation';
import type { ShapeClipboardSlice } from './slices/clipboard/shape-clipboard';
import type { SlicerClipboardSlice } from './slices/clipboard/slicer-clipboard';
import type { AccessibilitySlice } from './slices/core/accessibility';
import type { AccessibilityCheckerSlice } from './slices/core/accessibility-checker';
import type { MiscSlice } from './slices/core/misc';
import type { PanelTogglesSlice } from './slices/core/panel-toggles';
import type { SettingsSlice } from './slices/core/settings';
import type { DisplayModeSlice } from './slices/core/display-mode';
import type { DataToolsSlice } from './slices/data-tools/data-tools';
import type { FilterDropdownSlice } from './slices/data-tools/filter-dropdown';
import type { QuickAnalysisSlice } from './slices/data-tools/quick-analysis';
import type { SchemaBrowserSlice } from './slices/data-tools/schema-browser';
import type { WorkbookLinksPanelSlice } from './slices/data-tools/workbook-links-panel';
import type { AdvancedFilterDialogSlice } from './slices/dialogs/advanced-filter-dialog';
import type { CFDialogSlice } from './slices/dialogs/cf-dialog';
import type { ConsolidateDialogSlice } from './slices/dialogs/consolidate-dialog';
import type { CreateNamesDialogSlice } from './slices/dialogs/create-names-dialog';
import type { CustomAutoFilterDialogSlice } from './slices/dialogs/custom-autofilter-dialog';
import type { CustomListsDialogSlice } from './slices/dialogs/custom-lists-dialog';
import type { DataTableDialogSlice } from './slices/dialogs/data-table-dialog';
import type { DeleteSheetConfirmDialogSlice } from './slices/dialogs/delete-sheet-confirm-dialog';
import type { DialogStackSlice } from './slices/dialogs/dialog-stack';
import type { DragDropOverwriteDialogSlice } from './slices/dialogs/drag-drop-overwrite-dialog';
import type { DVDialogSlice } from './slices/dialogs/dv-dialog';
import type { EquationDialogSlice } from './slices/dialogs/equation-dialog';
import type { ErrorCheckingDialogSlice } from './slices/dialogs/error-checking-dialog';
import type { EvaluateFormulaDialogSlice } from './slices/dialogs/evaluate-formula-dialog';
import type { FillMergeConflictDialogSlice } from './slices/dialogs/fill-merge-conflict-dialog';
import type { FillSeriesDialogSlice } from './slices/dialogs/fill-series-dialog';
import type { FormatCellsDialogSlice } from './slices/dialogs/format-cells-dialog';
import type { FormulaErrorDialogSlice } from './slices/dialogs/formula-error-dialog';
import type { FunctionArgumentsDialogSlice } from './slices/dialogs/function-arguments-dialog';
import type { GoalSeekDialogSlice } from './slices/dialogs/goal-seek-dialog';
import type { GoToDialogSlice } from './slices/dialogs/goto-dialog';
import type { GoToSpecialDialogSlice } from './slices/dialogs/goto-special-dialog';
import type { HyperlinkDialogSlice } from './slices/dialogs/hyperlink-dialog';
import type { InsertCellsDialogSlice } from './slices/dialogs/insert-cells-dialog';
import type { InsertChartWizardDialogSlice } from './slices/dialogs/insert-chart-wizard-dialog';
import type { LargeFillDialogSlice } from './slices/dialogs/large-fill-dialog';
import type { MergeWarningDialogSlice } from './slices/dialogs/merge-warning-dialog';
import type { MissingFontsDialogSlice } from './slices/dialogs/missing-fonts-dialog';
import type { MoreColorsDialogSlice } from './slices/dialogs/more-colors-dialog';
import type { NamedRangesDialogSlice } from './slices/dialogs/named-ranges-dialog';
import type { PasteMismatchDialogSlice } from './slices/dialogs/paste-mismatch-dialog';
import type { PasteOverwriteConfirmDialogSlice } from './slices/dialogs/paste-overwrite-confirm-dialog';
import type { PdfExportDialogSlice } from './slices/dialogs/pdf-export-dialog';
import type { PictureDialogsSlice } from './slices/dialogs/picture-dialogs';
import type { PivotDialogSlice } from './slices/dialogs/pivot-dialog';
import type { ProtectSheetDialogSlice } from './slices/dialogs/protect-sheet-dialog';
import type { ProtectWorkbookDialogSlice } from './slices/dialogs/protect-workbook-dialog';
import type { UnprotectSheetDialogSlice } from './slices/dialogs/unprotect-sheet-dialog';
import type { ResizeDialogsSlice } from './slices/dialogs/resize-dialogs';
import type { ScenarioManagerDialogSlice } from './slices/dialogs/scenario-manager-dialog';
import type { SelectDataDialogSlice } from './slices/dialogs/select-data-dialog';
import type { SlicerConnectionsDialogSlice } from './slices/dialogs/slicer-connections-dialog';
import type { SlicerDialogSlice } from './slices/dialogs/slicer-dialog';
import type { SlicerReportConnectionsDialogSlice } from './slices/dialogs/slicer-report-connections-dialog';
import type { SlicerSizePropertiesDialogSlice } from './slices/dialogs/slicer-size-properties-dialog';
import type { SortDialogSlice } from './slices/dialogs/sort-dialog';
import type { SparklineDialogsSlice } from './slices/dialogs/sparkline-dialogs';
import type { SpellingDialogSlice } from './slices/dialogs/spelling-dialog';
import type { SubtotalDialogSlice } from './slices/dialogs/subtotal-dialog';
import type { TableDialogsSlice } from './slices/dialogs/table-dialogs';
import type { ValidationErrorDialogSlice } from './slices/dialogs/validation-error-dialog';
import type { ValidationWarningDialogSlice } from './slices/dialogs/validation-warning-dialog';
import type { AutoFillOptionsSlice } from './slices/editing/autofill-options';
import type { FlashFillSlice } from './slices/editing/flash-fill';
import type { FormatPainterSlice } from './slices/editing/format-painter';
import type { PendingCellFormatSlice } from './slices/editing/pending-cell-format';
import type { RepeatActionSlice } from './slices/editing/repeat-action';
import type { UndoSlice } from './slices/editing/undo';
import type { FormulaBarSlice } from './slices/formulas/formula-bar';
import type { FormulasSlice } from './slices/formulas/formulas';
import type { NLFormulaBarSlice } from './slices/nl-formula/nl-formula-bar';
import type { MRUFunctionsSlice } from './slices/formulas/mru-functions';
import type { TraceArrowsSlice } from './slices/formulas/trace-arrows';
import type { WatchWindowSlice } from './slices/formulas/watch-window';
import type { ActiveSheetSlice } from './slices/navigation/active-sheet';
import type { SplitViewSlice } from './slices/navigation/split-view';
import type { ZoomSlice } from './slices/navigation/zoom';
import type { FloatingObjectsSlice } from './slices/objects/floating-objects';
import type { InkSlice } from './slices/objects/ink';
import type { ObjectClipboardSlice } from './slices/objects/object-clipboard';
import type { DiagramUISlice } from './slices/objects/diagram';
import type { TextEffectSlice } from './slices/objects/text-effects';
import type { BordersPickerSlice } from './slices/pickers/borders-picker';
import type { FillColorPickerSlice } from './slices/pickers/fill-color-picker';
import type { FontColorPickerSlice } from './slices/pickers/font-color-picker';
import type { FontFamilyPickerSlice } from './slices/pickers/font-family-picker';
import type { NumberFormatDropdownSlice } from './slices/pickers/number-format-dropdown';
import type { ActiveRibbonTabSlice } from './slices/ribbon/active-tab';
import type { BackstageSlice } from './slices/ribbon/backstage';
import type { ContextualTabsSlice } from './slices/ribbon/contextual-tabs';
import type { RibbonDropdownsSlice } from './slices/ribbon/ribbon-dropdowns';
import type { RibbonSlice } from './slices/ribbon/ribbon';
import type { ToolbarSlice } from './slices/ribbon/toolbar';
import type { CtrlAStateSlice } from './slices/selection/ctrl-a-state';
import type { RangeSelectionModeSlice } from './slices/selection/range-selection-mode';
import type { SelectionCheckpointSlice } from './slices/selection/selection-checkpoint';
import type { SelectionModesSlice } from './slices/selection/selection-modes';
import type { CommentsUISlice } from './slices/sheets/comments';
import type { SheetOperationsSlice } from './slices/sheets/sheet-operations';
import type { TableAutoCorrectOptionsSlice } from './slices/tables/table-autocorrect-options';
import type { TableClickSelectionSlice } from './slices/tables/table-click-selection';
import type { TableDesignSlice } from './slices/tables/table-design';
import type { TableProgressiveSelectionSlice } from './slices/tables/table-progressive-selection';
import type { TotalRowDropdownSlice } from './slices/tables/total-row-dropdown';
import type { ContextMenuSlice } from './slices/view/context-menu';
import type { CornerRotationSlice } from './slices/view/corner-rotation';
import type { FillContextMenuSlice } from './slices/view/fill-context-menu';
import type { SheetViewStateSlice } from './slices/view/sheet-view-state';
import type { TransientVisualFeedbackSlice } from './slices/view/transient-visual-feedback';
import type { ValidationCirclesSlice } from './slices/view/validation-circles';
import type { ValidationTooltipSlice } from './slices/view/validation-tooltip';

/**
 * Combined UI State type - intersection of all slices
 */
export type UIState = ActiveSheetSlice &
  CFDialogSlice &
  DVDialogSlice &
  PivotDialogSlice &
  SheetOperationsSlice &
  FilterDropdownSlice &
  FillSeriesDialogSlice &
  FillContextMenuSlice &
  FormatCellsDialogSlice &
  FormulaErrorDialogSlice &
  FormatPainterSlice &
  ZoomSlice &
  RibbonSlice &
  FormulasSlice &
  FunctionArgumentsDialogSlice &
  GoToDialogSlice &
  GoToSpecialDialogSlice &
  UndoSlice &
  ContextMenuSlice &
  CtrlAStateSlice &
  CornerRotationSlice &
  ResizeDialogsSlice &
  DataToolsSlice &
  QuickAnalysisSlice &
  SettingsSlice &
  DisplayModeSlice &
  HyperlinkDialogSlice &
  InsertCellsDialogSlice &
  SparklineDialogsSlice &
  FloatingObjectsSlice &
  PictureDialogsSlice &
  TableDesignSlice &
  TableDialogsSlice &
  SubtotalDialogSlice &
  TraceArrowsSlice &
  ValidationCirclesSlice &
  NamedRangesDialogSlice &
  CreateNamesDialogSlice &
  SortDialogSlice &
  SlicerDialogSlice &
  SlicerConnectionsDialogSlice &
  SheetViewStateSlice &
  BackstageSlice &
  PasteOptionsSlice &
  PastePreviewSlice &
  PasteMismatchDialogSlice &
  PasteOverwriteConfirmDialogSlice &
  MiscSlice &
  MRUFunctionsSlice &
  SelectionModesSlice &
  AutoFillOptionsSlice &
  PendingCellFormatSlice &
  RepeatActionSlice &
  ChartClipboardSlice &
  ChartUISlice &
  ShapeClipboardSlice &
  CustomAutoFilterDialogSlice &
  MoreColorsDialogSlice &
  ValidationTooltipSlice &
  ValidationErrorDialogSlice &
  ValidationWarningDialogSlice &
  TableProgressiveSelectionSlice &
  TableClickSelectionSlice &
  ProtectSheetDialogSlice &
  UnprotectSheetDialogSlice &
  ProtectWorkbookDialogSlice &
  DeleteSheetConfirmDialogSlice &
  FormulaBarSlice &
  NLFormulaBarSlice &
  MergeWarningDialogSlice &
  TotalRowDropdownSlice &
  DragDropOverwriteDialogSlice &
  SelectionCheckpointSlice &
  RangeSelectionModeSlice &
  SelectDataDialogSlice &
  CommentsUISlice &
  PanelTogglesSlice &
  AccessibilitySlice &
  AccessibilityCheckerSlice &
  MissingFontsDialogSlice &
  FlashFillSlice &
  PdfExportDialogSlice &
  AdvancedFilterDialogSlice &
  InsertChartWizardDialogSlice &
  FillMergeConflictDialogSlice &
  LargeFillDialogSlice &
  CustomListsDialogSlice &
  PasteValidationSlice &
  GoalSeekDialogSlice &
  ConsolidateDialogSlice &
  SpellingDialogSlice &
  WatchWindowSlice &
  ErrorCheckingDialogSlice &
  EvaluateFormulaDialogSlice &
  TableAutoCorrectOptionsSlice &
  TransientVisualFeedbackSlice &
  ToolbarSlice &
  ContextualTabsSlice &
  InkSlice &
  DataTableDialogSlice &
  ScenarioManagerDialogSlice &
  SplitViewSlice &
  DiagramUISlice &
  TextEffectSlice &
  EquationDialogSlice &
  DialogStackSlice &
  SchemaBrowserSlice &
  WorkbookLinksPanelSlice &
  ObjectClipboardSlice &
  SlicerClipboardSlice &
  SlicerReportConnectionsDialogSlice &
  SlicerSizePropertiesDialogSlice &
  // Unified Keytip Router: ribbon tab + picker slices
  ActiveRibbonTabSlice &
  BordersPickerSlice &
  FillColorPickerSlice &
  FontColorPickerSlice &
  FontFamilyPickerSlice &
  NumberFormatDropdownSlice &
  // Unified Keytip Router: named ribbon-dropdown open-state map
  RibbonDropdownsSlice;

// Re-export all slice types for convenience
export type {
  AccessibilityCheckerSlice,
  AccessibilitySlice,
  DisplayModeSlice,
  ActiveSheetSlice,
  AutoFillOptionsSlice,
  BackstageSlice,
  CFDialogSlice,
  ChartUISlice,
  CommentsUISlice,
  ContextMenuSlice,
  CornerRotationSlice,
  CtrlAStateSlice,
  CustomListsDialogSlice,
  DataTableDialogSlice,
  DataToolsSlice,
  DeleteSheetConfirmDialogSlice,
  DialogStackSlice,
  DVDialogSlice,
  EquationDialogSlice,
  FillContextMenuSlice,
  FillSeriesDialogSlice,
  FilterDropdownSlice,
  FlashFillSlice,
  FloatingObjectsSlice,
  FormatCellsDialogSlice,
  FormatPainterSlice,
  FormulasSlice,
  FunctionArgumentsDialogSlice,
  GoToDialogSlice,
  GoToSpecialDialogSlice,
  HyperlinkDialogSlice,
  InkSlice,
  InsertCellsDialogSlice,
  MiscSlice,
  MRUFunctionsSlice,
  NamedRangesDialogSlice,
  ObjectClipboardSlice,
  PanelTogglesSlice,
  PasteMismatchDialogSlice,
  PasteOptionsSlice,
  PastePreviewSlice,
  PasteValidationSlice,
  PendingCellFormatSlice,
  PictureDialogsSlice,
  PivotDialogSlice,
  ProtectSheetDialogSlice,
  ProtectWorkbookDialogSlice,
  UnprotectSheetDialogSlice,
  QuickAnalysisSlice,
  RangeSelectionModeSlice,
  ResizeDialogsSlice,
  RibbonDropdownsSlice,
  RibbonSlice,
  SchemaBrowserSlice,
  WorkbookLinksPanelSlice,
  SelectionCheckpointSlice,
  SettingsSlice,
  SheetOperationsSlice,
  SheetViewStateSlice,
  SlicerClipboardSlice,
  SlicerConnectionsDialogSlice,
  SlicerDialogSlice,
  SlicerReportConnectionsDialogSlice,
  SlicerSizePropertiesDialogSlice,
  DiagramUISlice,
  SortDialogSlice,
  SparklineDialogsSlice,
  SplitViewSlice,
  SubtotalDialogSlice,
  TableAutoCorrectOptionsSlice,
  TableDesignSlice,
  TableDialogsSlice,
  TableProgressiveSelectionSlice,
  ToolbarSlice,
  TotalRowDropdownSlice,
  TraceArrowsSlice,
  UndoSlice,
  ValidationCirclesSlice,
  ValidationTooltipSlice,
  TextEffectSlice,
  ZoomSlice,
};

// Re-export state types
export type {
  ChartClipboardData,
  ChartClipboardSlice,
  ChartClipboardState,
} from './slices/charts/chart-clipboard';
export type {
  ChartEditorTab,
  ChartError,
  ChartErrorCode,
  ChartTooltipData,
  ChartUIState,
} from './slices/charts/chart-ui';
export type {
  PasteValidationDialogState,
  PasteValidationSummary,
} from './slices/clipboard/paste-validation';
export type { AnnouncementPriority, PendingAnnouncement } from './slices/core/accessibility';
export type {
  AccessibilityCheckerState,
  AccessibilityCheckStatus,
} from './slices/core/accessibility-checker';
export type { FilterDropdownState } from './slices/data-tools/filter-dropdown';
export type {
  ColumnSchema,
  SchemaBrowserState,
  SchemaData,
  TableSchema,
} from './slices/data-tools/schema-browser';
export type { WorkbookLinksPanelState } from './slices/data-tools/workbook-links-panel';
export type { CFDialogState, QuickRuleDialogType } from './slices/dialogs/cf-dialog';
export type {
  CustomAutoFilterDialogSlice,
  CustomAutoFilterDialogState,
  CustomFilterCondition,
  CustomFilterOperator,
} from './slices/dialogs/custom-autofilter-dialog';
export type {
  DataTableDialogState,
  DataTableResultInfo,
  DataTableStatus,
} from './slices/dialogs/data-table-dialog';
export type { DialogEntry } from './slices/dialogs/dialog-stack';
export type {
  DragDropOverwriteDialogSlice,
  DragDropOverwriteDialogState,
  PendingDragDropData,
} from './slices/dialogs/drag-drop-overwrite-dialog';
export type { DVDialogState, DVValidationType } from './slices/dialogs/dv-dialog';
export type {
  EquationDialogState,
  EquationTemplate,
  EquationTemplateCategory,
} from './slices/dialogs/equation-dialog';
export type { FillSeriesDialogState } from './slices/dialogs/fill-series-dialog';
export type { GoToDialogState, RecentLocation } from './slices/dialogs/goto-dialog';
export type {
  GoToSpecialDialogState,
  GoToSpecialType,
  ValueTypeFilter,
} from './slices/dialogs/goto-special-dialog';
export type { HyperlinkDialogState } from './slices/dialogs/hyperlink-dialog';
export type {
  InsertCellsDialogState,
  InsertDeleteMode,
  ShiftDirection,
} from './slices/dialogs/insert-cells-dialog';
export type {
  LargeFillDialogSlice,
  LargeFillDialogState,
  PendingLargeFillData,
} from './slices/dialogs/large-fill-dialog';
export type {
  ColorTargetType,
  HSLColor,
  MoreColorsDialogSlice,
  MoreColorsDialogState,
  RGBColor,
} from './slices/dialogs/more-colors-dialog';
export type {
  DefineNameDialogState,
  NameManagerDialogState,
  NameManagerFilter,
} from './slices/dialogs/named-ranges-dialog';
export type {
  PasteMismatchDialogState,
  PasteSize,
  PendingPasteData,
} from './slices/dialogs/paste-mismatch-dialog';
export type {
  PasteOverwriteConfirmDialogSlice,
  PasteOverwriteConfirmDialogState,
  PendingCutPasteData,
} from './slices/dialogs/paste-overwrite-confirm-dialog';
export type {
  EditAltTextDialogState,
  FormatPictureDialogState,
} from './slices/dialogs/picture-dialogs';
export type { PivotUIState } from './slices/dialogs/pivot-dialog';
export type { ProtectSheetDialogState } from './slices/dialogs/protect-sheet-dialog';
export type { UnprotectSheetDialogState } from './slices/dialogs/unprotect-sheet-dialog';
export type {
  HiddenEmptyCellsOptions,
  SelectDataDialogState,
  SelectDataSeries,
} from './slices/dialogs/select-data-dialog';
export type { SlicerConnectionsDialogState } from './slices/dialogs/slicer-connections-dialog';
export type {
  InsertSlicerDialogState,
  SlicerColumnOption,
  SlicerPivotFieldOption,
  SlicerSettingsPanelState,
} from './slices/dialogs/slicer-dialog';
export type { SortDialogState } from './slices/dialogs/sort-dialog';
export type {
  EditSparklineDialogState,
  SparklineDialogState,
} from './slices/dialogs/sparkline-dialogs';
export type { SubtotalDialogState } from './slices/dialogs/subtotal-dialog';
export type {
  ConvertToRangeDialogState,
  CustomTableStyleDefinition,
  CustomTableStyleDialogState,
  ResizeTableDialogState,
  StripePattern,
  TableElementStyle,
  TableStyleDialogMode,
  TableStyleDialogTab,
} from './slices/dialogs/table-dialogs';
export type {
  AutoFillOptionsState,
  AutoFillOptionType,
  LastFillInfo,
} from './slices/editing/autofill-options';
export type { FlashFillPreviewState, FlashFillPreviewValue } from './slices/editing/flash-fill';
export type { FormatPainterState } from './slices/editing/format-painter';
export type {
  RepeatableAction,
  RepeatActionSlice,
  RepeatActionState,
} from './slices/editing/repeat-action';
export type { UndoHistoryEntry } from './slices/editing/undo';
export type {
  TraceArrowsSliceActions,
  TraceArrowsSliceState,
} from './slices/formulas/trace-arrows';
export type {
  InsertPictureDialogState,
  InsertShapeMenuState,
  ObjectContextMenuState,
} from './slices/objects/floating-objects';
export type { DiagramUIState } from './slices/objects/diagram';
export type { TextEffectUIState } from './slices/objects/text-effects';
export type { BackstagePanelType, BackstageState } from './slices/ribbon/backstage';
export type {
  RangeSelectionInputMode,
  RangeSelectionModeState,
} from './slices/selection/range-selection-mode';
export type { SelectionCheckpoint } from './slices/selection/selection-checkpoint';
export type {
  CalculatedColumnInfo,
  CalculatedColumnOption,
  TableAutoCorrectOptionsState,
  TableAutoCorrectType,
  TableExpansionInfo,
  TableExpansionOption,
} from './slices/tables/table-autocorrect-options';
export type { TableDesignState } from './slices/tables/table-design';
export type {
  ProgressiveSelectionStage,
  TableProgressiveSelectionState,
} from './slices/tables/table-progressive-selection';
export type { TotalRowDropdownState } from './slices/tables/total-row-dropdown';
export type { CornerIndex } from './slices/view/corner-rotation';
export type { FillContextMenuState, FillOptionType } from './slices/view/fill-context-menu';
export type { SheetViewState } from './slices/view/sheet-view-state';
export type {
  BlockedEditAttempt,
  ShimmerEntryInput,
  TransientVisualFeedbackSlice,
} from './slices/view/transient-visual-feedback';
export type {
  ValidationCirclesSliceActions,
  ValidationCirclesSliceState,
} from './slices/view/validation-circles';
export type {
  InputMessageTooltipConfig,
  ValidationTooltipSliceActions,
  ValidationTooltipSliceState,
} from './slices/view/validation-tooltip';
