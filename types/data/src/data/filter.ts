/**
 * Filter Contracts - Type definitions for spreadsheet filtering.
 *
 * Layer 0: Filter State Foundation (Cell Identity Model)
 *
 * This module defines the filter state schema and interfaces for
 * AutoFilter, Table Filters, and Advanced Filters. The filter system
 * uses a bridge pattern: filter criteria determines which rows should
 * be hidden, but actual visibility is controlled by the existing
 * hiddenRows infrastructure.
 *
 * ARCHITECTURE (Cell Identity Model):
 *
 * Filter ranges are defined by CellId corner references, NOT position-based
 * CellRange. This follows the same pattern as:
 * - IdentityRangeRef (formulas)
 * - IdentityRangeSchemaRef (data validation)
 * - IdentityMergedRegion (merged cells)
 *
 * Why CellId-based?
 * - Survives row/col insert/delete (positions change, CellIds stable)
 * - CRDT-safe for concurrent structure changes
 * - Matches the Cell Identity Model used throughout the codebase
 *
 * Visibility ownership:
 *   FilterState (CellId-based) -> Resolve Positions -> Evaluate ->
 *   filterHiddenRows/{filterId}/{rowId} -> effective hiddenRows cache -> Render
 *
 * Single source of truth:
 *   - Row visibility: manualHiddenRows and filterHiddenRows RowId owner maps
 *     derive the effective hiddenRows compatibility cache
 *   - Filter state: filters Y.Map<FilterState> (CellId-based, durable definition)
 *
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellRange, CellValue } from '@mog/types-core/core';
import type { FilterOperator } from './pivot';

// Re-export FilterOperator for convenience (already defined in pivot.ts)
export type { FilterOperator } from './pivot';

/**
 * Dynamic filter rule — pre-defined filter rules that resolve against
 * live data (e.g. above average, date-relative).
 *
 * Mirrors the Rust DynamicFilterRule enum in compute-core.
 */
export type DynamicFilterRule =
  | 'aboveAverage'
  | 'belowAverage'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'lastWeek'
  | 'nextWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'nextMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'nextQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'nextYear';

// =============================================================================
// Filter Type Discriminators
// =============================================================================

/**
 * Filter type discriminator.
 *
 * - autoFilter: Range filter with dropdown headers (Data > Filter)
 * - tableFilter: Filter associated with an Excel table
 * - advancedFilter: Complex criteria-based filter (future)
 */
export type FilterType = 'autoFilter' | 'tableFilter' | 'advancedFilter';

export interface AdvancedFilterCriteriaRange {
  sheetId: string;
  startCellId: CellId;
  endCellId: CellId;
}

export interface AdvancedFilterState {
  criteriaRange?: AdvancedFilterCriteriaRange;
  uniqueRecordsOnly: boolean;
}

// =============================================================================
// Filter Criteria Types
// =============================================================================

/**
 * A single filter condition with operator and value(s).
 *
 * Used in condition filters where users specify rules like
 * "greater than 100" or "contains 'error'".
 */
export interface FilterCondition {
  /** The comparison operator */
  operator: FilterOperator;

  /** Primary comparison value (not used for isBlank/isNotBlank) */
  value?: CellValue;

  /** Secondary value for 'between' operator (inclusive range) */
  value2?: CellValue;
}

/**
 * Column filter criteria - what's applied to a single column.
 *
 * Each column in a filter range can have its own criteria.
 * Rows must match ALL column filters (AND logic across columns).
 */
export interface ColumnFilterCriteria {
  /**
   * Type of filter applied to this column.
   *
   * - value: Checkbox list of specific values to include
   * - condition: Operator-based rules (equals, contains, etc.)
   * - color: Filter by cell background or font color
   * - top10: Top/bottom N items or percent
   */
  type: 'value' | 'condition' | 'color' | 'top10' | 'dynamic' | 'icon';

  // ---------------------------------------------------------------------------
  // Value Filter (type: 'value')
  // ---------------------------------------------------------------------------

  /**
   * For value filters: list of values to INCLUDE (show).
   * Unchecked values in the dropdown are excluded (hidden).
   * Include empty string or null to show blank cells.
   */
  values?: CellValue[];

