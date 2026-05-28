/**
 * WorksheetTables — Sub-API for table operations on a worksheet.
 *
 * Provides methods to create, query, modify, and remove tables (ListObjects)
 * within a worksheet. Tables are workbook-scoped by name but sheet-scoped
 * for listing.
 */
import type {
  CellValue,
  CellRange,
  FilterInfo,
  TableColumn,
  TableInfo,
  TableOptions,
  TableUpdateOptions,
} from '../types';
import type {
  TableAddColumnReceipt,
  TableAddRowReceipt,
  TableDeleteRowReceipt,
  TableRemoveColumnReceipt,
  TableResizeReceipt,
} from '../mutation-receipt';
import type { CallableDisposable } from '@mog/types-core/disposable';
import type {
  TableCreatedEvent,
  TableDeletedEvent,
  TableSelectionChangedEvent,
  TableUpdatedEvent,
} from '@mog/types-events/table-events';

/**
 * A collection-like wrapper around a table's data rows.
 *
 * Returned by `WorksheetTables.getRows()`. The `count` property is a
 * snapshot taken at construction time and does NOT live-update.
 */
export interface TableRowCollection {
  /** Number of data rows (snapshot, not live). */
  count: number;
  /** Get the cell values of a data row by index. */
  getAt(index: number): Promise<CellValue[]>;
  /** Add a data row. If index is omitted, appends to the end. */
  add(index?: number, values?: CellValue[]): Promise<TableAddRowReceipt>;
  /** Delete a data row by index. */
  deleteAt(index: number): Promise<TableDeleteRowReceipt>;
  /** Get the cell values of a data row by index. */
  getValues(index: number): Promise<CellValue[]>;
  /** Set the cell values of a data row by index. */
  setValues(index: number, values: CellValue[]): Promise<void>;
  /** Get the A1-notation range for a data row by index. */
  getRange(index: number): Promise<string>;
}

/** Sub-namespace for table sort operations. */
export interface WorksheetTableSort {
  /**
   * Apply sort fields to a table.
   * @param tableName - Table name
   * @param fields - Array of sort field descriptors
   */
  apply(
    tableName: string,
    fields: Array<{ columnIndex: number; ascending?: boolean }>,
  ): Promise<void>;

  /**
   * Clear all sort fields from a table.
   * @param tableName - Table name
   */
  clear(tableName: string): Promise<void>;

  /**
   * Re-evaluate the most recently applied sort specification.
   *
   * Throws if no sort specification has been applied via `apply()`.
   * Note: sort specs are cached in memory only and do not survive document reload.
   *
   * @param tableName - Table name
   */
  reapply(tableName: string): Promise<void>;
}

/** Sub-namespace for table event subscriptions. */
export interface WorksheetTableEvents {
  /** Subscribe to table creation events on this worksheet. */
  onTableAdded(callback: (event: TableCreatedEvent) => void): CallableDisposable;
  /** Subscribe to table deletion events on this worksheet. */
  onTableDeleted(callback: (event: TableDeletedEvent) => void): CallableDisposable;
  /** Subscribe to change events for a specific table. */
  onTableChanged(
    tableName: string,
    callback: (event: TableUpdatedEvent) => void,
  ): CallableDisposable;
  /** Subscribe to selection change events for a specific table. */
  onSelectionChanged(
    tableName: string,
    callback: (event: TableSelectionChangedEvent) => void,
  ): CallableDisposable;
}

/** Sub-API for table operations on a worksheet. */
export interface WorksheetTables {
  /** Sort operations sub-namespace. */
  readonly sort: WorksheetTableSort;
  /** Event subscription sub-namespace. */
  readonly events: WorksheetTableEvents;
  /**
   * Create a new table from a cell range.
   *
   * @param range - A1-style range string (e.g. "A1:D10") or CellRange object
   * @param options - Optional table creation settings (name, headers, style)
   * @returns The created table information
   */
  add(range: string | CellRange, options?: TableOptions): Promise<TableInfo>;

