/**
 * Pivot Table Contracts
 *
 * Self-contained type definitions for pivot table UI and engine interfaces.
 *
 * The types in this file are structurally identical to the auto-generated Rust
 * types in `kernel/src/bridges/compute/compute-types.gen.ts`. If the Rust structs
 * change, these definitions MUST be updated manually to stay in sync.
 *
 * This file also defines TS-only types that have no Rust counterpart
 * (SortOrder, PivotItemInfo, PivotFieldItems, etc.).
 */

import type { CellValue } from '@mog/types-core/core';
import type { SortDirection } from './sorting';

export type PlacementId = string & { readonly __brand: 'PlacementId' };
export type CalculatedFieldId = string & { readonly __brand: 'CalculatedFieldId' };
export type PivotMemberKey = string & { readonly __brand: 'PivotMemberKey' };
export type PivotTupleKey = string & { readonly __brand: 'PivotTupleKey' };

// ============================================================================
// Types mirrored from Rust (compute-types.gen.ts)
// ============================================================================

export type AggregateFunction =
  | 'sum'
  | 'count'
  | 'counta'
  | 'countunique'
  | 'average'
  | 'min'
  | 'max'
  | 'product'
  | 'stdev'
  | 'stdevp'
  | 'var'
  | 'varp';

export type PivotMutationStage = 'validate' | 'configWrite' | 'refresh' | 'materialize';

export interface PivotKernelMutationError {
  code:
    | 'PIVOT_NOT_FOUND'
    | 'PLACEMENT_NOT_FOUND'
    | 'DUPLICATE_PLACEMENT_ID'
    | 'AMBIGUOUS_SELECTOR'
    | 'INVALID_PLACEMENT_SOURCE'
    | 'CALCULATED_FIELD_NOT_FOUND'
    | 'DUPLICATE_CALCULATED_FIELD_ID'
    | 'DUPLICATE_CALCULATED_FIELD_NAME'
    | 'INVALID_CALCULATED_FIELD_FORMULA'
    | 'INVALID_CALCULATED_FIELD_REFERENCE'
    | 'CALCULATED_FIELD_DEPENDENCY_CYCLE'
    | 'INVALID_CALCULATED_FIELD_STATE'
    | 'INVALID_EXPANSION_KEY'
    | 'UNRESOLVABLE_EXPANSION_KEY'
    | 'STALE_EXPANSION_TARGET'
    | 'REFRESH_FAILED'
    | 'MATERIALIZATION_FAILED';
  stage: PivotMutationStage;
  message: string;
}

export type PivotMutationStatus = 'applied' | 'noOp' | 'failed';

export interface PivotMutationEffect {
  type:
    | 'placementAdded'
    | 'placementUpdated'
    | 'placementRemoved'
    | 'calculatedFieldAdded'
    | 'calculatedFieldUpdated'
    | 'calculatedFieldRemoved'
    | 'calculatedFieldInvalidated'
    | 'expansionChanged'
    | 'expansionKeyDropped';
  placementId?: PlacementId;
  calculatedFieldId?: CalculatedFieldId;
  expansionKey?: PivotExpansionKey;
}

export interface PivotKernelMutationReceipt {
  kernelReceiptId: string;
  pivotId: string;
  effects: PivotMutationEffect[];
  mutationResult: unknown;
  updateReason: string;
  refreshPolicy: 'dirtyOnly' | 'refreshAndMaterialize';
  materialized: boolean;
  configRevision: number;
  resultRevision?: number;
  materializedRevision?: number;
  status: PivotMutationStatus;
  error?: PivotKernelMutationError;
}

export type PivotPlacementMutationReceipt =
  | (PivotKernelMutationReceipt & { status: 'applied'; placementId: PlacementId })
  | (PivotKernelMutationReceipt & { status: 'noOp' | 'failed'; placementId?: never });

export interface PivotCommandReceipt {
  receiptId: string;
  kernelReceiptId: string;
  action: string;
  pivotId: string;
  effects: PivotMutationEffect[];
  updateReason: string;
  refreshPolicy: 'dirtyOnly' | 'refreshAndMaterialize';
  materialized: boolean;
  configRevision: number;
  resultRevision: number;
  projectionRevision: number;
  materializedRevision?: number;
  renderFrame: number;
  status: 'complete' | 'failed' | 'cancelled' | 'timeout';
  error?: PivotKernelMutationError | { code: 'UI_TIMEOUT' | 'UI_CANCELLED'; message: string };
}

export interface PivotReadbackRevision {
  configRevision: number;
  resultRevision: number;
  projectionRevision: number;
  materializedRevision?: number;
  renderFrame: number;
  lastCommandReceiptId?: string;
}

