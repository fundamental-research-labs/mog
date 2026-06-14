/**
 * Unified Spreadsheet API -- Shared Types
 *
 * Additional types needed by the unified API that don't already exist in core.
 * Core types (CellValue, CellFormat, CellRange, etc.) are imported and
 * re-exported so consumers can import everything from '@mog-sdk/contracts/api'.
 */
import type { FormulaA1 } from '@mog/types-core/formula-string';
import type { FunctionArgument } from '@mog/types-core/function-registry';
import type { CodeExecutionDiagnostic } from '../core/execution';
import type {
  CellBorders,
  CellFormat,
  CellRange,
  CellValue,
  FormattedText,
  ResolvedCellFormat,
  SheetId,
} from '@mog/types-core/core';
import type { CFResult } from '@mog/types-formatting/conditional-format/rules';
import type { SlicerSource, SlicerStyle, TimelineLevel } from '@mog/types-data/data/slicers';
import type {
  ColumnFilterCriteria,
  FilterCapability,
  FilterHeaderInfo,
  ImportFilterUnsupportedReason,
} from '@mog/types-data/data/filter';
import type {
  AggregateFunction,
  CalculatedField,
  CalculatedFieldId,
  DataSourceType,
  PlacementId,
  PivotExpansionState,
  PivotFieldArea,
  PivotFieldItems,
  PivotFilter,
  PivotKernelMutationReceipt,
  PivotPlacementMutationReceipt,
  PivotMemberRef,
  PivotTableConfig as DataPivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
  PivotValueRecord,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog/types-data/data/pivot';
import type { TotalFunction } from '@mog/types-data/data/tables';
import type { SpreadsheetEvent as InternalSpreadsheetEvent } from '@mog/types-events/events';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  CellFormatChangedEvent,
  CellMetadataChangedEvent,
} from '@mog/types-events/cell-events';
import type {
  FilterAppliedEvent,
  FilterClearedEvent,
  FilterCreatedEvent,
  FilterDeletedEvent,
  FilterUpdatedEvent,
} from '@mog/types-events/filter-events';
import type {
  RowsHiddenEvent,
  RowsUnhiddenEvent,
  ColumnsHiddenEvent,
  ColumnsUnhiddenEvent,
  RowsInsertedEvent,
  RowsDeletedEvent,
  ColumnsInsertedEvent,
  ColumnsDeletedEvent,
} from '@mog/types-events/structure-events';
import type {
  CellsMergedEvent,
  CellsUnmergedEvent,
  MergesChangedEvent,
} from '@mog/types-events/merge-events';
import type {
  TableCreatedEvent,
  TableUpdatedEvent,
  TableDeletedEvent,
} from '@mog/types-events/table-events';
import type {
  ChartCreatedEvent,
  ChartUpdatedEvent,
  ChartDeletedEvent,
} from '@mog/types-events/chart-events';
import type {
  SlicerCreatedEvent,
  SlicerUpdatedEvent,
  SlicerDeletedEvent,
} from '@mog/types-events/slicer-events';
import type {
  SparklineChangedEvent,
  SparklineCreatedEvent,
  SparklineUpdatedEvent,
  SparklineDeletedEvent,
} from '@mog/types-events/sparkline-events';
import type { GroupingChangedEvent } from '@mog/types-events/grouping-events';
import type {
  CFRulesChangedEvent,
  CFRuleCreatedEvent,
  CFRuleDeletedEvent,
} from '@mog/types-events/conditional-formatting-events';
import type { ViewportResizedEvent } from '@mog/types-events/view-events';
import type { RecalcCompletedEvent } from '@mog/types-events/recalc-events';
import type { SelectionChangedEvent } from '@mog/types-events/selection-events';
import type {
  SheetActivatedEvent,
  SheetRenamedEvent,
  SheetCreatedEvent,
  SheetDeletedEvent,
  ProtectionChangedEvent,
} from '@mog/types-events/sheet-events';
import type { FormulaChangedEvent } from '@mog/types-events/cell-events';
import type { ColumnSortedEvent, RowSortedEvent } from '@mog/types-data/data/sorting';
import type {
  NameCreatedEvent,
  NameUpdatedEvent,
  NameDeletedEvent,
} from '@mog/types-events/named-range-events';
import type { ScenarioAppliedEvent, ScenarioDeletedEvent } from '@mog/types-events/scenario-events';
import type { WorkbookSettingsChangedEvent } from '@mog/types-events/settings-events';

// === Re-export core types that are part of the unified API surface ===

export type {
  CellAddress,
  CellBorders,
  CellData,
  CellFormat,
  CellRange,
  CellStyle,
  CellValue,
  ResolvedCellFormat,
  SheetId,
  SheetInfo,
} from '@mog/types-core/core';

// === Re-export SheetMeta from store types for API consumers ===
export type { SheetMeta } from '../store/store-types';

// === Re-export PrintSettings from core ===
export type { PrintSettings } from '@mog/types-core/core';

// === Shape types ===
// Rich types from objects/floating-objects.ts — the single source of truth.
// The lossy Api* types in connections/api.ts are NOT used here.
import type {
  ObjectBorder,
  ObjectAnchorType,
  ObjectFill,
  ObjectPosition,
  PictureAdjustments,
  PictureCrop,
  ShapeOutline,
  ShapeText,
  ShapeType,
  TextMargins,
  TextRun,
} from '@mog/types-objects/objects/floating-objects';
import type { EquationStyle } from '@mog/types-objects/equation';
import type {
  AdjustmentValues,
  TextEffects,
  TextWarpPreset,
  TextEffectConfig as DomainTextEffectConfig,
  TextEffectConfigUpdate,
  TextEffectFill,
  TextEffectOutline,
} from '@mog/types-objects/text-effects';
import type { OuterShadowEffect } from '@mog/types-objects/text-effects/effects';

export type {
  ObjectBorder,
  LineDash,
  ObjectAnchorType,
  ObjectFill,
  ObjectPosition,
  PictureAdjustments,
  PictureCrop,
  ShapeOutline,
  ShapeText,
  ShapeType,
  TextMargins,
  TextRun,
} from '@mog/types-objects/objects/floating-objects';
export type { EquationStyle } from '@mog/types-objects/equation';

/**
 * Shape configuration for creating/updating shapes.
 *
 * Uses simple integer positions (anchorRow/anchorCol) for the public API.
 * Internal storage uses CellId-based ObjectPosition.
 * Preserves full fidelity: gradient fills, arrowhead outlines, rich text.
 */
export interface ShapeConfig {
  /** Shape type (rect, ellipse, triangle, etc.) */
  type: ShapeType;

  // Position (integer-based, same pattern as ChartConfig)
  /** Anchor row (0-based) */
  anchorRow: number;
  /** Anchor column (0-based) */
  anchorCol: number;
  /** X offset from anchor cell in pixels */
  xOffset?: number;
  /** Y offset from anchor cell in pixels */
  yOffset?: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;

  /** Absolute pixel X on the sheet. When set, Rust resolves to anchorCol + xOffset. */
  pixelX?: number;
  /** Absolute pixel Y on the sheet. When set, Rust resolves to anchorRow + yOffset. */
  pixelY?: number;

  /** Optional name for the shape */
  name?: string;
  /** Fill configuration (solid, gradient with stops/angle, or none) */
  fill?: ObjectFill;
  /** Outline/stroke configuration (with optional arrowheads) */
  outline?: ShapeOutline;
  /** Rich text content inside the shape (with CellFormat) */
  text?: ShapeText;
  /** Shadow effect */
  shadow?: OuterShadowEffect;
  /** Rotation angle in degrees (0-360) */
  rotation?: number;
  /** Whether the shape is locked */
  locked?: boolean;
  /** Shape-specific adjustments (e.g., cornerRadius for roundRect) */
  adjustments?: Record<string, number>;
  /** Whether the shape is visible (default: true). */
  visible?: boolean;
  /** Anchor mode: how the shape anchors to cells (twoCell/oneCell/absolute). */
  anchorMode?: ObjectAnchorType;
  /** Whether to preserve aspect ratio when resizing */
  lockAspectRatio?: boolean;
  /** Accessibility title for the shape (distinct from alt text description) */
  altTextTitle?: string;
  /** User-visible display name (may differ from internal name) */
  displayName?: string;
}

/**
 * Shape as returned by get/list operations.
 *
 * Extends ShapeConfig with identity and metadata fields.
 * Same pattern as Chart extends ChartConfig.
 */
export interface Shape extends ShapeConfig {
  /** Unique shape ID */
  id: string;
  /** Sheet ID the shape belongs to */
  sheetId: string;
  /** Z-order within the sheet */
  zIndex: number;
  /** Creation timestamp (Unix ms) */
  createdAt?: number;
  /** Last update timestamp (Unix ms) */
  updatedAt?: number;
}

// === Chart types ===
// Canonical definitions in contracts/src/data/charts.ts
export type {
  BoxplotConfig,
  Chart,
  ChartBorder,
  ChartConfig,
  ChartFormatString,
  ChartLeaderLinesFormat,
  ChartSeriesDimension,
  ChartShadow,
  ChartType,
  DataLabelConfig,
  DataTableConfig,
  HistogramConfig,
  ImageExportOptions,
  ImageFittingMode,
  MarkerStyle,
  PivotChartOptions,
  SeriesConfig,
  SingleAxisConfig,
  TrendlineConfig,
} from '@mog/types-data/data/charts';

// === Chart layout types ===
// Canonical definitions in contracts/src/bridges/chart-bridge.ts
export type {
  AxisLayout,
  ChartLayout,
  DataLabelLayout,
  ElementBounds,
  LegendEntryLayout,
  LegendLayout,
  PlotAreaLayout,
  TitleLayout,
} from '@mog/types-bridges/chart-bridge';

// =============================================================================
// Comment (thread-aware — Rust-generated type is source of truth)
// =============================================================================

// Comment type (copied from Rust-generated compute-types.gen).
// Consumers see Rust field names: cellRef (not cellId), runs (not content), etc.

export interface RichTextRun {
  text: string;
  fontName: string | null;
  fontSize: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string | null;
  colorIndexed?: number;
  colorTheme?: number;
  colorTint?: number;
  charset: number | null;
  family: number | null;
  scheme: string | null;
  vertAlign?: string;
  preserveSpace?: boolean;
}

export interface Comment {
  id: string;
  cellRef: string;
  author: string;
  authorId?: string;
  authorEmail?: string;
  content: string | null;
  runs: RichTextRun[];
  threadId: string | null;
  parentId: string | null;
  personId?: string;
  resolved?: boolean;
  timestamp?: string;
  createdAt: number | null;
  modifiedAt: number | null;
  xrUid?: string;
  shapeId?: number;
  extLstXml?: string;
  contentType?: CommentContentType;
  mentions?: CommentMention[];
  commentType: CommentType;
  visible?: boolean;
  noteHeight?: number;
  noteWidth?: number;
}

/** A mention of a user within a comment's rich text content. */
export interface CommentMention {
  displayText: string;
  userId: string;
  email?: string;
  startIndex: number;
  length: number;
}

/** Options for updating an existing comment via `comments.update()`. */
export interface CommentUpdate {
  /** New plain-text content for the comment. */
  text?: string;
  /** @mentions to embed in the comment (implies content_type = Mention). */
  mentions?: CommentMention[];
}

