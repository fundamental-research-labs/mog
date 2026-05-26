/**
 * WorkbookSlicerStyles -- Default slicer style management sub-API interface.
 *
 * Provides access to the workbook-level default slicer style preset,
 * enumeration of built-in slicer styles, and CRUD operations on custom
 * named slicer styles stored in the workbook.
 * Equivalent API shape: `workbook.slicerStyles`.
 */

import type { SlicerCustomStyle } from '@mog/types-data/data/slicers';

export interface SlicerStyleInfo {
  name: string;
  isDefault: boolean;
}

/** A named slicer style stored in the workbook (custom or built-in). */
export interface NamedSlicerStyle {
  name: string;
  readOnly: boolean;
  style: SlicerCustomStyle;
}

export interface WorkbookSlicerStyles {
  /** Get the workbook's default slicer style preset. Returns 'light1' if not explicitly set. */
  getDefault(): Promise<string>;
  /** Set the workbook's default slicer style preset. Pass null to reset to 'light1'. */
  setDefault(style: string | null): Promise<void>;
  /** Get the number of built-in slicer styles. */
  getCount(): Promise<number>;
  /** Get a specific slicer style by name. Returns null if not found. */
  getItem(name: string): Promise<SlicerStyleInfo | null>;
  /** List all built-in slicer styles. */
  list(): Promise<SlicerStyleInfo[]>;

  // --- Named slicer style registry (custom styles) ---

  /**
   * Add a new custom named slicer style.
   * @param name - Desired style name.
   * @param style - Custom style definition.
   * @param makeUniqueName - When true, auto-appends a suffix if the name collides. Default: false.
   * @returns The final name assigned to the style (may differ from `name` when `makeUniqueName` is true).
   */
  add(name: string, style: SlicerCustomStyle, makeUniqueName?: boolean): Promise<string>;

  /**
   * Get a custom named slicer style by name, or null if not found.
   */
  get(name: string): Promise<NamedSlicerStyle | null>;

  /**
   * Remove a custom named slicer style.
   * @param name - The name of the style to remove.
   */
  remove(name: string): Promise<void>;

  /**
   * Duplicate an existing named slicer style.
   * @param name - The name of the style to duplicate.
   * @returns The name of the newly created copy.
   */
  duplicate(name: string): Promise<string>;
}