  /**
   * Get a table by name.
   *
   * Tables are workbook-scoped, so the name is unique across all sheets.
   *
   * @param name - Table name
   * @returns Table information, or null if not found
   */
  get(name: string): Promise<TableInfo | null>;

  /**
   * Check if a table exists by name.
   *
   * @param name - Table name
   * @returns True if the table exists
   */
  has(name: string): Promise<boolean>;

  /**
   * List all tables in this worksheet.
   *
   * @returns Array of table information objects
   */
  list(): Promise<TableInfo[]>;

  /**
   * Get the total number of tables on this worksheet.
   *
   * @returns The count of tables
   */
  getCount(): Promise<number>;

  /**
   * Get a table by its position in the list of tables on this worksheet.
   *
   * @param index - Zero-based index into the table list
   * @returns Table information, or null if the index is out of range
   */
  getItemAt(index: number): Promise<TableInfo | null>;

  /**
   * Get the first table on this worksheet.
   *
   * Convenience shortcut equivalent to `getAt(0)`.
   *
   * @returns Table information, or null if no tables exist
   */
  getFirst(): Promise<TableInfo | null>;

  /**
   * Look up a column in a table by its header name.
   *
   * @param tableName - Table name
   * @param columnName - Column header name to search for
   * @returns The matching column, or null if not found
   */
  getColumnByName(tableName: string, columnName: string): Promise<TableColumn | null>;

  /**
   * Remove a table definition, converting it back to a plain range.
   *
   * Cell data is preserved; only the table metadata is removed.
   *
   * @param name - Table name
   */
  remove(name: string): Promise<void>;

  /**
   * Convert a table to a plain range using the table conversion path.
   *
   * Cell data and formatting are preserved, and structured references that
   * point at the converted table are rewritten to A1 references where the
   * compute engine can resolve them.
   *
   * @param name - Table name
   * @returns Number of structured references converted
   */
  convertToRange(name: string): Promise<number>;

  /**
   * Remove all tables from this worksheet.
   */
  clear(): Promise<void>;

  /**
   * Rename a table.
   *
   * @param oldName - Current table name
   * @param newName - New table name
   */
  rename(oldName: string, newName: string): Promise<void>;

  /**
   * Update a table's properties.
   *
   * @param tableName - Table name
   * @param updates - Key-value pairs of properties to update
   */
  update(tableName: string, updates: TableUpdateOptions): Promise<void>;

  /**
   * Get the table at a specific cell position, if one exists.
   *
   * @param address - A1-style cell address (e.g. "B3")
   * @returns Table information, or null if no table exists at that cell
   */
  getAtCell(address: string): Promise<TableInfo | null>;
  /**
   * Get the table at a specific cell position, if one exists.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Table information, or null if no table exists at that cell
   */
  getAtCell(row: number, col: number): Promise<TableInfo | null>;

  /**
   * Clear all column filters on a table.
   *
   * @param tableName - Table name
   */
  clearFilters(tableName: string): Promise<void>;

  /**
   * Set the visual style preset for a table.
   *
   * @param tableName - Table name
   * @param preset - Style preset name (e.g. "TableStyleLight1")
   */
  setStylePreset(tableName: string, preset: string): Promise<void>;

  /**
   * Resize a table to a new range.
   *
   * @param name - Table name
   * @param newRange - New A1-style range string or CellRange object
   */
  resize(name: string, newRange: string | CellRange): Promise<TableResizeReceipt>;

  /**
   * Add a column to a table.
   *
   * @param name - Table name
   * @param columnName - Name for the new column
   * @param position - Column position (0-based index). If omitted, appends to the end.
   */
  addColumn(name: string, columnName: string, position?: number): Promise<TableAddColumnReceipt>;

  /**
   * Remove a column from a table by index.
   *
   * @param name - Table name
   * @param columnIndex - Column index within the table (0-based)
   */
  removeColumn(name: string, columnIndex: number): Promise<TableRemoveColumnReceipt>;

  /**
   * @deprecated Use {@link setShowTotals} instead.
   * Toggle the totals row visibility on a table.
   *
   * @param name - Table name
   */
  toggleTotalsRow(name: string): Promise<void>;