/** Whether a comment is a legacy note or a modern threaded comment. */
export type CommentType = 'note' | 'threadedComment';

/** Distinguishes plain text comments from those containing @mentions. */
export type CommentContentType = 'plain' | 'mention';

/** A cell note (simple, single string per cell). API-only type (no Rust equivalent). */
export interface Note {
  content: string;
  author: string;
  cellAddress: string;
  /** Visible state of the note shape. */
  visible?: boolean;
  /** Note callout box height in points. */
  height?: number;
  /** Note callout box width in points. */
  width?: number;
}

// =============================================================================
// Cell Write Options
// =============================================================================

/** Options controlling how a cell value is interpreted when written. */
export interface CellWriteOptions {
  /** If true, value is treated as a formula (prefixed with =) */
  asFormula?: boolean;
  /** If true, string values starting with "=" are stored as literal text, not formulas. */
  literal?: boolean;
}

// =============================================================================
// Raw Cell Data (includes formula info)
// =============================================================================

/**
 * Complete raw cell data including formula, formatting, and metadata.
 *
 * Unlike `CellData` from core (which is the minimal read type), `RawCellData`
 * includes all optional cell metadata useful for bulk reads and LLM presentation.
 */
export interface RawCellData {
  /** The computed cell value */
  value: CellValue;
  /** The formula string with "=" prefix, if the cell contains a formula */
  formula?: FormulaA1;
  /** Cell formatting */
  format?: CellFormat;
  /** Cell borders */
  borders?: CellBorders;
  /** Cell comment/note text */
  comment?: string;
  /** Hyperlink URL */
  hyperlink?: string;
  /** Whether the cell is part of a merged region */
  isMerged?: boolean;
  /** The merged region this cell belongs to (A1 notation, e.g., "A1:B2") */
  mergedRegion?: string;
}

// =============================================================================
// Identified Cell Data (includes CellId for identity-aware operations)
// =============================================================================

/**
 * Cell data enriched with stable CellId identity.
 *
 * Used by operations that need to reference cells by identity (not position),
 * such as find-replace, clipboard, and cell relocation. The CellId is a CRDT-safe
 * identifier that survives row/column insert/delete operations.
 *
 * Unlike `CellData` (position-implied), `IdentifiedCellData` includes explicit
 * position and identity for flat iteration over non-empty cells in a range.
 */
export interface IdentifiedCellData {
  /** Stable cell identity (CRDT-safe, survives structural changes). */
  cellId: string;
  /** Row index (0-based). */
  row: number;
  /** Column index (0-based). */
  col: number;
  /** The computed cell value (null for empty cells). */
  value: CellValue | null;
  /** Formula text (e.g., "=A1+B1") when the cell contains a formula. */
  formulaText?: string;
  /** Pre-formatted display string (e.g., "$1,234.56" for a currency-formatted number). */
  displayString: string;
}

// =============================================================================
// Sort Types
// =============================================================================

/** Options for sorting a range of cells. */
export interface SortOptions {
  /** Columns to sort by, in priority order */
  columns: SortColumn[];
  /** Whether the first row of the range contains headers (default: false) */
  hasHeaders?: boolean;
  /** Sort only currently visible row slots, preserving hidden row positions. */
  visibleRowsOnly?: boolean;
}

/**
 * A single column sort specification.
 *
 * Discriminated on `sortBy`. The default ('value') accepts an optional
 * Workbook `customList`. Color sorts (`cellColor` / `fontColor`)
 * require a `targetColor` and `colorPosition` so invalid combinations
 * cannot be expressed.
 */
export type SortColumn = {
  /** Column index (0-based, relative to the sort range) */
  column: number;
  /** Sort direction: 'asc' (default) or 'desc'. */
  direction?: 'asc' | 'desc';
  /** Case sensitive comparison (default: false) */
  caseSensitive?: boolean;
} & (
  | {
      /** What to sort by (default: 'value' if omitted) */
      sortBy?: 'value';
      /**
       * Optional Excel custom-list sort: values present in the list
       * sort by their list position; values not in the list sort
       * *after* list members (Excel compatibility).
       */
      customList?: CellValue[];
    }
  | {
      sortBy: 'cellColor' | 'fontColor';
      /** Hex color to match (e.g. '#FFFF00'). */
      targetColor: string;
      /** Whether matched rows go to top or bottom of the sorted range. */
      colorPosition: 'top' | 'bottom';
    }
);

// =============================================================================
// Filter Types
// =============================================================================

/** API filter state — derived from Rust FilterState with A1-notation range. */
export interface FilterState {
  /** The range the auto-filter is applied to (A1 notation) */
  range: string;
  /** Per-column filter criteria, keyed by column identifier (string) */
  columnFilters: Record<string, ColumnFilterCriteria>;
}

export type { ColumnFilterCriteria as ColumnFilter };

// =============================================================================
// Conditional Formatting Types (full discriminated union from data module)
// =============================================================================

export type {
  CFAboveAverageRule,
  CFCellValueRule,
  CFColorPoint,
  CFColorScale,
  CFColorScaleRule,
  CFContainsBlanksRule,
  CFContainsErrorsRule,
  CFContainsTextRule,
  CFCustomIcon,
  CFDataBar,
  CFDataBarAxisPosition,
  CFDataBarRule,
  CFDuplicateValuesRule,
  CFFormulaRule,
  CFIconSet,
  CFIconSetName,
  CFIconSetRule,
  CFIconThreshold,
  CFOperator,
  CFResult,
  CFRule,
  CFRuleBase,
  CFRuleInput,
  CFRuleType,
  CFStyle,
  CFTextOperator,
  CFTimePeriodRule,
  CFTop10Rule,
  CFValueType,
  ConditionalFormat,
  DatePeriod,
} from '@mog/types-formatting/conditional-format/rules';

// =============================================================================
// Validation Rule
// =============================================================================

/** A data validation rule for cells. */
export interface ValidationRule {
  /** Schema ID — populated when reading, optional when creating (auto-generated if omitted) */
  id?: string;
  /** The cell range this rule applies to in A1 notation (e.g., "A1:B5") — populated when reading */
  range?: string;
  /** The validation type. 'none' indicates no validation rule is set. */
  type: 'none' | 'list' | 'wholeNumber' | 'decimal' | 'date' | 'time' | 'textLength' | 'custom';
  /** Comparison operator */
  operator?:
    | 'equal'
    | 'notEqual'
    | 'greaterThan'
    | 'lessThan'
    | 'greaterThanOrEqual'
    | 'lessThanOrEqual'
    | 'between'
    | 'notBetween';
  /** Primary constraint value or formula */
  formula1?: string | number;
  /** Secondary constraint value or formula (for 'between' / 'notBetween') */
  formula2?: string | number;
  /** Explicit list of allowed values (for 'list' type) */
  values?: string[];
  /** Source reference for list validation: A1 range (e.g., "=Sheet1!A1:A10") or formula (e.g., "=INDIRECT(A1)"). Prefixed with "=" for formulas. */
  listSource?: string;
  /** Whether blank cells pass validation (default: true) */
  allowBlank?: boolean;
  /** Whether to show a dropdown arrow for list validations */
  showDropdown?: boolean;
  /** Whether to show an input message when the cell is selected */
  showInputMessage?: boolean;
  /** Title for the input message */
  inputTitle?: string;
  /** Body text for the input message */
  inputMessage?: string;
  /** Whether to show an error alert on invalid input */
  showErrorAlert?: boolean;
  /** Error alert style */
  errorStyle?: 'stop' | 'warning' | 'information';
  /** Title for the error alert */
  errorTitle?: string;
  /** Body text for the error alert */
  errorMessage?: string;
}

// =============================================================================
// Merged Region
// =============================================================================

/** Information about a merged cell region. */
export interface MergedRegion {
  /** The merged range in A1 notation (e.g., "A1:B2") */
  range: string;
  /** Start row (0-based) */
  startRow: number;
  /** Start column (0-based) */
  startCol: number;
  /** End row (0-based, inclusive) */
  endRow: number;
  /** End column (0-based, inclusive) */
  endCol: number;
  /** Row span (endRow - startRow + 1) */
  rowSpan: number;
  /** Column span (endCol - startCol + 1) */
  colSpan: number;
}

// =============================================================================
// Goal Seek
// =============================================================================

/** Result of a goal seek operation. */
export interface GoalSeekResult {
  /** Whether a solution was found */
  found: boolean;
  /** The value found for the changing cell (if found) */
  value?: number;
  /** The target cell value achieved by the proposed changing-cell value */
  achievedValue?: number;
  /** Number of iterations performed */
  iterations?: number;
}

/** Non-fatal warning attached to an operation result. */
export interface OperationWarning {
  /** Machine-readable warning code */
  code: string;
  /** Human-readable description */
  message: string;
  /** Optional structured context for programmatic handling */
  context?: Record<string, unknown>;
}

/** Result of a bulk setCells() operation. */
export interface SetCellsResult {
  /** Number of cells successfully written */
  cellsWritten: number;
  /** Per-cell errors, if any (omitted when all succeed) */
  errors?: Array<{ addr: string; error: string }> | null;
  /** Non-fatal warnings (e.g., deduplication, coercion) */
  warnings?: OperationWarning[];
}

/** Result of a format set/setRange operation. */
export interface FormatChangeResult {
  /** Number of cells whose formatting was changed */
  cellCount: number;
}

/** Confirmation returned by clearData() and clear(). */
export interface ClearResult {
  /** Number of cells in the cleared range. */
  cellCount: number;
}

// =============================================================================
// Table Types
// =============================================================================

/** Options for creating a new table. */
export interface TableOptions {
  /** Table name (auto-generated if omitted) */
  name?: string;
  /** Whether the first row of the range contains headers (default: true) */
  hasHeaders?: boolean;
  /** Table style preset name */
  style?: string;
  /** Whether the table automatically expands when adjacent user input is entered (default: true) */
  autoExpand?: boolean;
  /** Whether formulas entered in table data columns automatically create/fill calculated columns (default: true) */
  autoCalculatedColumns?: boolean;
}

/** Options for updating a table's properties via `WorksheetTables.update()`. */
export interface TableUpdateOptions {
  /** Table style preset name (e.g. "TableStyleLight1"). */
  style?: string;
  /** New table name (renames the table). */
  name?: string;
  /** Whether the first column is emphasized. */
  emphasizeFirstColumn?: boolean;
  /** Whether the last column is emphasized. */
  emphasizeLastColumn?: boolean;
  /** Whether banded columns are shown. */
  bandedColumns?: boolean;
  /** Whether banded rows are shown. */
  bandedRows?: boolean;
  /** Whether filter buttons are shown on the header row. */
  showFilterButtons?: boolean;
  /** Whether the header row is visible. */
  hasHeaderRow?: boolean;
  /** Whether the totals row is visible. */
  hasTotalsRow?: boolean;
  /** Whether the table automatically expands when adjacent user input is entered. */
  autoExpand?: boolean;
  /** Whether formulas entered in table data columns automatically create/fill calculated columns. */
  autoCalculatedColumns?: boolean;
}

/** Options for the one-liner createTable() convenience method. */
export interface CreateTableOptions {
  /** Column header names. */
  headers: string[];
  /** Data rows (each row must match headers length). */
  data: CellValue[][];
  /** Top-left cell address to start writing (default: "A1"). */
  startCell?: string;
}

