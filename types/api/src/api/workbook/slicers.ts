/**
 * WorkbookSlicers — Sub-API for workbook-scoped slicer operations.
 *
 * Provides access to all slicers across all sheets in the workbook.
 * Equivalent API shape: `workbook.slicers`.
 *
 * Usage: `workbook.slicers.list()` instead of `workbook.getAllSlicers()`
 */
import type { CellValue } from '@mog/types-core/core';
import type { Slicer, SlicerInfo, SlicerItem } from '../types';

/** Sub-API for workbook-scoped slicer operations. */
export interface WorkbookSlicers {
  /**
   * List all slicers across all sheets in the workbook.
   *
   * @returns Array of slicer summary information
   */
  list(): Promise<SlicerInfo[]>;

  /**
   * Get a slicer by ID from any sheet.
   *
   * @param slicerId - ID of the slicer
   * @returns Full slicer state, or null if not found
   */
  get(slicerId: string): Promise<Slicer | null>;

  /**
   * Get a slicer by its zero-based index in the list.
   *
   * @param index - Zero-based index of the slicer
   * @returns Slicer summary information, or null if index is out of range
   */
  getItemAt(index: number): Promise<SlicerInfo | null>;

  /**
   * Get the items (values) available in a slicer by ID.
   *
   * @param slicerId - ID of the slicer
   * @returns Array of slicer items with selection state
   */
  getItems(slicerId: string): Promise<SlicerItem[]>;

  /**
   * Get a slicer item by its string key.
   *
   * @param slicerId - ID of the slicer
   * @param key - The value to look up (matched via string coercion)
   * @returns The matching slicer item
   * @throws KernelError if no item matches the key
   */
  getItem(slicerId: string, key: CellValue): Promise<SlicerItem>;

  /**
   * Get a slicer item by its string key, or null if not found.
   *
   * @param slicerId - ID of the slicer
   * @param key - The value to look up (matched via string coercion)
   * @returns The matching slicer item, or null if not found
   */
  getItemOrNullObject(slicerId: string, key: CellValue): Promise<SlicerItem | null>;

  /**
   * Remove a slicer by ID from any sheet.
   *
   * @param slicerId - ID of the slicer to remove
   */
  remove(slicerId: string): Promise<void>;

  /**
   * Get the total count of slicers across all sheets.
   *
   * @returns Number of slicers in the workbook
   */
  getCount(): Promise<number>;
}
