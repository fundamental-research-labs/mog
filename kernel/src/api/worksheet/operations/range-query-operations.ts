/**
 * Range Query Operations Module
 *
 * Range-level query and manipulation operations that compose existing primitives.
 * Implements OfficeJS Range API gaps: clear modes, extended range, display text,
 * value types, find-in-range, replace-all, number format categories.
 *
 * All functions take (ctx: DocumentContext, sheetId: SheetId) as first two params.
 */

import {
  type CellRange,
  type CellValue,
  type ClearApplyTo,
  type ClearResult,
  CellType,
  CellValueType,
  NumberFormatCategory,
  RangeValueType,
} from '@mog-sdk/contracts/api';
import type { VisibleRangeView } from '@mog-sdk/contracts/api';
import type { FormulaA1 } from '@mog-sdk/contracts/cells';
import type { SheetId } from '@mog-sdk/contracts/core';
import { MAX_ROWS, MAX_COLS } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import { normalizeCellValue, cellValueToString } from '../../internal/value-conversions';
import { normalizeRange } from '../../internal/utils';
import { KernelError } from '../../../errors';
import type { FindInRangeOptions } from '../../../bridges/compute/compute-types.gen';
import type { CellAddress, DocumentContext } from './shared';
import { parseRefIdSimple } from './validation-helpers';

// =============================================================================
// Clear with Mode
// =============================================================================

/**
 * Unified clear with mode selection (OfficeJS Range.clear equivalent).
 *
 * Composes existing primitives:
 * - 'contents': clearRange (values + formulas, preserves formats)
 * - 'formats': clearFormatForRanges
 * - 'hyperlinks': iterate and remove hyperlinks
 * - 'all': clearRangeByPosition (full wipe) + formats + hyperlinks
 */
const VALID_CLEAR_MODES = ['all', 'contents', 'formats', 'hyperlinks'] as const;
const VALID_CLEAR_MODE_SET: ReadonlySet<string> = new Set(VALID_CLEAR_MODES);

function clearModeSuggestion(applyTo: unknown): string {
  if (applyTo === 'value' || applyTo === 'values' || applyTo === 'content') {
    return 'Use "contents" to clear values and formulas while preserving formats and hyperlinks.';
  }

  if (applyTo === 'valuesAndFormats') {
    return [
      '"valuesAndFormats" is ambiguous and is not the same as "all", because "all" also clears hyperlinks.',
      'Use "contents", "formats", or "all" explicitly.',
    ].join(' ');
  }

  return `Use one of: ${VALID_CLEAR_MODES.join(', ')}.`;
}

export function validateClearApplyTo(applyTo: unknown): ClearApplyTo {
  if (typeof applyTo === 'string' && VALID_CLEAR_MODE_SET.has(applyTo)) {
    return applyTo as ClearApplyTo;
  }

  const suggestion = clearModeSuggestion(applyTo);
  throw new KernelError(
    'API_INVALID_ARGUMENT',
    `Invalid clear mode for applyTo: ${JSON.stringify(applyTo)}.`,
    {
      path: ['applyTo'],
      suggestion,
      context: {
        issueCode: 'UNKNOWN_CLEAR_MODE',
        received: applyTo,
        validValues: [...VALID_CLEAR_MODES],
        suggestion,
      },
    },
  );
}

