/**
 * WorksheetInternal — Internal plumbing interface (NOT public API).
 *
 * Exposes low-level operations needed by internal consumers (bridges,
 * formula bar, action handlers) but NOT part of the public Worksheet surface.
 * Only exposed on WorksheetImpl directly, never on the Worksheet interface.
 */
import type { CellId, CellIdRange, IdentityFormula } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';
import type { RangeSchema } from '@mog/types-commands/schema';
import type { Chart, ChartAnchorMode } from '@mog/types-data/data/charts';
import type { TableConfig } from '@mog/types-data/data/tables';
import type { CellRange, ConditionalFormatCache } from '../types';

/**
 * Internal chart read model for first-party worksheet consumers.
 *
 * Public `Chart` intentionally omits CRDT/storage metadata. Spreadsheet
 * rendering still needs those fields to keep anchors and source ranges stable
 * across structural edits, so the internal worksheet surface exposes this
 * storage-backed projection instead of requiring UI code to inspect raw bridge
 * objects.
 */
export interface WorksheetInternalChart extends Chart {
  anchorCellId?: CellId;
  endAnchorCellId?: CellId;
  anchorMode?: ChartAnchorMode;
  dataRangeIdentity?: CellIdRange;
  seriesRangeIdentity?: CellIdRange;
  categoryRangeIdentity?: CellIdRange;
  zIndex?: number;
}

/** Internal worksheet operations — not part of the public Worksheet API. */
export interface WorksheetInternal {
  /**
   * Get the cell ID at a given position, or null if no cell exists there.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Cell ID string or null
   */
  getCellIdAt(row: number, col: number): Promise<string | null>;

  /**
   * Get or create a cell ID at the given position.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Cell ID string (guaranteed to exist after call)
   */
  getOrCreateCellId(row: number, col: number): Promise<string>;

  /**
   * Reverse-lookup: get the (row, col) position of a cell by its ID.
   *
   * @param cellId - The cell ID to look up
   * @returns Position object, or null if the cell ID is not found
   */
  getCellPosition(cellId: string): Promise<{ row: number; col: number } | null>;

  /**
   * Batch reverse-lookup: get positions for multiple cell IDs at once.
   *
   * @param cellIds - Array of cell IDs to look up
   * @returns Map from cell ID to position (missing IDs are omitted)
   */
  batchGetCellPositions(cellIds: string[]): Promise<Map<string, { row: number; col: number }>>;

  /**
   * List stored chart configs for first-party UI infrastructure.
   */
  listStoredCharts(): Promise<WorksheetInternalChart[]>;

  /**
   * Reactive conditional format cache.
   * Previously exposed as `ws.conditionalFormats` — renamed to avoid collision
   * with the new conditionalFormats sub-API.
   */
  readonly cfCache: ConditionalFormatCache;

  /**
   * Get the edit-mode string representation of a cell value.
   * Used by formula bar and in-cell editing.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param editText - Optional pre-computed edit text (for date/time cells)
   * @returns The string to display in edit mode
   */
  getValueForEditing(row: number, col: number, editText?: string): Promise<string>;

  /**
   * Convert an identity formula to an A1-display string.
   *
   * @param identityFormula - The identity formula to convert
   * @returns A1-notation display string
   */
  toA1Display(identityFormula: IdentityFormula): Promise<string>;

  /**
   * Get the full table configuration for a cell, if the cell is inside a table.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Full table config, or undefined if not in a table
   */
  getTableConfig(row: number, col: number): Promise<TableConfig | undefined>;

  /**
   * Get raw store-level data for a cell. Used for debugging and internal tooling.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Raw cell store data (shape is implementation-dependent)
   */
  getCellStoreData(row: number, col: number): Promise<unknown>;

  /**
   * Clamp a range to the actual data bounds of the sheet.
   * Full-column and full-row ranges are shrunk to the data extent plus a buffer.
   *
   * @param range - The range to clamp
   * @returns Clamped range (non-full ranges are returned as-is)
   */
  clampRangeToDataBounds(range: CellRange): Promise<CellRange>;

  /**
   * Relocate (move) cells from a source range to a target position.
   *
   * @param sourceRange - The range of cells to move
   * @param targetRow - Destination top-left row (0-based)
   * @param targetCol - Destination top-left column (0-based)
   */
  relocateCells(sourceRange: CellRange, targetRow: number, targetCol: number): Promise<void>;

  /**
   * Relocate (move) cells from a source range to a target position on a
   * (potentially different) sheet.  Uses the Yrs-backed bridge method that
   * supports cross-sheet formula-reference updates.
   *
   * @param sourceRange - The range of cells to move
   * @param targetSheetId - Destination sheet ID
   * @param targetRow - Destination top-left row (0-based)
   * @param targetCol - Destination top-left column (0-based)
   */
  relocateCellsToSheet(
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
  ): Promise<void>;

  /**
   * Get all range schemas (data validation rules) on this sheet, including
   * each schema's full ranges (multiple ranges per schema possible). Used by
   * clipboard capture to overlap schema ranges with the copied selection.
   *
   * Returns the raw RangeSchema shape rather than the lossy public ValidationRule
   * because clipboard capture needs the schema's original ranges (and a schema
   * may apply to multiple ranges that ValidationRule.range cannot represent).
   */
  getRangeSchemas(): Promise<RangeSchema[]>;

  /**
   * Apply a raw RangeSchema (as captured by the clipboard) to a range without
   * the lossy ValidationRule round-trip. The id and createdAt are auto-filled.
   * Used by the paste pipeline to replicate the source rule on the destination
   * cells.
   */
  setRangeSchemaFromClipboard(
    range: CellRange,
    schema: RangeSchema['schema'],
    enforcement: RangeSchema['enforcement'],
    ui?: RangeSchema['ui'],
  ): Promise<void>;

  /**
   * Copy cells from a source range to a target position on a (potentially
   * different) sheet, routing through the compute-core copy_range mutation.
   * Handles relative/absolute formula-reference adjustment atomically.
   *
   * @param sourceRange - The range of cells to copy
   * @param targetSheetId - Destination sheet ID
   * @param targetRow - Destination top-left row (0-based)
   * @param targetCol - Destination top-left column (0-based)
   * @param copyType - What to copy: 'all', 'values', 'formulas', or 'formats'
   * @param skipBlanks - Skip source cells that are blank
   * @param transpose - Swap row/col offsets
   */
  copyRangeToSheet(
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
    copyType: 'all' | 'values' | 'formulas' | 'formats',
    skipBlanks: boolean,
    transpose: boolean,
  ): Promise<void>;
}
