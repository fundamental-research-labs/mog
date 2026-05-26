/**
 * Range Manager Utilities
 *
 * Centralized utility for parsing, manipulating, and adjusting range references.
 * Used throughout the codebase for:
 * - RangeSchema.ranges (data validation)
 * - enumSource (dynamic dropdown source)
 * - Row/column insert/delete operations
 * - Copy/paste operations
 *
 * Cell Identity Model:
 * RangeSchema.ranges now uses IdentityRangeSchemaRef (CellId-based) instead of
 * A1 strings. The RangeSpatialIndex resolves CellIds to positions at query time
 * via a resolveCellPosition callback. This ensures concurrent structure changes
 * compose correctly under CRDT.
 */

import {
  toCellId,
  type CellId,
  type IdentityRangeSchemaRef,
} from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  CellRef,
  IRangeSpatialIndex,
  RangeContainsResult,
  RangeRef,
  ViewportBounds,
} from '@mog-sdk/contracts/range-ref';
import type { RangeSchema } from '@mog-sdk/contracts/schema';

// =============================================================================
// Constants
// =============================================================================

/** Column letters for conversion (A-Z, AA-AZ, etc.) */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// =============================================================================
// Column Index Conversion
// =============================================================================

/**
 * Convert column index (0-based) to letter(s) (A, B, ..., Z, AA, AB, ...)
 */
export function colIndexToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = ALPHABET[c % 26] + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}

/**
 * Convert column letter(s) to index (0-based)
 */
export function letterToColIndex(letters: string): number {
  const upper = letters.toUpperCase();
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}

// =============================================================================
// RangeManager Class
// =============================================================================

/**
 * Utility class for parsing and manipulating range references.
 * All methods are static for easy use without instantiation.
 */
export class RangeManager {
  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parse a cell reference string (e.g., "A1", "$A$1", "A$1")
   */
  static parseCell(cellStr: string): CellRef {
    // Pattern: optional $, letters (col), optional $, digits (row)
    const match = cellStr.match(/^(\$?)([A-Z]+)(\$?)(\d+)$/i);
    if (!match) {
      throw new Error(`Invalid cell reference: ${cellStr}`);
    }

    const [, colAbsMarker, colLetters, rowAbsMarker, rowDigits] = match;
    return {
      col: letterToColIndex(colLetters.toUpperCase()),
      row: parseInt(rowDigits, 10) - 1, // Convert to 0-based
      colAbsolute: colAbsMarker === '$',
      rowAbsolute: rowAbsMarker === '$',
    };
  }

