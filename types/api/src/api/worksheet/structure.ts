/**
 * WorksheetStructure — Sub-API Interface for Structure Operations
 *
 * Row/column insertion and deletion, cell shifting, dimensions,
 * text-to-columns, remove duplicates, and merge operations.
 */
import type {
  CellRange,
  MergedRegion,
  RemoveDuplicatesResult,
  TextToColumnsOptions,
  TextToColumnsResult,
} from '../types';
import type { WorksheetRange } from '../ranges';
import type {
  DeleteCellsReceipt,
  DeleteColumnsReceipt,
  DeleteRowsReceipt,
  InsertCellsReceipt,
  InsertColumnsReceipt,
  InsertRowsReceipt,
  MergeReceipt,
  UnmergeReceipt,
} from '../mutation-receipt';

export interface WorksheetStructure {
  // ===========================================================================
  // Row / Column insertion and deletion
  // ===========================================================================

  /** Insert rows starting at the given 0-based index. */
  insertRows(index: number, count: number): Promise<InsertRowsReceipt>;

  /** Delete rows starting at the given 0-based index. */
  deleteRows(index: number, count: number): Promise<DeleteRowsReceipt>;

  /** Insert columns starting at the given 0-based index. */
  insertColumns(index: number, count: number): Promise<InsertColumnsReceipt>;

  /** Delete columns starting at the given 0-based index. */
  deleteColumns(index: number, count: number): Promise<DeleteColumnsReceipt>;

  // ===========================================================================
  // Cell shifting
  // ===========================================================================

  /** Insert cells by shifting existing cells in the specified direction. */
  insertCellsWithShift(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    direction: 'right' | 'down',
  ): Promise<InsertCellsReceipt>;

  /** Delete cells by shifting remaining cells in the specified direction. */
  deleteCellsWithShift(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    direction: 'left' | 'up',
  ): Promise<DeleteCellsReceipt>;

  // ===========================================================================
  // Dimensions
  // ===========================================================================

  /** Get the number of rows with data. */
  getRowCount(): Promise<number>;

  /** Get the number of columns with data. */
  getColumnCount(): Promise<number>;

  // ===========================================================================
  // Data operations
  // ===========================================================================

  /** Split text in a column into multiple columns. */
  textToColumns(
    range: string | CellRange,
    options: TextToColumnsOptions,
  ): Promise<TextToColumnsResult>;

  /** Remove duplicate rows in a range. */
  removeDuplicates(
    range: string | CellRange,
    columns: number[],
    hasHeaders?: boolean,
  ): Promise<RemoveDuplicatesResult>;

  // ===========================================================================
  // Merges
  // ===========================================================================

  /** Merge cells by A1 range. */
  merge(range: string): Promise<MergeReceipt>;
  /** Merge cells by CellRange object. */
  merge(range: CellRange): Promise<MergeReceipt>;
  /** Merge cells by numeric bounds. */
  merge(startRow: number, startCol: number, endRow: number, endCol: number): Promise<MergeReceipt>;

  /** Unmerge cells by A1 range. */
  unmerge(range: string): Promise<UnmergeReceipt>;
  /** Unmerge cells by CellRange object. */
  unmerge(range: CellRange): Promise<UnmergeReceipt>;
  /** Unmerge cells by numeric bounds. */
  unmerge(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<UnmergeReceipt>;

  /** Get all merged regions in the sheet. */
  getMergedRegions(): Promise<MergedRegion[]>;

  /** Get the merge containing a cell by A1 address, or null if not merged. */
  getMergeAtCell(address: string): Promise<WorksheetRange | null>;
  /** Get the merge containing a cell by row/col, or null if not merged. */
  getMergeAtCell(row: number, col: number): Promise<WorksheetRange | null>;
}
