/**
 * Paste Executor
 *
 * Single source of truth for all paste operations.
 * Pure transformation functions + main executor.
 *
 * Design:
 * - Pure functions for transformations (testable, no side effects)
 * - Dependency injection for store operations (decoupled)
 * - Batch writes for performance
 *
 */

import { toA1 } from '@mog-sdk/kernel';
import type {
  ClipboardCellData,
  ClipboardData,
  PasteSpecialOptions,
  RelativeComment,
  RelativeValidation,
} from '@mog-sdk/contracts/actors';
import { EXTERNAL_SOURCE_SHEET_ID } from '@mog-sdk/contracts/actors';
import type { CellId } from '@mog-sdk/contracts/cell-identity';
import {
  type CellFormat,
  type CellRange,
  type CellValue,
  type SheetId,
  sheetId as toSheetId,
} from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { RichText } from '@mog-sdk/contracts/rich-text';
import {
  applyConditionalFormatsFromClipboard,
  type CreateConditionalFormat,
} from './conditional-format-paste';
import { parseCellKey } from './clipboard-utils';
import { shouldResetNumberFormatBeforeExternalPaste } from './external-paste-format-reset';
import { isDenseCoreCopyUnsafeForSource } from './full-shape-ranges';
import {
  expandTablesForPastedValues,
  rangeFromPastedValueUpdates,
  type PasteTableInfo,
} from './paste-table-expansion';

// =============================================================================
// Constants
// =============================================================================

/**
 * Threshold for large paste operations.
 * Operations with more cells than this will report progress.
 */
export const LARGE_PASTE_THRESHOLD = 10000;

/**
 * Chunk size for async paste operations.
 * Cells are processed in chunks of this size to keep UI responsive.
 */
export const PASTE_CHUNK_SIZE = 1000;

/**
 * Minimum interval (ms) between progress callbacks.
 * Prevents excessive UI updates.
 */
export const PROGRESS_CALLBACK_INTERVAL_MS = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Progress callback for large paste operations.
 */
export interface PasteProgressCallback {
  (progress: PasteProgress): void;
}

/**
 * Progress information for paste operations.
 */
export interface PasteProgress {
  /** Number of cells processed so far */
  processed: number;
  /** Total number of cells to process */
  total: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Estimated time remaining in milliseconds (null if unknown) */
  estimatedTimeRemaining: number | null;
}

/**
 * Validation violation from paste operation.
 */
export interface PasteValidationViolation {
  row: number;
  col: number;
  value: CellValue;
  expectedType: string;
  enforcement: 'strict' | 'warn' | 'info';
}

/**
 * Result of a paste operation.
 */
export interface PasteResult {
  success: boolean;
  affectedRange: CellRange;
  cellCount: number;
  error?: string;
  /**
   * Validation violations found during paste.
   * Contains cells where pasted values don't match existing validation at target.
   */
  validationViolations?: PasteValidationViolation[];
}

/**
 * Merge position info returned by getMergesInRange.
 */
export interface MergePosition {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Store operations interface for dependency injection.
 * Decouples paste executor from SpreadsheetStore implementation.
 */
export interface PasteStoreOperations {
  setCellValues(
    sheetId: SheetId,
    updates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
  ): Promise<void> | void;
  /**
   * Copy a source range to a target position at the compute-core layer.
   * Routes values, formulas (with correct relative/absolute reference adjustment),
   * and formats through the engine in a single atomic transaction — which is why
   * internal in-document paste must prefer this over cell-by-cell setCellValues.
   *
   * Only the core value/formula/format payload is routed here. Comments,
   * hyperlinks, data validations, conditional formatting, merges, column widths,
   * and hidden-row skipping still layer on top in TS.
   */
  copyRange?(
    sourceSheetId: SheetId,
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
    copyType: 'all' | 'formulas' | 'values' | 'formats',
    skipBlanks: boolean,
    transpose: boolean,
  ): Promise<void>;
  setCellFormat(
    sheetId: SheetId,
    row: number,
    col: number,
    format: Partial<CellFormat>,
  ): Promise<void> | void;
  /**
   * Batch set cell formats. Groups updates by identical format to minimize IPC calls.
   * Falls back to per-cell setCellFormat if not implemented.
   */
  setCellFormatBatch?(
    sheetId: SheetId,
    updates: Array<{ row: number; col: number; format: Partial<CellFormat> }>,
  ): Promise<void> | void;
  getCellData(
    sheetId: SheetId,
    row: number,
    col: number,
  ): { raw: unknown; computed?: unknown; formula?: string } | undefined;
  /**
   * Get sheet name by ID (for Paste Link cross-sheet references).
   * Returns the sheet name for creating formula references like =Sheet1!A1.
   */
  getSheetName?(sheetId: SheetId): string | Promise<string>;
  /**
   * Create a merged region (
   * Called after pasting cells to recreate merges from clipboard.
   * Returns true if merge was created, false if blocked (overlap, invalid range).
   */
  mergeRange?(
    sheetId: SheetId,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): boolean;
  /**
   * Remove a merged region (
   * Called before pasting to clear existing merges at target.
   * Also called after cut-paste to remove merges from source.
   */
  unmergeRange?(
    sheetId: SheetId,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): void;
  /**
   * Get all merges that overlap with a range (
   * Used to find merges to unmerge before pasting.
   */
  getMergesInRange?(sheetId: SheetId, range: CellRange): MergePosition[];