  /**
   * @deprecated Use {@link setShowHeaders} instead.
   * Toggle the header row visibility on a table.
   *
   * @param name - Table name
   */
  toggleHeaderRow(name: string): Promise<void>;

  /**
   * Apply auto-expansion to a table, extending it to include adjacent data.
   *
   * @param tableName - Table name
   */
  applyAutoExpansion(tableName: string): Promise<void>;

  /**
   * Set a calculated column formula for all data cells in a table column.
   *
   * @param tableName - Table name
   * @param colIndex - Column index within the table (0-based)
   * @param formula - The formula to set (e.g. "=[@Price]*[@Quantity]")
   */
  setCalculatedColumn(tableName: string, colIndex: number, formula: string): Promise<void>;

  /**
   * Clear the calculated column formula from a table column, replacing with empty values.
   *
   * @param tableName - Table name
   * @param colIndex - Column index within the table (0-based)
   */
  clearCalculatedColumn(tableName: string, colIndex: number): Promise<void>;

  /**
   * Get the A1-notation range covering the data body of a table (excludes header and totals rows).
   *
   * @param name - Table name
   * @returns A1-notation range string, or null if the table has no data body rows
   */
  getDataBodyRange(name: string): Promise<string | null>;

  /**
   * Get the A1-notation range covering the header row of a table.
   *
   * @param name - Table name
   * @returns A1-notation range string, or null if the table has no header row
   */
  getHeaderRowRange(name: string): Promise<string | null>;

  /**
   * Get the A1-notation range covering the totals row of a table.
   *
   * @param name - Table name
   * @returns A1-notation range string, or null if the table has no totals row
   */
  getTotalRowRange(name: string): Promise<string | null>;

  // ---------------------------------------------------------------------------
  // Row operations
  // ---------------------------------------------------------------------------

  /**
   * Add a data row to a table.
   *
   * @param tableName - Table name
   * @param index - Row index within the data body (0-based). If omitted, appends to the end.
   * @param values - Optional cell values for the new row
   */
  addRow(tableName: string, index?: number, values?: CellValue[]): Promise<TableAddRowReceipt>;

  /**
   * Delete a data row from a table.
   *
   * @param tableName - Table name
   * @param index - Row index within the data body (0-based)
   */
  deleteRow(tableName: string, index: number): Promise<TableDeleteRowReceipt>;

  /**
   * Delete multiple data rows from a table by their data-body-relative indices.
   *
   * Rows are deleted in descending index order to avoid index shifting.
   *
   * @param tableName - Table name
   * @param indices - Array of row indices within the data body (0-based)
   */
  deleteRows(tableName: string, indices: number[]): Promise<void>;

  /**
   * Delete one or more contiguous data rows from a table starting at `index`.
   *
   * @param tableName - Table name
   * @param index - Starting row index within the data body (0-based)
   * @param count - Number of rows to delete (default 1)
   */
  deleteRowsAt(tableName: string, index: number, count?: number): Promise<void>;

  /**
   * Get the number of data rows in a table (excludes header and totals rows).
   *
   * @param tableName - Table name
   * @returns Number of data rows
   */
  getRowCount(tableName: string): Promise<number>;

  /**
   * Get the A1-notation range for a specific data row.
   *
   * @param tableName - Table name
   * @param index - Row index within the data body (0-based)
   * @returns A1-notation range string
   */
  getRowRange(tableName: string, index: number): Promise<string>;

  /**
   * Get the cell values of a specific data row.
   *
   * @param tableName - Table name
   * @param index - Row index within the data body (0-based)
   * @returns Array of cell values
   */
  getRowValues(tableName: string, index: number): Promise<CellValue[]>;

  /**
   * Set the cell values of a specific data row.
   *
   * @param tableName - Table name
   * @param index - Row index within the data body (0-based)
   * @param values - Cell values to set
   */
  setRowValues(tableName: string, index: number, values: CellValue[]): Promise<void>;

  // ---------------------------------------------------------------------------
  // Column sub-range methods
  // ---------------------------------------------------------------------------

