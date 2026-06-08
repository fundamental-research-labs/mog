/**
 * WorksheetPivots — Sub-API for pivot table operations on a worksheet.
 *
 * Provides methods to create, query, modify, and remove pivot tables within a
 * worksheet. Pivot tables are rendered on a target sheet and connected
 * to a source data range.
 *
 * Operations on this sub-API operate on the worksheet's sheet (no sheetId parameter needed).
 */
import type {
  PivotCommandReceipt,
  PivotKernelMutationReceipt,
  PivotReadbackRevision,
  PivotRefreshReceipt,
} from '../mutation-receipt';
import type { CellRange, CellValue } from '@mog/types-core';
import type {
  AggregateFunction,
  CalculatedField,
  CalculatedFieldId,
  DataSourceType,
  PivotCalculatedField,
  PivotDataHierarchyInfo,
  PivotExpansionState,
  PivotFieldArea,
  PivotFieldItems,
  PivotFilter,
  PivotItemLocation,
  PivotMemberRef,
  PivotTableConfig,
  PivotTableLayout,
  PivotTableResult,
  PivotTableStyle,
  PlacementId,
  ShowValuesAsConfig,
  SortOrder,
} from '@mog/types-data/data/pivot';
import type {
  PivotTableConfig as SimplePivotTableConfig,
  PivotQueryResult,
  PivotTableHandle,
  PivotTableInfo,
} from '../types';

/**
 * Input config for pivot creation — accepts either the simple ergonomic format
 * (dataSource string + field name arrays) or the full wire format (sourceSheetName,
 * sourceRange, fields[], placements[]).
 *
 * Simple format example:
 * ```ts
 * { name: "Sales", dataSource: "Sheet1!A1:D100", rowFields: ["Region"],
 *   columnFields: ["Year"], valueFields: [{ field: "Amount", aggregation: "sum" }] }
 * ```
 *
 * Full format example:
 * ```ts
 * { name: "Sales", sourceSheetName: "Sheet1",
 *   sourceRange: { startRow: 0, startCol: 0, endRow: 99, endCol: 3 },
 *   outputSheetName: "Sheet1", outputLocation: { row: 0, col: 5 },
 *   fields: [...], placements: [...], filters: [] }
 * ```
 */
export type PivotCreateConfig =
  | SimplePivotTableConfig
  | Omit<PivotTableConfig, 'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'>;

export interface PivotPlacementSpec {
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

export interface PivotSemanticTargetBase {
  pivotName: string;
}

export type PivotSemanticTarget =
  | ({ type: 'pivotRoot'; outputSheetId: string } & PivotSemanticTargetBase)
  | ({
      type: 'fieldHeader';
      placementId: PlacementId;
      fieldId?: string;
      axis: PivotFieldArea;
      headerKey: string;
    } & PivotSemanticTargetBase)
  | ({
      type: 'rowHeader';
      axisPlacementId: PlacementId;
      fieldId: string;
      rowMemberPath: PivotMemberRef[];
      depth: number;
      totalScope: 'none' | 'subtotal' | 'grandTotal';
    } & PivotSemanticTargetBase)
  | ({
      type: 'columnHeader';
      axisPlacementId: PlacementId;
      fieldId: string;
      columnMemberPath: PivotMemberRef[];
      depth: number;
      totalScope: 'none' | 'subtotal' | 'grandTotal';
    } & PivotSemanticTargetBase)
  | ({
      type: 'valueCell';
      measurePlacementId: PlacementId;
      rowAxisPlacementIds: PlacementId[];
      columnAxisPlacementIds: PlacementId[];
      rowMemberPath: PivotMemberRef[];
      columnMemberPath: PivotMemberRef[];
      row: number;
      col: number;
      totalScope:
        | 'none'
        | 'rowSubtotal'
        | 'columnSubtotal'
        | 'rowGrandTotal'
        | 'columnGrandTotal'
        | 'cornerGrandTotal';
    } & PivotSemanticTargetBase);

export interface PivotModelReadback {
  revision: PivotReadbackRevision;
  config: PivotTableConfig;
  fields: PivotTableConfig['fields'];
  measureDescriptors: PivotPlacementSpec[];
  placements: PivotTableConfig['placements'];
  filters: PivotTableConfig['filters'];
  layout?: PivotTableLayout;
  calculatedFields?: Array<PivotCalculatedField | CalculatedField>;
  result: PivotTableResult | null;
  renderedBounds?: PivotTableResult['renderedBounds'];
  errors?: string[];
}

export interface PivotSurfaceCellReadback {
  row: number;
  col: number;
  role: 'rowHeader' | 'columnHeader' | 'value' | 'grandTotal' | 'subtotal';
  text: string;
  value: CellValue;
  measurePlacementId?: PlacementId;
  axisPlacementId?: PlacementId;
  fieldId?: string;
  rowMemberPath?: PivotMemberRef[];
  columnMemberPath?: PivotMemberRef[];
  totalScope?: string;
  depth?: number;
}

export interface PivotSurfaceReadback {
  revision: PivotReadbackRevision;
  anchor: CellRange;
  bounds: CellRange;
  cells: PivotSurfaceCellReadback[];
}

export interface PivotUiStateReadback {
  revision: PivotReadbackRevision;
  selectedPivotName?: string;
  editingPivotName?: string;
  openDialogs: string[];
  fieldPanelZones: Record<string, unknown>;
  filterMenuOptions: Record<string, unknown>;
  activeRangePicker?: string;
  validationMessages: string[];
  selectedAggregateControls: Record<string, unknown>;
  activeSemanticTarget?: PivotSemanticTarget;
}

export type ImportedPivotSourceKind = 'promotedImport' | 'unsupportedImport';
export type ImportedPivotAssociationStatus = 'promoted' | 'unsupported' | 'deleted';

export interface ImportedPivotCapabilities {
  canEditFields: boolean;
  canReorderFields: boolean;
  canRemoveFields: boolean;
  canChangeAggregate: boolean;
  canRefresh: boolean;
  canDelete: boolean;
  canExport: boolean;
  unsupportedReason?: string;
}

export interface ImportedPivotRenderedRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  ref?: string;
}

