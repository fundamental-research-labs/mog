/**
 * WorksheetBindings — Sub-API Interface for Sheet Data Bindings
 *
 * Methods for managing sheet-level data source bindings and querying
 * projection (dynamic array spill) metadata.
 */
import type { CellRange, CreateBindingConfig, SheetDataBindingInfo } from '../types';
import type { WorksheetRange } from '../ranges';

/** Sub-API for worksheet data binding operations. */
export interface WorksheetBindings {
  /**
   * List all data bindings on the sheet.
   *
   * @returns Array of binding info objects
   */
  list(): Promise<SheetDataBindingInfo[]>;

  /**
   * Get a data binding by ID.
   *
   * @param bindingId - The binding ID to retrieve
   * @returns The binding info, or null if not found
   */
  get(bindingId: string): Promise<SheetDataBindingInfo | null>;

  /**
   * Get the total number of data bindings on this sheet.
   *
   * @returns The count of bindings
   */
  getCount(): Promise<number>;

  /**
   * Remove all data bindings from the sheet.
   */
  clear(): Promise<void>;

  /**
   * Add a new data binding on the sheet.
   *
   * @param config - Binding configuration (connection, column mappings, etc.)
   * @returns The created binding info
   */
  add(config: CreateBindingConfig): Promise<SheetDataBindingInfo>;

  /**
   * Remove a data binding by ID.
   *
   * @param bindingId - The binding ID to remove
   */
  remove(bindingId: string): Promise<void>;

  /**
   * Get the spill range for a projected (dynamic array) cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The spill range, or null if the cell is not a projection source
   */
  getProjectionRange(row: number, col: number): Promise<WorksheetRange | null>;

  /**
   * Get the source cell of a projected value.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The source cell position, or null if the cell is not a projection
   */
  getProjectionSource(row: number, col: number): Promise<{ row: number; col: number } | null>;

  /**
   * Check whether a cell position is a projected (spilled) value.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell holds a projected value
   */
  isProjectedPosition(row: number, col: number): Promise<boolean>;

  /**
   * Get all projection data overlapping a viewport range (batch query).
   * Returns one entry per projection with origin position and dimensions.
   *
   * @param range - A1-style range string or CellRange object
   */
  getViewportProjectionData(
    range: string | CellRange,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
  /**
   * Get all projection data overlapping a viewport range (batch query).
   * Returns one entry per projection with origin position and dimensions.
   *
   * @param startRow - Start row (0-based)
   * @param startCol - Start column (0-based)
   * @param endRow - End row (0-based, inclusive)
   * @param endCol - End column (0-based, inclusive)
   */
  getViewportProjectionData(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
}