  /**
   * Relocate cells from source to target (Cut-Paste Formula Update).
   * This is the architecturally correct implementation for cut-paste:
   * - CellIds are PRESERVED (stable identities)
   * - Only positions are updated
   * - Formulas referencing moved cells automatically work
   *
   * @param sourceSheetId - Source sheet ID
   * @param sourceRange - Source range to move
   * @param targetSheetId - Target sheet ID
   * @param targetRow - Target top-left row
   * @param targetCol - Target top-left column
   * @returns Result with success status and moved cell count
   */
  relocateCells?(
    sourceSheetId: SheetId,
    sourceRange: CellRange,
    targetSheetId: SheetId,
    targetRow: number,
    targetCol: number,
  ):
    | Promise<{ success: boolean; movedCount: number; error?: string }>
    | { success: boolean; movedCount: number; error?: string };
  /**
   * Get CellId at a given position.
   * Comments in Clipboard - needed to attach comments to pasted cells.
   */
  getCellIdAt?(sheetId: SheetId, row: number, col: number): CellId | null;
  /**
   * Get or create CellId at a given position.
   * Comments in Clipboard - creates cell if needed for comment attachment.
   */
  getOrCreateCellId?(sheetId: SheetId, row: number, col: number): CellId;
  /**
   * Add a comment to a cell.
   * Comments in Clipboard - applies pasted comments.
   *
   * @param sheetId - Sheet ID
   * @param cellId - CellId to attach comment to
   * @param content - Rich text content
   * @param author - Author name
   * @param options - Optional authorId
   */
  addComment?(
    sheetId: SheetId,
    row: number,
    col: number,
    content: RichText,
    author: string,
    options?: {
      authorId?: string;
      commentType?: 'note' | 'threadedComment';
      resolved?: boolean;
      threadId?: string | null;
      parentId?: string | null;
    },
  ): Promise<void> | void;
  /**
   * Check if a row is hidden (Hidden/Filtered Row Handling).
   * Used to skip hidden rows during paste operations.
   * Returns true if the row is hidden (by user hide or filter).
   */
  isRowHidden?(sheetId: SheetId, row: number): boolean;
  /**
   * Set a range schema (data validation) for a range. Mirrors the kernel's
   * RangeSchema shape so the clipboard pipeline doesn't have to round-trip
   * through the lossy ValidationRule conversion.
   *
   * @param sheetId - Sheet ID
   * @param range - The range to apply validation to
   * @param schema - The schema definition (type and constraints)
   * @param enforcement - Enforcement level ('none' | 'info' | 'warning' | 'strict')
   * @param ui - UI settings (dropdown, input message, error message)
   */
  setRangeSchema?(
    sheetId: SheetId,
    range: CellRange,
    schema: { type?: string; constraints?: Record<string, unknown> },
    enforcement: 'none' | 'info' | 'warning' | 'strict',
    ui?: {
      showDropdown?: boolean;
      inputMessage?: { title?: string; message?: string };
      errorMessage?: { title?: string; message?: string };
    },
  ): void;
  /**
   * Set a hyperlink on a cell.
   *
   * @param sheetId - Sheet ID
   * @param row - Row index
   * @param col - Column index
   * @param url - Hyperlink URL (or undefined to clear)
   */
  setHyperlink?(sheetId: SheetId, row: number, col: number, url: string | undefined): void;
  /**
   * Create a conditional formatting rule.
   *
   * @param sheetId - Sheet ID
   * @param ranges - Cell ranges the CF applies to
   * @param rules - The CF rule definitions (type, conditions, style, etc.)
   * @returns The created format ID, or undefined if creation failed
   */
  createConditionalFormat?: CreateConditionalFormat;
  /**
   * Get the validation schema at a specific cell position.
   *
   * @param sheetId - Sheet ID
   * @param row - Row index
   * @param col - Column index
   * @returns The validation schema if exists, undefined otherwise
   */
  getRangeSchema?(
    sheetId: SheetId,
    row: number,
    col: number,
  ):
    | {
        schema: { type: string; constraints?: Record<string, unknown> };
        enforcement?: { input?: 'strict' | 'warn' | 'info' };
      }
    | undefined;
  /**
   * Validate a value against a schema.
   *
   * @param value - The value to validate
   * @param schema - The schema to validate against
   * @returns true if valid, false if invalid
   */
  validateValue?(
    value: CellValue,
    schema: { type: string; constraints?: Record<string, unknown> },
  ): boolean;
  /**
   * Set column width.
   *
   * @param sheetId - Sheet ID
   * @param col - Column index
   * @param width - Width in pixels (or undefined for default)
   */
  setColumnWidth?(sheetId: SheetId, col: number, width: number | undefined): void;
  getTables?(sheetId: SheetId): Promise<PasteTableInfo[]> | PasteTableInfo[];
  resizeTable?(sheetId: SheetId, tableName: string, rangeA1: string): Promise<void> | void;
}

// =============================================================================
// Pure Transformation Functions
// =============================================================================

/**
 * Transpose clipboard data (swap rows and columns).
 *
 * @example
 * // 2x3 range becomes 3x2
 * // Before: (0,0), (0,1), (0,2), (1,0), (1,1), (1,2)
 * // After: (0,0), (0,1), (1,0), (1,1), (2,0), (2,1)
 */
export function transposeData(data: ClipboardData): ClipboardData {
  const newCells: Record<string, ClipboardCellData> = {};

  for (const [key, cellData] of Object.entries(data.cells)) {
    const { row, col } = parseCellKey(key);
    // Swap coordinates: (row, col) → (col, row)
    const newKey = `${col},${row}`;
    // Copy cell data (formula text stays as-is)
    newCells[newKey] = { ...cellData };
  }

  // Transpose source ranges
  const newSourceRanges = data.sourceRanges.map((range) => ({
    startRow: range.startCol,
    startCol: range.startRow,
    endRow: range.endCol,
    endCol: range.endRow,
  }));

  return {
    ...data,
    cells: newCells,
    sourceRanges: newSourceRanges,
  };
}

/**
 * Filter clipboard data by paste type.
 *
 * @param data - Source clipboard data
 * @param options - Which types to include (values, formulas, formats)
 * @returns Filtered clipboard data
 */
export function filterByPasteType(
  data: ClipboardData,
  options: PasteSpecialOptions,
): ClipboardData {
  const { values, formulas, formats } = options;

  // If no specific type selected, paste everything (default behavior)
  const pasteAll = !values && !formulas && !formats;
  if (pasteAll) {
    return data;
  }

  const newCells: Record<string, ClipboardCellData> = {};

  for (const [key, cellData] of Object.entries(data.cells)) {
    const filtered: ClipboardCellData = { raw: undefined };

    if (values) {
      // Values only: paste computed value, no formula, no format
      filtered.raw = cellData.raw;
    } else if (formulas) {
      // Formulas: paste formula (or value if no formula), no format
      filtered.raw = cellData.raw;
      filtered.formula = cellData.formula;
    } else if (formats) {
      // Formats only: paste format, no value, no formula
      filtered.format = cellData.format ? { ...(cellData.format as object) } : undefined;
    }

    // Only include if there's something to paste
    const hasContent =
      filtered.raw !== undefined ||
      filtered.formula !== undefined ||
      (filtered.format !== undefined &&
        filtered.format !== null &&
        Object.keys(filtered.format as object).length > 0);

    if (hasContent) {
      newCells[key] = filtered;
    }
  }

  return {
    ...data,
    cells: newCells,
  };
}

/**
 * Filter out blank cells from clipboard data.
 * A cell is blank if it has no value, no formula, and no format.
 */
export function filterBlanks(data: ClipboardData): ClipboardData {
  const newCells: Record<string, ClipboardCellData> = {};

  for (const [key, cellData] of Object.entries(data.cells)) {
    const hasValue = cellData.raw !== null && cellData.raw !== undefined && cellData.raw !== '';
    const hasFormula = cellData.formula !== undefined && cellData.formula !== '';
    const hasFormat =
      cellData.format !== undefined &&
      cellData.format !== null &&
      Object.keys(cellData.format as object).length > 0;

    if (hasValue || hasFormula || hasFormat) {
      newCells[key] = cellData;
    }
  }

  return {
    ...data,
    cells: newCells,
  };
}

/**
 * Apply arithmetic operation between source and target values.
 *
 * When target is non-numeric text, operation is skipped
 * and the original value is preserved (returns SKIP_OPERATION symbol).
 *
 * @param sourceValue - Value from clipboard
 * @param targetValue - Existing value at target cell
 * @param operation - Operation to apply
 * @returns Result value, error, or SKIP_OPERATION symbol
 */
export function applyArithmeticOperation(
  sourceValue: unknown,
  targetValue: unknown,
  operation: 'add' | 'subtract' | 'multiply' | 'divide',
): ArithmeticResult {
  // Skip operation if target is non-numeric text (Excel behavior)
  // When destination contains text, arithmetic paste preserves the original value
  if (!isNumericValue(targetValue)) {
    return SKIP_OPERATION;
  }

  const source = toNumber(sourceValue);
  const target = toNumber(targetValue);

  switch (operation) {
    case 'add':
      return source + target;
    case 'subtract':
      // Excel behavior: target - source (subtract source from existing)
      return target - source;
    case 'multiply':
      return source * target;
    case 'divide':
      if (source === 0) {
        return { type: 'error', value: 'Div0' };
      }
      // Excel behavior: target / source (divide existing by source)
      return target / source;
    default:
      return source;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert value to number, defaulting to 0 for non-numeric.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return 0;
}

/**
 * Check if a value can be converted to a number.
 * Used to determine if arithmetic operation should be skipped.
 *
 * Returns true for:
 * - Numbers
 * - Booleans (true=1, false=0)
 * - Strings that can be parsed as numbers
 * - null/undefined (treated as 0)
 *
 * Returns false for:
 * - Non-numeric strings (text)
 * - Objects (except cell errors which would have been handled earlier)
 */
function isNumericValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return true; // Empty string = 0
    return !isNaN(parseFloat(trimmed));
  }
  return false;
}

