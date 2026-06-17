/**
 * WorksheetSlicers — Sub-API for slicer operations on a worksheet.
 *
 * Provides methods to create, query, modify, and remove slicers (visual
 * filter controls) within a worksheet. Slicers are connected to tables
 * or pivot tables and filter data by column values.
 */
import type { CellValue } from '@mog/types-core/core';
import type {
  SlicerAddReceipt,
  SlicerClearReceipt,
  SlicerDuplicateReceipt,
  SlicerRemoveReceipt,
  SlicerSelectionClearReceipt,
  SlicerSelectionSetReceipt,
  SlicerUpdateReceipt,
} from '../mutation-receipt';
import type {
  Slicer,
  SlicerConfig,
  SlicerInfo,
  SlicerItem,
  SlicerState,
  SlicerUpdate,
} from '../types';

/** Sub-API for slicer operations on a worksheet. */
export interface WorksheetSlicers {
  /**
   * Create a new slicer on this worksheet.
   *
   * @param config - Slicer configuration (table, column, position)
   * @returns Operation receipt containing the created slicer with full state
   */
  add(config: SlicerConfig): Promise<SlicerAddReceipt>;

  /**
   * Remove a slicer from this worksheet.
   *
   * @param slicerId - ID of the slicer to remove
   */
  remove(slicerId: string): Promise<SlicerRemoveReceipt>;

  /**
   * Remove all slicers from this worksheet.
   */
  clear(): Promise<SlicerClearReceipt>;

  /**
   * List all slicers on this worksheet.
   *
   * @returns Array of slicer summary information
   */
  list(): Promise<SlicerInfo[]>;

  /**
   * Check if a slicer exists by ID.
   *
   * @param slicerId - ID of the slicer
   * @returns True if the slicer exists
   */
  has(slicerId: string): Promise<boolean>;

  /**
   * Get the total number of slicers on this worksheet.
   *
   * @returns The count of slicers
   */
  getCount(): Promise<number>;

  /**
   * Get a slicer by ID, including full state.
   *
   * @param slicerId - ID of the slicer
   * @returns Full slicer state, or null if not found
   */
  get(slicerId: string): Promise<Slicer | null>;

  /**
   * Find a slicer by its name, or null if not found.
   *
   * @param name - Slicer name to search for
   * @returns Full slicer state, or null if no slicer matches
   */
  getByName(name: string): Promise<Slicer | null>;

  /**
   * Get a slicer by its zero-based index in the list.
   *
   * @param index - Zero-based index of the slicer
   * @returns Slicer summary information, or null if index is out of range
   */
  getItemAt(index: number): Promise<SlicerInfo | null>;

  /**
   * Get the items (values) available in a slicer.
   *
   * @param slicerId - ID of the slicer
   * @returns Array of slicer items with selection state
   */
  getItems(slicerId: string): Promise<SlicerItem[]>;

  /**
   * Get a slicer item by its string key.
   * Throws if no item matches — use when you expect the item to exist.
   * For conditional checks, use {@link getItemOrNullObject} which returns null instead.
   *
   * @param slicerId - ID of the slicer
   * @param key - The value to look up (matched via string coercion)
   * @returns The matching slicer item
   * @throws KernelError if no item matches the key
   */
  getItem(slicerId: string, key: CellValue): Promise<SlicerItem>;

  /**
   * Get a slicer item by its string key, or null if not found.
   * Non-throwing alternative to {@link getItem} — use for conditional checks.
   *
   * @param slicerId - ID of the slicer
   * @param key - The value to look up (matched via string coercion)
   * @returns The matching slicer item, or null if not found
   */
  getItemOrNullObject(slicerId: string, key: CellValue): Promise<SlicerItem | null>;

  /**
   * Set the selected items in a slicer, replacing any existing selection.
   *
   * @param slicerId - ID of the slicer
   * @param selectedItems - Array of values to select
   */
  setSelection(slicerId: string, selectedItems: CellValue[]): Promise<SlicerSelectionSetReceipt>;

  /**
   * Clear all selections in a slicer (show all items).
   *
   * @param slicerId - ID of the slicer
   */
  clearSelection(slicerId: string): Promise<SlicerSelectionClearReceipt>;

  /**
   * Duplicate a slicer with an optional position offset.
   *
   * @param slicerId - ID of the slicer to duplicate
   * @param offset - Position offset in pixels (defaults to { x: 20, y: 20 })
   * @returns Operation receipt containing the ID of the newly created slicer
   */
  duplicate(slicerId: string, offset?: { x?: number; y?: number }): Promise<SlicerDuplicateReceipt>;

  /**
   * Update a slicer's configuration.
   *
   * @param slicerId - ID of the slicer
   * @param updates - Partial configuration updates
   */
  update(slicerId: string, updates: Partial<SlicerConfig>): Promise<SlicerUpdateReceipt>;

  /**
   * Get the enriched runtime state of a slicer.
   *
   * @param slicerId - ID of the slicer
   * @returns Enriched slicer state including computed items and connection status
   */
  getState(slicerId: string): Promise<SlicerState>;
}
