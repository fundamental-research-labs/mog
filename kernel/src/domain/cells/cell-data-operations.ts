/**
 * Cell Data Operations Module
 *
 * User-facing data transformation operations for cells:
 * - Remove Duplicates: Remove duplicate rows based on column comparison
 * - Text to Columns: Split text values into multiple columns
 *
 * These are dialog-driven operations with preview capabilities.
 * Write operations delegate to ComputeBridge (Rust compute core).
 * Read operations are async, querying ComputeBridge.
 * MutationResultHandler handles event emission -- no manual event emission here.
 *
 */

import type { TextToColumnsOptions, TextToColumnsResult } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';

import type { DocumentContext } from '../../context/types';

export type { TextToColumnsOptions, TextToColumnsResult };

// =============================================================================
// Remove Duplicates Operation
// =============================================================================

/**
 * Options for the Remove Duplicates operation.
 */
export interface RemoveDuplicatesOptions {
  /** Whether the first row contains headers (should not be removed) */
  hasHeaders: boolean;
  /** Column indices to compare for duplicates (if empty, compare all columns) */
  columnsToCompare: number[];
  /** Whether comparison is case-sensitive */
  caseSensitive: boolean;
}

/**
 * Result of the Remove Duplicates operation.
 */
export interface RemoveDuplicatesResult {
  /** Number of duplicate rows found */
  duplicatesFound: number;
  /** Number of duplicate rows removed */
  duplicatesRemoved: number;
  /** Number of unique values remaining */
  uniqueValuesRemaining: number;
}

/**
 * Remove duplicate rows from a range based on selected columns.
 *
 * Delegates to ComputeBridge. Rust handles:
 * - Reading cell data for comparison
 * - Row compaction (moving non-duplicate rows up)
 * - Clearing remaining rows
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to check for duplicates
 * @param options - Operation options
 * @returns Result with statistics
 */
export async function removeDuplicates(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options: RemoveDuplicatesOptions,
): Promise<RemoveDuplicatesResult> {
  const { hasHeaders, columnsToCompare, caseSensitive: _caseSensitive } = options;
  const { startRow, endRow, startCol, endCol } = range;

  // Determine which columns to compare
  const columnsToCheck =
    columnsToCompare.length > 0
      ? columnsToCompare.filter((c) => c >= startCol && c <= endCol)
      : Array.from({ length: endCol - startCol + 1 }, (_, i) => startCol + i);

  if (columnsToCheck.length === 0) {
    return {
      duplicatesFound: 0,
      duplicatesRemoved: 0,
      uniqueValuesRemaining: endRow - startRow + 1,
    };
  }

  const result = await ctx.computeBridge.removeDuplicates(
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
    columnsToCheck,
    hasHeaders,
  );

  // Parse result from Rust — domain data is in MutationResult.data
  interface RemoveDuplicatesData {
    duplicates_removed?: number;
    unique_remaining?: number;
  }
  const data: RemoveDuplicatesData | undefined = result?.data as RemoveDuplicatesData | undefined;
  const duplicatesRemoved = data?.duplicates_removed ?? 0;
  const uniqueRemaining = data?.unique_remaining ?? endRow - startRow + 1 - (hasHeaders ? 1 : 0);

  return {
    duplicatesFound: duplicatesRemoved,
    duplicatesRemoved,
    uniqueValuesRemaining: uniqueRemaining,
  };
}

/**
 * Get column headers from the first row of a range.
 * Used by the dialog to display column names.
 *
 * Reads cell values from ComputeBridge via queryRange.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to get headers from
 * @returns Array of column headers
 */
export async function getColumnHeaders(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<Array<{ col: number; header: string }>> {
  const { startRow, startCol, endCol } = range;

  // Query just the header row
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    startRow,
    startCol,
    startRow,
    endCol,
  );

  const headers: Array<{ col: number; header: string }> = [];
  const cellMap = new Map<number, string>();

  // Build a map of col -> display value from the range data
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      const value = cell.value;
      let displayValue = '';
      if (typeof value === 'string') displayValue = value;
      else if (typeof value === 'number') displayValue = String(value);
      else if (typeof value === 'boolean') displayValue = String(value);
      if (cell.formatted) displayValue = cell.formatted;
      cellMap.set(cell.col, displayValue);
    }
  }

  for (let col = startCol; col <= endCol; col++) {
    const value = cellMap.get(col) ?? '';
    headers.push({
      col,
      header: value || `Column ${colToLetter(col)}`,
    });
  }

  return headers;
}

