/**
 * Worksheet Sub-API Interfaces — Barrel Export
 *
 * All worksheet namespace interfaces for the unified spreadsheet API.
 */

export type { WorksheetBindings } from './bindings';
export type {
  WorksheetCellVisitor,
  WorksheetGetCellsFormulasOnlyOptions,
  WorksheetGetCellsFullOptions,
  WorksheetGetCellsOptions,
  WorksheetGetCellsValuesOnlyOptions,
  WorksheetRangeCell,
  WorksheetRangeCellBase,
  WorksheetRangeFormulaCell,
  WorksheetRangeOrigin,
  WorksheetRangeValueCell,
} from './cell-reads';
export type {
  ChangeOrigin,
  ChangeRecord,
  ChangeTracker,
  ChangeTrackOptions,
  WorksheetChanges,
} from './changes';
export type {
  ChartAxisDescription,
  ChartCachedPoint,
  ChartDescription,
  ChartImageExporter,
  ChartReadMaterialization,
  ChartReadOptions,
  ChartSeriesDescription,
  ChartSeriesSourceDataUpdate,
  ChartSourceData,
  ChartSourceDataUpdate,
  ChartSourceRangeKind,
  ChartSourceRangeMatch,
  WorksheetCharts,
} from './charts';
export type { ChartMutationReceipt } from '../mutation-receipt';
export type { WorksheetComments } from './comments';
export type { WorksheetCustomProperties } from './custom-properties';
export type {
  ConditionalFormatUpdate,
  WorksheetConditionalFormatting,
} from './conditional-formats';
export type {
  AdvancedFilterMode,
  AdvancedFilterOptions,
  AdvancedFilterResult,
  FilterByColorOptions,
  FilterDropdownColumnType,
  FilterDropdownData,
  FilterDropdownItem,
  FilterCompactListOptions,
  FilterCompactListScope,
  FilterHeaderInfoEntry,
  FilterListOptions,
  FilterListScope,
  FilterSummaryInfo,
  WorksheetFilters,
} from './filters';
export type { WorksheetFormControls } from './form-controls';
export type {
  AutoFillApplyReceipt,
  AutoFillPreviewReceipt,
  FillSeriesApplyReceipt,
  WorksheetFill,
} from './fill';
export type { WorksheetFormats } from './formats';
export type { WorksheetHyperlink, WorksheetHyperlinks } from './hyperlinks';
export type { WorksheetInternal, WorksheetInternalChart } from './internal';
export type { RangePixelPosition, WorksheetLayout } from './layout';
export type { WorksheetNames } from './names';
/** @internal — kept for kernel WorksheetObjectsImpl; not part of the public Worksheet interface. */
export type { WorksheetObjects } from './objects';
export type { WorksheetOutline } from './outline';
export type {
  ImportedPivotViewRecord,
  PivotCreateConfig,
  PivotCreateOptions,
  PivotCreateWithSheetOptions,
  WorksheetPivots,
} from './pivots';
export type { WorksheetPrint } from './print';
export type {
  AllowEditRange,
  ProtectionOperation,
  WorksheetAllowEditRanges,
  WorksheetProtection,
} from './protection';
export type { WorksheetSettings } from './settings';
export type {
  FindCellsFormatQuery,
  FindCellsInclude,
  FindCellsQuery,
  FindCellsResult,
  FindCellsValueType,
  FoundCell,
} from './search';
export type { WorksheetSlicers } from './slicers';
export type { NodeMoveDirection, NodePosition, WorksheetDiagrams } from './diagrams';
export type { WorksheetSparklines } from './sparklines';
export type { WorksheetStructure } from './structure';
export type { WorksheetStyles } from './styles';
export type {
  TableRowCollection,
  WorksheetTableEvents,
  WorksheetTableSort,
  WorksheetTables,
} from './tables';
export type {
  DropdownItemsWithRevision,
  ListValidationOptions,
  ListValidationSource,
  WorksheetValidation,
  ValidationCheckResult,
} from './validation';
export type { WorksheetView } from './view';
export type { WorksheetWhatIf } from './what-if';

// Format mapping utilities (API angle/pattern values to OOXML conversions)
export {
  officeJsAngleToOoxmlRotation,
  ooxmlRotationToOfficeJsAngle,
  officeJsPatternToOoxml,
  ooxmlPatternToOfficeJs,
  clampIndent,
  MAX_INDENT_LEVEL,
} from './format-mappings';

// Handle types
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
} from './handles/index';

// Collection types
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
} from './collections/index';