/**
 * Symbol to indicate that arithmetic operation should be skipped.
 * Used when destination is text and operation should preserve original.
 */
const SKIP_OPERATION = Symbol('SKIP_OPERATION');
type ArithmeticResult = CellValue | typeof SKIP_OPERATION;

/**
 * Check if value is a cell error.
 */
function isCellError(value: unknown): value is { type: 'error'; value: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as Record<string, unknown>).type === 'error'
  );
}

/**
 * Get dimensions of clipboard data.
 */
export function getClipboardDimensions(data: ClipboardData): { rows: number; cols: number } {
  let maxRow = 0;
  let maxCol = 0;

  const keys = Object.keys(data.cells);
  for (const key of keys) {
    const { row, col } = parseCellKey(key);
    maxRow = Math.max(maxRow, row);
    maxCol = Math.max(maxCol, col);
  }

  return {
    rows: keys.length > 0 ? maxRow + 1 : 0,
    cols: keys.length > 0 ? maxCol + 1 : 0,
  };
}

/**
 * Create a formula reference string for Paste Link.
 *
 * @param row - Absolute row of source cell
 * @param col - Absolute column of source cell
 * @param sourceSheetId - Source sheet ID
 * @param targetSheetId - Target sheet ID
 * @param getSheetName - Function to get sheet name from ID
 * @returns Formula reference string (e.g., "=A1" or "=Sheet2!A1")
 */