/**
 * Detect if the first row likely contains headers.
 * Simple heuristic: if first row is all text and other rows have numbers, likely headers.
 *
 * Reads cell values from ComputeBridge.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param range - Range to check
 * @returns true if headers detected
 */
export async function detectHeaders(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
): Promise<boolean> {
  const { startRow, endRow, startCol, endCol } = range;

  // If only one row, can't have headers
  if (startRow >= endRow) return false;

  // Query first two rows
  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    startRow,
    startCol,
    startRow + 1,
    endCol,
  );

  // Build a map of (row, col) -> value type
  const cellTypes = new Map<string, string>();
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      const v = cell.value;
      const valueType =
        typeof v === 'string'
          ? 'Text'
          : typeof v === 'number'
            ? 'Number'
            : typeof v === 'boolean'
              ? 'Boolean'
              : 'Null';
      cellTypes.set(`${cell.row},${cell.col}`, valueType);
    }
  }

  // Check if first row is all text
  let firstRowAllText = true;
  for (let col = startCol; col <= endCol; col++) {
    const cellType = cellTypes.get(`${startRow},${col}`) ?? 'Null';
    if (cellType === 'Number') {
      firstRowAllText = false;
      break;
    }
  }

  // Check if second row has any numbers
  let secondRowHasNumbers = false;
  for (let col = startCol; col <= endCol; col++) {
    const cellType = cellTypes.get(`${startRow + 1},${col}`) ?? 'Null';
    if (cellType === 'Number') {
      secondRowHasNumbers = true;
      break;
    }
  }

  return firstRowAllText && secondRowHasNumbers;
}

// =============================================================================
// Text to Columns
// =============================================================================

/**
 * Split text in a column into multiple columns.
 *
 * Delegates to ComputeBridge.textToColumns(). Rust handles:
 * - Reading source cell values
 * - Splitting by delimiters or fixed width
 * - Writing split values to destination
 * MutationResultHandler handles event emission.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param sourceRange - Single column range to split
 * @param options - Splitting options
 * @param destination - Starting cell for output
 * @returns Result with statistics
 */
export async function textToColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  sourceRange: CellRange,
  options: TextToColumnsOptions,
  destination: { row: number; col: number },
): Promise<TextToColumnsResult> {
  const { startRow, endRow, startCol } = sourceRange;

  const result = await ctx.computeBridge.textToColumns(
    sheetId,
    startRow,
    endRow,
    startCol,
    destination.row,
    destination.col,
    toBridgeTextToColumnsOptions(options),
  );

  const rowsProcessed = endRow - startRow + 1;
  const payload = result.data as { rowsProcessed?: number; columnsCreated?: number } | undefined;

  return {
    rowsProcessed: payload?.rowsProcessed ?? rowsProcessed,
    columnsCreated: payload?.columnsCreated ?? 1,
  };
}

/**
 * Preview text to columns split without applying changes.
 *
 * Reads source values from ComputeBridge and performs the split locally.
 * Does NOT write any changes.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param sourceRange - Source range
 * @param options - Splitting options
 * @param maxPreviewRows - Maximum rows to preview
 * @returns Preview of split values
 */
export async function previewTextToColumns(
  ctx: DocumentContext,
  sheetId: SheetId,
  sourceRange: CellRange,
  options: TextToColumnsOptions,
  maxPreviewRows: number = 5,
): Promise<string[][]> {
  const { startRow, endRow, startCol } = sourceRange;

  // Query source column values
  const rowCount = Math.min(endRow - startRow + 1, maxPreviewRows);
  const lastRow = startRow + rowCount - 1;

  const rangeData = await ctx.computeBridge.queryRange(
    sheetId,
    startRow,
    startCol,
    lastRow,
    startCol,
  );

  // Build value map
  const valueMap = new Map<number, string>();
  if (rangeData?.cells) {
    for (const cell of rangeData.cells) {
      const value = cell.value;
      let strValue = '';
      if (typeof value === 'string') strValue = value;
      else if (typeof value === 'number') strValue = String(value);
      else if (typeof value === 'boolean') strValue = String(value);
      valueMap.set(cell.row, strValue);
    }
  }

  // Collect values
  const sourceValues: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    sourceValues.push(valueMap.get(startRow + i) ?? '');
  }

  // Split each value
  if (options.type === 'fixedWidth') {
    return sourceValues.map((value) => splitByFixedWidth(value, options.fixedWidthBreaks ?? []));
  }

  const delimiterRegex = buildDelimiterRegex(
    resolveTextToColumnsDelimiters(options),
    options.treatConsecutiveAsOne ?? false,
  );
  const qualifier = options.textQualifier ?? 'none';

  return sourceValues.map((value) => splitByDelimiter(value, delimiterRegex, qualifier));
}