export async function clearWithMode(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  applyTo: unknown = 'all',
): Promise<ClearResult> {
  const mode = validateClearApplyTo(applyTo);

  const n = normalizeRange(range);
  const promises: Promise<unknown>[] = [];

  if (mode === 'all') {
    // 'all' mode: full cell deletion (values + formulas + formats + hyperlinks).
    // clearRangeByPosition wipes cell properties (including format) along with values.
    promises.push(
      ctx.computeBridge.clearRangeByPosition(sheetId, n.startRow, n.startCol, n.endRow, n.endCol),
    );
  } else if (mode === 'contents') {
    // 'contents' mode: clear values + formulas, PRESERVE formats and cell identity.
    // Routes to the `clearRange` bridge (Rust `mutation_clear_range`), which uses
    // `clear_properties = false` so the cell's property entry (bold, number format,
    // etc.) survives the wipe. Do NOT use `clearRangeByPosition` here — it drops
    // properties unconditionally.
    promises.push(
      ctx.computeBridge.clearRange(sheetId, n.startRow, n.startCol, n.endRow, n.endCol),
    );
  }

  if (mode === 'all' || mode === 'formats') {
    promises.push(
      ctx.computeBridge.clearFormatForRanges(sheetId, [
        [n.startRow, n.startCol, n.endRow, n.endCol],
      ]),
    );
  }

  if (mode === 'all' || mode === 'hyperlinks') {
    // Single bridge call clears all hyperlinks in the range.
    promises.push(
      ctx.computeBridge.clearHyperlinksInRange(sheetId, n.startRow, n.startCol, n.endRow, n.endCol),
    );
  }

  await Promise.all(promises);

  const cellCount = (n.endRow - n.startRow + 1) * (n.endCol - n.startCol + 1);
  return { cellCount };
}

// =============================================================================
// Extended Range (Ctrl+Shift+Arrow)
// =============================================================================

/**
 * Get the extended range in a direction (OfficeJS Range.getExtendedRange).
 *
 * From the active cell, finds the data edge via findDataEdge, then extends
 * the original range to include the edge cell.
 */
export async function getExtendedRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  direction: 'up' | 'down' | 'left' | 'right',
  activeCell?: { row: number; col: number },
): Promise<CellRange> {
  const n = normalizeRange(range);
  const anchor = activeCell ?? { row: n.startRow, col: n.startCol };

  await ctx.awaitMaterialized?.(sheetId);
  const edge = await ctx.computeBridge.findDataEdge(sheetId, anchor.row, anchor.col, direction);

  // Extend the range to include the edge
  return {
    sheetId,
    startRow: Math.min(n.startRow, edge.row),
    startCol: Math.min(n.startCol, edge.col),
    endRow: Math.max(n.endRow, edge.row),
    endCol: Math.max(n.endCol, edge.col),
  };
}

// =============================================================================
// Display Text (bulk)
// =============================================================================

/**
 * Get formatted display text for an entire range as a 2D array.
 *
 * Delegates to Rust `get_display_text_2d` — a single bridge call that
 * iterates cells, formats values, and reshapes into a 2D array.
 */
