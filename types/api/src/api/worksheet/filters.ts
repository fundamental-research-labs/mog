/**
 * WorksheetFilters — Sub-API for filter operations.
 *
 * Provides methods to create, query, and manage auto-filters and
 * CellId-aware filter operations on a worksheet.
 */
import type { AutoFilterClearReceipt, AutoFilterSetReceipt } from '../mutation-receipt';
import type { ColumnFilterCriteria, DynamicFilterRule } from '@mog/types-data/data/filter';
import type {
  CellRange,
  CellValue,
  ColumnFilter,
  FilterDetailInfo,
  FilterHeaderInfoEntry,
  FilterSortState,
  FilterState,
  FilterSummaryInfo,
} from '../types';

export type { FilterHeaderInfoEntry, FilterSummaryInfo } from '../types';

export type AdvancedFilterMode = 'inPlace' | 'copyTo';

export interface AdvancedFilterInPlaceOptions {
  listRange: string;
  criteriaRange?: string | null;
  mode: 'inPlace';
  copyToRange?: never;
  uniqueRecordsOnly?: boolean;
  filterId?: string;
}

export interface AdvancedFilterCopyToOptions {
  listRange: string;
  criteriaRange?: string | null;
  mode: 'copyTo';
  copyToRange: string;
  uniqueRecordsOnly?: boolean;
  filterId?: never;
}

export type AdvancedFilterOptions = AdvancedFilterInPlaceOptions | AdvancedFilterCopyToOptions;

export interface AdvancedFilterInPlaceResult {
  mode: 'inPlace';
  listRange: string;
  criteriaRange?: string;
  filterId: string;
  rowsMatched: number;
  rowsHidden: number;
  rowsCopied?: never;
  columnsCopied?: never;
  destinationRange?: never;
}

export interface AdvancedFilterCopyToResult {
  mode: 'copyTo';
  listRange: string;
  criteriaRange?: string;
  filterId?: never;
  rowsMatched: number;
  rowsHidden?: never;
  rowsCopied: number;
  columnsCopied: number;
  destinationRange?: string;
}

export type AdvancedFilterResult = AdvancedFilterInPlaceResult | AdvancedFilterCopyToResult;

/**
 * Options for {@link WorksheetFilters.byColor}.
 *
 * Excel/ECMA-376 vocabulary: `'fill'` matches the cell background fill color;
 * `'font'` matches the cell font color. Both compare the resolved per-cell
 * effective format (direct cell formatting; CF-derived colors are not yet
 * supported.
 */
export interface FilterByColorOptions {
  /** Whether to filter by background fill color or font color. */
  colorType: 'fill' | 'font';
  /** Hex color to match (e.g. '#FFFF00'). Case-insensitive. */
  color: string;
  /** Optional filter ID; defaults to the first auto-filter on the sheet. */
  filterId?: string;
}

export interface FilterDropdownItem {
  readonly value: CellValue;
  readonly displayText: string;
  readonly count: number;
  readonly selected: boolean;
}

export type FilterDropdownColumnType = 'number' | 'text' | 'date' | 'mixed';

export interface FilterDropdownData {
  readonly items: readonly FilterDropdownItem[];
  readonly hasBlank: boolean;
  readonly blankCount: number;
  readonly blankSelected: boolean;
  readonly totalRowCount: number;
  /**
   * Predominant value type for this filter column, derived from both cell
   * values and resolved number formats. Numeric Excel serials are only
   * classified as dates when their cells carry a date/time number format.
   */
  readonly columnType?: FilterDropdownColumnType;
}

/** Sub-API for filter operations on a worksheet. */
export interface WorksheetFilters {
  /**
   * Add an auto-filter to the sheet.
   *
   * @param range - A1-style range string (e.g. "A1:D100") or a CellRange object
   */
  add(range: string | CellRange): Promise<void>;

  /**
   * Apply an Excel Advanced Filter.
   *
   * Range strings are passed to Rust as entered; parsing, validation,
   * criteria evaluation, row visibility, copy output, and viewport patches are
   * owned by the compute layer.
   */
  applyAdvanced(options: AdvancedFilterOptions): Promise<AdvancedFilterResult>;

