/**
 * WorksheetNames — Sub-API for sheet-scoped named ranges.
 *
 * Convenience wrapper that delegates to the workbook-level names API
 * with the scope pre-filled to the current sheet.
 */
import type { NamedRangeInfo, NamedRangeReference, NamedRangeUpdateOptions } from '../types';

/** Sub-API for sheet-scoped named range operations. */
export interface WorksheetNames {
  /**
   * Add a named range scoped to this sheet.
   *
   * @param name - Name for the range
   * @param reference - Cell reference (e.g., "A1:B10" or "=Sheet1!A1:B10")
   * @param comment - Optional comment
   * @returns The created named range info
   */
  add(name: string, reference: string, comment?: string): Promise<NamedRangeInfo>;

  /**
   * Check if a named range exists in this sheet's scope.
   *
   * @param name - Name to check
   * @returns True if the named range exists
   */
  has(name: string): Promise<boolean>;

  /**
   * Get the total number of named ranges scoped to this sheet.
   *
   * @returns The count of named ranges
   */
  getCount(): Promise<number>;

  /**
   * Get a named range by name, scoped to this sheet.
   *
   * @param name - Name to look up
   * @returns Named range info or null if not found
   */
  get(name: string): Promise<NamedRangeInfo | null>;

  /**
   * Get the range reference for a named range scoped to this sheet.
   *
   * @param name - Name to look up
   * @returns Range reference or null if not found
   */
  getRange(name: string): Promise<NamedRangeReference | null>;

  /**
   * Remove a named range scoped to this sheet.
   *
   * @param name - Name to remove
   */
  remove(name: string): Promise<void>;

  /**
   * Update a named range scoped to this sheet.
   *
   * @param name - Name of the range to update
   * @param updates - Fields to update
   */
  update(name: string, updates: NamedRangeUpdateOptions): Promise<void>;

  /**
   * Remove all named ranges scoped to this sheet.
   */
  clear(): Promise<void>;

  /**
   * List all named ranges scoped to this sheet.
   *
   * @returns Array of named range info objects
   */
  list(): Promise<NamedRangeInfo[]>;
}
