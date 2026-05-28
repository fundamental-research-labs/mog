/**
 * WorkbookNames — Sub-API for named range operations.
 *
 * Provides namespaced access to named range CRUD and related operations.
 *
 * Usage: `workbook.names.add("Revenue", "Sheet1!A1:A10")` instead of
 *        `workbook.addNamedRange("Revenue", "Sheet1!A1:A10")`
 */
import type { NameAddReceipt, NameRemoveReceipt } from '../mutation-receipt';
import type {
  CellRange,
  CellValue,
  CreateNamesFromSelectionOptions,
  CreateNamesResult,
  NamedItemType,
  NamedRangeInfo,
  NamedRangeReference,
  NamedRangeUpdateOptions,
  RangeValueType,
  SheetId,
} from '../types';

export interface WorkbookNames {
  /**
   * Define a new named range.
   * @param name - The name to define.
   * @param reference - A1-style reference (e.g. "Sheet1!$A$1:$B$10"). May omit leading "=".
   * @param comment - Optional descriptive comment.
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   */
  add(name: string, reference: string, comment?: string, scope?: string): Promise<NameAddReceipt>;

  /**
   * Check if a named range exists.
   * @param name - The name to check.
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   * @returns True if the named range exists.
   */
  has(name: string, scope?: string): Promise<boolean>;

  /**
   * Get the total number of named ranges in the workbook.
   * @returns The count of named ranges.
   */
  getCount(): Promise<number>;

  /**
   * Get a named range by name.
   * @param name - The name to look up.
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   * @returns The named range info, or null if not found.
   */
  get(name: string, scope?: string): Promise<NamedRangeInfo | null>;

  /**
   * Get the parsed sheet reference for a named range.
   * Returns the sheet name and range portion for names that refer to a simple
   * sheet!range reference. Returns null if the name is not found or if the
   * reference is not a simple sheet!range format (e.g., a formula).
   * @param name - The name to look up.
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   * @returns The parsed reference, or null if not found or not a simple range.
   */
  getRange(name: string, scope?: string): Promise<NamedRangeReference | null>;

  /**
   * Remove a named range.
   * @param name - The name to remove.
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   */
  remove(name: string, scope?: string): Promise<NameRemoveReceipt>;

  /**
   * Update an existing named range.
   * @param name - The current name to update.
   * @param updates - Fields to change (name, reference, comment).
   * @param scope - Optional sheet name scope. Omit for workbook-scoped names.
   */
  update(name: string, updates: NamedRangeUpdateOptions, scope?: string): Promise<void>;

  /**
   * Remove all named ranges from the workbook.
   */
  clear(): Promise<void>;

  /**
   * List all named ranges in the workbook.
   * @returns Array of named range info objects.
   */
  list(): Promise<NamedRangeInfo[]>;

  /**
   * Create named ranges from row/column labels in a selection.
   * Scans edges of the selection for label text and creates names referring to
   * the corresponding data cells.
   * @param sheet - Sheet containing the selection (name or SheetId).
   * @param range - The cell range to scan for labels.
   * @param options - Which edges to scan (top, left, bottom, right).
   * @returns Counts of successfully created and skipped names.
   */
  createFromSelection(
    sheet: string | SheetId,
    range: CellRange,
    options: CreateNamesFromSelectionOptions,
  ): Promise<CreateNamesResult>;

  /**
   * Get the computed value of a named item as a display-formatted string.
   * For single-cell references, returns the formatted cell value.
   * For range references, returns the raw A1 reference string.
   * @param name - The named item to evaluate.
   * @param scope - Optional sheet name scope for resolution precedence.
   * @returns The display value, or null if the name doesn't exist.
   */
  getValue(name: string, scope?: string): Promise<string | null>;

  /**
   * Get the API type of a named item's resolved value.
   * @param name - The named item to inspect.
   * @param scope - Optional sheet name scope for resolution precedence.
   * @returns The type string, or null if the name doesn't exist.
   */
  getType(name: string, scope?: string): Promise<NamedItemType | null>;

  /**
   * Get the 2D array of resolved values for a named range.
   * For single-cell references, returns a 1×1 array.
   * For multi-cell ranges, returns the full grid.
   * @param name - The named item to evaluate.
   * @param scope - Optional sheet name scope for resolution precedence.
   * @returns The 2D value array, or null if the name doesn't exist or isn't a range.
   */
  getArrayValues(name: string, scope?: string): Promise<CellValue[][] | null>;

  /**
   * Get the 2D array of type classifications for each cell in a named range.
   * @param name - The named item to evaluate.
   * @param scope - Optional sheet name scope for resolution precedence.
   * @returns The 2D type array, or null if the name doesn't exist or isn't a range.
   */
  getArrayTypes(name: string, scope?: string): Promise<RangeValueType[][] | null>;

  /**
   * Get the raw typed value of a named item as a JSON-compatible value.
   * For single-cell references, returns the cell's typed value (string, number, boolean, null, or error).
   * For range references, returns the first cell's value.
   * For constants, returns the constant as a string.
   * @param name - The named item to evaluate.
   * @param scope - Optional sheet name scope for resolution precedence.
   * @returns The typed value, or null if the name doesn't exist.
   */
  getValueAsJson(name: string, scope?: string): Promise<CellValue | null>;

  /**
   * Recalculate all formulas that depend on a given named range.
   * Called after a name is created, updated, or deleted so that
   * dependent cells reflect the new definition (or show #NAME? errors).
   * @param name - The name that changed (case-insensitive).
   * @param sheetId - Current active sheet for relative reference resolution.
   * @param origin - Transaction origin (default: 'user').
   */
  recalculateDependents(name: string, sheetId: SheetId, origin?: string): void;
}
