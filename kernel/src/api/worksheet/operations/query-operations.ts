/**
 * Query Operations Module
 *
 * Standalone functions for querying cell data in a sheet.
 *
 * RESPONSIBILITIES:
 * - getUsedRange: Get the range containing all non-empty cells
 * - findCells: Find cells matching a predicate
 * - findByValue: Find cells by value
 * - findByFormula: Find cells with formulas matching a pattern
 * - regexSearch: Search cells using regex patterns
 *
 * ARCHITECTURE:
 * - All functions take (ctx: DocumentContext, sheetId: string) as first two params
 * - Uses ComputeBridge.getDataBounds() + queryRange() for bounded traversal
 * - Returns contract types (CellRange, CellAddress, etc.)
 */

import { colToLetter, toA1, parseCellRange } from '@mog/spreadsheet-utils/a1';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { SheetId } from '@mog-sdk/contracts/core';
import { normalizeCellValue, cellValueToString } from '../../internal/value-conversions';
import type { SelectionAggregates } from '../../../bridges/compute/compute-types.gen';
import type { CellAddress, CellData, CellRange, CellValue, DocumentContext } from './shared';

// =============================================================================
// Search Result Types
// =============================================================================

/** A single regex search result with cell location and match details. */
export interface SearchResult {
  /** Cell address in A1 notation (e.g., "B3") */
  address: string;
  /** The cell's string value */
  value: string;
  /** The name of the sheet containing the match */
  sheetName: string;
  /** The regex pattern that matched */
  matchedPattern: string;
}

// =============================================================================
// Query Operations
// =============================================================================

/**
 * Get the range containing all non-empty cells.
 *
 * Uses ComputeBridge.getDataBounds() — an O(1) query into Rust compute-core
 * that returns the bounding rectangle of all non-empty cells.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Promise resolving to CellRange of used area, or null if sheet is empty
 */
export async function getUsedRange(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<CellRange | null> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return null;

  return {
    sheetId,
    startRow: bounds.minRow,
    startCol: bounds.minCol,
    endRow: bounds.maxRow,
    endCol: bounds.maxCol,
  };
}

/**
 * Find cells matching a predicate.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param predicate - Function to test each cell
 * @returns Array of matching cell addresses
 *
 * @example
 * ```typescript
 * // Find all cells with values > 100
 * const cells = findCells(ctx, sheetId, (cell) => {
 *   return typeof cell.value === "number" && cell.value > 100;
 * });
 * ```
 */
export async function findCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  predicate: (cell: CellData, row: number, col: number) => boolean,
): Promise<CellAddress[]> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return [];

  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  const results: CellAddress[] = [];
  for (const cell of rangeResult.cells) {
    const cellData: CellData = {
      value: normalizeCellValue(cell.value),
      formula: cell.formula as FormulaA1 | undefined,
    };

    if (predicate(cellData, cell.row, cell.col)) {
      results.push({ sheetId, row: cell.row, col: cell.col });
    }
  }

  return results;
}

/**
 * Find cells by value.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param value - Value to search for
 * @returns Array of matching cell addresses
 *
 * @example
 * ```typescript
 * const cells = findByValue(ctx, sheetId, "Total");
 * ```
 */
export async function findByValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  value: CellValue,
): Promise<CellAddress[]> {
  const positions = await ctx.computeBridge.findCellsByValue(
    sheetId,
    String(value),
    null,
    null,
    null,
    null,
  );
  return positions.map(([row, col]) => ({ sheetId, row, col }));
}

/**
 * Find cells with formulas matching a pattern.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param pattern - Regular expression to match formulas
 * @returns Array of matching cell addresses
 *
 * @example
 * ```typescript
 * // Find all cells using SUM function
 * const sumCells = findByFormula(ctx, sheetId, /SUM\(/i);
 * ```
 */
export async function findByFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  pattern: RegExp,
): Promise<CellAddress[]> {
  // Convert JS RegExp to Rust regex pattern string.
  // Prepend (?i) for case-insensitive flag since Rust's regex crate uses inline flags.
  const rustPattern = pattern.flags.includes('i') ? `(?i)${pattern.source}` : pattern.source;
  const positions = await ctx.computeBridge.findCellsByFormula(sheetId, rustPattern);
  return positions.map(([row, col]) => ({ sheetId, row, col }));
}

/**
 * Search cells using regex patterns.
 *
 * Iterates over all cells in the sheet and tests each cell's value (and
 * optionally its formula) against the provided regex patterns. Returns
 * detailed results including the cell address, value, sheet name, and
 * which pattern matched.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param patterns - Array of regex pattern strings
 * @param options - Search options
 * @returns Array of matching cells with addresses, values, sheet name, and matched pattern
 *
 * @example
 * ```typescript
 * // Find all cells containing "USD" or "EUR"
 * const results = await regexSearch(ctx, sheetId, ["USD", "EUR"]);
 *
 * // Case-sensitive whole-cell match
 * const exact = await regexSearch(ctx, sheetId, ["^Total$"], {
 *   caseSensitive: true,
 *   wholeCell: true,
 * });
 * ```
 */