  /**
   * Get the A1-notation range covering the data body cells of a table column.
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @returns A1-notation range string, or null if no data body rows
   */
  getColumnDataBodyRange(tableName: string, columnIndex: number): Promise<string | null>;

  /**
   * Get the A1-notation range covering the header cell of a table column.
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @returns A1-notation range string, or null if no header row
   */
  getColumnHeaderRange(tableName: string, columnIndex: number): Promise<string | null>;

  /**
   * Get the A1-notation range covering the entire table column (header + data + totals).
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @returns A1-notation range string, or null if column does not exist
   */
  getColumnRange(tableName: string, columnIndex: number): Promise<string | null>;

  /**
   * Get the A1-notation range covering the totals cell of a table column.
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @returns A1-notation range string, or null if no totals row
   */
  getColumnTotalRange(tableName: string, columnIndex: number): Promise<string | null>;

  /**
   * Get the cell values of a table column (data body only).
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @returns Array of cell values
   */
  getColumnValues(tableName: string, columnIndex: number): Promise<CellValue[]>;

  /**
   * Set the cell values of a table column (data body only).
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @param values - Cell values to set
   */
  setColumnValues(tableName: string, columnIndex: number, values: CellValue[]): Promise<void>;

  // ---------------------------------------------------------------------------
  // Boolean option setters
  // ---------------------------------------------------------------------------

  /**
   * Set whether the first column is highlighted.
   *
   * @param tableName - Table name
   * @param value - Whether to highlight the first column
   */
  setHighlightFirstColumn(tableName: string, value: boolean): Promise<void>;

  /**
   * Set whether the last column is highlighted.
   *
   * @param tableName - Table name
   * @param value - Whether to highlight the last column
   */
  setHighlightLastColumn(tableName: string, value: boolean): Promise<void>;

  /**
   * Set whether banded columns are shown.
   *
   * @param tableName - Table name
   * @param value - Whether to show banded columns
   */
  setShowBandedColumns(tableName: string, value: boolean): Promise<void>;

  /**
   * Set whether banded rows are shown.
   *
   * @param tableName - Table name
   * @param value - Whether to show banded rows
   */
  setShowBandedRows(tableName: string, value: boolean): Promise<void>;

  /**
   * Set whether filter buttons are shown on the header row.
   *
   * @param tableName - Table name
   * @param value - Whether to show filter buttons
   */
  setShowFilterButton(tableName: string, value: boolean): Promise<void>;

  /**
   * Set whether the header row is visible.
   *
   * @param tableName - Table name
   * @param visible - Whether to show the header row
   */
  setShowHeaders(tableName: string, visible: boolean): Promise<void>;

  /**
   * Set whether the totals row is visible.
   *
   * @param tableName - Table name
   * @param visible - Whether to show the totals row
   */
  setShowTotals(tableName: string, visible: boolean): Promise<void>;

  // ---------------------------------------------------------------------------
  // Filter & collection access
  // ---------------------------------------------------------------------------

  /**
   * Apply an icon filter to a table column.
   *
   * Filters rows by conditional formatting icon: only rows whose evaluated
   * CF icon matches the specified icon set and index are shown.
   *
   * Requires an icon set CF rule applied to the column's range.
   *
   * @param tableName - Table name
   * @param columnIndex - Column index within the table (0-based)
   * @param icon - Icon to filter by: set name (e.g. "3Arrows") and index (0-based)
   */
  applyIconFilter(
    tableName: string,
    columnIndex: number,
    icon: { set: string; index: number },
  ): Promise<void>;

  /**
   * Get the auto-filter associated with a table.
   *
   * @param tableName - Table name
   * @returns Filter information, or null if the table has no associated filter
   */
  getAutoFilter(tableName: string): Promise<FilterInfo | null>;

  /**
   * Get a collection-like wrapper around the table's data rows.
   *
   * The returned object delegates to the existing row methods on this API.
   * The `count` property is a snapshot taken at call time and does not
   * live-update.
   *
   * @param tableName - Table name
   * @returns A TableRowCollection object
   */
  getRows(tableName: string): Promise<TableRowCollection>;
}