// =============================================================================
// Text to Columns Helpers (Private)
// =============================================================================

function buildDelimiterRegex(
  delimiters: NonNullable<TextToColumnsOptions['delimiters']>,
  treatConsecutiveAsOne: boolean,
): RegExp {
  const chars: string[] = [];

  if (delimiters.tab) chars.push('\\t');
  if (delimiters.semicolon) chars.push(';');
  if (delimiters.comma) chars.push(',');
  if (delimiters.space) chars.push(' ');
  if (delimiters.other) {
    const escaped = delimiters.other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    chars.push(escaped);
  }

  if (chars.length === 0) {
    chars.push(',');
  }

  const pattern = `[${chars.join('')}]${treatConsecutiveAsOne ? '+' : ''}`;
  return new RegExp(pattern, 'g');
}

function resolveTextToColumnsDelimiters(
  options: TextToColumnsOptions,
): NonNullable<TextToColumnsOptions['delimiters']> {
  if (options.delimiters) {
    return options.delimiters;
  }

  const delimiter = options.delimiter ?? 'comma';
  return {
    tab: delimiter === 'tab',
    semicolon: delimiter === 'semicolon',
    comma: delimiter === 'comma',
    space: delimiter === 'space',
    other: delimiter === 'custom' ? options.customDelimiter : undefined,
  };
}

function toBridgeTextToColumnsOptions(options: TextToColumnsOptions): Record<string, unknown> {
  let textQualifier: string;
  if (options.textQualifier === "'") {
    textQualifier = 'singleQuote';
  } else if (options.textQualifier === 'none') {
    textQualifier = 'none';
  } else {
    textQualifier = 'doubleQuote';
  }

  return {
    splitType: options.type === 'fixedWidth' ? 'fixedWidth' : 'delimited',
    delimiters: resolveTextToColumnsDelimiters(options),
    treatConsecutiveAsOne: options.treatConsecutiveAsOne ?? false,
    textQualifier,
    fixedWidthBreaks: options.fixedWidthBreaks ?? [],
  };
}

function splitByDelimiter(
  value: string,
  delimiterRegex: RegExp,
  textQualifier: '"' | "'" | 'none',
): string[] {
  if (!value) return [''];

  if (textQualifier === 'none') {
    return value.split(delimiterRegex);
  }

  const qualifier = textQualifier;
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < value.length) {
    const char = value[i];

    if (char === qualifier) {
      if (inQuotes) {
        if (i + 1 < value.length && value[i + 1] === qualifier) {
          current += qualifier;
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        inQuotes = true;
      }
      i++;
    } else if (!inQuotes && delimiterRegex.test(char)) {
      result.push(current);
      current = '';
      i++;
      delimiterRegex.lastIndex = 0;
    } else {
      current += char;
      i++;
    }
  }

  result.push(current);
  return result;
}

function splitByFixedWidth(value: string, breaks: number[]): string[] {
  if (!value || breaks.length === 0) return [value || ''];

  const result: string[] = [];
  const sortedBreaks = [...breaks].sort((a, b) => a - b);
  let lastPos = 0;

  for (const breakPos of sortedBreaks) {
    if (breakPos > lastPos && breakPos <= value.length) {
      result.push(value.substring(lastPos, breakPos).trim());
      lastPos = breakPos;
    }
  }

  if (lastPos < value.length) {
    result.push(value.substring(lastPos).trim());
  } else if (result.length === 0) {
    result.push(value);
  }

  return result;
}