  /**
   * Filter a column by cell or font color.
   *
   * Convenience wrapper over {@link setColumnFilter} with a color predicate —
   * rows whose column-`col` cell does not match the requested color are hidden.
   *
   * When `opts.filterId` is omitted, targets the first auto-filter on the sheet.
   *
   * @param col - Column index (0-based, absolute)
   * @param opts - Color filter options
   */
  byColor(col: number, opts: FilterByColorOptions): Promise<void>;

  /**
   * Get the current auto-filter state.
   *
   * @returns The filter state, or null if no auto-filter is set
   */
  get(): Promise<FilterState | null>;

  /**
   * Clear the auto-filter from the sheet.
   * Removes all filters, not just criteria.
   */
  clear(): Promise<void>;

  /**
   * @deprecated Use {@link add} instead.
   * Set an auto-filter on the sheet by parsing an A1-style range string.
   *
   * @param range - A1-style range string (e.g. "A1:D100")
   */
  setAutoFilter(range: string): Promise<AutoFilterSetReceipt>;

  /**
   * @deprecated Use {@link add} instead.
   * Set an auto-filter on the sheet from a CellRange (position-based).
   *
   * @param range - Range object with start/end row and column
   */
  setAutoFilter(range: CellRange): Promise<AutoFilterSetReceipt>;

  /**
   * @deprecated Use {@link clear} instead.
   * Clear the auto-filter from the sheet.
   * Removes all filters, not just criteria.
   */
  clearAutoFilter(): Promise<AutoFilterClearReceipt>;

  /**
   * @deprecated Use {@link get} instead.
   * Get the current auto-filter state.
   *
   * @returns The filter state, or null if no auto-filter is set
   */
  getAutoFilter(): Promise<FilterState | null>;

  /**
   * Get the filter overlapping a range, or null if none.
   *
   * @param range - A1-style range string (e.g. "A1:D100")
   * @returns Object with filter ID if found, or null
   */
  getForRange(
    range: string,
  ): Promise<{ id: string; filterKind: 'autoFilter' | 'tableFilter' | 'advancedFilter' } | null>;

  /**
   * Get the filter overlapping a range, or null if none.
   *
   * @param range - Range object with start/end row and column
   * @returns Object with filter ID if found, or null
   */
  getForRange(
    range: CellRange,
  ): Promise<{ id: string; filterKind: 'autoFilter' | 'tableFilter' | 'advancedFilter' } | null>;

  /**
   * Remove a specific filter by its ID.
   *
   * @param filterId - Filter ID to remove
   */
  remove(filterId: string): Promise<void>;

  /**
   * Set filter criteria for a column on an auto-filter.
   *
   * When `filterId` is omitted, targets the first auto-filter (convenience shorthand).
   * When provided, targets the specified filter directly.
   *
   * @param col - Column index (0-based)
   * @param criteria - Filter criteria to apply
   * @param filterId - Optional filter ID; defaults to first auto-filter
   */
  setColumnFilter(col: number, criteria: ColumnFilterCriteria, filterId?: string): Promise<void>;

  /**
   * Apply a dynamic filter rule to a column on an auto-filter.
   *
   * Dynamic filters are pre-defined rules resolved against live data,
   * such as "above average", "below average", or date-relative rules
   * like "today", "this month", etc.
   *
   * When `filterId` is omitted, targets the first auto-filter.
   *
   * @param col - Column index (0-based)
   * @param rule - Dynamic filter rule to apply
   * @param filterId - Optional filter ID; defaults to first auto-filter
   */
  applyDynamicFilter(col: number, rule: DynamicFilterRule, filterId?: string): Promise<void>;

  /**
   * Clear filter criteria for a column on an auto-filter.
   *
   * When `filterId` is omitted, targets the first auto-filter.
   * When provided, targets the specified filter directly.
   *
   * @param col - Column index (0-based)
   * @param filterId - Optional filter ID; defaults to first auto-filter
   */
  clearColumnFilter(col: number, filterId?: string): Promise<void>;