  /**
   * For value filters: explicitly include blank cells.
   * When present, takes precedence over inferring from values array.
   */
  includeBlanks?: boolean;

  // ---------------------------------------------------------------------------
  // Condition Filter (type: 'condition')
  // ---------------------------------------------------------------------------

  /**
   * For condition filters: one or two filter conditions.
   * When two conditions are present, conditionLogic determines how they combine.
   */
  conditions?: FilterCondition[];

  /**
   * Logic for combining multiple conditions.
   * - 'and': Row must match ALL conditions
   * - 'or': Row must match ANY condition
   * Default: 'and'
   */
  conditionLogic?: 'and' | 'or';

  // ---------------------------------------------------------------------------
  // Color Filter (type: 'color')
  // ---------------------------------------------------------------------------

  /**
   * For color filters: filter by fill (background) or font color.
   */
  colorFilter?: {
    /**
     * Which color axis to filter on.
     *
     * Vocabulary matches Excel/ECMA-376: `'fill'` is the cell's background
     * fill color; `'font'` is the text color. (Renamed from `'background'`
     * to `'fill'` so the filter discriminator lines up with the rest of the
     * filter/sort surface and the harness probe.)
     */
    type: 'fill' | 'font';
    /** Hex color to match (e.g., '#ff0000') */
    color: string;
  };

  // ---------------------------------------------------------------------------
  // Top/Bottom Filter (type: 'top10')
  // ---------------------------------------------------------------------------

  /**
   * For top/bottom N filters: show only the highest or lowest values.
   */
  topBottom?: {
    /** Show top values or bottom values */
    type: 'top' | 'bottom';
    /** Number of items or percentage */
    count: number;
    /** Whether count is number of items or percentage */
    by: 'items' | 'percent' | 'sum';
  };

  // ---------------------------------------------------------------------------
  // Dynamic Filter (type: 'dynamic')
  // ---------------------------------------------------------------------------

  /**
   * For dynamic filters: a pre-defined rule resolved against live data.
   * Examples: above average, below average, today, this month, etc.
   */
  dynamicFilter?: {
    /** The dynamic filter rule to apply */
    rule: DynamicFilterRule;
  };

  // ---------------------------------------------------------------------------
  // Icon Filter (type: 'icon')
  // ---------------------------------------------------------------------------

  /**
   * For icon filters: filter by conditional formatting icon.
   * Requires an icon set CF rule on the column. Rows are shown only if
   * the evaluated icon matches the specified set + index.
   */
  iconFilter?: {
    /** Icon set name (e.g. "3Arrows", "4Rating") */
    iconSet: string;
    /** Icon index within the set (0-based) */
    iconIndex: number;
  };
}

// =============================================================================
// Sort State (Filters Can Also Sort)
// =============================================================================

/**
 * Sort configuration for a filter.
 *
 * Filters often include sort controls in their dropdown menus.
 * This tracks the current sort state applied via the filter.
 *
 * Cell Identity Model: Uses CellId for the sorted column header, not column index.
 */
export interface FilterSortState {
  /**
   * CellId of the header cell being sorted.
   * Using CellId ensures the sort follows the column on insert/delete.
   */
  columnCellId: CellId;

  /** Sort direction */
  order: 'asc' | 'desc';

  /** What to sort by */
  sortBy: 'value' | 'color' | 'icon';
}

// =============================================================================
// Filter State (Cell Identity Model)
// =============================================================================

/**
 * Complete filter state for a range - Cell Identity Model.
 *
 * ARCHITECTURE: Filter ranges are defined by CellId corner references,
 * NOT position-based CellRange. This follows the same pattern as:
 * - IdentityRangeRef (formulas)
 * - IdentityRangeSchemaRef (data validation)
 * - IdentityMergedRegion (merged cells)
 *
 * Why CellId-based?
 * - Survives row/col insert/delete (positions change, CellIds stable)
 * - CRDT-safe for concurrent structure changes
 * - Matches the Cell Identity Model used throughout the codebase
 *
 * This is the persisted state in Yjs. It includes:
 * - Corner cell CellIds that define the filter range
 * - Per-column filter criteria keyed by header CellId
 * - Optional sort state (also by CellId)
 * - Optional table association
 */