export interface ImportedPivotViewRecord {
  sourceKind: ImportedPivotSourceKind;
  status: ImportedPivotAssociationStatus;
  importIdentity: string;
  outputSheetId: string;
  sourceSheetId?: string;
  config: PivotTableConfig;
  result?: PivotTableResult;
  capabilities: ImportedPivotCapabilities;
  unsupportedReason?: string;
  renderedRange?: ImportedPivotRenderedRange;
}

/** Sub-API for pivot table operations on a worksheet. */
export interface WorksheetPivots {
  // ===========================================================================
  // CRUD
  // ===========================================================================

  /**
   * Create a new pivot table on this worksheet.
   *
   * Accepts either:
   * - **Simple config**: `{ name, dataSource: "Sheet1!A1:D100", rowFields: ["Region"], ... }`
   *   Fields are auto-detected from source headers, placements are generated from field arrays.
   * - **Full config**: `{ name, sourceSheetName, sourceRange, fields, placements, filters, ... }`
   *   Direct wire format — no conversion needed.
   *
   * @param config - Pivot table configuration
   * @returns The created pivot table configuration (with generated id, timestamps)
   */
  add(config: PivotCreateConfig): Promise<PivotTableConfig>;

  /**
   * Atomically create a new sheet AND a pivot table on it.
   * Both operations happen in a single transaction for undo atomicity.
   *
   * Accepts the same simple or full config formats as `add()`.
   *
   * @param sheetName - Name for the new sheet
   * @param config - Pivot table configuration
   * @returns The new sheet ID and the created pivot config
   */
  addWithSheet(
    sheetName: string,
    config: PivotCreateConfig,
  ): Promise<{ sheetId: string; config: PivotTableConfig }>;

  /**
   * List full pivot configs rendered on this worksheet.
   */
  getAll(): Promise<PivotTableConfig[]>;

  /**
   * List imported pivot view records rendered on this worksheet.
   *
   * Promoted imports include their native config; unsupported imports include
   * read-only preserved OOXML metadata and capabilities.
   */
  getImportedViewRecords(): Promise<ImportedPivotViewRecord[]>;

  /**
   * Remove a pivot table by name.
   *
   * @param name - Pivot table name
   */
  remove(name: string): Promise<void>;

  /**
   * Remove all pivot tables from this worksheet.
   */
  clear(): Promise<void>;

  /**
   * Rename a pivot table by name.
   *
   * @param name - Pivot table name
   * @param newName - New name for the pivot table
   */
  rename(name: string, newName: string): Promise<void>;

  /**
   * List all pivot tables on this worksheet.
   *
   * @returns Array of pivot table summary information
   */
  list(): Promise<PivotTableInfo[]>;