  /**
   * Get unique values in a column (for filter dropdowns).
   *
   * When `filterId` is omitted, uses the first auto-filter.
   *
   * @param col - Column index (0-based)
   * @param filterId - Optional filter ID; defaults to first auto-filter
   * @returns Array of unique values
   */
  getUniqueValues(col: number, filterId?: string): Promise<any[]>;

  /**
   * Get complete value-list dropdown data for a filter column.
   *
   * Returns nonblank items plus first-class blank metadata from the same
   * table/filter engine path used to apply value filters.
   *
   * @param col - Column index (0-based, absolute)
   * @param filterId - Optional filter ID; defaults to first auto-filter
   */
  getFilterDropdownData(col: number, filterId?: string): Promise<FilterDropdownData>;

  /**
   * @deprecated Use {@link setColumnFilter} instead.
   * Set filter criteria for a column on a specific filter by ID (advanced).
   *
   * @param filterId - Filter ID
   * @param col - Column index (0-based)
   * @param criteria - Filter criteria to apply
   */
  setCriteria(filterId: string, col: number, criteria: ColumnFilterCriteria): Promise<void>;

  /**
   * @deprecated Use {@link clearColumnFilter} instead.
   * Clear filter criteria for a column on a specific filter by ID (advanced).
   *
   * @param filterId - Filter ID
   * @param col - Column index (0-based)
   */
  clearCriteria(filterId: string, col: number): Promise<void>;

  /**
   * Clear all filter criteria for a filter.
   * Removes filters from all columns but keeps the filter structure intact.
   *
   * @param filterId - Filter ID
   */
  clearAllCriteria(filterId: string): Promise<void>;

  /**
   * Apply a filter (Rust evaluates criteria and updates row visibility).
   *
   * @param filterId - Filter ID to apply
   */
  apply(filterId: string): Promise<void>;

  /**
   * Get detailed filter info including resolved range and column filters.
   *
   * @param filterId - Filter ID
   * @returns Detailed filter info, or null if not found
   */
  getInfo(filterId: string): Promise<FilterDetailInfo | null>;

  /**
   * @deprecated Use {@link getUniqueValues} instead.
   * Get unique values for a filter column.
   *
   * @param filterId - Filter ID
   * @param col - Column index (0-based)
   * @returns Array of unique values
   */
  getFilterUniqueValues(filterId: string, col: number): Promise<any[]>;

  /**
   * List all filters in the sheet with full detail (resolved numeric ranges
   * and converted column-filter criteria).
   *
   * @returns Array of detailed filter info objects
   */
  list(): Promise<FilterDetailInfo[]>;

  /**
   * List compact filter summaries without per-column criteria conversion.
   *
   * @returns Array of filter summary objects
   */
  listSummaries(): Promise<FilterSummaryInfo[]>;

  /**
   * List renderer-ready filter header entries for the sheet.
   *
   * @returns Array of header entries keyed by row/column
   */
  listHeaderInfo(): Promise<FilterHeaderInfoEntry[]>;

  /**
   * Whether any auto-filter exists on the sheet.
   *
   * @returns true if at least one filter is present
   */
  isEnabled(): Promise<boolean>;

  /**
   * Whether any filter on the sheet has active criteria applied.
   *
   * Returns true if at least one filter has non-empty column filters,
   * meaning some rows may be hidden.
   *
   * @returns true if any column filter criteria are set
   */
  isDataFiltered(): Promise<boolean>;

  /**
   * @deprecated Use {@link list} instead, which now returns full detail.
   * Alias kept for backward compatibility.
   */
  listDetails(): Promise<FilterDetailInfo[]>;

  /**
   * Get the sort state for a filter.
   *
   * @param filterId - Filter ID
   * @returns Sort state, or null if no sort state set
   */
  getSortState(filterId: string): Promise<FilterSortState | null>;

  /**
   * Set the sort state for a filter.
   *
   * @param filterId - Filter ID
   * @param state - Sort state to set
   */
  setSortState(filterId: string, state: FilterSortState): Promise<void>;
}