export interface FilterState {
  /** Unique filter identifier (UUID v7) */
  id: string;

  /** Filter type discriminator */
  type: FilterType;

  // ===========================================================================
  // Range Definition (Cell Identity Model)
  // ===========================================================================

  /**
   * CellId of the header row, first column (top-left of header).
   * Example: If filter is on A1:C10, this is the CellId of A1.
   */
  headerStartCellId: CellId;

  /**
   * CellId of the header row, last column (top-right of header).
   * Example: If filter is on A1:C10, this is the CellId of C1.
   */
  headerEndCellId: CellId;

  /**
   * CellId of the last data row, first column (defines data extent).
   * Example: If filter is on A1:C10 (header A1:C1, data A2:C10), this is CellId of A10.
   *
   * Why first column? We only need to track row extent, and the column extent
   * is already defined by headerEndCellId. Using first column is simpler.
   */
  dataEndCellId: CellId;

  // ===========================================================================
  // Column Filters (keyed by CellId)
  // ===========================================================================

  /**
   * Per-column filter criteria, keyed by header cell CellId.
   *
   * Why CellId key (not column index)?
   * - Column index changes on insert/delete column
   * - CellId is stable - filter criteria follows the column
   *
   * Example: If column B has a filter and user inserts column at A,
   * B becomes C but the filter criteria stays with the same CellId.
   *
   * Empty object means no filters are applied (show all rows).
   */
  columnFilters: Record<CellId, ColumnFilterCriteria>;

  /**
   * Advanced Filter metadata.
   *
   * Present for durable advancedFilter records. Criteria ranges are stored as
   * CellId corners so reapply reads the current live criteria cells after
   * structural edits.
   */
  advancedFilter?: AdvancedFilterState;

  /** Current sort state applied via this filter (optional) */
  sortState?: FilterSortState;

  /** Associated table ID for tableFilter type (optional) */
  tableId?: string;

  /** When this filter was created (Unix ms) */
  createdAt?: number;

  /** When this filter was last modified (Unix ms) */
  updatedAt?: number;

  // ===========================================================================
  // Resolved Positions (runtime only, not persisted)
  // ===========================================================================

  /** Resolved row/col positions (runtime only, not persisted). Populated by Rust when filters are queried. */
  startRow?: number | null;
  startCol?: number | null;
  endRow?: number | null;
  endCol?: number | null;
}

// =============================================================================
// Filter Header Info (for UI rendering)
// =============================================================================

/**
 * Information about a filter header cell for UI rendering.
 *
 * Returned by getFilterHeaderInfo() to tell the renderer whether a cell
 * is an AutoFilter header and should show a filter dropdown button.
 *
 * NOTE: Table filters use a separate code path via getTableAtCell().
 * This type is specifically for AutoFilter (non-table filters).
 */
export interface FilterHeaderInfo {
  /**
   * The filter state ID - used to open the dropdown and apply criteria.
   */
  filterId: string;

  /**
   * CellId of this header cell (NOT column index!).
   * Used as the key for column filter operations in Layer 0.
   */
  headerCellId: CellId;

  /**
   * Whether this column has active filter criteria applied.
   * If true, the dropdown button shows a filter indicator.
   */
  hasActiveFilter: boolean;
}

// =============================================================================
// Filter Evaluation Types
// =============================================================================

/**
 * Result of evaluating a filter against a single row.
 *
 * Used internally by the filter engine to determine which rows
 * should be hidden or shown.
 */
export interface FilterEvaluationResult {
  /** Row index (0-based absolute row in sheet) */
  row: number;

  /** Whether the row matches all active filter criteria */
  matches: boolean;
}

// =============================================================================
// Filter Manager Interface (Cell Identity Model)
// =============================================================================

/**
 * Interface for filter CRUD operations.
 *
 * Implemented by the filter operations module in the engine.
 * All operations go through the coordinator pattern.
 *
 * ARCHITECTURE: Column operations use CellId (header cell) instead of column index.
 * This ensures filter criteria follows columns on insert/delete operations.
 */
