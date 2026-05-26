/**
 * WorksheetProtection — Sub-API Interface for Sheet Protection
 *
 * Methods for protecting/unprotecting sheets, querying protection state,
 * and checking whether specific operations are allowed under protection.
 */
import type { ProtectionConfig, ProtectionOptions } from '../types';

/** Valid operations for structural protection checks. */
export type ProtectionOperation =
  | 'insertRows'
  | 'insertColumns'
  | 'deleteRows'
  | 'deleteColumns'
  | 'formatCells'
  | 'formatRows'
  | 'formatColumns'
  | 'sort'
  | 'filter'
  | 'editObject';

/** A range that can be edited even when the sheet is protected. */
export interface AllowEditRange {
  /** Title/name of the editable range */
  title: string;
  /** Range address in A1 notation (e.g. "A1:C10") */
  address: string;
}

/** Collection of ranges that can be edited while the sheet is protected. */
export interface WorksheetAllowEditRanges {
  /**
   * Add a range that can be edited when the sheet is protected.
   *
   * @param title - Name for the editable range
   * @param address - Range address in A1 notation
   */
  add(title: string, address: string): Promise<void>;

  /**
   * Remove an allow-edit range by title.
   *
   * @param title - Title of the range to remove
   */
  remove(title: string): Promise<void>;

  /**
   * List all allow-edit ranges.
   *
   * @returns Array of allow-edit range definitions
   */
  list(): Promise<AllowEditRange[]>;
}

/** Sub-API for worksheet protection operations. */
export interface WorksheetProtection {
  /**
   * Check whether the sheet is currently protected.
   *
   * @returns True if the sheet is protected
   */
  isProtected(): Promise<boolean>;

  /**
   * Protect the sheet with an optional password.
   *
   * @param password - Optional password to require for unprotection
   */
  protect(password?: string): Promise<void>;

  /**
   * Protect the sheet with an optional password and granular permission options.
   *
   * @param password - Optional password to require for unprotection
   * @param options - Granular permissions (e.g., allowSort, allowFormatCells)
   */
  protectWithOptions(password?: string, options?: ProtectionOptions): Promise<void>;

  /**
   * Unprotect the sheet. Returns true if unprotection succeeded.
   *
   * @param password - Password if the sheet was protected with one
   * @returns True if the sheet was successfully unprotected
   */
  unprotect(password?: string): Promise<boolean>;

  /**
   * Check whether a specific cell can be edited under current protection.
   * Returns true if the sheet is unprotected or the cell is unlocked.
   *
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @returns True if the cell is editable
   */
  canEditCell(row: number, col: number): Promise<boolean>;

  /**
   * Synchronous protection fast path for edit-entry commands.
   *
   * Returns true only when the mirror proves the sheet is currently
   * unprotected. Returns 'unknown' for protected sheets, where callers must use
   * canEditCell(row, col) so cell lock state remains kernel-owned.
   */
  canEditCellFast(row: number, col: number): true | 'unknown';

  /**
   * Check whether a structural operation is allowed under current protection.
   *
   * @param operation - Operation name (e.g., 'sort', 'insertRows', 'deleteColumns')
   * @returns True if the operation is allowed
   */
  canDoStructureOp(operation: ProtectionOperation): Promise<boolean>;

  /**
   * Check whether sorting is allowed under current protection.
   * Convenience shorthand for `canDoStructureOp('sort')`.
   *
   * @returns True if sorting is allowed
   */
  canSort(): Promise<boolean>;

  /**
   * Get the full protection configuration for the sheet.
   *
   * @returns Protection configuration including status and permission flags
   */
  getConfig(): Promise<ProtectionConfig>;

  /**
   * Get the current selection mode when the sheet is protected.
   *
   * @returns 'normal' (all cells selectable), 'unlockedOnly' (only unlocked cells), or 'none' (no selection)
   */
  getSelectionMode(): Promise<'normal' | 'unlockedOnly' | 'none'>;

  /**
   * Set the selection mode for when the sheet is protected.
   * Only takes effect when the sheet is actually protected.
   *
   * @param mode - Selection mode
   */
  setSelectionMode(mode: 'normal' | 'unlockedOnly' | 'none'): Promise<void>;

  /**
   * Temporarily suspend sheet protection.
   * If the sheet is password-protected, the correct password must be provided.
   *
   * @param password - Password if the sheet is password-protected
   */
  pauseProtection(password?: string): Promise<void>;

  /**
   * Re-enable previously paused protection with the original configuration.
   */
  resumeProtection(): Promise<void>;

  /**
   * Whether protection can be paused (true if sheet is protected and not already paused).
   */
  readonly canPauseProtection: boolean;

  /**
   * Whether protection is currently paused.
   */
  readonly isPaused: boolean;

  /**
   * Check if the given password matches the current protection password
   * without modifying protection state.
   *
   * @param password - Password to check
   * @returns True if the password matches
   */
  checkPassword(password?: string): Promise<boolean>;

  /**
   * Change the protection password without needing to unprotect/re-protect.
   *
   * @param password - New password, or undefined/empty to remove the password
   */
  setPassword(password?: string): Promise<void>;

  /**
   * Update protection options without needing to unprotect/re-protect.
   *
   * @param options - Partial protection options to merge with existing options
   */
  updateOptions(options: Partial<ProtectionOptions>): Promise<void>;

  /**
   * Collection of ranges that can be edited even when the sheet is protected.
   */
  readonly allowEditRanges: WorksheetAllowEditRanges;
}
