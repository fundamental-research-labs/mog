/**
 * Unified Spreadsheet API -- Public Barrel
 *
 * This is THE canonical entry point for the unified API.
 * Import path: `@mog-sdk/contracts/api`
 */
export * from './types';
export type {
  Workbook,
  WorkbookLinks,
  WorkbookInternal,
  WorkbookId,
  WorkbookSessionId,
  DocumentId,
  LinkId,
  LinkStatus,
  LinkStatusReason,
  LinkStatusView,
  WorkbookLinkStatusScope,
  PersistedLinkTarget,
  PersistedWorkbookLinkRecord,
  CalculateOptions,
  CalculateResult,
  CustomList,
  WorkbookCustomListInput,
  WorkbookCustomListUpdate,
} from './workbook';
export type {
  FormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  FormulaReferenceEdgeDiagnostic,
  FormulaReferenceEdgeDiagnosticRow,
  FormulaReferenceLocation,
  FormulaReferenceParseDiagnosticRow,
  WorkbookDiagnostics,
} from './workbook/diagnostics';
export type {
  MirrorReadView,
  MirrorFrozenPanes,
  MirrorScrollPosition,
  MirrorPageBreaks,
  MirrorPageBreakEntry,
  MirrorSplitConfig,
  MirrorSheetMeta,
} from './state-mirror';
export type {
  Worksheet,
  WorksheetWithInternals,
  ActiveCellEditSource,
  FormulaCircularReferenceValidation,
  FormulaSyntaxValidationError,
  SortByColorOptions,
  CellRecord,
  WorksheetCellsAccessor,
} from './worksheet';

// Worksheet sub-API interfaces
export type {
  ChartImageExporter,
  ConditionalFormatUpdate,
  NodeMoveDirection,
  NodePosition,
  ChangeOrigin,
  ChangeRecord,
  ChangeTracker,
  ChangeTrackOptions,
  WorksheetBindings,
  WorksheetChanges,
  WorksheetCharts,
  WorksheetComments,
  WorksheetCustomProperties,
  WorksheetConditionalFormatting,
  WorksheetFilters,
  AdvancedFilterMode,
  AdvancedFilterOptions,
  AdvancedFilterResult,
  FilterByColorOptions,
  FilterDropdownData,
  FilterDropdownItem,
  WorksheetFormControls,
  WorksheetFormats,
  WorksheetHyperlinks,
  WorksheetInternal,
  WorksheetLayout,
  RangePixelPosition,
  WorksheetNames,
  WorksheetObjects,
  WorksheetOutline,
  PivotCalculatedFieldSpec,
  PivotCreateConfig,
  PivotPlacementPatch,
  PivotPlacementSpec,
  WorksheetPivots,
  WorksheetPrint,
  AllowEditRange,
  ProtectionOperation,
  WorksheetAllowEditRanges,
  WorksheetProtection,
  WorksheetSettings,
  WorksheetSlicers,
  WorksheetDiagrams,
  WorksheetSparklines,
  WorksheetStructure,
  WorksheetStyles,
  TableRowCollection,
  WorksheetTableEvents,
  WorksheetTableSort,
  WorksheetTables,
  DropdownItemsWithRevision,
  WorksheetValidation,
  ValidationCheckResult,
  WorksheetView,
  WorksheetWhatIf,
} from './worksheet/index';

// Floating object handle types
export type {
  FloatingObjectHandle,
  ShapeHandle,
  PictureHandle,
  TextBoxHandle,
  DrawingHandle,
  EquationHandle,
  TextEffectHandle,
  ConnectorHandle,
  ChartHandle,
  DiagramHandle,
  SlicerHandle,
  OleObjectHandle,
} from './worksheet/index';

// Floating object collection types
export type {
  EquationDefaults,
  EquationStyle,
  TextEffectDefaults,
  TextEffectObjectConfig,
  WorksheetObjectCollection,
  WorksheetShapeCollection,
  WorksheetPictureCollection,
  WorksheetTextBoxCollection,
  WorksheetDrawingCollection,
  WorksheetEquationCollection,
  WorksheetTextEffectCollection,
  WorksheetConnectorCollection,
} from './worksheet/index';

// Format mapping utilities (API angle/pattern values to OOXML conversions)
export {
  officeJsAngleToOoxmlRotation,
  ooxmlRotationToOfficeJsAngle,
  officeJsPatternToOoxml,
  ooxmlPatternToOfficeJs,
  clampIndent,
  MAX_INDENT_LEVEL,
} from './worksheet/index';

// Workbook sub-API interfaces
export type {
  ViewportChangeEvent,
  ViewportRegion,
  WorkbookChanges,
  WorkbookChangeTracker,
  WorkbookChangeRecord,
  WorkbookCollectResult,
  WorkbookTrackOptions,
  WorkbookHistory,
  WorkbookNames,
  NotificationId,
  WorkbookNotifications,
  WorkbookProtection,
  WorkbookSecurity,
  WorkbookScenarios,
  WorkbookSheets,
  WorkbookSlicerStyles,
  SlicerStyleInfo,
  NamedSlicerStyle,
  WorkbookSlicers,
  WorkbookTimelineStyles,
  TimelineStyleInfo,
  NamedTimelineStyle,
  WorkbookTableStyles,
  WorkbookCellStyles,
  CellStyleCatalog,
  CellStyleCategoryInfo,
  CellStyleListOptions,
  CellStyleSource,
  TableStyleInfoWithReadOnly,
  WorkbookPivotTableStyles,
  PivotTableStyleInfo,
  WorkbookFunctions,
  WorkbookTheme,
  WorkbookViewport,
  WorkbookViewportBounds,
  WorkbookStateProvider,
  WorkbookProperties,
  DocumentProperties,
} from './workbook/index';

// Mutation receipt types
export {
  isFloatingObjectMutationReceipt,
  isFloatingObjectReceipt,
  isFloatingObjectRemoveReceipt,
} from './mutation-receipt';

export type {
  AutoFilterClearReceipt,
  AutoFilterSetReceipt,
  DeleteCellsReceipt,
  DeleteColumnsReceipt,
  DeleteRowsReceipt,
  FloatingObjectDeleteReceipt,
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
  FloatingObjectReceipt,
  InsertCellsReceipt,
  InsertColumnsReceipt,
  InsertRowsReceipt,
  MergeReceipt,
  MutationReceipt,
  NameAddReceipt,
  NameRemoveReceipt,
  PivotRefreshReceipt,
  PivotRemoveReceipt,
  RedoReceipt,
  SheetHideReceipt,
  SheetMoveReceipt,
  SheetRemoveReceipt,
  SheetRenameReceipt,
  SheetShowReceipt,
  TableAddColumnReceipt,
  TableAddRowReceipt,
  TableDeleteRowReceipt,
  TableRemoveColumnReceipt,
  TableRemoveReceipt,
  TableResizeReceipt,
  UndoReceipt,
  UnmergeReceipt,
  ValidationRemoveReceipt,
  ValidationSetReceipt,
} from './mutation-receipt';

// Records API types (re-exported from types.ts but explicit for discoverability)
export type { FilterExpression, IRecordsAPI, RecordValues, TableRecord } from './types';

// Notification types (re-exported from services for convenience — apps use wb.notifications)
export type { Notification, NotificationOptions, NotificationType } from '../services/index';

// Undo event types (re-exported from services for API surface discoverability)
export type { UndoStateChangeEvent } from '../services/index';