export async function regexSearch(
  ctx: DocumentContext,
  sheetId: SheetId,
  patterns: string[],
  options?: {
    caseSensitive?: boolean;
    wholeCell?: boolean;
    includeFormulas?: boolean;
    startRow?: number;
    startCol?: number;
    endRow?: number;
    endCol?: number;
  },
): Promise<SearchResult[]> {
  // Single IPC call to Rust — regex compilation, cell iteration, and pattern
  // matching all happen in compute-core using the `regex` crate (PCRE-compatible).
  const result = await ctx.computeBridge.regexSearch(sheetId, {
    patterns,
    caseSensitive: options?.caseSensitive ?? false,
    wholeCell: options?.wholeCell ?? false,
    includeFormulas: options?.includeFormulas ?? false,
    ...(options?.startRow != null ? { startRow: options.startRow } : {}),
    ...(options?.startCol != null ? { startCol: options.startCol } : {}),
    ...(options?.endRow != null ? { endRow: options.endRow } : {}),
    ...(options?.endCol != null ? { endCol: options.endCol } : {}),
  });

  if (result.errors.length > 0) {
    console.warn('[regexSearch] Pattern compilation errors:', result.errors);
  }

  return result.matches.map((m) => ({
    address: m.address,
    value: m.value,
    sheetName: m.sheetName,
    matchedPattern: m.matchedPattern,
  }));
}

// =============================================================================
// Sign Check
// =============================================================================

import type { SignCheckOptions, SignCheckResult } from '@mog-sdk/contracts/api';

/**
 * Detect cells whose numeric sign disagrees with their neighbors.
 *
 * Delegates to Rust `sign_check_a1` — range parsing and used-range
 * fallback now happen in the engine.
 */
export async function signCheck(
  ctx: DocumentContext,
  sheetId: SheetId,
  range?: string,
  options?: SignCheckOptions,
): Promise<SignCheckResult> {
  let startRow: number, startCol: number, endRow: number, endCol: number;

  if (range) {
    const parsed = parseCellRange(range);
    if (!parsed) throw new Error(`Invalid range: "${range}"`);
    startRow = parsed.startRow;
    startCol = parsed.startCol;
    endRow = parsed.endRow;
    endCol = parsed.endCol;
  } else {
    const usedRange = await getUsedRange(ctx, sheetId);
    if (!usedRange) return { cellsChecked: 0, anomalies: [] };
    startRow = usedRange.startRow;
    startCol = usedRange.startCol;
    endRow = usedRange.endRow;
    endCol = usedRange.endCol;
  }

  const result = await ctx.computeBridge.signCheck(
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
    (options ?? {}) as import('../../../bridges/compute/compute-types.gen').SignCheckOptions,
  );

  return {
    cellsChecked: result.cellsChecked,
    anomalies: result.anomalies.map((a) => ({
      cell: a.cell,
      value: a.value,
      disagreement: a.disagreement,
      neighbors: a.neighbors.map((n) => ({ cell: n.cell, value: n.value })),
    })),
  };
}

/**
 * Get selection aggregates (SUM, COUNT, AVG, MIN, MAX) for the status bar.
 * Ranges are [startRow, startCol, endRow, endCol] tuples.
 */
export async function getSelectionAggregates(
  ctx: DocumentContext,
  sheetId: SheetId,
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>,
): Promise<SelectionAggregates> {
  const tuples: [number, number, number, number][] = ranges.map((r) => [
    r.startRow,
    r.startCol,
    r.endRow,
    r.endCol,
  ]);
  return ctx.computeBridge.getSelectionAggregates(sheetId, tuples);
}

/**
 * Batch-format values using number format codes.
 * Each entry contains a cell value descriptor and a format code.
 * Returns one formatted display string per entry.
 */
export async function formatValues(
  ctx: DocumentContext,
  entries: Array<{ value: { type: string; value?: unknown }; format_code: string }>,
): Promise<string[]> {
  return ctx.computeBridge.formatValues(entries);
}

// =============================================================================
// Identity-aware Range Query
// =============================================================================

/**
 * Get all non-empty cells in a range with stable CellId identity.
 *
 * Delegates to computeBridge.queryRange() and maps Rust types
 * to contract types (CellValue). This encapsulates the Rust ↔ TS type boundary
 * inside the kernel.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param startRow - Start row (0-based, inclusive)
 * @param startCol - Start column (0-based, inclusive)
 * @param endRow - End row (0-based, inclusive)
 * @param endCol - End column (0-based, inclusive)
 * @returns Flat array of non-empty cells with CellId, position, value, formula, display string
 */
export async function getRangeWithIdentity(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): Promise<
  Array<{
    cellId: string;
    row: number;
    col: number;
    value: CellValue | null;
    formulaText?: string;
    displayString: string;
  }>
> {
  return ctx.computeBridge.getRangeWithIdentity(sheetId, startRow, startCol, endRow, endCol);
}