  /**
   * Get a pivot table handle by name.
   *
   * @param name - Pivot table name
   * @returns A handle for the pivot table, or null if not found
   */
  get(name: string): Promise<PivotTableHandle | null>;
  get(config: PivotTableConfig): Promise<PivotTableHandle | null>;

  /**
   * Get plain data information about a pivot table by name.
   *
   * Unlike `get()` which returns a handle with bound methods, this returns
   * a plain data object suitable for serialization and inspection.
   *
   * @param name - Pivot table name
   * @returns Pivot table info, or null if not found
   */
  getInfo(name: string): Promise<PivotTableInfo | null>;

  /**
   * Check if a pivot table exists by name.
   *
   * @param name - Pivot table name
   * @returns True if the pivot table exists
   */
  has(name: string): Promise<boolean>;

  /**
   * Get the total number of pivot tables on this worksheet.
   *
   * @returns The count of pivot tables
   */
  getCount(): Promise<number>;

  /**
   * Add a field to a pivot table area, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to add
   * @param area - Target area (row, column, value, or filter)
   * @param options - Optional configuration (position, aggregateFunction, sortOrder, displayName)
   */
  addField(
    name: string,
    fieldId: string,
    area: PivotFieldArea,
    options?: {
      position?: number;
      aggregateFunction?: AggregateFunction;
      sortOrder?: SortOrder;
      displayName?: string;
      showValuesAs?: ShowValuesAsConfig;
    },
  ): Promise<void>;

  /**
   * Remove a field from a pivot table area, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to remove
   * @param area - Area to remove the field from
   */
  removeField(name: string, fieldId: string, area: PivotFieldArea): Promise<void>;

  /**
   * Move a field to a different area or position, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to move
   * @param fromArea - Source area
   * @param toArea - Target area
   * @param toPosition - Target position within the area
   */
  moveField(
    name: string,
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    toPosition: number,
  ): Promise<void>;

  // ===========================================================================
  // Field Configuration
  // ===========================================================================

  /**
   * Set the aggregate function for a value placement.
   *
   * `pivot` must be an unambiguous pivot name.
   * `fieldOrPlacement` may be an unambiguous field name/ID, display label, or
   * stable placement ID. Ambiguous references throw before mutating.
   */
  setAggregateFunction(
    pivot: string,
    fieldOrPlacement: string,
    aggregateFunction: AggregateFunction,
  ): Promise<PivotKernelMutationReceipt>;

  /**
   * Set the "Show Values As" calculation for a value placement.
   *
   * `pivot` must be an unambiguous pivot name.
   * `fieldOrPlacement` may be an unambiguous field name/ID, display label, or
   * stable placement ID. Pass null to clear.
   */
  setShowValuesAs(
    pivot: string,
    fieldOrPlacement: string,
    showValuesAs: ShowValuesAsConfig | null,
  ): Promise<PivotKernelMutationReceipt>;

  /**
   * Set the sort order for a row or column placement.
   *
   * `pivot` must be an unambiguous pivot name.
   * `fieldOrPlacement` may be an unambiguous field name/ID, display label, or
   * stable placement ID.
   */
  setSortOrder(
    pivot: string,
    fieldOrPlacement: string,
    sortOrder: SortOrder | null,
  ): Promise<PivotKernelMutationReceipt>;

  /**
   * Set (add or update) a filter on a field, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to filter
   * @param filter - Filter configuration (without fieldId)
   */
  setFilter(name: string, fieldId: string, filter: Omit<PivotFilter, 'fieldId'>): Promise<void>;

  /**
   * Remove a filter from a field, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID whose filter should be removed
   */
  removeFilter(name: string, fieldId: string): Promise<void>;

  /**
   * Reset a field placement to defaults, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to reset
   */
  resetField(name: string, fieldId: string): Promise<void>;

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  /**
   * Set layout options for a pivot table, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param layout - Partial layout configuration to merge with existing
   */
  setLayout(name: string, layout: Partial<PivotTableLayout>): Promise<PivotKernelMutationReceipt>;

  /**
   * Set style options for a pivot table, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param style - Partial style configuration to merge with existing
   */
  setStyle(name: string, style: Partial<PivotTableStyle>): Promise<void>;

  // ===========================================================================
  // Computation
  // ===========================================================================