export interface IFilterManager {
  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a new filter for a range.
   *
   * ARCHITECTURE: Accepts position-based CellRange for convenience (API), but
   * internally stores CellId references. This is the same pattern as formula
   * parsing - user types A1:C10, we store CellIds.
   *
   * @param sheetId - Sheet to create filter in
   * @param range - Range to filter (header row + data rows)
   * @param type - Filter type (default: 'autoFilter')
   * @returns The created filter state (with CellId references)
   */
  createFilter(sheetId: string, range: CellRange, type?: FilterType): FilterState;

  /**
   * Get a filter by ID.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @returns Filter state or undefined if not found
   */
  getFilter(sheetId: string, filterId: string): FilterState | undefined;

  /**
   * Get filter that contains a specific range (for overlap detection).
   *
   * @param sheetId - Sheet to search
   * @param range - Range to check for filter containment
   * @returns Filter state or undefined if no filter contains the range
   */
  getFilterForRange(sheetId: string, range: CellRange): FilterState | undefined;

  /**
   * Get all filters in a sheet.
   *
   * @param sheetId - Sheet to get filters from
   * @returns Array of filter states
   */
  getFiltersInSheet(sheetId: string): FilterState[];

  /**
   * Delete a filter (removes filter state, does NOT unhide rows).
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID to delete
   */
  deleteFilter(sheetId: string, filterId: string): void;

  // ---------------------------------------------------------------------------
  // Column Filter Operations (CellId-based)
  // ---------------------------------------------------------------------------

  /**
   * Set filter criteria for a specific column.
   *
   * ARCHITECTURE: Uses header CellId instead of column index for CRDT safety.
   * The filter criteria follows the column on insert/delete operations.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @param headerCellId - CellId of the header cell (NOT column index)
   * @param criteria - Filter criteria to apply
   */
  setColumnFilter(
    sheetId: string,
    filterId: string,
    headerCellId: CellId,
    criteria: ColumnFilterCriteria,
  ): void;

  /**
   * Clear filter criteria for a specific column.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @param headerCellId - CellId of the header cell (NOT column index)
   */
  clearColumnFilter(sheetId: string, filterId: string, headerCellId: CellId): void;

  /**
   * Clear all column filters (show all rows).
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   */
  clearAllColumnFilters(sheetId: string, filterId: string): void;

  // ---------------------------------------------------------------------------
  // Evaluation & Application
  // ---------------------------------------------------------------------------

  /**
   * Evaluate filter criteria against data rows.
   *
   * Returns which rows match/don't match without hiding anything.
   * Useful for preview or debugging.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @returns Array of evaluation results for each data row
   */
  evaluateFilter(sheetId: string, filterId: string): FilterEvaluationResult[];

  /**
   * Apply filter: evaluate criteria and hide/unhide rows.
   *
   * This is THE BRIDGE: resolves CellIds to positions, evaluates criteria,
   * then calls hideRows()/unhideRows() based on filter results.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   */
  applyFilter(sheetId: string, filterId: string): void;

  // ---------------------------------------------------------------------------
  // Sort Operations (CellId-based)
  // ---------------------------------------------------------------------------

  /**
   * Sort data by a filter column.
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @param headerCellId - CellId of the header cell to sort by
   * @param order - Sort direction
   */
  sortFilterColumn(
    sheetId: string,
    filterId: string,
    headerCellId: CellId,
    order: 'asc' | 'desc',
  ): void;

  // ---------------------------------------------------------------------------
  // Query Operations (CellId-based)
  // ---------------------------------------------------------------------------

  /**
   * Get unique values in a filter column (for populating dropdown).
   *
   * @param sheetId - Sheet containing the filter
   * @param filterId - Filter ID
   * @param headerCellId - CellId of the header cell
   * @returns Array of unique cell values in the column
   */
  getUniqueValues(sheetId: string, filterId: string, headerCellId: CellId): CellValue[];

  /**
   * Check if a row is filtered (hidden by any filter).
   *
   * @param sheetId - Sheet to check
   * @param row - Row index to check
   * @returns true if the row is hidden due to filtering
   */
  isRowFiltered(sheetId: string, row: number): boolean;
}