/**
 * Information about an existing table.
 *
 * Field names match the Rust-generated `Table` type (compute-types.gen.ts)
 * except `range` which is converted from `SheetRange` to A1 notation string.
 */
export interface TableInfo {
  /** Internal table identifier */
  id: string;
  /** Table name */
  name: string;
  /** Display name */
  displayName: string;
  /** Sheet the table belongs to */
  sheetId: string;
  /** Table range in A1 notation (converted from Rust SheetRange) */
  range: string;
  /** Column definitions */
  columns: TableColumn[];
  /** Whether the table has a header row */
  hasHeaderRow: boolean;
  /** Whether the totals row is visible */
  hasTotalsRow: boolean;
  /** Table style name */
  style: string;
  /** Whether banded rows are shown */
  bandedRows: boolean;
  /** Whether banded columns are shown */
  bandedColumns: boolean;
  /** Whether first column is emphasized */
  emphasizeFirstColumn: boolean;
  /** Whether last column is emphasized */
  emphasizeLastColumn: boolean;
  /** Whether filter buttons are shown */
  showFilterButtons: boolean;
  /** Whether the table automatically expands when adjacent user input is entered */
  autoExpand: boolean;
  /** Whether formulas entered in table data columns automatically create/fill calculated columns */
  autoCalculatedColumns: boolean;
}

/**
 * A single column in a table.
 *
 * Field names match the Rust-generated `TableColumn` type (compute-types.gen.ts).
 */
export interface TableColumn {
  /** Unique column ID */
  id: string;
  /** Column header name */
  name: string;
  /** Column index within the table (0-based) */
  index: number;
  /** Total row function type */
  totalsFunction: TotalsFunction | null;
  /** Total row label */
  totalsLabel: string | null;
  /** Calculated column formula */
  calculatedFormula?: string;
}

/** Totals function type (matches Rust TotalsFunction). */
export type TotalsFunction =
  | 'average'
  | 'count'
  | 'countNums'
  | 'max'
  | 'min'
  | 'stdDev'
  | 'sum'
  | 'var'
  | 'custom'
  | 'none';

// =============================================================================
// Pivot Table Types
// =============================================================================

/** Configuration for creating or describing a pivot table. */
export interface PivotTableConfig {
  /** Pivot table name */
  name: string;
  /** Source data range in A1 notation (e.g., "Sheet1!A1:E100") */
  dataSource: string;
  /** Target sheet name (defaults to a new sheet) */
  targetSheet?: string;
  /** Target cell address (defaults to A1) */
  targetAddress?: string;
  /** Field names for the row area */
  rowFields?: string[];
  /** Field names for the column area */
  columnFields?: string[];
  /** Value field configurations */
  valueFields?: PivotValueField[];
  /** Field names for the filter area */
  filterFields?: string[];
  /** When true, allows multiple filter criteria on a single field. */
  allowMultipleFiltersPerField?: boolean;
  /** Controls whether the pivot table auto-formats when refreshed. */
  autoFormat?: boolean;
  /** Controls whether custom formatting is preserved on refresh. */
  preserveFormatting?: boolean;
}

/** A value field in a pivot table. */
export interface PivotValueField {
  /** Stable value placement ID once the field is placed. */
  placementId?: PlacementId;
  /** Source field name */
  field: string;
  /** Aggregation function */
  aggregation: 'sum' | 'count' | 'average' | 'max' | 'min';
  /** Custom label for the value field */
  label?: string;
}

/** Placement-first field insertion spec for a pivot table handle. */
export interface PivotHandlePlacementSpec {
  placementId?: PlacementId;
  fieldId?: string;
  area: PivotFieldArea;
  position?: number;
  source?:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: CalculatedFieldId };
  aggregateFunction?: AggregateFunction;
  sortOrder?: SortOrder;
  displayName?: string;
  showValuesAs?: ShowValuesAsConfig;
  numberFormat?: string;
}

/** Sort a row/column axis by a value placement. */
export interface PivotValueSortConfig {
  order: SortOrder;
  columnKey?: string;
}

/** Options for side-effect-free pivot handle introspection. */
export interface PivotHandleInfoOptions {
  /** Include current pivot items for non-value fields. Defaults to false. */
  includeItems?: boolean;
  /** Include rendered range metadata when available. Defaults to true. */
  includeRanges?: boolean;
}

/** Side-effect-free, handle-local pivot table introspection. */
export interface PivotHandleInfo {
  /** Stable pivot ID captured by the handle. */
  id: string;
  /** Current pivot display name. */
  name: string;
  /** Source data range (e.g. "Sheet1!A1:D100"). */
  dataSource: string;
  /** Range occupied by the pivot table content. */
  contentArea: string;
  /** Output anchor location as A1 reference (e.g. "G1"). */
  location?: string;
  /** Row dimension field names. */
  rowFields: string[];
  /** Column dimension field names. */
  columnFields: string[];
  /** Value fields with aggregation info. */
  valueFields: PivotValueField[];
  /** Filter field names. */
  filterFields: string[];
  /** Source sheet name when known. */
  sourceSheetName?: string;
  /** Source range in zero-based coordinates. */
  sourceRange?: CellRange;
  /** Output sheet name when known. */
  outputSheetName?: string;
  /** Output anchor location. */
  outputLocation?: { row: number; col: number; a1: string };
  /** Full field definitions from the pivot config. */
  fields: DataPivotTableConfig['fields'];
  /** Full placement definitions from the pivot config. */
  placements: DataPivotTableConfig['placements'];
  /** Current filters, including item-visibility filters. */
  filters: DataPivotTableConfig['filters'];
  /** Layout settings when present. */
  layout?: PivotTableLayout;
  /** Style settings when present. */
  style?: PivotTableStyle;
  /** Current rendered range, when requested and available. */
  renderedRange?: CellRange | null;
  /** Current expansion state. */
  expansionState: PivotExpansionState;
  /** Data source type for this pivot. */
  dataSourceType: DataSourceType;
  /** Current item lists when explicitly requested. */
  items?: PivotFieldItems[];
  /** Mutation/read methods available on this handle. */
  availableMethods: string[];
}

/**
 * Handle for interacting with an existing pivot table.
 *
 * Returned by `worksheet.pivots.get()`. Provides methods to query
 * and modify the pivot table's field configuration.
 */