  /**
   * Detect fields from source data for pivot table creation.
   *
   * @param sourceSheetId - Sheet ID containing the source data
   * @param range - Source data range
   * @returns Array of detected pivot fields
   */
  detectFields(
    sourceSheetId: string,
    range: { startRow: number; startCol: number; endRow: number; endCol: number },
  ): Promise<any[]>;

  /**
   * Compute a pivot table result by name (uses cache if available).
   *
   * @param name - Pivot table name
   * @param forceRefresh - Force recomputation ignoring cache
   * @returns Computed pivot table result
   */
  compute(name: string, forceRefresh?: boolean): Promise<PivotTableResult | null>;

  /**
   * Query a pivot table by name, returning flat records optionally filtered by dimension values.
   * Eliminates the need to manually traverse hierarchical PivotTableResult trees.
   *
   * @param pivotName - Pivot table name
   * @param filters - Optional dimension filters: field name → value or array of values to include
   * @returns Flat query result, or null if pivot not found or not computable
   */
  queryPivot(
    pivotName: string,
    filters?: Record<string, CellValue | CellValue[]>,
  ): Promise<PivotQueryResult | null>;

  /**
   * Refresh a pivot table by name (recompute without cache).
   *
   * @param name - Pivot table name
   */
  refresh(name: string): Promise<PivotRefreshReceipt | PivotCommandReceipt>;

  /**
   * Refresh all pivot tables on this worksheet.
   */
  refreshAll(): Promise<void>;

  /**
   * Get drill-down data for a pivot table cell, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param rowKey - Row key from the pivot result
   * @param columnKey - Column key from the pivot result
   * @returns Source data rows that contribute to this cell
   */
  getDrillDownData(name: string, rowKey: string, columnKey: string): Promise<CellValue[][]>;

  // ===========================================================================
  // Calculated Fields
  // ===========================================================================

  addCalculatedField(name: string, field: CalculatedField): Promise<void>;

  updateCalculatedField(
    name: string,
    fieldId: string,
    updates: Partial<Pick<CalculatedField, 'name' | 'formula'>>,
  ): Promise<void>;

  removeCalculatedField(name: string, fieldId: string): Promise<void>;

  // ===========================================================================
  // Sub-Range Access
  // ===========================================================================

  /**
   * Get the full range occupied by the rendered pivot table, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns CellRange covering the entire pivot table, or null if not computed
   */
  getRange(name: string): Promise<CellRange | null>;

  /**
   * Get the range of the data body, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns CellRange covering the data body, or null if not computed
   */
  getDataBodyRange(name: string): Promise<CellRange | null>;

  /**
   * Get the range of column label headers, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns CellRange covering the column headers, or null if not computed
   */
  getColumnLabelRange(name: string): Promise<CellRange | null>;

  /**
   * Get the range of row label headers, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns CellRange covering the row headers, or null if not computed
   */
  getRowLabelRange(name: string): Promise<CellRange | null>;

  /**
   * Get the range of the filter area, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns CellRange covering filter dropdowns, or null if no filter fields
   */
  getFilterAxisRange(name: string): Promise<CellRange | null>;

  // ===========================================================================
  // Pivot Items
  // ===========================================================================

  /**
   * Get pivot items for all placed fields, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns Items grouped by field
   */
  getAllPivotItems(name: string): Promise<PivotFieldItems[]>;

  /**
   * Set visibility of specific items in a field, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID
   * @param visibleItems - Map of item value (as string) to visibility boolean
   */
  setPivotItemVisibility(
    name: string,
    fieldId: string,
    visibleItems: Record<string, boolean>,
  ): Promise<void>;

  /**
   * Supported compatibility alias for {@link setPivotItemVisibility}.
   *
   * Prefer `setPivotItemVisibility(name, fieldId, visibleItems)` in new code.
   */
  setItemVisibility(
    name: string,
    fieldId: string,
    visibleItems: Record<string, boolean>,
  ): Promise<void>;

  // ===========================================================================
  // Expansion State
  // ===========================================================================

  /**
   * Toggle expansion state for a header, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param headerKey - Header key to toggle
   * @param isRow - Whether this is a row header (true) or column header (false)
   * @returns The new expansion state (true = expanded, false = collapsed)
   */
  toggleExpanded(name: string, headerKey: string, isRow: boolean): Promise<boolean>;

  /**
   * Set expansion state for all headers, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @param expanded - Whether all headers should be expanded (true) or collapsed (false)
   */
  setAllExpanded(name: string, expanded: boolean): Promise<void>;