export interface CalculatedFieldStatus {
  state: 'valid' | 'invalid';
  error?: PivotKernelMutationError;
  referencedFieldIds: string[];
}

export interface PivotCalculatedField {
  calculatedFieldId: CalculatedFieldId;
  name: string;
  formula: string;
  status: CalculatedFieldStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Legacy calculated-field shape. New contracts should use `PivotCalculatedField`.
 */
export interface CalculatedField {
  fieldId: string;
  calculatedFieldId?: CalculatedFieldId;
  name: string;
  formula: string;
  status?: CalculatedFieldStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type DateGrouping =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second';

export type DetectedDataType = 'string' | 'number' | 'date' | 'boolean' | 'empty' | 'error';

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between'
  | 'notBetween'
  | 'isBlank'
  | 'isNotBlank'
  | 'aboveAverage'
  | 'belowAverage';

export type LayoutForm = 'compact' | 'outline' | 'tabular';

export interface NumberGrouping {
  start: number;
  end: number;
  interval: number;
}

export interface OutputLocation {
  row: number;
  col: number;
}

export interface SheetRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface PivotColumnHeader {
  headers: PivotHeader[];
  fieldId: string;
}

export interface PivotField {
  id: string;
  name: string;
  sourceColumn: number;
  dataType: DetectedDataType;
}

export type PivotFieldArea = 'row' | 'column' | 'value' | 'filter';

export interface PivotFieldPlacementFlat {
  placementId: PlacementId;
  fieldId: string;
  calculatedFieldId?: CalculatedFieldId;
  area: PivotFieldArea;
  position: number;
  aggregateFunction?: AggregateFunction;
  sortOrder?: SortDirection;
  customSortList?: CellValue[];
  sortByValue?: SortByValueConfig;
  dateGrouping?: DateGrouping;
  numberGrouping?: NumberGrouping;
  showSubtotals?: boolean;
  displayName?: string;
  numberFormat?: string;
  showValuesAs?: ShowValuesAsConfig;
}

export interface PivotFilter {
  fieldId: string;
  includeValues?: CellValue[];
  excludeValues?: CellValue[];
  condition?: PivotFilterConditionFlat;
  topBottom?: PivotTopBottomFilter;
  showItemsWithNoData?: boolean;
}

export interface PivotFilterConditionFlat {
  operator: FilterOperator;
  value?: CellValue;
  value2?: CellValue;
}

export interface PivotGrandTotals {
  row?: CellValue[];
  column?: CellValue[][];
  grand?: CellValue[];
  rowLabel?: string;
}

export interface PivotHeader {
  key: PivotMemberKey;
  value: CellValue;
  fieldId: string;
  axisPlacementId?: PlacementId;
  depth: number;
  span: number;
  isExpandable: boolean;
  isExpanded: boolean;
  isSubtotal: boolean;
  isGrandTotal: boolean;
  parentKey?: PivotMemberKey;
  childKeys?: PivotMemberKey[];
}

export interface PivotRenderedBounds {
  totalRows: number;
  totalCols: number;
  firstDataRow: number;
  firstDataCol: number;
  /**
   * Number of data columns reserved for the pivot body — `column_leaves * max(v, 1)`.
   * Distinct from `totalCols`, which adds row-header columns and grand-total columns.
   * Computed from the column-axis structure (sum of depth-0 column-header spans),
   * not from per-row value vectors, so it stays correct when measures or rows are empty.
   */
  numDataCols: number;
}

export interface PivotRow {
  key: PivotTupleKey;
  headers: PivotHeader[];
  values: CellValue[];
  valueRecords?: PivotValueRecord[];
  depth: number;
  isSubtotal: boolean;
  isGrandTotal: boolean;
  /** Source row indices from the original data that contribute to this row's values.
   * Indices are 0-based into the source data rows (excluding the header row). */
  sourceRowIndices?: number[];
}

export interface PivotMeasureDescriptor {
  placementId: PlacementId;
  source:
    | { type: 'field'; fieldId: string }
    | { type: 'calculatedField'; calculatedFieldId: CalculatedFieldId };
  aggregateFunction: AggregateFunction;
  name: string;
  numberFormat?: string;
}

/**
 * Identifies which data hierarchy (value field) a pivot cell belongs to.
 */
export interface PivotDataHierarchyInfo {
  /** The field ID of the value field. */
  fieldId: string;
  /** Stable placement ID of the value field. */
  measurePlacementId?: PlacementId;
  /** The display name of the value field (e.g., "Sum of Sales"). */
  displayName: string;
  /** The aggregate function applied. */
  aggregateFunction: AggregateFunction;
  /** The 0-based index of this value field in the value placements. */
  index: number;
}

/**
 * Identifies which pivot items (row/column group values) intersect at a given cell.
 */
export interface PivotItemLocation {
  /** The field ID. */
  fieldId: string;
  /** Stable placement ID of the axis field, when available. */
  axisPlacementId?: PlacementId;
  /** The display value of the item. */
  value: CellValue;
  /** The compound key identifying this item in the pivot result tree. */
  key: PivotMemberKey;
}

export interface PivotTableConfig {
  schemaVersion: number;
  id: string;
  name: string;
  /**
   * Stable identifier for the sheet containing the source data.
   * Authoritative when present; sourceSheetName is derived/display metadata.
   */
  sourceSheetId?: string;
  /** Display name of the source sheet. Legacy configs may provide only this. */
  sourceSheetName: string;
  sourceRange: SheetRange;
  outputSheetName: string;
  outputLocation: OutputLocation;
  fields: PivotField[];
  placements: PivotFieldPlacementFlat[];
  filters: PivotFilter[];
  layout?: PivotTableLayout;
  style?: PivotTableStyle;
  dataOptions?: PivotTableDataOptions;
  createdAt?: number;
  updatedAt?: number;
  calculatedFields?: CalculatedField[];
  /** When true, allows multiple filter criteria on a single field. */
  allowMultipleFiltersPerField?: boolean;
  /** Controls whether the pivot table auto-formats when refreshed. */
  autoFormat?: boolean;
  /** Controls whether custom formatting is preserved on refresh. */
  preserveFormatting?: boolean;
  cacheId?: number;
  refRange?: string;
  firstDataRow?: number;
  firstDataCol?: number;
  rowItems?: PivotRowColItem[];
  colItems?: PivotRowColItem[];
}

export interface PivotTableDataOptions {
  emptyValue?: string;
  errorValue?: string;
  refreshOnOpen?: boolean;
}

export interface PivotTableLayout {
  showRowGrandTotals?: boolean;
  showColumnGrandTotals?: boolean;
  layoutForm?: LayoutForm;
  subtotalLocation?: SubtotalLocation;
  repeatRowLabels?: boolean;
  insertBlankRowAfterItem?: boolean;
  showRowHeaders?: boolean;
  showColumnHeaders?: boolean;
  classicLayout?: boolean;
  grandTotalCaption?: string;
  rowHeaderCaption?: string;
  colHeaderCaption?: string;
  dataCaption?: string;
  gridDropZones?: boolean;
  errorCaption?: string;
  showError?: boolean;
  missingCaption?: string;
  showMissing?: boolean;
}

export interface PivotTableResult {
  columnHeaders: PivotColumnHeader[];
  rows: PivotRow[];
  records?: PivotQueryRecord[];
  grandTotals: PivotGrandTotals;
  sourceRowCount: number;
  renderedBounds: PivotRenderedBounds;
  measureDescriptors?: PivotMeasureDescriptor[];
  valueRecords?: PivotValueRecord[];
  errors?: string[];
}

export interface PivotTableStyle {
  styleName?: string;
  showRowStripes?: boolean;
  showColumnStripes?: boolean;
}

export interface PivotTopBottomFilter {
  type: TopBottomType;
  n: number;
  by: TopBottomBy;
  valueFieldId?: string;
}

export type ShowValuesAs =
  | 'noCalculation'
  | 'percentOfGrandTotal'
  | 'percentOfColumnTotal'
  | 'percentOfRowTotal'
  | 'percentOfParentRowTotal'
  | 'percentOfParentColumnTotal'
  | 'difference'
  | 'percentDifference'
  | 'runningTotal'
  | 'percentRunningTotal'
  | 'rankAscending'
  | 'rankDescending'
  | 'index';

export interface ShowValuesAsConfig {
  type: ShowValuesAs;
  baseField?: string;
  baseItem?:
    | { type: 'relative'; position: 'previous' | 'next' }
    | { type: 'specific'; value: CellValue };
}

export interface SortByValueConfig {
  /** @deprecated Prefer `valuePlacementId` for placement-stable value sorting. */
  valueFieldId: string;
  valuePlacementId?: PlacementId;
  order: SortDirection;
  /** Legacy rendered tuple key; normalized read paths should brand this as `PivotTupleKey`. */
  columnKey?: string;
  columnTupleKey?: PivotTupleKey;
}

export type SubtotalLocation = 'top' | 'bottom';

export type TopBottomBy = 'items' | 'percent' | 'sum';

export type TopBottomType = 'top' | 'bottom';

/** Backward-compatible alias — generated types renamed to PivotFieldPlacementFlat. */
export type PivotFieldPlacement = PivotFieldPlacementFlat;

// ============================================================================
// Data Source Type
// ============================================================================

/**
 * The type of data source backing a pivot table.
 * Mirrors the workbook data source type.
 */
export type DataSourceType = 'range' | 'table' | 'external';

// ============================================================================
// TS-only types (no Rust counterpart)
// ============================================================================

/**
 * Sort order for pivot fields.
 * "none" means no explicit sort — uses natural order.
 * Maps to Option<SortDirection> on the Rust side (None = "none").
 */
export type SortOrder = 'asc' | 'desc' | 'none';

/**
 * Row/column item metadata parsed from workbook pivot definitions.
 *
 * The generated bridge DTO currently exposes this as `unknown[]`; keep the
 * boundary equally opaque until the Rust side exports the concrete shape.
 */
export type PivotRowColItem = unknown;

/**
 * A PivotItem represents a unique value within a pivot field.
 * Mirrors the Rust PivotItemInfo type.
 */
export interface PivotItemInfo {
  key: PivotMemberKey;
  value: CellValue;
  fieldId: string;
  axisPlacementId?: PlacementId;
  area: PivotFieldArea;
  depth: number;
  isExpandable: boolean;
  isExpanded: boolean;
  isVisible: boolean;
  isSubtotal: boolean;
  isGrandTotal: boolean;
  childKeys?: PivotMemberKey[];
  parentKey?: PivotMemberKey;
}

/**
 * Collection of pivot items for a single field.
 * Mirrors the Rust PivotFieldItems type.
 */
export interface PivotFieldItems {
  fieldId: string;
  fieldName: string;
  area: PivotFieldArea;
  items: PivotItemInfo[];
}

/**
 * Pivot table configuration combined with its computed result.
 * Used by UI components to render pivot tables with their data.
 */
export interface PivotTableWithResult {
  config: PivotTableConfig;
  result: PivotTableResult | null;
  error?: string;
}

// ============================================================================
// Expansion State
// ============================================================================

/**
 * Tracks which headers are expanded/collapsed.
 * Uses Record<string, boolean> for TS ergonomics; Rust side uses HashSet<String>
 * with custom serde that accepts both array and map formats.
 */
export interface PivotExpansionState {
  keys?: PivotExpansionKey[];
  /** @deprecated Legacy expansion map keyed by rendered header strings. */
  expandedRows: Record<string, boolean>;
  /** @deprecated Legacy expansion map keyed by rendered header strings. */
  expandedColumns: Record<string, boolean>;
}

export interface PivotExpansionKey {
  axis: 'row' | 'column';
  axisPlacementId: PlacementId;
  memberPath: PivotMemberKey[];
}

export type PivotTotalScope =
  | 'none'
  | 'rowSubtotal'
  | 'columnSubtotal'
  | 'rowGrandTotal'
  | 'columnGrandTotal'
  | 'cornerGrandTotal';

export interface PivotMemberRef {
  key: PivotMemberKey;
  value: CellValue;
  displayText: string;
  fieldId?: string;
  groupingBucketId?: string;
}

export interface PivotSemanticValueRecord {
  measurePlacementId: PlacementId;
  rowMemberPath: PivotMemberRef[];
  columnMemberPath: PivotMemberRef[];
  totalScope: PivotTotalScope;
  rawValue: CellValue;
  formattedText?: string;
}

export interface PivotValueRecord {
  rowKey: PivotTupleKey;
  columnKey: PivotTupleKey;
  measureIndex: number;
  value: CellValue;
  sourceRowIndices?: number[];
}

export interface PivotQueryRecord {
  dimensions: Record<string, CellValue>;
  rowKey: PivotTupleKey;
  columnKey: PivotTupleKey;
  values: PivotSemanticValueRecord[];
}

/**
 * Provider for pivot expansion state.
 * Implemented by the app layer (PivotExpansionManager), injected into the kernel.
 */
export interface PivotExpansionStateProvider {
  getExpansionState(pivotId: string): PivotExpansionState;
  toggleExpanded(pivotId: string, headerKey: string, isRow: boolean, sheetId?: string): boolean;
  setAllExpanded(pivotId: string, expanded: boolean): void;
}

// ============================================================================
// Engine Interface
// ============================================================================

/**
 * Interface for the pivot table computation engine
 */
export interface IPivotEngine {
  compute(
    config: PivotTableConfig,
    data: CellValue[][],
    expansionState?: PivotExpansionState,
  ): PivotTableResult;

  detectFields(data: CellValue[][]): PivotField[];

  drillDown(
    config: PivotTableConfig,
    data: CellValue[][],
    rowKey: string,
    columnKey: string,
  ): number[];

  validateConfig(config: PivotTableConfig): string[];
}

// ============================================================================
// GETPIVOTDATA Function Support
// ============================================================================

/**
 * Arguments for GETPIVOTDATA function
 */
export interface GetPivotDataArgs {
  dataField: string;
  pivotTableId: string;
  fieldValuePairs: Array<{ field: string; value: CellValue }>;
}