  /**
   * Parse a range reference string.
   * Supports:
   * - Simple ranges: "A1:B10"
   * - Absolute refs: "$A$1:$B$10", "A$1:$B10"
   * - Cross-sheet: "Sheet2!A1:B10", "'Sheet Name'!A1:B10"
   * - Single cell: "A1" (start and end are the same)
   */
  static parse(rangeStr: string): RangeRef {
    let sheetName: string | undefined;
    let rangeWithoutSheet = rangeStr;

    // Check for sheet prefix (SheetName! or 'Sheet Name'!)
    const sheetMatch = rangeStr.match(/^(?:'([^']+)'|([^'!]+))!/);
    if (sheetMatch) {
      sheetName = sheetMatch[1] || sheetMatch[2];
      rangeWithoutSheet = rangeStr.slice(sheetMatch[0].length);
    }

    // Parse the range part
    const parts = rangeWithoutSheet.split(':');
    if (parts.length === 1) {
      // Single cell reference - start and end are the same
      const cell = this.parseCell(parts[0]);
      return { start: cell, end: { ...cell }, sheetName };
    } else if (parts.length === 2) {
      const start = this.parseCell(parts[0]);
      const end = this.parseCell(parts[1]);
      return { start, end, sheetName };
    } else {
      throw new Error(`Invalid range reference: ${rangeStr}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Stringification
  // ---------------------------------------------------------------------------

  /**
   * Convert a CellRef back to string (e.g., "$A$1", "B2")
   */
  static stringifyCell(cell: CellRef): string {
    const colStr = cell.colAbsolute ? '$' : '';
    const rowStr = cell.rowAbsolute ? '$' : '';
    return `${colStr}${colIndexToLetter(cell.col)}${rowStr}${cell.row + 1}`;
  }

  /**
   * Convert a RangeRef back to string (e.g., "Sheet1!$A$1:$B$10")
   */
  static stringify(ref: RangeRef): string {
    const startStr = this.stringifyCell(ref.start);
    const endStr = this.stringifyCell(ref.end);

    // Check if it's a single cell (start and end are the same)
    const isSingleCell = ref.start.row === ref.end.row && ref.start.col === ref.end.col;

    const rangeStr = isSingleCell ? startStr : `${startStr}:${endStr}`;

    if (ref.sheetName) {
      // Quote sheet name if it contains spaces or special chars
      const needsQuotes = /[\s!']/.test(ref.sheetName);
      const quotedName = needsQuotes ? `'${ref.sheetName}'` : ref.sheetName;
      return `${quotedName}!${rangeStr}`;
    }

    return rangeStr;
  }

  // ---------------------------------------------------------------------------
  // Containment Checks
  // ---------------------------------------------------------------------------

  /**
   * Check if a cell is within a range.
   * Returns containment info including relative position within the range.
   */
  static contains(range: RangeRef, row: number, col: number): RangeContainsResult {
    // Normalize range (handle if start > end)
    const minRow = Math.min(range.start.row, range.end.row);
    const maxRow = Math.max(range.start.row, range.end.row);
    const minCol = Math.min(range.start.col, range.end.col);
    const maxCol = Math.max(range.start.col, range.end.col);

    const contains = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;

    if (contains) {
      return {
        contains: true,
        relativeRow: row - minRow,
        relativeCol: col - minCol,
      };
    }

    return { contains: false };
  }

  /**
   * Check if two ranges overlap
   */
  static rangesOverlap(a: RangeRef, b: RangeRef): boolean {
    const aMinRow = Math.min(a.start.row, a.end.row);
    const aMaxRow = Math.max(a.start.row, a.end.row);
    const aMinCol = Math.min(a.start.col, a.end.col);
    const aMaxCol = Math.max(a.start.col, a.end.col);

    const bMinRow = Math.min(b.start.row, b.end.row);
    const bMaxRow = Math.max(b.start.row, b.end.row);
    const bMinCol = Math.min(b.start.col, b.end.col);
    const bMaxCol = Math.max(b.start.col, b.end.col);

    // Check for non-overlap (easier to check)
    const noOverlap =
      aMaxRow < bMinRow || // a is above b
      aMinRow > bMaxRow || // a is below b
      aMaxCol < bMinCol || // a is left of b
      aMinCol > bMaxCol; // a is right of b

    return !noOverlap;
  }

  // ---------------------------------------------------------------------------
  // Row/Column Adjustments
  // ---------------------------------------------------------------------------

  /**
   * Adjust a range after row insert/delete.
   * @param range The range to adjust
   * @param atRow The row where insert/delete occurred
   * @param delta Positive for insert, negative for delete
   * @returns Adjusted range, or null if the range was entirely deleted
   */
  static adjustForRowChange(range: RangeRef, atRow: number, delta: number): RangeRef | null {
    const newStart = this.adjustCellForRowChange(range.start, atRow, delta);
    const newEnd = this.adjustCellForRowChange(range.end, atRow, delta);

    // If either becomes invalid (deleted), return null
    if (newStart === null || newEnd === null) {
      // Check if the entire range is deleted
      const minRow = Math.min(range.start.row, range.end.row);
      const maxRow = Math.max(range.start.row, range.end.row);

      if (delta < 0) {
        // Deletion case
        const deleteStart = atRow;
        const deleteEnd = atRow - delta - 1; // e.g., delta=-3 means delete rows atRow to atRow+2

        // If entire range is within deleted rows
        if (minRow >= deleteStart && maxRow <= deleteEnd) {
          return null;
        }
      }
    }

    // Reconstruct the range
    return {
      start: newStart || range.start,
      end: newEnd || range.end,
      sheetName: range.sheetName,
    };
  }

  /**
   * Adjust a single cell reference for row change
   */
  private static adjustCellForRowChange(
    cell: CellRef,
    atRow: number,
    delta: number,
  ): CellRef | null {
    // Absolute row references don't shift
    if (cell.rowAbsolute) {
      return cell;
    }

    if (delta > 0) {
      // Insert: shift down if at or after insertion point
      if (cell.row >= atRow) {
        return { ...cell, row: cell.row + delta };
      }
    } else {
      // Delete: shift up or invalidate
      const deleteCount = -delta;
      const deleteEnd = atRow + deleteCount - 1;

      if (cell.row >= atRow && cell.row <= deleteEnd) {
        // Cell is in deleted range
        return null;
      }
      if (cell.row > deleteEnd) {
        // Cell is after deleted range, shift up
        return { ...cell, row: cell.row + delta };
      }
    }

    return cell;
  }

  /**
   * Adjust a range after column insert/delete.
   * @param range The range to adjust
   * @param atCol The column where insert/delete occurred
   * @param delta Positive for insert, negative for delete
   * @returns Adjusted range, or null if the range was entirely deleted
   */
  static adjustForColChange(range: RangeRef, atCol: number, delta: number): RangeRef | null {
    const newStart = this.adjustCellForColChange(range.start, atCol, delta);
    const newEnd = this.adjustCellForColChange(range.end, atCol, delta);

    // If either becomes invalid (deleted), return null
    if (newStart === null || newEnd === null) {
      const minCol = Math.min(range.start.col, range.end.col);
      const maxCol = Math.max(range.start.col, range.end.col);

      if (delta < 0) {
        const deleteStart = atCol;
        const deleteEnd = atCol - delta - 1;

        if (minCol >= deleteStart && maxCol <= deleteEnd) {
          return null;
        }
      }
    }

    return {
      start: newStart || range.start,
      end: newEnd || range.end,
      sheetName: range.sheetName,
    };
  }

  /**
   * Adjust a single cell reference for column change
   */
  private static adjustCellForColChange(
    cell: CellRef,
    atCol: number,
    delta: number,
  ): CellRef | null {
    // Absolute column references don't shift
    if (cell.colAbsolute) {
      return cell;
    }

    if (delta > 0) {
      // Insert: shift right if at or after insertion point
      if (cell.col >= atCol) {
        return { ...cell, col: cell.col + delta };
      }
    } else {
      // Delete: shift left or invalidate
      const deleteCount = -delta;
      const deleteEnd = atCol + deleteCount - 1;

      if (cell.col >= atCol && cell.col <= deleteEnd) {
        return null;
      }
      if (cell.col > deleteEnd) {
        return { ...cell, col: cell.col + delta };
      }
    }

    return cell;
  }

  // ---------------------------------------------------------------------------
  // Copy/Paste Translation
  // ---------------------------------------------------------------------------

  /**
   * Translate a range for copy/paste (shift by offset).
   * Only relative references are shifted.
   */
  static translate(range: RangeRef, rowOffset: number, colOffset: number): RangeRef {
    return {
      start: this.translateCell(range.start, rowOffset, colOffset),
      end: this.translateCell(range.end, rowOffset, colOffset),
      sheetName: range.sheetName,
    };
  }

  /**
   * Translate a single cell reference
   */
  private static translateCell(cell: CellRef, rowOffset: number, colOffset: number): CellRef {
    return {
      row: cell.rowAbsolute ? cell.row : cell.row + rowOffset,
      col: cell.colAbsolute ? cell.col : cell.col + colOffset,
      rowAbsolute: cell.rowAbsolute,
      colAbsolute: cell.colAbsolute,
    };
  }

  // ---------------------------------------------------------------------------
  // Cell Enumeration
  // ---------------------------------------------------------------------------

  /**
   * Get all cells in a range as array of [row, col] tuples.
   * Useful for iterating over all cells in a range.
   */
  static getCells(range: RangeRef): Array<[number, number]> {
    const cells: Array<[number, number]> = [];
    const minRow = Math.min(range.start.row, range.end.row);
    const maxRow = Math.max(range.start.row, range.end.row);
    const minCol = Math.min(range.start.col, range.end.col);
    const maxCol = Math.max(range.start.col, range.end.col);

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        cells.push([row, col]);
      }
    }

    return cells;
  }

  /**
   * Get cells in a range that are within the given viewport bounds.
   * More efficient than getCells() when only viewport cells are needed.
   */
  static getCellsInBounds(range: RangeRef, bounds: ViewportBounds): Array<[number, number]> {
    const cells: Array<[number, number]> = [];

    // Intersect range with bounds
    const minRow = Math.max(Math.min(range.start.row, range.end.row), bounds.minRow);
    const maxRow = Math.min(Math.max(range.start.row, range.end.row), bounds.maxRow);
    const minCol = Math.max(Math.min(range.start.col, range.end.col), bounds.minCol);
    const maxCol = Math.min(Math.max(range.start.col, range.end.col), bounds.maxCol);

    // If no intersection, return empty
    if (minRow > maxRow || minCol > maxCol) {
      return cells;
    }

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        cells.push([row, col]);
      }
    }

    return cells;
  }

  /**
   * Get the dimensions of a range
   */
  static getDimensions(range: RangeRef): { rows: number; cols: number } {
    return {
      rows: Math.abs(range.end.row - range.start.row) + 1,
      cols: Math.abs(range.end.col - range.start.col) + 1,
    };
  }

  // ---------------------------------------------------------------------------
  // Spatial Index
  // ---------------------------------------------------------------------------

  /**
   * Build a spatial index for efficient range lookups.
   * The index allows O(1) amortized lookup of "which schemas contain this cell?"
   */
  static buildSpatialIndex(schemas: RangeSchema[]): RangeSpatialIndex {
    return new RangeSpatialIndex(schemas);
  }
}

// =============================================================================
// Spatial Index Implementation
// =============================================================================

/**
 * Resolved range bounds from CellId-based refs.
 * Cached per-query to avoid repeated lookups.
 */
interface ResolvedRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

/**
 * Spatial index for efficient range lookups.
 * Uses a simple interval-based approach suitable for spreadsheet use cases.
 *
 * For typical spreadsheet usage (hundreds of validation rules, thousands of visible cells),
 * this provides excellent performance without the complexity of R-trees or quad-trees.
 *
 * Cell Identity Model:
 * RangeSchema.ranges are now IdentityRangeSchemaRef (CellId-based). The spatial index
 * resolves CellIds to positions at query time via a resolveCellPosition callback.
 * This ensures:
 * - Concurrent structure changes compose correctly (no adjustment needed)
 * - Position resolution is always current (no stale cached positions)
 * - Deleted cells result in invalid ranges (schema is effectively disabled for that range)
 */
export class RangeSpatialIndex implements IRangeSpatialIndex<RangeSchema> {
  private schemas: RangeSchema[] = [];
  private resolveCellPosition:
    | ((cellId: CellId) => Promise<{ row: number; col: number; sheet: SheetId } | null>)
    | null = null;

  constructor(
    schemas: RangeSchema[] = [],
    resolveCellPosition?: (
      cellId: CellId,
    ) => Promise<{ row: number; col: number; sheet: SheetId } | null>,
  ) {
    this.resolveCellPosition = resolveCellPosition ?? null;
    this.rebuild(schemas);
  }

  /**
   * Set or update the cell position resolver.
   * Call this when the resolver changes (e.g., sheet switch).
   */
  setResolveCellPosition(
    resolve:
      | ((cellId: CellId) => Promise<{ row: number; col: number; sheet: SheetId } | null>)
      | null,
  ): void {
    this.resolveCellPosition = resolve;
  }

  /**
   * Rebuild the index with new schemas.
   * Note: With CellId-based refs, we don't pre-parse ranges anymore.
   * Resolution happens at query time.
   */
  rebuild(schemas: RangeSchema[]): void {
    this.schemas = schemas;
  }

  /**
   * Resolve an IdentityRangeSchemaRef to position bounds.
   * Returns null if either corner cell is deleted.
   */
  private async resolveRangeBounds(ref: IdentityRangeSchemaRef): Promise<ResolvedRange | null> {
    if (!this.resolveCellPosition) {
      console.warn('RangeSpatialIndex: No cell position resolver configured');
      return null;
    }

    const startPos = await this.resolveCellPosition(toCellId(ref.startId));
    const endPos = await this.resolveCellPosition(toCellId(ref.endId));

    // If either corner is deleted, range is invalid
    if (!startPos || !endPos) {
      return null;
    }

    // Normalize bounds (handle reversed ranges)
    return {
      minRow: Math.min(startPos.row, endPos.row),
      maxRow: Math.max(startPos.row, endPos.row),
      minCol: Math.min(startPos.col, endPos.col),
      maxCol: Math.max(startPos.col, endPos.col),
    };
  }

  /**
   * Check if a cell is within resolved bounds.
   */
  private cellInBounds(row: number, col: number, bounds: ResolvedRange): boolean {
    return (
      row >= bounds.minRow && row <= bounds.maxRow && col >= bounds.minCol && col <= bounds.maxCol
    );
  }

  /**
   * Check if two bounds overlap.
   */
  private boundsOverlap(a: ResolvedRange, b: ResolvedRange): boolean {
    return !(
      a.maxRow < b.minRow ||
      a.minRow > b.maxRow ||
      a.maxCol < b.minCol ||
      a.minCol > b.maxCol
    );
  }

  /**
   * Get all schemas whose ranges contain the given cell.
   * Resolves CellId refs to positions at query time.
   */
  async getItemsForCell(row: number, col: number): Promise<RangeSchema[]> {
    const result: RangeSchema[] = [];

    for (const schema of this.schemas) {
      for (const rangeRef of schema.ranges) {
        const bounds = await this.resolveRangeBounds(rangeRef);
        if (bounds && this.cellInBounds(row, col, bounds)) {
          result.push(schema);
          break; // Schema matches, no need to check other ranges
        }
      }
    }

    return result;
  }

  /**
   * Get all schemas whose ranges intersect the given viewport.
   * Returns a Map for deduplication (schema ID -> schema).
   */
  async getItemsInViewport(bounds: ViewportBounds): Promise<Map<string, RangeSchema>> {
    const result = new Map<string, RangeSchema>();

    const viewportBounds: ResolvedRange = {
      minRow: bounds.minRow,
      maxRow: bounds.maxRow,
      minCol: bounds.minCol,
      maxCol: bounds.maxCol,
    };

    for (const schema of this.schemas) {
      for (const rangeRef of schema.ranges) {
        const schemaBounds = await this.resolveRangeBounds(rangeRef);
        if (schemaBounds && this.boundsOverlap(schemaBounds, viewportBounds)) {
          result.set(schema.id, schema);
          break; // Schema matches, no need to check other ranges
        }
      }
    }

    return result;
  }
}