export interface PivotTableHandle {
  /** Get the pivot table name */
  getName(): string;
  /** Side-effect-free handle-local introspection bound to this pivot ID. */
  getInfo(options?: PivotHandleInfoOptions): Promise<PivotHandleInfo>;
  /** Get the current configuration including all fields */
  getConfig(): PivotTableConfig;
  /** Update the pivot table data configuration. */
  update(updates: Partial<Omit<DataPivotTableConfig, 'id' | 'createdAt'>>): Promise<void>;
  /** Delete the pivot table. */
  delete(): Promise<boolean>;
  /** Subscribe to computed result updates for this pivot. */
  subscribeResult(callback: (result: PivotTableResult | null, error?: string) => void): () => void;
  /** Compute this pivot table result. */
  compute(forceRefresh?: boolean): Promise<PivotTableResult | null>;
  /** Get the full range occupied by the rendered pivot table. */
  getRange(): Promise<CellRange | null>;
  /** Add a field to the row, column, or filter area */
  addField(field: string, area: 'row' | 'column' | 'filter', position?: number): Promise<void>;
  /** Add a value field with aggregation */
  addValueField(
    field: string,
    aggregation: PivotValueField['aggregation'],
    label?: string,
  ): Promise<void>;
  /** Add a placement to a row, column, value, or filter area. */
  addPlacement(spec: PivotHandlePlacementSpec): Promise<PivotPlacementMutationReceipt>;
  /** Remove a field by name */
  removeField(fieldName: string, area?: PivotFieldArea): Promise<void>;
  /** Remove a specific placement by stable placement ID. */
  removePlacement(placementId: PlacementId): Promise<PivotKernelMutationReceipt>;
  /** Move a field to a different area or position. */
  moveField(
    fieldName: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<void>;
  /** Move a specific placement to a different area or ordered position. */
  movePlacement(
    placementId: PlacementId,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<PivotKernelMutationReceipt>;
  /** Change the aggregation function of a value field */
  changeAggregation(
    valueFieldLabel: string,
    newAggregation: PivotValueField['aggregation'],
  ): Promise<void>;
  /** Change the aggregation function of a specific value placement. */
  setPlacementAggregateFunction(
    placementId: PlacementId,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt>;
  /** Rename a value field's display label */
  renameValueField(currentLabel: string, newLabel: string): Promise<void>;
  /** Rename a value placement by stable placement ID. */
  renameValuePlacement(
    placementId: PlacementId,
    displayName: string | null,
  ): Promise<PivotKernelMutationReceipt>;
  /** Refresh the pivot table from its data source */
  refresh(): Promise<void>;
  /** Get all items for all non-value fields */
  getAllItems(): Promise<PivotFieldItems[]>;
  /** Set the "Show Values As" calculation for a value field. Pass null to clear. */
  setShowValuesAs(valueFieldLabel: string, showValuesAs: ShowValuesAsConfig | null): Promise<void>;
  /** Set the sort order for a row or column field. */
  setSortOrder(fieldOrPlacement: string, sortOrder: SortOrder): Promise<void>;
  /** Set the sort order for a row or column placement. */
  setPlacementSortOrder(
    placementId: PlacementId,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt>;
  /** Set or clear value sorting on a row or column axis placement. */
  setSortByValue(
    axisPlacementId: PlacementId,
    valuePlacementId: PlacementId,
    config: PivotValueSortConfig | null,
  ): Promise<PivotKernelMutationReceipt>;
  /** Set a filter on a field. */
  setFilter(fieldId: string, filter: Omit<PivotFilter, 'fieldId'>): Promise<void>;
  /** Remove a filter from a field. */
  removeFilter(fieldId: string): Promise<void>;
  /** Set layout options. */
  setLayout(layout: Partial<PivotTableLayout>): Promise<void>;
  /** Set style options. */
  setStyle(style: Partial<PivotTableStyle>): Promise<void>;
  /** Toggle expansion state for a header. */
  toggleExpanded(headerKey: string, isRow: boolean): Promise<boolean>;
  /** Set expansion state for all headers. */
  setAllExpanded(expanded: boolean): Promise<void>;
  /** Read expansion state. */
  getExpansionState(): Promise<PivotExpansionState>;
  /** Get drill-down data for a pivot cell. */
  getDrillDownData(rowKey: string, columnKey: string): Promise<CellValue[][]>;
  /** Add a calculated field to this pivot. */
  addCalculatedField(
    field: CalculatedField,
  ): Promise<PivotKernelMutationReceipt & { calculatedFieldId: CalculatedFieldId }>;
  /** Set item visibility by value string -> boolean map */
  setItemVisibility(fieldId: string, visibleItems: Record<string, boolean>): Promise<void>;
  /** Get the data source type (range, table, or external). */
  getDataSourceType(): DataSourceType;
  /** Change the source data range without refreshing/materializing. */
  setDataSource(dataSource: string): Promise<void>;
}

/** Summary information about an existing pivot table. */
export interface PivotTableInfo {
  /** Pivot table name */
  name: string;
  /** Source data range (e.g., "Sheet1!A1:D100") */
  dataSource: string;
  /** Range occupied by the pivot table content */
  contentArea: string;
  /** Range occupied by filter dropdowns (if any) */
  filterArea?: string;
  /** Output anchor location as A1 reference (e.g., "G1") */
  location?: string;
  /** Row dimension field names */
  rowFields?: string[];
  /** Column dimension field names */
  columnFields?: string[];
  /** Value fields with aggregation info */
  valueFields?: PivotValueField[];
  /** Filter field names */
  filterFields?: string[];
}

/** A single flat record from a pivot query result. */
export interface PivotQueryRecord {
  /** Dimension values keyed by field name (e.g., { Region: "North", Year: 2021 }) */
  dimensions: Record<string, CellValue>;
  /** Aggregated values keyed by value field label (e.g., { "Sum of Amount": 110 }) */
  values: Record<string, CellValue>;
  /** Measure-aware values with stable placement provenance. */
  valueRecords?: PivotValueRecord[];
  rowMemberPath?: PivotMemberRef[];
  columnMemberPath?: PivotMemberRef[];
}

/** Result of queryPivot() — flat, agent-friendly records instead of hierarchy trees. */
export interface PivotQueryResult {
  /** Pivot table name */
  pivotName: string;
  /** Row dimension field names */
  rowFields: string[];
  /** Column dimension field names */
  columnFields: string[];
  /** Value field labels */
  valueFields: string[];
  /** Flat records — one per data intersection, excluding subtotals and grand totals */
  records: PivotQueryRecord[];
  /** Total source row count */
  sourceRowCount: number;
}

// =============================================================================
// Slicer Types
// =============================================================================

/**
 * Slicer types copied from Rust-generated compute-types.gen.
 * NOTE: The bridge currently returns data in a flattened format that matches
 * the hand-written types below, NOT the StoredSlicer shape. These types
 * are for code that talks directly to the bridge or for future alignment.
 */
export interface StoredSlicer {
  id: string;
  sheetId: string;
  source: SlicerSource;
  caption: string;
  name?: string;
  style: SlicerStyle;
  position?: unknown;
  level: number;
  zIndex: number;
  locked: boolean;
  showHeader: boolean;
  startItem?: number;
  multiSelect: boolean;
  selectedValues: CellValue[];
  createdAt?: number;
  updatedAt?: number;
}

export interface StoredSlicerUpdate {
  caption?: string;
  name?: string;
  style?: SlicerStyle;
  position?: unknown;
  zIndex?: number;
  locked?: boolean;
  showHeader?: boolean;
  startItem?: number;
  multiSelect?: boolean;
  selectedValues?: CellValue[];
}

export type { SlicerSource };

/** Partial update payload for a slicer (Rust StoredSlicerUpdate). */
export type SlicerUpdate = StoredSlicerUpdate;

/** Configuration for creating a new slicer. */
export interface SlicerConfig {
  /** Slicer ID (generated if omitted) */
  id?: string;
  /** Sheet ID the slicer belongs to */
  sheetId?: string;
  /** Name of the table to connect the slicer to */
  tableName?: string;
  /** Column name within the table to filter on */
  columnName?: string;
  /** Display name for the slicer (auto-generated if omitted) */
  name?: string;
  /** Position and dimensions in pixels */
  position?: { x: number; y: number; width: number; height: number };
  /** Data source connection (rich alternative to tableName/columnName) */
  source?: SlicerSource;
  /** Slicer caption (header text) */
  caption?: string;
  /** Style configuration */
  style?: SlicerStyle;
  /** Show slicer header */
  showHeader?: boolean;
  /** Z-order within the sheet */
  zIndex?: number;
  /** Whether slicer position is locked */
  locked?: boolean;
  /** Whether multi-select is enabled */
  multiSelect?: boolean;
  /** Initial selected values */
  selectedValues?: CellValue[];
  /** Currently selected date range start (timeline slicers) */
  selectedStartDate?: number;
  /** Currently selected date range end (timeline slicers) */
  selectedEndDate?: number;
  /** Current aggregation level (timeline slicers) */
  timelineLevel?: TimelineLevel;
}

/** Summary information about a slicer. */
export interface SlicerInfo {
  /** Unique slicer ID */
  id: string;
  /** Programmatic name (unique within workbook). Falls back to caption if not set. */
  name: string;
  /** Display caption (header text). */
  caption: string;
  /** Connected table name */
  tableName: string;
  /** Connected column name */
  columnName: string;
  /** Stable source binding for table/pivot slicers. */
  source?: SlicerSource;
  /** Discriminator for timeline slicers (matches TimelineSlicerConfig.sourceType) */
  sourceType?: 'timeline';
}

/** Full slicer state including selection and position. */
export interface Slicer extends SlicerInfo {
  /** Currently selected filter items */
  selectedItems: CellValue[];
  /** Position and dimensions in pixels */
  position: { x: number; y: number; width: number; height: number };
}

/** A single item in a slicer's value list. */
export interface SlicerItem {
  /** The display value */
  value: CellValue;
  /** Whether this item is currently selected */
  selected: boolean;
  /** Number of matching records (if available) */
  count?: number;
}

// =============================================================================
// Protection Options
// =============================================================================

/** Granular options for sheet protection. */
export interface ProtectionOptions {
  /** Allow selecting locked cells */
  allowSelectLockedCells?: boolean;
  /** Allow selecting unlocked cells */
  allowSelectUnlockedCells?: boolean;
  /** Allow formatting cells */
  allowFormatCells?: boolean;
  /** Allow formatting columns */
  allowFormatColumns?: boolean;
  /** Allow formatting rows */
  allowFormatRows?: boolean;
  /** Allow inserting columns */
  allowInsertColumns?: boolean;
  /** Allow inserting rows */
  allowInsertRows?: boolean;
  /** Allow inserting hyperlinks */
  allowInsertHyperlinks?: boolean;
  /** Allow deleting columns */
  allowDeleteColumns?: boolean;
  /** Allow deleting rows */
  allowDeleteRows?: boolean;
  /** Allow sorting */
  allowSort?: boolean;
  /** Allow using auto-filter */
  allowAutoFilter?: boolean;
  /** Allow using pivot tables */
  allowPivotTables?: boolean;
  /** Allow editing objects such as charts, shapes, and images */
  allowEditObjects?: boolean;
  /** Allow editing scenarios */
  allowEditScenarios?: boolean;
}

// =============================================================================
// Scenario Types
// =============================================================================

/** Configuration for creating a what-if scenario. */
export interface ScenarioConfig {
  /** Scenario name */
  name: string;
  /** Cell addresses that change (A1 notation) */
  changingCells: string[];
  /** Values for the changing cells, in the same order */
  values: (string | number | boolean | null)[];
  /** Optional description */
  comment?: string;
}

/** A saved scenario with metadata. */
export interface Scenario extends ScenarioConfig {
  /** Unique scenario ID */
  id: string;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
}

/** A saved original cell value from before scenario application. */
export interface OriginalCellValue {
  sheetId: SheetId;
  cellId: string;
  value: string | number | boolean | null;
  /** Original formula, if the cell had one. */
  formula?: string;
}

/** Result returned from applyScenario(). */
export interface ApplyScenarioResult {
  /** Session baseline token to pass to restoreScenario(). */
  baselineId: string;
  /** Document/session handle this baseline belongs to. */
  documentId?: string;
  /** Number of cells that were updated with scenario values. */
  cellsUpdated: number;
  /** CellIds that could not be found (deleted cells). */
  skippedCells: string[];
  /** Original values to pass to restoreScenario() later. */
  originalValues: OriginalCellValue[];
}

/** Session-scoped state for an applied scenario. */
export interface ActiveScenarioState {
  /** Scenario whose values are currently applied in this local session. */
  scenarioId: string;
  /** Session baseline token used by restore once Rust-owned apply/restore lands. */
  baselineId: string;
  /** Document handle this session state belongs to. */
  documentId: string;
  /** Whether the stored scenario definition still matches the active baseline. */
  definitionStatus?: 'current' | 'stale' | 'deleted';
  /** Whether active cells have diverged from the baseline. */
  cellMutationStatus?: 'clean' | 'conflicted';
}

// =============================================================================
// Named Range Info
// =============================================================================

/** Information about a defined name / named range. */
export interface NamedRangeInfo {
  /** The defined name */
  name: string;
  /** The reference formula (e.g., "Sheet1!$A$1:$B$10") */
  reference: string;
  /** Scope: undefined or sheet name (undefined = workbook scope) */
  scope?: string;
  /** Optional descriptive comment */
  comment?: string;
  /** Whether the name is visible in Name Manager. Hidden names are typically system-generated. */
  visible?: boolean;
}

/** Parsed reference for a named range that refers to a simple sheet!range. */
export interface NamedRangeReference {
  /** The sheet name (e.g., "Sheet1") */
  sheetName: string;
  /** The range portion (e.g., "$A$1:$B$10") */
  range: string;
}

/**
 * API type classification for a named item's value.
 *
 * @see https://learn.microsoft.com/en-us/javascript/api/excel/excel.nameditemtype
 */
export type NamedItemType =
  | 'String'
  | 'Integer'
  | 'Double'
  | 'Boolean'
  | 'Range'
  | 'Error'
  | 'Array';

// =============================================================================
// Checkpoint Types
// =============================================================================

/** Information about a saved checkpoint (version snapshot). */
export interface CheckpointInfo {
  /** Unique checkpoint ID */
  id: string;
  /** Optional human-readable label */
  label?: string;
  /** Creation timestamp (Unix ms) */
  timestamp: number;
}

// =============================================================================
// Code Execution
// =============================================================================

/** Options for code execution via `workbook.executeCode()`. */
export interface ExecuteOptions {
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Whether to run in a sandboxed environment */
  sandbox?: boolean;
}

/** Result of a code execution. */
export interface CodeResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Captured console output */
  output?: string;
  /** Error message (if success is false) */
  error?: string;
  /** Structured diagnostics produced by the executor */
  diagnostics?: readonly CodeExecutionDiagnostic[];
  /** Execution duration in milliseconds */
  duration?: number;
}

// =============================================================================
// Summary Options
// =============================================================================

/** Options for the `worksheet.summarize()` method. */
export interface SummaryOptions {
  /** Whether to include sample data in the summary */
  includeData?: boolean;
  /** Maximum number of rows to include in sample data */
  maxRows?: number;
  /** Maximum number of columns to include in sample data */
  maxCols?: number;
}

// =============================================================================
// Search Types
// =============================================================================

/** Options for cell search operations. */
export interface SearchOptions {
  /** Whether the search is case-sensitive */
  matchCase?: boolean;
  /** Whether to match the entire cell value */
  entireCell?: boolean;
  /** Whether to search formula text instead of computed values */
  searchFormulas?: boolean;
  /** Limit search to this range (A1 notation). Used by regexSearch; ignored by findInRange (use its range parameter instead). */
  range?: string;
}

/** Options for findInRange — range is provided as a separate method parameter. */
export type FindInRangeOptions = Omit<SearchOptions, 'range'>;

/** A single search result. */
export interface SearchResult {
  /** Cell address in A1 notation */
  address: string;
  /** The cell's display value */
  value: string;
  /** The cell's formula (if any) */
  formula?: string;
}

// =============================================================================
// Sign Check
// =============================================================================

/** Options for sign anomaly detection. */
export interface SignCheckOptions {
  /**
   * Which axis to check sign consistency along.
   * - `'column'`: compare cells vertically within each column (default).
   * - `'row'`: compare cells horizontally within each row.
   * - `'both'`: run both checks, merge results.
   */
  axis?: 'column' | 'row' | 'both';

  /**
   * How many non-empty numeric neighbors to consider in each direction.
   * Default: 3 (up to 6 neighbors total per axis).
   */
  window?: number;
}

/** Result of a signCheck call. */
export interface SignCheckResult {
  /** Total non-zero numeric cells examined. */
  cellsChecked: number;
  /** Cells whose sign disagrees with the majority of their neighbors. */
  anomalies: SignAnomaly[];
}

/** A single cell whose sign disagrees with its neighbors. */
export interface SignAnomaly {
  /** A1 address of the anomalous cell. */
  cell: string;
  /** The cell's computed numeric value. */
  value: number;
  /**
   * Fraction of neighbors with the opposite sign (0.0–1.0).
   * 1.0 = every neighbor disagrees. Sorted descending.
   */
  disagreement: number;
  /** The neighboring cells that were considered. */
  neighbors: { cell: string; value: number }[];
}

// =============================================================================
// Cross-sheet batch read (wb.describeRanges)
// =============================================================================

/** A request for a range read on a specific sheet (used by wb.describeRanges). */
export interface SheetRangeRequest {
  /** Sheet name (case-insensitive lookup). */
  sheet: string;
  /** A1-style range, e.g. "A1:M50". If omitted, reads used range. */
  range?: string;
}

/** Result entry for one sheet range in a batch read. */
export interface SheetRangeDescribeResult {
  /** Sheet name (as resolved). */
  sheet: string;
  /** The range that was actually read. */
  range: string;
  /** The LLM-formatted description (same format as ws.describeRange). Empty string if error. */
  description: string;
  /** Set if this entry failed (bad sheet name, empty sheet, etc.). */
  error?: string;
}

// =============================================================================
// Range Value Type
// =============================================================================

/**
 * Per-cell value type classification.
 * Matches the workbook range value-type enum values.
 */
export enum RangeValueType {
  /** Cell is empty */
  Empty = 'Empty',
  /** Cell contains a string */
  String = 'String',
  /** Cell contains a number (including dates) */
  Double = 'Double',
  /** Cell contains a boolean */
  Boolean = 'Boolean',
  /** Cell contains an error */
  Error = 'Error',
}

// =============================================================================
// Clear Mode
// =============================================================================

/**
 * Determines which aspects of a range to clear.
 * Matches the spreadsheet clear-mode enum.
 */
export type ClearApplyTo = 'all' | 'contents' | 'formats' | 'hyperlinks';

// =============================================================================
// Number Format Category
// =============================================================================

/**
 * Number format category classification.
 * Matches the FormatType enum from Rust compute-formats.
 */
export enum NumberFormatCategory {
  General = 'General',
  Number = 'Number',
  Currency = 'Currency',
  Accounting = 'Accounting',
  Date = 'Date',
  Time = 'Time',
  Percentage = 'Percentage',
  Fraction = 'Fraction',
  Scientific = 'Scientific',
  Text = 'Text',
  Special = 'Special',
  Custom = 'Custom',
}

// =============================================================================
// VisibleRangeView (visible range-view behavior)
// =============================================================================

/**
 * The result of `getVisibleView()` — only visible (non-hidden) rows from a range.
 *
 * Matches the visible range-view concept: a filtered view of a range that
 * excludes hidden rows (e.g., rows hidden by AutoFilter).
 */
export interface VisibleRangeView {
  /** Cell values for visible rows only (2D array, same column count as input range). */
  values: CellValue[][];
  /** The 0-based row indices (absolute, within the sheet) of the visible rows. */
  visibleRowIndices: number[];
}

// =============================================================================
// CellType / CellValueType
// =============================================================================

/**
 * Cell type classification for `getSpecialCells()`.
 * Matches the spreadsheet special-cell type.
 */
export enum CellType {
  /** Empty / blank cells */
  Blanks = 'Blanks',
  /** Cells containing constant (non-formula) values */
  Constants = 'Constants',
  /** Cells containing formulas */
  Formulas = 'Formulas',
  /** Visible cells only (excludes hidden rows/columns) */
  Visible = 'Visible',
  /** Cells that have conditional formatting rules applied */
  ConditionalFormats = 'ConditionalFormats',
  /** Cells that have data validation rules applied */
  DataValidations = 'DataValidations',
}

/**
 * Value type filter for `getSpecialCells()` when cellType is `Constants` or `Formulas`.
 * Matches the spreadsheet special-cell value type.
 */
export enum CellValueType {
  /** Numeric values */
  Numbers = 'Numbers',
  /** Text/string values */
  Text = 'Text',
  /** Boolean values (TRUE/FALSE) */
  Logicals = 'Logicals',
  /** Error values (#REF!, #DIV/0!, etc.) */
  Errors = 'Errors',
}

// =============================================================================
// Function Info
// =============================================================================

/** Information about a spreadsheet function (e.g., SUM, VLOOKUP). */
export interface FunctionInfo {
  /** Function name (uppercase, e.g., "SUM") */
  name: string;
  /** Description of what the function does */
  description: string;
  /** Function category (e.g., "Math & Trig", "Lookup & Reference") */
  category: string;
  /** Syntax example (e.g., "SUM(number1, [number2], ...)") */
  syntax: string;
  /** Usage examples */
  examples?: string[];
  /** Function argument metadata for IntelliSense/argument hints */
  arguments?: FunctionArgument[];
}

// =============================================================================
// Workbook Snapshot
// =============================================================================

/** A summary snapshot of the entire workbook state. */
export interface WorkbookSnapshot {
  /** All sheets in the workbook */
  sheets: SheetSnapshot[];
  /** ID of the currently active sheet */
  activeSheetId: string;
  /** Total number of sheets */
  sheetCount: number;
}

/** A summary snapshot of a single sheet. */
export interface SheetSnapshot {
  /** Sheet ID */
  id: string;
  /** Sheet name */
  name: string;
  /** Sheet index (0-based) */
  index: number;
  /** Range containing all non-empty cells, or null if sheet is empty */
  usedRange: CellRange | null;
  /** Number of cells with data */
  cellCount: number;
  /** Number of cells with formulas */
  formulaCount: number;
  /** Number of charts in this sheet */
  chartCount: number;
  /** Sheet dimensions */
  dimensions: { rows: number; cols: number };
}

// =============================================================================
// Event Types
// =============================================================================

/** All spreadsheet event types that can be subscribed to via `workbook.on()`. */
export type SpreadsheetEventType =
  | 'cellChanged'
  | 'rangeChanged'
  | 'sheetAdded'
  | 'sheetRemoved'
  | 'sheetRenamed'
  | 'sheetMoved'
  | 'activeSheetChanged'
  | 'selectionChanged'
  | 'formatChanged'
  | 'structureChanged'
  | 'tableChanged'
  | 'chartChanged'
  | 'filterChanged'
  | 'sortApplied'
  | 'undoRedoStateChanged'
  | 'calculationComplete'
  | 'protectionChanged';

/** Generic event handler. For typed subscriptions, T is the specific event type. */
export type EventHandler<T = InternalSpreadsheetEvent> = (event: T) => void;

// Re-export internal event types for generic on() signatures
export type {
  EventByType,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent as InternalSpreadsheetEvent,
} from '@mog/types-events/events';

// =============================================================================
// --- API gap closure types ---
// =============================================================================

// Group 1: Protection config (returned by getSheetProtectionOptions bridge)
/** Full protection configuration for a sheet. */
export interface ProtectionConfig {
  /** Whether the sheet is protected */
  isProtected: boolean;
  /** Whether a password is set for protection (does not expose the hash) */
  hasPasswordSet?: boolean;
  /** Allow selecting locked cells */
  allowSelectLockedCells?: boolean;
  /** Allow selecting unlocked cells */
  allowSelectUnlockedCells?: boolean;
  /** Allow formatting cells */
  allowFormatCells?: boolean;
  /** Allow formatting columns */
  allowFormatColumns?: boolean;
  /** Allow formatting rows */
  allowFormatRows?: boolean;
  /** Allow inserting columns */
  allowInsertColumns?: boolean;
  /** Allow inserting rows */
  allowInsertRows?: boolean;
  /** Allow inserting hyperlinks */
  allowInsertHyperlinks?: boolean;
  /** Allow deleting columns */
  allowDeleteColumns?: boolean;
  /** Allow deleting rows */
  allowDeleteRows?: boolean;
  /** Allow sorting */
  allowSort?: boolean;
  /** Allow using auto-filter */
  allowAutoFilter?: boolean;
  /** Allow using pivot tables */
  allowPivotTables?: boolean;
  /** Allow editing objects such as charts, shapes, and images */
  allowEditObjects?: boolean;
  /** Allow editing scenarios */
  allowEditScenarios?: boolean;
}

// Group 3: View options (returned by getViewOptions bridge)
/** Sheet view options (gridlines, headings). */
export interface ViewOptions {
  /** Whether gridlines are shown */
  showGridlines: boolean;
  /** Whether row headers are shown */
  showRowHeaders: boolean;
  /** Whether column headers are shown */
  showColumnHeaders: boolean;
}

/** Scroll position (cell-level, not pixel-level). */
export interface ScrollPosition {
  /** Top visible row index (0-based). */
  topRow: number;
  /** Left visible column index (0-based). */
  leftCol: number;
}

// Group 6: Table style types (returned by getAllCustomTableStyles bridge)
// Copied from Rust-generated compute-types.gen (CustomTableStyleConfig).

export interface TableElementStyle {
  fill?: string;
  fontColor?: string;
  fontBold?: boolean;
  borderTop?: string;
  borderBottom?: string;
  borderLeft?: string;
  borderRight?: string;
}

export interface StripePattern {
  stripeSize: number;
  stripe1Fill?: string;
  stripe2Fill?: string;
}

export interface TableStyleInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  headerRow: TableElementStyle;
  totalRow: TableElementStyle;
  firstColumn: TableElementStyle;
  lastColumn: TableElementStyle;
  rowStripes: StripePattern;
  columnStripes: StripePattern;
  wholeTable: TableElementStyle;
}

/** Configuration for creating/updating a custom table style. */
export interface TableStyleConfig {
  /**
   * Optional legacy style name. `WorkbookTableStyles.add(name, style)` owns the
   * canonical name through its first argument.
   */
  name?: string;
  headerRow?: TableElementStyle;
  totalRow?: TableElementStyle;
  firstColumn?: TableElementStyle;
  lastColumn?: TableElementStyle;
  rowStripes?: StripePattern;
  columnStripes?: StripePattern;
  wholeTable?: TableElementStyle;
  /** Additional producer-specific style metadata. */
  [key: string]: unknown;
}

// Group 7: Workbook settings — re-exported from canonical core definition
// (The API surface previously had a degraded 8-field stub with [key: string]: unknown.
//  The core version has 20+ properly typed fields.)
export type { WorkbookSettings } from '@mog/types-core/core';

// Group 4: Filter info (returned by getFiltersInSheet bridge)
/** Information about a filter applied to a sheet. */
export type FilterKind = 'autoFilter' | 'tableFilter' | 'advancedFilter';

export interface AdvancedFilterDetailInfo {
  /** Resolved criteria range, if this Advanced Filter has criteria. */
  criteriaRange?: { startRow: number; startCol: number; endRow: number; endCol: number };
  /** Whether duplicate full-row records are hidden/copied after criteria evaluation. */
  uniqueRecordsOnly: boolean;
  /** Whether this Advanced Filter currently has criteria or unique-records semantics. */
  active: boolean;
}

export interface FilterInfo {
  /** Filter ID */
  id: string;
  /** Filter kind. */
  filterKind: FilterKind;
  /** The filtered range */
  range?: string;
  /** Per-column filter criteria */
  columns?: Record<string, unknown>;
  /** Table ID if this filter is associated with a table. */
  tableId?: string;
  /** Per-column filter criteria, keyed by column identifier. */
  columnFilters?: Record<string, unknown>;
}

/** Detailed filter information including resolved numeric range and column filters. */
export interface FilterDetailInfo {
  /** Filter ID */
  id: string;
  /** Filter kind. */
  filterKind: FilterKind;
  /** Resolved numeric range of the filter */
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  /** Per-column filter criteria, keyed by header cell ID */
  columnFilters: Record<string, ColumnFilterCriteria>;
  /** Table ID if this filter is associated with a table. */
  tableId?: string;
  /** Advanced Filter metadata, present for advanced filters. */
  advancedFilter?: AdvancedFilterDetailInfo;
}

/** Compact filter information for UI controls that only need identity and activity. */
export interface FilterSummaryInfo {
  /** Filter ID */
  id: string;
  /** Filter kind. */
  filterKind: FilterKind;
  /** Resolved numeric range of the filter */
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  /** Table ID if this filter is associated with a table. */
  tableId?: string;
  /** Number of columns with active criteria. */
  activeColumnCount: number;
  /** Whether this filter has any active criteria. */
  hasActiveCriteria: boolean;
  /** Whether this filter has active runtime or preserved lossless criteria. */
  hasActiveFilter?: boolean;
  /** Whether the active criteria can be cleared through the worksheet filter API. */
  clearable?: boolean;
  /** Whether complete filter details are ready without all-sheet materialization. */
  detailsReady?: boolean;
  /** Whether the filter is fully owned by the production evaluator. */
  capability?: FilterCapability;
  /** Unsupported imported features preserved in lossless metadata. */
  unsupportedReasons?: readonly ImportFilterUnsupportedReason[];
}

/** Renderer-ready filter-header entry keyed by sheet row/column. */
export interface FilterHeaderInfoEntry extends FilterHeaderInfo {
  /** Header row index, zero-based. */
  row: number;
  /** Header column index, zero-based. */
  col: number;
  /** Filter kind. */
  filterKind: FilterKind;
  /** Resolved numeric range of the filter. */
  range: { startRow: number; startCol: number; endRow: number; endCol: number };
  /** Table ID if this filter is associated with a table. */
  tableId?: string;
  /** Source object that owns this header button. */
  sourceType?: 'sheetAutoFilter' | 'tableAutoFilter';
  /** Whether this filter is fully owned by the production evaluator. */
  capability?: 'supported' | 'unsupported';
  /** Unsupported imported features preserved in lossless metadata. */
  unsupportedReasons?: readonly (
    | 'unknownDynamicType'
    | 'unknownCustomOperator'
    | 'dateGroupUnsupported'
    | 'dynamicTemporalContextUnsupported'
    | 'valueTokenUnresolved'
    | 'valueTypeUnsupported'
    | 'colorDxfUnresolved'
    | 'iconFilterUnsupported'
    | 'unknownExtension'
    | 'tableFilterShapeUnsupported'
  )[];
  /** Normalized button visibility after hiddenButton/showButton are applied. */
  buttonVisible?: boolean;
}

// Group 5: Slicer state (returned by getSlicerState bridge — enriched runtime data)
/** Enriched runtime state for a slicer (includes computed items, connection status). */
export interface SlicerState {
  /** Computed items with selection state */
  items: SlicerItem[];
  /** Whether the slicer is connected to its data source */
  isConnected: boolean;
  /** Selected values */
  selectedValues: CellValue[];
  /** Timeline periods (for timeline slicers) */
  periods?: TimelinePeriod[];
}

/** A period in a timeline slicer. */
export interface TimelinePeriod {
  /** Period label */
  label: string;
  /** Period start date (ISO string) */
  start: string;
  /** Period end date (ISO string) */
  end: string;
  /** Whether this period is selected */
  selected: boolean;
}

// Group 9: Aggregate result (returned by getSelectionAggregates bridge)
/** Aggregate values for selected cells (status bar display). */
export interface AggregateResult {
  /** Sum of numeric values */
  sum: number;
  /** Total number of non-empty cells */
  count: number;
  /** Number of numeric cells */
  numericCount: number;
  /** Average of numeric values (null if no numeric cells) */
  average: number | null;
  /** Minimum numeric value (null if no numeric cells) */
  min: number | null;
  /** Maximum numeric value (null if no numeric cells) */
  max: number | null;
}

/** Entry for batch format-values call. */
export interface FormatEntry {
  /** Cell value descriptor */
  value: { type: string; value?: unknown };
  /** Number format code (e.g., "#,##0.00") */
  formatCode: string;
}

// Group 10: Data operation types
/** Destination cell for text-to-columns output. */
export interface TextToColumnsDestination {
  /** Zero-based row index. */
  row: number;
  /** Zero-based column index. */
  col: number;
}

/** Delimiter set for text-to-columns splitting. Multiple delimiters may be enabled. */
export interface TextToColumnsDelimiters {
  /** Split on tab characters. */
  tab?: boolean;
  /** Split on semicolons. */
  semicolon?: boolean;
  /** Split on commas. */
  comma?: boolean;
  /** Split on spaces. */
  space?: boolean;
  /** Split on this custom delimiter character/string. */
  other?: string;
}

/** Options for text-to-columns splitting. */
export interface TextToColumnsOptions {
  /** Split mode. Defaults to 'delimited' when omitted. */
  type?: 'delimited' | 'fixedWidth';
  /**
   * Legacy single delimiter selector. Defaults to 'comma' when `delimiters`
   * is omitted. Use `delimiters` when more than one delimiter is selected.
   */
  delimiter?: 'comma' | 'tab' | 'semicolon' | 'space' | 'custom';
  /** Custom delimiter character (when delimiter is 'custom') */
  customDelimiter?: string;
  /** Full delimiter set. Takes precedence over `delimiter` when provided. */
  delimiters?: TextToColumnsDelimiters;
  /** Destination cell. Defaults to the top-left source cell. */
  destination?: string | TextToColumnsDestination;
  /** Whether to treat consecutive delimiters as one */
  treatConsecutiveAsOne?: boolean;
  /** Text qualifier character */
  textQualifier?: '"' | "'" | 'none';
  /** Zero-based character offsets at which to split (fixedWidth mode). */
  fixedWidthBreaks?: number[];
}

/** Result of a text-to-columns operation. */
export interface TextToColumnsResult {
  /** Number of source rows processed. */
  rowsProcessed: number;
  /** Maximum number of destination columns produced by any processed row. */
  columnsCreated: number;
}

/** Result of a remove-duplicates operation. */
export interface RemoveDuplicatesResult {
  /** Number of duplicate rows removed */
  removedCount: number;
  /** Number of unique rows remaining */
  remainingCount: number;
}

// =============================================================================
// Floating Object Types (generic operations on any floating object)
// =============================================================================

/**
 * Type discriminator for floating objects (API layer).
 * Superset of FloatingObjectKind (12 storage-layer variants) + 'text-effects' (API-only ergonomic alias).
 * text-effect objects are stored as Textbox with word_art config; this type lets consumers reference them directly.
 */
export type FloatingObjectType =
  | 'shape'
  | 'connector'
  | 'picture'
  | 'textbox'
  | 'chart'
  | 'camera'
  | 'equation'
  | 'diagram'
  | 'drawing'
  | 'oleObject'
  | 'formControl'
  | 'slicer'
  | 'text-effects';

/** Summary information about a floating object (returned by listFloatingObjects). */
export interface FloatingObjectInfo {
  /** Unique object ID. */
  id: string;
  /** Object type discriminator. */
  type: FloatingObjectType;
  /** Optional display name. */
  name?: string;
  /** X position in pixels. */
  x: number;
  /** Y position in pixels. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Rotation angle in degrees. */
  rotation?: number;
  /** Flipped horizontally. */
  flipH?: boolean;
  /** Flipped vertically. */
  flipV?: boolean;
  /** Z-order index. */
  zIndex?: number;
  /** Whether the object is visible. */
  visible?: boolean;
  /** ID of the parent group (if this object is grouped). */
  groupId?: string;
  /** Anchor mode (twoCell/oneCell/absolute). */
  anchorType?: ObjectAnchorType;
  /** Alt text for accessibility. */
  altText?: string;
}

// =============================================================================
// Picture Types
// =============================================================================

/** Configuration for creating a new picture. */
export interface PictureConfig {
  /** Image source: data URL, blob URL, or file path. */
  src: string;
  /** X position in pixels. */
  x?: number;
  /** Y position in pixels. */
  y?: number;
  /** Width in pixels (defaults to original image width). */
  width?: number;
  /** Height in pixels (defaults to original image height). */
  height?: number;
  /** Accessibility alt text. */
  altText?: string;
  /** Display name. */
  name?: string;
  /** Image crop settings (percentage from each edge). */
  crop?: PictureCrop;
  /** Image adjustments (brightness, contrast, transparency). */
  adjustments?: PictureAdjustments;
  /** Border around the picture. */
  border?: ObjectBorder;
  /** Full floating-object position update. Used by Format Picture dialogs. */
  position?: Partial<ObjectPosition>;
  /** Whether the picture is locked when sheet protection is active. */
  locked?: boolean;
  /** Whether the picture prints with the worksheet. */
  printable?: boolean;
  /**
   * Anchor cell as `{row, col}`. When set, `x`/`y` become offsets from this
   * cell instead of from cell `(0, 0)`. Used by paste-image to anchor at the
   * active cell.
   */
  anchorCell?: { row: number; col: number };
}

// =============================================================================
// Text Box Types
// =============================================================================

/** Configuration for creating a new text box. */
export interface TextBoxConfig {
  /** Text content and formatting — shared model with ShapeData. */
  text?: ShapeText;
  /**
   * Anchor cell as `{row, col}`. When set, `x`/`y` are offsets from this
   * cell instead of from cell `(0, 0)`.
   */
  anchorCell?: { row: number; col: number };
  /** X position in pixels. */
  x?: number;
  /** Y position in pixels. */
  y?: number;
  /** Width in pixels (default: 200). */
  width?: number;
  /** Height in pixels (default: 100). */
  height?: number;
  /** Display name. */
  name?: string;
}

// =============================================================================
// Equation Types
// =============================================================================

/** Configuration for creating a new equation. */
export interface EquationConfig {
  /** LaTeX source for the equation. */
  latex: string;
  /**
   * Anchor cell as `{row, col}`. When set, `x`/`y` are offsets from this
   * cell instead of from cell `(0, 0)`.
   */
  anchorCell?: { row: number; col: number };
  /** X position in pixels. */
  x?: number;
  /** Y position in pixels. */
  y?: number;
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
  /** Equation style options. */
  style?: EquationStyleConfig;
}

/** Styling overrides for an equation. Missing fields are filled by kernel defaults. */
export type EquationStyleConfig = Partial<EquationStyle>;

/** Fully normalized equation defaults used by Worksheet equation creation. */
export interface EquationDefaults {
  /** Fully populated default equation style. */
  style: EquationStyle;
  /** Default equation object width in pixels. */
  width: number;
  /** Default equation object height in pixels. */
  height: number;
}

/** Updates for an existing equation. */
export interface EquationUpdates {
  /** Updated LaTeX source. */
  latex?: string;
  /** Updated OMML XML. */
  omml?: string;
  /** Updated style options. */
  style?: Partial<EquationStyleConfig>;
}

// =============================================================================
// Text-Effect Types
// =============================================================================

/** Persisted visual text-effect configuration stored on a TextBoxObject. */
export type TextEffectObjectConfig = DomainTextEffectConfig;

/** Configuration for creating new text effects. */
export interface CreateTextEffectInput {
  /** Text content. */
  text: string;
  /** Text warp preset. Missing values are filled by kernel defaults. */
  warpPreset?: TextWarpPreset;
  /** Warp adjustment values. */
  warpAdjustments?: AdjustmentValues;
  /** Text fill configuration. Missing values are filled by kernel defaults. */
  fill?: TextEffectFill;
  /** Text outline configuration. Missing values are filled by kernel defaults. */
  outline?: TextEffectOutline;
  /** Text effects configuration. Missing values are filled by kernel defaults. */
  effects?: TextEffects;
  /** Visual text-effect configuration overrides. */
  textEffects?: Partial<TextEffectObjectConfig>;
  /** X position in pixels. */
  x?: number;
  /** Y position in pixels. */
  y?: number;
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
  /** Display name. */
  name?: string;
}

/** Fully normalized text effects defaults used by Worksheet text effects creation. */
export interface TextEffectDefaults {
  /** Fully populated default visual text-effect configuration. */
  config: TextEffectObjectConfig;
  /** Default text-effect object width in pixels. */
  width: number;
  /** Default text-effect object height in pixels. */
  height: number;
}

/** Text-format fields accepted by text-effect text formatting updates. */
export type TextEffectTextFormatUpdate = Partial<NonNullable<ShapeText['format']>>;

/** Updates for existing text effects. */
export interface TextEffectUpdates {
  /** Updated text content. */
  text?: string;
  /** Warp preset name (text geometric transformation). */
  warp?: TextWarpPreset;
  /** Warp adjustment values. */
  warpAdjustments?: AdjustmentValues;
  /** Fill configuration. */
  fill?: TextEffectFill;
  /** Outline configuration. Explicit undefined removes the outline. */
  outline?: TextEffectOutline | undefined;
  /** Text effects (shadow, glow, reflection, etc.). */
  effects?: TextEffects;
  /** Full text-effect configuration batch update. */
  config?: TextEffectConfigUpdate;
  /** Text formatting update. */
  textFormat?: TextEffectTextFormatUpdate;
}

// =============================================================================
// Diagram Types
// =============================================================================

/** Configuration for creating a new diagram. */
export interface DiagramConfig {
  /** Layout ID (e.g., 'hierarchy/org-chart', 'process/basic-process'). */
  layoutId: string;
  /** X position in pixels. */
  x?: number;
  /** Y position in pixels. */
  y?: number;
  /** Width in pixels. */
  width?: number;
  /** Height in pixels. */
  height?: number;
  /** Initial nodes to create. */
  nodes?: DiagramNodeConfig[];
  /** Display name. */
  name?: string;
}

/** Configuration for a diagram node. */
export interface DiagramNodeConfig {
  /** Node text content. */
  text: string;
  /** Hierarchy level (0 = root). */
  level?: number;
  /** Insertion position relative to a reference node. */
  position?: 'before' | 'after' | 'child';
  /** Reference node ID for positioning. */
  referenceNodeId?: string;
}

// =============================================================================
// --- Drawings (ink) ---
// =============================================================================

/** Transform type for stroke transformations. */
export type StrokeTransformType = 'rotate' | 'scale' | 'flip-horizontal' | 'flip-vertical';

/** Transform parameters for stroke transformations. */
export interface StrokeTransformParams {
  /** Transform type */
  type: StrokeTransformType;
  /** Center point X for rotation/scale */
  centerX?: number;
  /** Center point Y for rotation/scale */
  centerY?: number;
  /** Rotation angle in radians (for 'rotate') */
  angle?: number;
  /** Scale factor X (for 'scale') */
  scaleX?: number;
  /** Scale factor Y (for 'scale') */
  scaleY?: number;
}

// =============================================================================
// --- Domain module API types ---
// =============================================================================

// Group State (1b: Grouping Read Methods)
/** State of all row/column groups on a sheet. */
export interface GroupState {
  /** All row groups */
  rowGroups: any[];
  /** All column groups */
  columnGroups: any[];
  /** Maximum outline level for rows */
  maxRowLevel: number;
  /** Maximum outline level for columns */
  maxColLevel: number;
}

/** Configuration for the subtotal operation. */
export interface SubtotalConfig {
  /** Target range to subtotal */
  range: CellRange;
  /** Whether the target range includes a header row */
  hasHeaders: boolean;
  /** Column index to group by (0-based) */
  groupByColumn: number;
  /** Columns to subtotal (0-based indices) */
  subtotalColumns: number[];
  /** Aggregation function to use */
  aggregation: 'sum' | 'count' | 'average' | 'max' | 'min';
  /** Whether to replace existing subtotals */
  replace?: boolean;
  /** Whether summary rows appear below their detail rows */
  summaryBelowData?: boolean;
}

/** Result of creating subtotals. */
export interface SubtotalResult {
  /** Number of row groups created */
  groupsCreated: number;
  /** Number of subtotal rows inserted */
  subtotalRowsInserted: number;
  /** Range affected by the subtotal operation */
  affectedRange: CellRange;
}

// Filter Sort State (1e: Filter Sort State)
/** Sort state for a filter. */
export interface FilterSortState {
  /** Column index or header cell ID to sort by */
  column: string | number;
  /** Sort direction */
  direction: 'asc' | 'desc';
  /** Sort criteria (optional, for advanced sorting) */
  criteria?: any;
}

// Sheet Settings (1h: Sheet Settings for domain module elimination)
/** Full sheet settings (mirrors SheetSettings from core contracts). */
export interface SheetSettingsInfo {
  /** Default row height in pixels */
  defaultRowHeight: number;
  /** Default column width in pixels */
  defaultColWidth: number;
  /** Whether gridlines are shown */
  showGridlines: boolean;
  /** Whether row headers are shown */
  showRowHeaders: boolean;
  /** Whether column headers are shown */
  showColumnHeaders: boolean;
  /** Whether zero values are displayed (false = blank) */
  showZeroValues: boolean;
  /** Gridline color (hex string) */
  gridlineColor: string;
  /** Whether the sheet is protected */
  isProtected: boolean;
  /** Whether the sheet uses right-to-left layout */
  rightToLeft: boolean;
}

// Outline Settings (1i: Outline Settings for domain module elimination)
/** Outline display settings for grouping. */
export interface OutlineSettings {
  /** Whether outline symbols (+/-) are visible */
  showOutlineSymbols: boolean;
  /** Whether outline level buttons (1,2,3...) are visible */
  showOutlineLevelButtons: boolean;
  /** Whether summary rows appear below detail rows */
  summaryRowsBelow: boolean;
  /** Whether summary columns appear to the right of detail */
  summaryColumnsRight: boolean;
}

// Named Range Update (1j: Named range update for domain module elimination)
/** Options for updating a named range. */
export interface NamedRangeUpdateOptions {
  /** New name (for renaming) */
  name?: string;
  /** New reference (A1-style) */
  reference?: string;
  /** New comment */
  comment?: string;
  /** Whether the name is visible in Name Manager */
  visible?: boolean;
}

// =============================================================================
// --- API extension types ---
// =============================================================================

// 1a: Create Names from Selection
/** Options for creating named ranges from row/column labels in a selection. */
export interface CreateNamesFromSelectionOptions {
  /** Create names from labels in the top row of the selection. */
  top?: boolean;
  /** Create names from labels in the left column of the selection. */
  left?: boolean;
  /** Create names from labels in the bottom row of the selection. */
  bottom?: boolean;
  /** Create names from labels in the right column of the selection. */
  right?: boolean;
}

/** Result of a create-names-from-selection operation. */
export interface CreateNamesResult {
  /** Number of names successfully created. */
  success: number;
  /** Number of names skipped (already exist or invalid). */
  skipped: number;
}

// 1b: Undo History
/** An entry in the undo history. */
export interface UndoHistoryEntry {
  /** Unique identifier for this entry. */
  id: string;
  /** Description of the operation. */
  description: string;
  /** Timestamp of the operation (Unix ms). */
  timestamp: number;
}

// 1g: Undo State
/** Full undo/redo state from the compute engine. */
export interface UndoState {
  /** Whether undo is available. */
  canUndo: boolean;
  /** Whether redo is available. */
  canRedo: boolean;
  /** Number of operations that can be undone. */
  undoDepth: number;
  /** Number of operations that can be redone. */
  redoDepth: number;
  /** Description of the next undo operation, if set. */
  nextUndoDescription: string | null;
  /** Description of the next redo operation, if set. */
  nextRedoDescription: string | null;
}

// =============================================================================
// Data Binding Types (sheet-level data source connections)
// =============================================================================

/** Column mapping for a sheet data binding. */
export interface ColumnMapping {
  /** Column index to write to (0-indexed) */
  columnIndex: number;
  /** JSONPath or field name to extract from data */
  dataPath: string;
  /** Optional transform formula (receives value as input) */
  transform?: string;
  /** Header text (if headerRow >= 0) */
  headerText?: string;
}

/** Configuration for creating a sheet data binding. */
export interface CreateBindingConfig {
  /** Connection providing the data */
  connectionId: string;
  /** Maps data fields to columns */
  columnMappings: ColumnMapping[];
  /** Auto-insert/delete rows to match data length (default: true) */
  autoGenerateRows?: boolean;
  /** Row index for headers (-1 = no header row, default: 0) */
  headerRow?: number;
  /** First row of data (0-indexed, default: 1) */
  dataStartRow?: number;
  /** Preserve header row formatting on refresh (default: true) */
  preserveHeaderFormatting?: boolean;
}

/** Information about an existing sheet data binding. */
export interface SheetDataBindingInfo {
  /** Unique binding identifier */
  id: string;
  /** Connection providing the data */
  connectionId: string;
  /** Maps data fields to columns */
  columnMappings: ColumnMapping[];
  /** Auto-insert/delete rows to match data length */
  autoGenerateRows: boolean;
  /** Row index for headers (-1 = no header row) */
  headerRow: number;
  /** First row of data (0-indexed) */
  dataStartRow: number;
  /** Preserve header row formatting on refresh */
  preserveHeaderFormatting: boolean;
  /** Last refresh timestamp */
  lastRefresh?: number;
}

// =============================================================================
// Viewport types (sync render-path data)
// =============================================================================

/**
 * Viewport reader contracts (ViewportReader, BinaryCellReader,
 * BinaryViewportReader, and supporting data records) were promoted to
 * @mog/types-viewport/viewport/reader so types-rendering
 * (Tier 2) can consume them without forming a rendering ↔ api (Tier 2 ↔
 * Tier 2) cycle. Re-exported here for back-compat.
 */
export type {
  ActiveCellInfo,
  BinaryCellData,
  BinaryCellReader,
  BinaryViewportReader,
  ViewportBounds,
  ViewportCellData,
  ViewportColDimension,
  ViewportMergeRegion,
  ViewportReader,
  ViewportRowDimension,
} from '@mog/types-viewport/viewport/reader';

// =============================================================================
// Records API types (table-aware CRUD for view adapters/containers)
// =============================================================================

/**
 * A RecordValues is a map of field (column) IDs to their values.
 * This is the computed/display value, not raw formula text.
 */
export type RecordValues = { [key: string]: CellValue };

/**
 * A TableRecord represents a row in a table with its values.
 */
export interface TableRecord {
  /** The record's row ID (row index as string, e.g., "5") */
  rowId: string;
  /** The record's field values (keyed by column ID or column name) */
  values: RecordValues;
}

/**
 * Filter expression for querying records.
 * Currently supports simple equality filters.
 */
export interface FilterExpression {
  /** Field to filter on (column ID or column name) */
  field: string;
  /** Value to match (exact equality) */
  equals: CellValue;
}

/**
 * Records API — table-aware CRUD operations.
 *
 * Provides record (row) operations for table-based views like Kanban, Gallery, etc.
 * A "Record" is a row in a table, with each column representing a field.
 *
 * Available on `workbook.records`. Wraps the kernel Records module,
 * hiding the DocumentContext from app-layer consumers.
 */
export interface IRecordsAPI {
  /** Get a single record by row ID. */
  get(tableId: string, rowId: string): Promise<TableRecord | null>;
  /** Query records in a table with optional filtering. */
  query(tableId: string, filter?: FilterExpression): Promise<TableRecord[]>;
  /** Get a single field value from a record by column ID or name. */
  getFieldValue(tableId: string, rowId: string, fieldId: string): Promise<CellValue>;
  /** Get a field value by column name (convenience wrapper). */
  getFieldByName(tableId: string, rowId: string, fieldName: string): Promise<CellValue>;
  /** Create a new record in the table. Returns the new record's row ID. */
  create(tableId: string, values: RecordValues): Promise<string>;
  /** Update a record's field values. */
  update(tableId: string, rowId: string, changes: Partial<RecordValues>): Promise<void>;
  /** Remove a record from the table (clears the row's cells). */
  remove(tableId: string, rowId: string): Promise<void>;
}

// =============================================================================
// Sheet-level and workbook-level event types
// =============================================================================

/**
 * Coarse sheet-level event types for `ws.on()`.
 *
 * Each coarse type maps to one or more fine-grained internal events.
 * Callers that need fine-grained control can use SpreadsheetEventType
 * as an escape hatch: `ws.on('filter:applied', handler)`.
 */
export type SheetEvent =
  | 'cellChanged'
  | 'filterChanged'
  | 'visibilityChanged'
  | 'structureChanged'
  | 'mergeChanged'
  | 'tableChanged'
  | 'chartChanged'
  | 'slicerChanged'
  | 'sparklineChanged'
  | 'groupingChanged'
  | 'cfChanged'
  | 'viewportRefreshed'
  | 'recalcComplete'
  | 'nameChanged'
  | 'selectionChanged'
  | 'activated'
  | 'deactivated';

/**
 * Coarse workbook-level event types for `wb.on()`.
 *
 * These events are not sheet-scoped — they fire once for the whole workbook.
 */
export type WorkbookEvent =
  | 'sheetAdded'
  | 'sheetRemoved'
  | 'sheetRenamed'
  | 'activeSheetChanged'
  | 'undoStackChanged'
  | 'checkpointCreated'
  | 'namedRangeChanged'
  | 'scenarioChanged'
  | 'settingsChanged';

// =============================================================================
// Typed Event Maps for `on()` overloads (Issue 6a)
// =============================================================================

/**
 * Maps each coarse SheetEvent name to the union of typed event payloads
 * that the handler will receive. These correspond to the internal event
 * types wired in SHEET_EVENT_TO_INTERNAL.
 *
 * Events whose internal strings have no typed definition are omitted;
 * the handler simply never fires for those (the event bus does string matching).
 */
export interface SheetEventMap {
  cellChanged:
    | CellChangedEvent
    | CellsBatchChangedEvent
    | CellFormatChangedEvent
    | CellMetadataChangedEvent;
  filterChanged:
    | FilterAppliedEvent
    | FilterClearedEvent
    | FilterCreatedEvent
    | FilterDeletedEvent
    | FilterUpdatedEvent;
  visibilityChanged:
    | RowsHiddenEvent
    | RowsUnhiddenEvent
    | ColumnsHiddenEvent
    | ColumnsUnhiddenEvent;
  structureChanged:
    | RowsInsertedEvent
    | RowsDeletedEvent
    | ColumnsInsertedEvent
    | ColumnsDeletedEvent;
  mergeChanged: CellsMergedEvent | CellsUnmergedEvent | MergesChangedEvent;
  tableChanged: TableCreatedEvent | TableUpdatedEvent | TableDeletedEvent;
  chartChanged: ChartCreatedEvent | ChartUpdatedEvent | ChartDeletedEvent;
  slicerChanged: SlicerCreatedEvent | SlicerUpdatedEvent | SlicerDeletedEvent;
  sparklineChanged:
    | SparklineChangedEvent
    | SparklineCreatedEvent
    | SparklineUpdatedEvent
    | SparklineDeletedEvent;
  groupingChanged: GroupingChangedEvent;
  cfChanged: CFRulesChangedEvent | CFRuleCreatedEvent | CFRuleDeletedEvent;
  viewportRefreshed: ViewportResizedEvent;
  recalcComplete: RecalcCompletedEvent;
  nameChanged: SheetRenamedEvent;
  selectionChanged: SelectionChangedEvent;
  activated: SheetActivatedEvent;
  deactivated: { type: 'sheet:deactivated'; sheetId: string; name: string; timestamp: number };
  columnSorted: ColumnSortedEvent;
  rowSorted: RowSortedEvent;
  formulaChanged: FormulaChangedEvent;
  protectionChanged: ProtectionChangedEvent;
}

/**
 * Maps each coarse WorkbookEvent name to the union of typed event payloads
 * that the handler will receive. These correspond to the internal event
 * types wired in WORKBOOK_EVENT_TO_INTERNAL.
 */
export interface WorkbookEventMap {
  sheetAdded: SheetCreatedEvent;
  sheetRemoved: SheetDeletedEvent;
  sheetRenamed: SheetRenamedEvent;
  activeSheetChanged: SheetActivatedEvent;
  undoStackChanged: InternalSpreadsheetEvent;
  checkpointCreated: InternalSpreadsheetEvent;
  namedRangeChanged: NameCreatedEvent | NameUpdatedEvent | NameDeletedEvent;
  scenarioChanged: ScenarioAppliedEvent | ScenarioDeletedEvent;
  settingsChanged: WorkbookSettingsChangedEvent;
}

/**
 * Maps each sheet collection event to its payload type.
 * Used by `workbook.sheets.on()`.
 */
export interface SheetsCollectionEventMap {
  sheetAdded: SheetCreatedEvent;
  sheetRemoved: SheetDeletedEvent;
  sheetRenamed: SheetRenamedEvent;
  activeSheetChanged: SheetActivatedEvent;
}

/**
 * Options for insertWorksheetsFromBase64 — controls which sheets to import
 * and where to place them in the workbook.
 */
export interface InsertWorksheetOptions {
  /** Which sheets to import by name. Default: all sheets. */
  sheetNamesToInsert?: string[];
  /** Where to insert relative to existing sheets. Default: 'end'. */
  positionType?: 'before' | 'after' | 'beginning' | 'end';
  /** Sheet name to position relative to (required for 'before'/'after'). */
  relativeTo?: string;
}

// =============================================================================
// Reactive cache interfaces
// =============================================================================

/**
 * Reactive conditional format cache.
 *
 * Provides sync reads for the render path and auto-invalidates when CF rules
 * or cell values change. Created lazily by `ws.conditionalFormats`.
 *
 * Lifecycle: implements `destroy()` for subscription teardown.
 * `WorksheetImpl.dispose()` calls `destroy()` to prevent memory leaks.
 */
export interface ConditionalFormatCache {
  /** Get the CF result for a cell (sync, O(1)). Returns undefined if no CF applies. */
  getResult(sheetId: string, row: number, col: number): CFResult | undefined;
  /** Check if a cell has conditional formatting. */
  hasCF(sheetId: string, row: number, col: number): boolean;
  /** Force re-evaluation of all CF rules for a sheet. */
  evaluateAll(sheetId: string): Promise<void>;
  /** Invalidate cached results for specific cells. */
  invalidateCells(
    sheetId: string,
    changedCells?: Array<{ row: number; col: number }>,
  ): Promise<void>;
  /** Invalidate all cached results. */
  invalidateAll(): void;
  /** Subscribe to rule changes. Returns unsubscribe function. */
  onRulesChanged(callback: () => void): () => void;
  /** Tear down subscriptions and release resources. */
  destroy(): void;
}

/**
 * Reactive cell metadata cache.
 *
 * Provides sync reads for projection (dynamic array spill) data and
 * validation error indicators. Auto-invalidates on recalc. Created lazily
 * by `ws.cellMetadata`.
 *
 * Lifecycle: implements `destroy()` for subscription teardown.
 */
export interface CellMetadataCache {
  /** Check if a cell position is a projected (spill target) position. */
  isProjectedPosition(row: number, col: number): boolean;
  /** Get the source cell of a projection. */
  getProjectionSourcePosition(row: number, col: number): { row: number; col: number } | undefined;
  /** Get the full range of a projection (dynamic array spill range). */
  getProjectionRange(row: number, col: number): CellRange | undefined;
  /** Check if a cell has validation errors. */
  hasValidationErrors(row: number, col: number): boolean;
  /** Evaluate metadata for the visible viewport range. */
  evaluateViewport(
    sheetId: string,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<void>;
  /** Subscribe to metadata changes. Returns unsubscribe function. */
  onChange(callback: () => void): () => void;
  /** Clear all cached data. */
  clear(): void;
  /** Tear down subscriptions and release resources. */
  destroy(): void;
}

// =============================================================================
// Screenshot Types
// =============================================================================

/** Options for capturing a sheet screenshot as a PNG image. */
export interface ScreenshotOptions {
  /** Device pixel ratio (1 = standard, 2 = Retina). Default: 1. */
  dpr?: number;
  /** Whether to render row/column headers. Default: true. */
  showHeaders?: boolean;
  /** Whether to render gridlines. Default: true. */
  showGridlines?: boolean;
  /** Maximum pixel width — scales down if exceeded. */
  maxWidth?: number;
  /** Maximum pixel height — scales down if exceeded. */
  maxHeight?: number;
}
