/**
 * Workbook Sub-API Interfaces — Barrel Export
 *
 * All workbook namespace interfaces for the unified spreadsheet API.
 */

export type { WorkbookHistory } from './history';
export type {
  FormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  FormulaReferenceEdgeDiagnostic,
  FormulaReferenceEdgeDiagnosticRow,
  ImportDiagnosticDetails,
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
  ImportDiagnosticPhase,
  ImportDiagnosticRecoverability,
  ImportDiagnosticSeverity,
  ImportFilterUnsupportedReason,
  FormulaReferenceLocation,
  FormulaReferenceParseDiagnosticRow,
  MaterializationPhase,
  MaterializationState,
  ResolvedChartSpecDiagnosticsOptions,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  RuntimeOperationDiagnostic,
  CheckErrorsOptions,
  ValidateWorkbookOptions,
  WorkbookBlankRegionCheckInput,
  WorkbookDiagnostics,
  WorkbookExternalReferenceCheckOptions,
  WorkbookFormulaShapeCheckInput,
  WorkbookFormulaShapeRangeRequest,
  WorkbookValidationCheckKind,
  WorkbookValidationCheckResult,
  WorkbookValidationCheckStatus,
  WorkbookValidationFinding,
  WorkbookValidationRangeRequest,
  WorkbookValidationResult,
  WorkbookValidationScanOptions,
  WorkbookValidationSeverity,
} from './diagnostics';
export type { WorkbookNames } from './names';
export type { NotificationId, WorkbookNotifications } from './notifications';
export type { WorkbookProtection } from './protection';
export type { WorkbookSecurity } from './security';
export type { WorkbookScenarios } from './scenarios';
export type { WorkbookSheets } from './sheets';
export type { WorkbookSlicerStyles, SlicerStyleInfo, NamedSlicerStyle } from './slicer-styles';
export type { WorkbookSlicers } from './slicers';
export type {
  WorkbookTimelineStyles,
  TimelineStyleInfo,
  NamedTimelineStyle,
} from './timeline-styles';
export type { WorkbookPivotTableStyles, PivotTableStyleInfo } from './pivot-styles';
export type { WorkbookFunctions } from './functions';
export type { WorkbookTableStyles, TableStyleInfoWithReadOnly } from './table-styles';
export type {
  CellStyleCatalog,
  CellStyleCategoryInfo,
  CellStyleListOptions,
  CellStyleSource,
  WorkbookCellStyles,
} from './cell-styles';
export type { WorkbookTheme } from './theme';
export type { ViewportChangeEvent, ViewportRegion, WorkbookViewport } from './viewport';
export type { ViewportBounds as WorkbookViewportBounds } from './viewport';
export type { WorkbookStateProvider } from './state-provider';
export type { WorkbookProperties, DocumentProperties } from './properties';
export type {
  WorkbookChanges,
  WorkbookChangeTracker,
  WorkbookChangeRecord,
  WorkbookCollectResult,
  WorkbookTrackOptions,
} from './changes';
