/**
 * WorksheetValidation — Sub-API for data validation operations.
 *
 * Provides methods to set, get, remove, and query data validation rules
 * on a worksheet. Supports both A1-style string and numeric (row, col)
 * addressing.
 */
import type { ValidationSetReceipt } from '../mutation-receipt';
import type { CellRange } from '../types';
import type { ValidationRule } from '../types';

/**
 * Result of validating a single cell value against the rules covering it.
 *
 * Uses the public `errorStyle` vocabulary ("stop" | "warning" | "information")
 * rather than the internal `enforcement` vocabulary. "none" indicates that no
 * validation rule covers the cell (the value is trivially valid).
 */
export interface ValidationCheckResult {
  /** Whether the value satisfies the covering rule. */
  valid: boolean;
  /** Error message (only meaningful when `valid` is false). */
  errorMessage?: string;
  /** Error title for dialog display (only meaningful when `valid` is false). */
  errorTitle?: string;
  /**
   * Error style from the covering rule. "none" means no rule covers the cell,
   * in which case the result is trivially valid.
   */
  errorStyle: 'stop' | 'warning' | 'information' | 'none';
}

export interface DropdownItemsWithRevision {
  items: string[];
  dataRevision: string | number;
}

/** Sub-API for data validation operations on a worksheet. */
export interface WorksheetValidation {
  /**
   * Set a validation rule on a cell or range.
   *
   * @param address - A1-style cell or range address (e.g. "A1", "A1:B5")
   * @param rule - Validation rule to apply
   */
  set(address: string, rule: ValidationRule): Promise<ValidationSetReceipt>;
  /**
   * Set a validation rule on a range.
   *
   * @param range - CellRange object defining the target range
   * @param rule - Validation rule to apply
   */
  set(range: CellRange, rule: ValidationRule): Promise<ValidationSetReceipt>;
  /**
   * Set a validation rule on a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param rule - Validation rule to apply
   */
  set(row: number, col: number, rule: ValidationRule): Promise<ValidationSetReceipt>;

  /**
   * Remove validation from a cell (deletes any range schema covering the cell).
   *
   * @param address - A1-style cell address
   */
  remove(address: string): Promise<void>;
  /**
   * Remove validation from a range (deletes any range schema overlapping the range).
   *
   * @param range - CellRange object defining the target range
   */
  remove(range: CellRange): Promise<void>;
  /**
   * Remove validation from a cell (deletes any range schema covering the cell).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   */
  remove(row: number, col: number): Promise<void>;

  /**
   * Get the validation rule for a cell.
   *
   * @param address - A1-style cell address
   * @returns The validation rule, or null if none
   */
  get(address: string): Promise<ValidationRule | null>;
  /**
   * Get the validation rule covering a range.
   *
   * @param range - CellRange object defining the target range
   * @returns The validation rule, or null if none
   */
  get(range: CellRange): Promise<ValidationRule | null>;
  /**
   * Get the validation rule for a cell.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns The validation rule, or null if none
   */
  get(row: number, col: number): Promise<ValidationRule | null>;

  /**
   * Synchronously read a validation rule when this sheet's validation cache is
   * already hydrated.
   *
   * Returns `undefined` when the sheet cache is cold, `null` when it is warm and
   * no rule covers the cell, or the covering rule when one exists.
   */
  peek(address: string): ValidationRule | null | undefined;
  /**
   * Synchronously read a validation rule when this sheet's validation cache is
   * already hydrated.
   *
   * Returns `undefined` when the sheet cache is cold, `null` when it is warm and
   * no rule covers the cell, or the covering rule when one exists.
   */
  peek(row: number, col: number): ValidationRule | null | undefined;

  /**
   * Check if a cell has a validation rule.
   *
   * @param address - A1-style cell address
   * @returns True if the cell has a validation rule
   */
  has(address: string): Promise<boolean>;
  /**
   * Check if a cell has a validation rule.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell has a validation rule
   */
  has(row: number, col: number): Promise<boolean>;

  /**
   * Get the total number of validation rules on this sheet.
   *
   * @returns The count of validation rules
   */
  getCount(): Promise<number>;

  /**
   * Get dropdown items for a cell with list validation.
   *
   * @param address - A1-style cell address
   * @returns Array of dropdown item strings
   */
  getDropdownItems(address: string): Promise<string[]>;
  /**
   * Get dropdown items for a cell with list validation.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns Array of dropdown item strings
   */
  getDropdownItems(row: number, col: number): Promise<string[]>;

  /**
   * Get dropdown items with a revision token for the source data used to
   * produce them. The token changes when the resolved item set changes.
   */
  getDropdownItemsWithRevision(address: string): Promise<DropdownItemsWithRevision>;
  /**
   * Get dropdown items with a revision token for the source data used to
   * produce them. The token changes when the resolved item set changes.
   */
  getDropdownItemsWithRevision(row: number, col: number): Promise<DropdownItemsWithRevision>;

  /**
   * List all validation rules on the sheet.
   *
   * @returns Array of validation rules
   */
  list(): Promise<ValidationRule[]>;

  /**
   * Clear all validation rules from the sheet.
   * When called with a range argument, clears only rules overlapping that range
   * (deprecated — use {@link clearInRange} for range-scoped clearing).
   *
   * @param range - (Optional) A1-style range string. If omitted, removes ALL rules.
   */
  clear(range?: string): Promise<void>;

  /**
   * Clear validation rules that overlap a range.
   *
   * @param range - A1-style range string (e.g. "A1:B5") or CellRange object
   */
  clearInRange(range: string | CellRange): Promise<void>;

  /**
   * Remove a validation rule by its ID.
   *
   * @param id - Validation rule / range schema ID
   */
  removeById(id: string): Promise<void>;

  /**
   * Validate a candidate value for a cell against the rule covering it.
   *
   * Stateless — does not mutate any cell. Delegates to the compute layer,
   * which evaluates the covering schema (including `allowBlank`, type checks,
   * and range/list constraints).
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param value - Candidate value (stringified — same form committed by the editor)
   * @returns Validation result. `errorStyle` is "none" when no rule covers the cell.
   */
  validate(row: number, col: number, value: string): Promise<ValidationCheckResult>;
  /**
   * Validate a candidate value for a cell against the rule covering it.
   *
   * @param address - A1-style cell address
   * @param value - Candidate value (stringified)
   */
  validate(address: string, value: string): Promise<ValidationCheckResult>;

  /**
   * Get cells with validation errors in a range.
   *
   * @param startRow - Start row (0-based)
   * @param startCol - Start column (0-based)
   * @param endRow - End row (0-based)
   * @param endCol - End column (0-based)
   * @returns Array of {row, col} for cells with errors
   */
  getErrorsInRange(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<{ row: number; col: number }>>;
}