export async function createCellReference(
  row: number,
  col: number,
  sourceSheetId: SheetId,
  targetSheetId: SheetId,
  getSheetName?: (sheetId: SheetId) => string | Promise<string>,
): Promise<string> {
  const cellRef = toA1(row, col);

  // Same sheet: simple reference
  if (sourceSheetId === targetSheetId) {
    return `=${cellRef}`;
  }

  // Cross-sheet: need sheet name prefix
  const sheetName = (await getSheetName?.(sourceSheetId)) ?? sourceSheetId;
  // Quote sheet name if it contains spaces or special characters
  const needsQuotes = /[^A-Za-z0-9_]/.test(sheetName);
  const sheetRef = needsQuotes ? `'${sheetName}'` : sheetName;
  return `=${sheetRef}!${cellRef}`;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Apply validation rules from clipboard to target range.
 *
 * For each validation rule in the clipboard:
 * 1. Calculate the target range based on relative offsets
 * 2. Adjust for transpose if needed
 * 3. Apply the validation schema to the target range
 *
 * @param validations - Validation rules from clipboard
 * @param target - Target cell (top-left of paste range)
 * @param sheetId - Target sheet ID
 * @param store - Store operations for setting schemas
 * @param transpose - Whether data was transposed
 */
function applyValidationFromClipboard(
  validations: RelativeValidation[],
  target: CellCoord,
  sheetId: SheetId,
  store: PasteStoreOperations,
  transpose: boolean,
): void {
  if (!store.setRangeSchema) return;

  for (const validation of validations) {
    for (const relativeRange of validation.ranges) {
      let startRowOffset = relativeRange.startRowOffset;
      let startColOffset = relativeRange.startColOffset;
      let endRowOffset = relativeRange.endRowOffset;
      let endColOffset = relativeRange.endColOffset;

      if (transpose) {
        [startRowOffset, startColOffset] = [startColOffset, startRowOffset];
        [endRowOffset, endColOffset] = [endColOffset, endRowOffset];
      }

      const targetRange: CellRange = {
        startRow: target.row + startRowOffset,
        startCol: target.col + startColOffset,
        endRow: target.row + endRowOffset,
        endCol: target.col + endColOffset,
      };

      store.setRangeSchema(
        sheetId,
        targetRange,
        {
          type: validation.schema.type,
          constraints: validation.schema.constraints,
        },
        validation.enforcement,
        validation.ui,
      );
    }
  }
}

// =============================================================================
// Column Width Application
// =============================================================================

/**
 * Apply source column widths to target columns.
 *
 * @param sourceWidths - Array of source column widths (indexed by relative col)
 * @param target - Target cell (top-left of paste range)
 * @param sheetId - Target sheet ID
 * @param store - Store operations for setting column widths
 * @param numCols - Number of columns in the paste range
 */
function applyColumnWidths(
  sourceWidths: (number | undefined)[],
  target: CellCoord,
  sheetId: SheetId,
  store: PasteStoreOperations,
  numCols: number,
): void {
  if (!store.setColumnWidth) return;

  for (let relCol = 0; relCol < numCols; relCol++) {
    const width = sourceWidths[relCol];
    if (width !== undefined) {
      const targetCol = target.col + relCol;
      store.setColumnWidth(sheetId, targetCol, width);
    }
  }
}

// =============================================================================
// Paste Validation Checking
// =============================================================================

/**
 * Check pasted values against existing validation rules at target cells.
 *
 * This function checks each pasted value against any existing validation
 * schema at the target cell location. It returns a list of violations
 * for cells where the pasted value doesn't match the validation.
 *
 * Note: This does NOT block the paste - values are still written.
 * The violations are returned so the UI can show warnings or error indicators.
 *
 * @param valueUpdates - The values that were pasted
 * @param sheetId - Target sheet ID
 * @param store - Store operations for reading validation schemas
 * @returns Array of validation violations (empty if all values are valid)
 */
function checkPastedValuesAgainstValidation(
  valueUpdates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
  sheetId: SheetId,
  store: PasteStoreOperations,
): PasteValidationViolation[] {
  // If validation checking is not available, return empty array (no violations)
  if (!store.getRangeSchema || !store.validateValue) {
    return [];
  }

  const violations: PasteValidationViolation[] = [];

  for (const update of valueUpdates) {
    // Get the existing validation schema at the target cell
    const schemaInfo = store.getRangeSchema(sheetId, update.row, update.col);
    if (!schemaInfo) {
      // No validation at this cell - no violation possible
      continue;
    }

    // Validate the pasted value against the schema
    const isValid = store.validateValue(update.value, schemaInfo.schema);
    if (!isValid) {
      violations.push({
        row: update.row,
        col: update.col,
        value: update.value,
        expectedType: schemaInfo.schema.type,
        enforcement: schemaInfo.enforcement?.input ?? 'warn',
      });
    }
  }

  return violations;
}

function pasteWouldSkipHiddenTargetRows(
  sheetId: SheetId,
  targetRow: number,
  rowCount: number,
  store: PasteStoreOperations,
): boolean {
  if (!store.isRowHidden || rowCount <= 0) return false;
  for (let relRow = 0; relRow < rowCount; relRow++) {
    if (store.isRowHidden(sheetId, targetRow + relRow)) return true;
  }
  return false;
}

async function applyCellFormatUpdates(
  store: PasteStoreOperations,
  sheetId: SheetId,
  updates: Array<{ row: number; col: number; format: Partial<CellFormat> }>,
): Promise<void> {
  if (updates.length === 0) return;

  if (store.setCellFormatBatch) {
    await store.setCellFormatBatch(sheetId, updates);
    return;
  }

  for (const { row, col, format } of updates) {
    await store.setCellFormat(sheetId, row, col, format);
  }
}

// =============================================================================
// Main Executor
// =============================================================================

/**
 * Execute a paste operation with the given options.
 *
 * Flow:
 * 1. Apply transpose if requested
 * 2. Filter by paste type (values/formulas/formats)
 * 3. Skip blanks if requested
 * 4. Calculate affected range
 * 5. Unmerge existing merges at target (
 * 6. Apply arithmetic operations if any
 * 7. Batch write values and formats to store
 * 8. Recreate merges from clipboard at target (
 *
 * Note: Cut-paste source cleanup (unmerging at source) is handled by the
 * coordinator, not here. This function is pure and only affects the target.
 *
 * @param data - Clipboard data to paste
 * @param target - Target cell (top-left of paste range)
 * @param sheetId - Target sheet ID
 * @param options - Paste special options
 * @param store - Store operations for reading/writing
 * @returns Result of the paste operation
 */
export async function executePaste(
  data: ClipboardData,
  target: CellCoord,
  sheetId: SheetId,
  options: PasteSpecialOptions,
  store: PasteStoreOperations,
): Promise<PasteResult> {
  try {
    // Step 1: Apply transformations
    let processedData = data;

    if (options.transpose) {
      processedData = transposeData(processedData);
    }

    processedData = filterByPasteType(processedData, options);

    if (options.skipBlanks) {
      processedData = filterBlanks(processedData);
    }

    // Step 2: Prepare updates
    const { values: valuesOnly, formulas: formulasOnly, formats: formatsOnly, pasteLink } = options;
    const pasteAll = !valuesOnly && !formulasOnly && !formatsOnly && !pasteLink;
    const operation = options.operation ?? 'none';
    const isExternalSource = data.sourceSheetId === EXTERNAL_SOURCE_SHEET_ID;

    // Fast path: when the clipboard source is an internal in-document range,
    // route values/formulas/formats through compute-core's copy_range.
    // This is what produces correct relative/absolute/mixed reference adjustment
    // atomically in a single CRDT transaction. Secondary payloads (comments,
    // hyperlinks, validations, CF, merges, column widths) still layer on top
    // below.
    const isInternalSource =
      data.sourceSheetId !== EXTERNAL_SOURCE_SHEET_ID &&
      data.sourceSheetId !== '' &&
      data.sourceRanges.length === 1;
    const coreCopyType: 'all' | 'formulas' | 'values' | 'formats' | null = pasteAll
      ? 'all'
      : formulasOnly && !valuesOnly && !formatsOnly && !pasteLink
        ? 'formulas'
        : valuesOnly && !formulasOnly && !formatsOnly && !pasteLink
          ? 'values'
          : formatsOnly && !valuesOnly && !formulasOnly && !pasteLink
            ? 'formats'
            : null;
    const clipboardHasFormat = Object.values(data.cells).some(
      (c) => c.format && Object.keys(c.format as object).length > 0,
    );
    const clipboardHasFormula = Object.values(data.cells).some((c) => c.formula !== undefined);
    const clipboardHasValue = Object.values(data.cells).some(
      (c) => c.raw !== undefined && c.raw !== null,
    );
    //
    // A clipboard entry built by buildClipboardData includes cells that have
    // only format (raw/formula undefined) — cutting a source and re-copying
    // its now-empty cells leaves those format-only entries. Routing those
    // through copy_range in CopyType::All mode would write CellValue::Null
    // over the target's existing values (see range_operations.rs All case),
    // which the old TS path silently skipped because its valueUpdates list
    // excluded `raw === undefined` cells. Require at least one cell with
    // actual value/formula content to take the fast path.
    const clipboardHasCorePayload =
      coreCopyType === 'all'
        ? clipboardHasValue || clipboardHasFormula
        : coreCopyType === 'formats'
          ? clipboardHasFormat
          : coreCopyType === 'formulas'
            ? clipboardHasFormula
            : coreCopyType === 'values'
              ? clipboardHasValue || clipboardHasFormula
              : false;
    // Cross-sheet pastes DO use the core copy_range fast path. The engine
    // reads the source range from its own mirror (not the active-sheet
    // viewport), so a non-active source sheet is read correctly, blank source
    // positions clear the target atomically, and naked relative refs rebind to
    // the target sheet via build_cross_sheet_adjusted_formula — none of which
    // the TS cell-by-cell path (which writes captured formula strings
    // verbatim, without positional rebasing) can do. The earlier cross-sheet
    // no-op was NOT the engine read failing; it was a redundant TS blank-clear
    // pass that read the source through the active-only viewport (see the
    // copy_range call below).
    const dimensions = getClipboardDimensions(processedData);
    const hiddenRowsWouldChangeTargetMapping =
      options.skipHiddenRows === true &&
      pasteWouldSkipHiddenTargetRows(sheetId, target.row, dimensions.rows, store);
    const useCoreCopyRange =
      isInternalSource &&
      clipboardHasCorePayload &&
      !!store.copyRange &&
      coreCopyType !== null &&
      operation === 'none' &&
      !hiddenRowsWouldChangeTargetMapping &&
      !options.skipCells &&
      !isDenseCoreCopyUnsafeForSource(data.sourceRanges);

    const valueUpdates: Array<{
      row: number;
      col: number;
      value: string | number | boolean | null;
    }> = [];
    const preValueFormatUpdates: Array<{
      row: number;
      col: number;
      format: Partial<CellFormat>;
    }> = [];
    const formatUpdates: Array<{ row: number; col: number; format: Partial<CellFormat> }> = [];
    // Collect comments for pasting
    const commentUpdates: Array<{
      row: number;
      col: number;
      comments: RelativeComment[];
    }> = [];
    // Collect hyperlinks for pasting
    const hyperlinkUpdates: Array<{ row: number; col: number; url: string }> = [];

    // Get source range info for Paste Link (need to calculate absolute source positions)
    const sourceRange = processedData.sourceRanges[0];
    const sourceStartRow = sourceRange?.startRow ?? 0;
    const sourceStartCol = sourceRange?.startCol ?? 0;

    // Build a mapping from relative clipboard row index to actual target row
    // when skipHiddenRows is enabled. This allows pasting to skip hidden rows in the target.
    const skipHiddenRows = options.skipHiddenRows && store.isRowHidden;
    const relativeRowToTargetRow = new Map<number, number>();

    if (skipHiddenRows) {
      // Build mapping: for each relative row in clipboard, find the next visible target row
      let targetRowOffset = 0;
      for (let relRow = 0; relRow < dimensions.rows; relRow++) {
        // Find the next visible row in target starting from target.row + targetRowOffset
        while (store.isRowHidden!(sheetId, target.row + targetRowOffset)) {
          targetRowOffset++;
        }
        relativeRowToTargetRow.set(relRow, target.row + targetRowOffset);
        targetRowOffset++;
      }
    }

    // Get skipCells set for partial protection handling
    const skipCells = options.skipCells;

    // Step 3: Build update lists
    // Setup progress tracking for large pastes
    const cellEntries = Object.entries(processedData.cells);
    const totalCells = cellEntries.length;
    const isLargePaste = totalCells >= LARGE_PASTE_THRESHOLD;
    const onProgress = options.onProgress;
    const signal = options.signal;
    let processedCount = 0;
    let lastProgressTime = 0;
    const startTime = isLargePaste ? Date.now() : 0;

    for (const [key, cellData] of cellEntries) {
      // Check for cancellation
      if (signal?.aborted) {
        return {
          success: false,
          affectedRange: {
            startRow: target.row,
            startCol: target.col,
            endRow: target.row,
            endCol: target.col,
          },
          cellCount: processedCount,
          error: 'Paste operation cancelled',
        };
      }

      const { row: relRow, col: relCol } = parseCellKey(key);

      // Use the row mapping when skipHiddenRows is enabled
      const targetRow = skipHiddenRows
        ? (relativeRowToTargetRow.get(relRow) ?? target.row + relRow)
        : target.row + relRow;
      const targetCol = target.col + relCol;

      // Report progress for large pastes
      processedCount++;
      if (isLargePaste && onProgress) {
        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_CALLBACK_INTERVAL_MS) {
          const percent = Math.round((processedCount / totalCells) * 100);
          const elapsed = now - startTime;
          const estimatedTotal = (elapsed / processedCount) * totalCells;
          const estimatedRemaining = Math.round(estimatedTotal - elapsed);
          onProgress({
            processed: processedCount,
            total: totalCells,
            percent,
            estimatedTimeRemaining: estimatedRemaining > 0 ? estimatedRemaining : null,
          });
          lastProgressTime = now;
        }
      }

      // Skip protected cells during paste
      if (skipCells && skipCells.has(`${targetRow},${targetCol}`)) {
        continue;
      }

      // Handle Paste Link: create formula references to source cells
      if (pasteLink) {
        // Calculate absolute source position
        // For transposed data, we need to swap back to get original positions
        let sourceRow: number;
        let sourceCol: number;
        if (options.transpose) {
          // Transpose swaps row/col, so swap back to get original
          sourceRow = sourceStartRow + relCol;
          sourceCol = sourceStartCol + relRow;
        } else {
          sourceRow = sourceStartRow + relRow;
          sourceCol = sourceStartCol + relCol;
        }

        const formula = await createCellReference(
          sourceRow,
          sourceCol,
          toSheetId(processedData.sourceSheetId),
          sheetId,
          store.getSheetName,
        );
        valueUpdates.push({ row: targetRow, col: targetCol, value: formula });
        continue;
      }

      // Handle arithmetic operations
      if (operation !== 'none' && cellData.raw !== undefined) {
        const existingData = store.getCellData(sheetId, targetRow, targetCol);
        const existingValue =
          existingData?.formula !== undefined ? existingData.computed : (existingData?.raw ?? 0);
        const result = applyArithmeticOperation(cellData.raw, existingValue, operation);

        // If target is non-numeric text, skip this cell (preserve original)
        if (result === SKIP_OPERATION) {
          continue;
        }

        const valueStr = isCellError(result) ? result.value : String(result);
        valueUpdates.push({ row: targetRow, col: targetCol, value: valueStr });
        continue;
      }

      // Handle value/formula paste
      // Skipped for the core copy_range fast path (engine owns the write).
      if (!useCoreCopyRange && (pasteAll || valuesOnly || formulasOnly)) {
        let didPasteRawValue = false;
        let pastedRawValue: unknown;
        if (cellData.formula && !valuesOnly) {
          // Paste formula
          const formulaStr = cellData.formula;
          valueUpdates.push({ row: targetRow, col: targetCol, value: formulaStr });
        } else if (cellData.raw !== undefined) {
          // Paste value
          const rawValue = cellData.raw;
          if (rawValue === null) {
            valueUpdates.push({ row: targetRow, col: targetCol, value: null });
          } else if (isCellError(rawValue)) {
            valueUpdates.push({ row: targetRow, col: targetCol, value: rawValue.value });
          } else {
            valueUpdates.push({
              row: targetRow,
              col: targetCol,
              value: rawValue as string | number | boolean,
            });
          }
          didPasteRawValue = true;
          pastedRawValue = rawValue;
        }

        if (
          didPasteRawValue &&
          isExternalSource &&
          pasteAll &&
          !cellData.format &&
          shouldResetNumberFormatBeforeExternalPaste(pastedRawValue)
        ) {
          preValueFormatUpdates.push({
            row: targetRow,
            col: targetCol,
            format: { numberFormat: 'General' },
          });
        }
      }

      // Handle format paste (not applicable for Paste Link)
      // Skipped for the core copy_range fast path (engine owns the write).
      if (!useCoreCopyRange && (pasteAll || formatsOnly) && cellData.format) {
        formatUpdates.push({
          row: targetRow,
          col: targetCol,
          format: cellData.format as Partial<CellFormat>,
        });
      }

      // Handle comment paste
      // Comments are pasted when:
      // - pasteAll is true (no specific type selected) AND comments option is not explicitly false
      // - OR comments option is explicitly true (Paste Special -> Comments)
      const shouldPasteComments =
        (pasteAll && options.comments !== false) || options.comments === true;
      if (shouldPasteComments && cellData.comments && cellData.comments.length > 0) {
        commentUpdates.push({ row: targetRow, col: targetCol, comments: cellData.comments });
      }

      // Handle hyperlink paste
      // Hyperlinks are pasted when:
      // - pasteAll is true (no specific type selected)
      // - NOT when pasting only values, formulas, or formats
      if (pasteAll && cellData.hyperlink) {
        hyperlinkUpdates.push({ row: targetRow, col: targetCol, url: cellData.hyperlink });
      }
    }

    // Step 4: Calculate affected range (needed for merge operations)
    // When skipHiddenRows is enabled, use the actual target rows from the mapping
    let affectedEndRow = target.row + Math.max(0, dimensions.rows - 1);
    if (skipHiddenRows && dimensions.rows > 0) {
      // The last actual target row is the last value in our row mapping
      const lastTargetRow = relativeRowToTargetRow.get(dimensions.rows - 1);
      if (lastTargetRow !== undefined) {
        affectedEndRow = lastTargetRow;
      }
    }
    const affectedRange: CellRange = {
      startRow: target.row,
      startCol: target.col,
      endRow: affectedEndRow,
      endCol: target.col + Math.max(0, dimensions.cols - 1),
    };

    // Step 5: Unmerge existing merges at target before pasting
    // This ensures we don't create overlapping merges
    if (store.getMergesInRange && store.unmergeRange) {
      const existingMerges = store.getMergesInRange(sheetId, affectedRange);
      for (const merge of existingMerges) {
        store.unmergeRange(sheetId, merge.startRow, merge.startCol, merge.endRow, merge.endCol);
      }
    }

    // Step 6: Batch write to store.
    // For the core copy_range fast path, the engine writes values/formulas/formats
    // atomically — it also adjusts formula references, which the TS cell-by-cell
    // synthesis above cannot do. Secondary payloads (comments, hyperlinks, etc.)
    // still go through TS below.
    if (!useCoreCopyRange && preValueFormatUpdates.length > 0) {
      await applyCellFormatUpdates(store, sheetId, preValueFormatUpdates);
    }

    if (useCoreCopyRange && store.copyRange) {
      // copy_range owns the full-rectangle write atomically — including
      // clearing target cells whose source position is blank. For All /
      // Values / Formulas (skip_blanks=false) the engine pushes
      // CellValue::Null for every blank source position, so pre-existing
      // target content is overwritten in the same CRDT transaction (see
      // range_operations/copy.rs and the test_copy_range_skip_blanks
      // assertion that a blank source clears the target).
      //
      // Do NOT layer a second TS blank-clear pass on top. It would be
      // redundant with the engine, non-atomic (a separate setCellValues
      // mutation + IPC round-trip), and — critically — wrong for cross-sheet
      // paste: the source read is viewport-scoped to the *active* sheet, so
      // when the source sheet isn't active every source cell reads as blank
      // and the clears wipe the values copy_range just wrote.
      await store.copyRange(
        toSheetId(data.sourceSheetId),
        data.sourceRanges[0],
        sheetId,
        target.row,
        target.col,
        coreCopyType ?? 'all',
        options.skipBlanks ?? false,
        options.transpose ?? false,
      );
    } else if (valueUpdates.length > 0) {
      await store.setCellValues(sheetId, valueUpdates);
    }

    if (!useCoreCopyRange && formatUpdates.length > 0) {
      await applyCellFormatUpdates(store, sheetId, formatUpdates);
    }

    await expandTablesForPastedValues(
      store,
      sheetId,
      useCoreCopyRange && coreCopyType !== 'formats'
        ? affectedRange
        : rangeFromPastedValueUpdates(valueUpdates),
    );

    // Step 7: Recreate merges from clipboard
    // Only when pasting all (not values/formulas/formats only)
    if (pasteAll && processedData.merges && store.mergeRange) {
      for (const merge of processedData.merges) {
        // Adjust merge positions based on transpose
        let startRowOffset = merge.startRowOffset;
        let startColOffset = merge.startColOffset;
        let endRowOffset = merge.endRowOffset;
        let endColOffset = merge.endColOffset;

        if (options.transpose) {
          // Swap row/col for transposed data
          [startRowOffset, startColOffset] = [startColOffset, startRowOffset];
          [endRowOffset, endColOffset] = [endColOffset, endRowOffset];
        }

        const mergeStartRow = target.row + startRowOffset;
        const mergeStartCol = target.col + startColOffset;
        const mergeEndRow = target.row + endRowOffset;
        const mergeEndCol = target.col + endColOffset;

        // Create the merge (ignoring failures due to overlaps)
        store.mergeRange(sheetId, mergeStartRow, mergeStartCol, mergeEndRow, mergeEndCol);
      }
    }

    // Step 7.5: Apply comments from clipboard
    // Comments are applied after values so the cells exist for comment attachment
    if (commentUpdates.length > 0 && store.addComment) {
      for (const { row, col, comments } of commentUpdates) {
        // Add each comment
        for (const comment of comments) {
          // Convert plain text content to RichText format
          const richTextContent: RichText = [{ text: comment.content }];
          await store.addComment(sheetId, row, col, richTextContent, comment.author, {
            authorId: comment.authorId,
            commentType: comment.commentType,
            resolved: comment.resolved,
            threadId: comment.threadId,
            parentId: comment.parentId,
          });
        }
      }
    }

    // Step 7.6: Apply validation from clipboard
    // Validation is applied when:
    // - pasteAll is true (no specific type selected) AND validation option is not explicitly false
    // - OR validation option is explicitly true (Paste Special -> Validation)
    const shouldPasteValidation =
      (pasteAll && options.validation !== false) || options.validation === true;
    if (
      shouldPasteValidation &&
      processedData.validation &&
      processedData.validation.length > 0 &&
      store.setRangeSchema
    ) {
      applyValidationFromClipboard(
        processedData.validation,
        target,
        sheetId,
        store,
        options.transpose ?? false,
      );
    }

    // Step 7.7: Apply hyperlinks from clipboard
    // Hyperlinks are applied after values so the cells exist
    if (hyperlinkUpdates.length > 0 && store.setHyperlink) {
      for (const { row, col, url } of hyperlinkUpdates) {
        store.setHyperlink(sheetId, row, col, url);
      }
    }

    // Step 7.8: Apply conditional formatting from clipboard
    // CF is applied when:
    // - pasteAll is true (no specific type selected) AND cf option is not explicitly false
    // - OR conditionalFormatting option is explicitly true (Paste Special -> Conditional Formatting)
    const shouldPasteCF =
      (pasteAll && options.conditionalFormatting !== false) ||
      options.conditionalFormatting === true;
    if (
      shouldPasteCF &&
      processedData.conditionalFormatting &&
      processedData.conditionalFormatting.length > 0 &&
      store.createConditionalFormat
    ) {
      await applyConditionalFormatsFromClipboard(
        processedData.conditionalFormatting,
        target,
        sheetId,
        store.createConditionalFormat,
        options.transpose ?? false,
      );
    }

    // Step 7.9: Apply source column widths
    // Column widths are applied when:
    // - columnWidths option is explicitly true (from Paste Special menu)
    // - AND source column widths are available in clipboard data
    if (
      options.columnWidths === true &&
      processedData.sourceColumnWidths &&
      processedData.sourceColumnWidths.length > 0 &&
      store.setColumnWidth
    ) {
      applyColumnWidths(processedData.sourceColumnWidths, target, sheetId, store, dimensions.cols);
    }

    // Step 7.10: Check pasted values against existing validation
    // This step validates values AFTER they are pasted, checking against
    // existing validation rules at the target cells.
    const validationViolations = checkPastedValuesAgainstValidation(valueUpdates, sheetId, store);

    // Step 8: Calculate result
    // When using the core copy_range fast path, the cell count is derived from
    // the target geometry (engine doesn't return a per-cell list).
    const cellCount = useCoreCopyRange
      ? Math.max(0, affectedEndRow - target.row + 1) *
        Math.max(0, affectedRange.endCol - affectedRange.startCol + 1)
      : valueUpdates.length + (formatsOnly ? formatUpdates.length : 0);

    // Note: Cut-paste source merge cleanup (unmerging at source after cut-paste)
    // is handled at the coordinator level, not here. The paste-executor is a pure
    // function that operates on the target only. See coordinator/clipboard-coordination.ts

    return {
      success: true,
      affectedRange,
      cellCount,
      validationViolations: validationViolations.length > 0 ? validationViolations : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown paste error';
    return {
      success: false,
      affectedRange: {
        startRow: target.row,
        startCol: target.col,
        endRow: target.row,
        endCol: target.col,
      },
      cellCount: 0,
      error: errorMessage,
    };
  }
}

/**
 * Create default paste options (paste all, no transformations).
 *
 * Hidden/Filtered Row Handling
 * - skipHiddenRows is true by default to match Excel behavior
 * - When pasting into filtered data, paste only to visible rows
 */
export function createDefaultPasteOptions(): PasteSpecialOptions {
  return {
    values: false,
    formulas: false,
    formats: false,
    transpose: false,
    operation: 'none',
    skipBlanks: false,
    pasteLink: false,
    skipHiddenRows: true, // Excel behavior - paste only to visible rows
  };
}