  /**
   * Get the current expansion state, resolved by pivot name.
   *
   * @param name - Pivot table name
   * @returns Expansion state with expandedRows and expandedColumns maps
   */
  getExpansionState(name: string): Promise<PivotExpansionState>;

  // ===========================================================================
  // Data Source
  // ===========================================================================

  /**
   * Get the data source type of a pivot table (range, table, or external).
   *
   * @param name - Pivot table name
   * @returns The data source type
   */
  getDataSourceType(name: string): Promise<DataSourceType>;

  /**
   * Change the source data range for a pivot table without refreshing it.
   *
   * `dataSource` must be a qualified A1 range such as `Sheet1!A1:D100` or
   * `'Bob''s Data'!A1:D100`.
   */
  setDataSource(name: string, dataSource: string): Promise<void>;

  // ===========================================================================
  // Formatting Options
  // ===========================================================================

  /**
   * Get whether multiple filters per field are allowed on a pivot table.
   *
   * @param name - Pivot table name
   * @returns True if multiple filters per field are allowed
   */
  getAllowMultipleFiltersPerField(name: string): Promise<boolean>;

  /**
   * Set whether multiple filters per field are allowed on a pivot table.
   *
   * @param name - Pivot table name
   * @param allow - True to allow multiple filters per field
   */
  setAllowMultipleFiltersPerField(name: string, allow: boolean): Promise<void>;

  /**
   * Get whether the pivot table auto-formats when refreshed.
   *
   * @param name - Pivot table name
   * @returns True if auto-formatting is enabled
   */
  getAutoFormat(name: string): Promise<boolean>;

  /**
   * Set whether the pivot table auto-formats when refreshed.
   *
   * @param name - Pivot table name
   * @param autoFormat - True to enable auto-formatting
   */
  setAutoFormat(name: string, autoFormat: boolean): Promise<void>;

  /**
   * Get whether custom formatting is preserved on refresh.
   *
   * @param name - Pivot table name
   * @returns True if custom formatting is preserved
   */
  getPreserveFormatting(name: string): Promise<boolean>;

  /**
   * Set whether custom formatting is preserved on refresh.
   *
   * @param name - Pivot table name
   * @param preserve - True to preserve custom formatting
   */
  setPreserveFormatting(name: string, preserve: boolean): Promise<void>;

  // ===========================================================================
  // Cell Provenance (B2)
  // ===========================================================================

  /**
   * Identify which data hierarchy (value field) a pivot cell belongs to.
   *
   * Given an output cell position (row, col) in the rendered pivot table,
   * returns information about the value field (aggregate) that produced the cell.
   *
   * @param name - Pivot table name
   * @param row - 0-based row index in the rendered pivot table
   * @param col - 0-based column index in the rendered pivot table
   * @returns Data hierarchy info, or null if the cell is not a data cell
   */
  getDataHierarchy(name: string, row: number, col: number): Promise<PivotDataHierarchyInfo | null>;

  /**
   * Identify which row/column items intersect at a given pivot output cell.
   *
   * Returns the pivot items (group values) from the specified axis that
   * define the cell's position in the pivot table.
   *
   * @param name - Pivot table name
   * @param axis - 'row' or 'column'
   * @param row - 0-based row index in the rendered pivot table
   * @param col - 0-based column index in the rendered pivot table
   * @returns Array of pivot item locations, or null if the cell is outside the data area
   */
  getPivotItems(
    name: string,
    axis: 'row' | 'column',
    row: number,
    col: number,
  ): Promise<PivotItemLocation[] | null>;

  // ===========================================================================
  // Multiple Filter Items (B7)
  // ===========================================================================

  /**
   * Get whether multiple filter items per field are enabled for a specific field.
   *
   * When enabled, multiple `PivotFilter` entries can exist for the same field,
   * combined with AND logic during evaluation.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to check
   * @returns True if multiple filter items are enabled for this field
   */
  getEnableMultipleFilterItems(name: string, fieldId: string): Promise<boolean>;

  /**
   * Set whether multiple filter items per field are enabled for a specific field.
   *
   * When enabled, multiple `PivotFilter` entries can exist for the same field,
   * combined with AND logic during evaluation.
   *
   * @param name - Pivot table name
   * @param fieldId - Field ID to configure
   * @param enabled - True to enable multiple filter items
   */
  setEnableMultipleFilterItems(name: string, fieldId: string, enabled: boolean): Promise<void>;
}