export async function getDisplayText(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<string[][]> {
  const n = normalizeRange(range);
  return ctx.computeBridge.getDisplayText2d(sheetId, n.startRow, n.startCol, n.endRow, n.endCol);
}

// =============================================================================
// Value Types
// =============================================================================

/**
 * Get per-cell value type classification for a range.
 *
 * Delegates to Rust `get_value_types_2d` — a single bridge call that
 * classifies each cell value and returns a 2D string array.
 */
export async function getValueTypes(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<RangeValueType[][]> {
  const n = normalizeRange(range);
  const raw = await ctx.computeBridge.getValueTypes2d(
    sheetId,
    n.startRow,
    n.startCol,
    n.endRow,
    n.endCol,
  );
  return raw.map((row) =>
    row.map((v) => RangeValueType[v as keyof typeof RangeValueType] ?? RangeValueType.Empty),
  );
}

// =============================================================================
// Find in Range
// =============================================================================

/**
 * Find the first cell matching text within a range.
 *
 * Delegates to Rust `find_in_range` — a single IPC call that performs
 * literal text matching via the `regex` crate. No JS RegExp involved.
 */
export async function findInRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  text: string,
  options?: { caseSensitive?: boolean; wholeCell?: boolean; includeFormulas?: boolean },
): Promise<{ address: string; value: string } | null> {
  if (!text) return null;

  const n = normalizeRange(range);

  const result = await ctx.computeBridge.findInRange(
    sheetId,
    n.startRow,
    n.startCol,
    n.endRow,
    n.endCol,
    {
      text,
      caseSensitive: options?.caseSensitive ?? null,
      wholeCell: options?.wholeCell ?? null,
      includeFormulas: options?.includeFormulas ?? null,
    },
  );

  if (!result) return null;

  return {
    address: result.address,
    value: result.value,
  };
}

// =============================================================================
// Replace All
// =============================================================================

/**
 * Find and replace all occurrences within a range.
 *
 * Delegates to Rust `replace_all_in_range` — a single IPC call that finds
 * matching cells, applies replacements, and writes through the mutation
 * system for proper undo/redo support. No JS RegExp involved.
 *
 * @returns Number of replacements made
 */
export async function replaceAll(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  text: string,
  replacement: string,
  options?: { caseSensitive?: boolean; wholeCell?: boolean; includeFormulas?: boolean },
): Promise<number> {
  if (!text) return 0;

  const n = normalizeRange(range);

  const result = await ctx.computeBridge.replaceAllInRange(
    sheetId,
    n.startRow,
    n.startCol,
    n.endRow,
    n.endCol,
    text,
    replacement,
    {
      text,
      caseSensitive: options?.caseSensitive ?? null,
      wholeCell: options?.wholeCell ?? null,
      includeFormulas: options?.includeFormulas ?? null,
    },
  );

  // The replacement count is stored in MutationResult.data
  return (result.data as number) ?? 0;
}

// =============================================================================
// Number Format Categories
// =============================================================================

/**
 * Get per-cell number format category for a range.
 *
 * Delegates to Rust `get_format_categories_2d` — a single bridge call that
 * reads effective formats and classifies each cell's format code.
 */
export async function getNumberFormatCategories(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<NumberFormatCategory[][]> {
  const n = normalizeRange(range);
  const raw = await ctx.computeBridge.getFormatCategories2d(
    sheetId,
    n.startRow,
    n.startCol,
    n.endRow,
    n.endCol,
  );
  return raw.map((row) =>
    row.map(
      (v) =>
        NumberFormatCategory[v as keyof typeof NumberFormatCategory] ??
        NumberFormatCategory.General,
    ),
  );
}

// =============================================================================
// Entire Column / Entire Row checks
// =============================================================================

/**
 * Check if a CellRange represents entire column(s).
 * A full-column range has `isFullColumn` set, or spans from row 0 to the max row (1,048,575).
 */
export function isEntireColumn(range: CellRange): boolean {
  if (range.isFullColumn) return true;
  // Heuristic: if startRow is 0 and endRow is very large (>= 1M rows), treat as full column
  return range.startRow === 0 && range.endRow >= MAX_ROWS - 1;
}

/**
 * Check if a CellRange represents entire row(s).
 * A full-row range has `isFullRow` set, or spans from col 0 to the max col (16,383).
 */
export function isEntireRow(range: CellRange): boolean {
  if (range.isFullRow) return true;
  // Heuristic: if startCol is 0 and endCol is very large (>= 16K cols), treat as full row
  return range.startCol === 0 && range.endCol >= MAX_COLS - 1;
}

// =============================================================================
// Visible View (OfficeJS RangeView equivalent)
// =============================================================================

/**
 * Get only the visible (non-hidden) rows from a range.
 *
 * Composes `getHiddenRows()` (bulk bitmap) with `queryRange()`, then filters
 * out hidden rows. Returns cell values for visible rows along with their indices.
 */
export async function getVisibleView(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<VisibleRangeView> {
  const n = normalizeRange(range);

  // Fetch hidden rows bitmap and range data in parallel
  const [hiddenRows, rangeResult] = await Promise.all([
    ctx.computeBridge.getHiddenRows(sheetId).then((rows) => new Set(rows)),
    ctx.computeBridge.queryRange(sheetId, n.startRow, n.startCol, n.endRow, n.endCol),
  ]);

  // Build cell lookup map
  const cellMap = new Map<string, (typeof rangeResult.cells)[number]>();
  for (const cell of rangeResult.cells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  const values: CellValue[][] = [];
  const visibleRowIndices: number[] = [];

  for (let row = n.startRow; row <= n.endRow; row++) {
    if (hiddenRows.has(row)) continue;

    visibleRowIndices.push(row);
    const rowData: CellValue[] = [];
    for (let col = n.startCol; col <= n.endCol; col++) {
      const cell = cellMap.get(`${row},${col}`);
      rowData.push(cell ? normalizeCellValue(cell.value) : null);
    }
    values.push(rowData);
  }

  return { values, visibleRowIndices };
}

// =============================================================================
// Special Cells (OfficeJS Range.getSpecialCells equivalent)
// =============================================================================

/**
 * Find cells matching a special cell type within the used range.
 *
 * Dispatches to existing primitives (`findCells`, `getValueTypes`, etc.)
 * with typed enums matching OfficeJS SpecialCellType / SpecialCellValueType.
 */
export async function getSpecialCells(
  ctx: DocumentContext,
  sheetId: SheetId,
  cellType: CellType,
  valueType?: CellValueType,
): Promise<CellAddress[]> {
  const bounds = await ctx.computeBridge.getDataBounds(sheetId);
  if (!bounds) return [];

  switch (cellType) {
    case CellType.Blanks:
      return getSpecialCellsBlanks(ctx, sheetId, bounds);

    case CellType.Constants:
      return getSpecialCellsConstantsOrFormulas(ctx, sheetId, bounds, false, valueType);

    case CellType.Formulas:
      return getSpecialCellsConstantsOrFormulas(ctx, sheetId, bounds, true, valueType);

    case CellType.Visible:
      return getSpecialCellsVisible(ctx, sheetId, bounds);

    case CellType.ConditionalFormats:
      return getSpecialCellsConditionalFormats(ctx, sheetId, bounds);

    case CellType.DataValidations:
      return getSpecialCellsDataValidations(ctx, sheetId, bounds);

    default:
      throw new Error(`Unsupported CellType: ${cellType}`);
  }
}

/** Find blank (empty) cells in the used range. Capped at 100K cells to prevent OOM. */
async function getSpecialCellsBlanks(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { minRow: number; minCol: number; maxRow: number; maxCol: number },
): Promise<CellAddress[]> {
  const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
  if (cellCount > 100_000) {
    throw new Error(
      `getSpecialCells(Blanks): used range too large (${cellCount} cells, max 100000)`,
    );
  }

  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  // Build set of occupied cells using numeric keys for efficiency
  const occupied = new Set<number>();
  for (const cell of rangeResult.cells) {
    const val = normalizeCellValue(cell.value);
    if (val !== null && val !== undefined && val !== '') {
      occupied.add(cell.row * MAX_COLS + cell.col);
    }
  }

  // Everything in the used range that is NOT occupied is blank
  const results: CellAddress[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      if (!occupied.has(row * MAX_COLS + col)) {
        results.push({ sheetId, row, col });
      }
    }
  }
  return results;
}

/** Find cells with constants or formulas, optionally filtered by value type. */
async function getSpecialCellsConstantsOrFormulas(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { minRow: number; minCol: number; maxRow: number; maxCol: number },
  formulasOnly: boolean,
  valueType?: CellValueType,
): Promise<CellAddress[]> {
  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    bounds.minRow,
    bounds.minCol,
    bounds.maxRow,
    bounds.maxCol,
  );

  const results: CellAddress[] = [];
  for (const cell of rangeResult.cells) {
    const hasFormula = !!cell.formula;
    // Constants = has value, no formula; Formulas = has formula
    if (formulasOnly && !hasFormula) continue;
    if (!formulasOnly && hasFormula) continue;

    const val = normalizeCellValue(cell.value);
    if (val === null || val === undefined || val === '') continue;

    // Apply value type filter if specified
    if (valueType !== undefined) {
      if (!matchesValueType(val, valueType)) continue;
    }

    results.push({ sheetId, row: cell.row, col: cell.col });
  }
  return results;
}

/** Check if a cell value matches a CellValueType filter. */
function matchesValueType(value: CellValue, valueType: CellValueType): boolean {
  switch (valueType) {
    case CellValueType.Numbers:
      return typeof value === 'number';
    case CellValueType.Text:
      return typeof value === 'string' && !isErrorString(value);
    case CellValueType.Logicals:
      return typeof value === 'boolean';
    case CellValueType.Errors:
      return typeof value === 'string' && isErrorString(value);
    default:
      return false;
  }
}

/** Check if a string value represents a spreadsheet error. */
function isErrorString(value: string): boolean {
  return (
    value.startsWith('#') &&
    (value === '#DIV/0!' ||
      value === '#N/A' ||
      value === '#NAME?' ||
      value === '#NULL!' ||
      value === '#NUM!' ||
      value === '#REF!' ||
      value === '#VALUE!' ||
      value === '#GETTING_DATA!' ||
      value === '#SPILL!' ||
      value === '#CALC!' ||
      value === '#BLOCKED!' ||
      value === '#UNKNOWN!' ||
      value === '#FIELD!' ||
      value === '#CONNECT!')
  );
}

/** Find visible (non-hidden) cells in the used range. */
async function getSpecialCellsVisible(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { minRow: number; minCol: number; maxRow: number; maxCol: number },
): Promise<CellAddress[]> {
  const [hiddenRows, hiddenCols] = await Promise.all([
    ctx.computeBridge.getHiddenRows(sheetId).then((rows) => new Set(rows)),
    ctx.computeBridge.getHiddenColumns(sheetId).then((cols) => new Set(cols)),
  ]);

  const results: CellAddress[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    if (hiddenRows.has(row)) continue;
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      if (hiddenCols.has(col)) continue;
      results.push({ sheetId, row, col });
    }
  }
  return results;
}

/** Find cells that have conditional formatting rules applied. */
async function getSpecialCellsConditionalFormats(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { minRow: number; minCol: number; maxRow: number; maxCol: number },
): Promise<CellAddress[]> {
  // Get all CF rules for the sheet, then check which cells fall within CF ranges
  const cfRules = await ctx.computeBridge.getAllCfRules(sheetId);
  if (!cfRules || cfRules.length === 0) return [];

  // Collect all cells covered by CF ranges using numeric keys for efficiency
  const cfCells = new Set<number>();
  for (const rule of cfRules) {
    if (!rule.ranges) continue;
    for (const range of rule.ranges) {
      const nr = normalizeRange(range);
      for (
        let row = Math.max(nr.startRow, bounds.minRow);
        row <= Math.min(nr.endRow, bounds.maxRow);
        row++
      ) {
        for (
          let col = Math.max(nr.startCol, bounds.minCol);
          col <= Math.min(nr.endCol, bounds.maxCol);
          col++
        ) {
          cfCells.add(row * MAX_COLS + col);
        }
      }
    }
  }

  const results: CellAddress[] = [];
  for (const key of cfCells) {
    const row = Math.floor(key / MAX_COLS);
    const col = key % MAX_COLS;
    results.push({ sheetId, row, col });
  }
  // Sort by row, then col for consistent ordering
  results.sort((a, b) => a.row - b.row || a.col - b.col);
  return results;
}

/** Find cells that have data validation rules applied, clipped to used range bounds. */
async function getSpecialCellsDataValidations(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { minRow: number; minCol: number; maxRow: number; maxCol: number },
): Promise<CellAddress[]> {
  // Get all validation range schemas for the sheet using the bridge directly
  const schemas = await ctx.computeBridge.getRangeSchemasForSheet(sheetId);
  if (!schemas || schemas.length === 0) return [];

  // Collect all cells covered by validation ranges, clipped to used range bounds
  const dvCells = new Set<number>();
  for (const schema of schemas) {
    if (!schema.ranges) continue;
    for (const ref of schema.ranges) {
      const start = parseRefIdSimple(ref.startId);
      const end = parseRefIdSimple(ref.endId);
      if (!start || !end) continue;
      for (
        let row = Math.max(start.row, bounds.minRow);
        row <= Math.min(end.row, bounds.maxRow);
        row++
      ) {
        for (
          let col = Math.max(start.col, bounds.minCol);
          col <= Math.min(end.col, bounds.maxCol);
          col++
        ) {
          dvCells.add(row * MAX_COLS + col);
        }
      }
    }
  }

  const results: CellAddress[] = [];
  for (const key of dvCells) {
    const row = Math.floor(key / MAX_COLS);
    const col = key % MAX_COLS;
    results.push({ sheetId, row, col });
  }
  results.sort((a, b) => a.row - b.row || a.col - b.col);
  return results;
}
