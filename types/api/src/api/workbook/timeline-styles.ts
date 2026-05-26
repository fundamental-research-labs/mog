/**
 * WorkbookTimelineStyles -- Timeline slicer style management sub-API interface.
 *
 * Provides access to the workbook-level default timeline style preset,
 * enumeration of built-in timeline styles, and CRUD operations on custom
 * named timeline styles stored in the workbook.
 * Equivalent API shape: `workbook.timelineStyles`.
 */

import type { SlicerCustomStyle } from '@mog/types-data/data/slicers';

export interface TimelineStyleInfo {
  name: string;
  isDefault: boolean;
}

/** A named timeline style stored in the workbook (custom or built-in). */
export interface NamedTimelineStyle {
  name: string;
  readOnly: boolean;
  style: SlicerCustomStyle;
}

export interface WorkbookTimelineStyles {
  /** Get the workbook's default timeline style preset. Returns 'light1' if not explicitly set. */
  getDefault(): Promise<string>;
  /** Set the workbook's default timeline style preset. Pass null to reset to 'light1'. */
  setDefault(style: string | null): Promise<void>;
  /** Get the number of built-in timeline styles. */
  getCount(): Promise<number>;
  /** Get a specific timeline style by name. Returns null if not found. */
  getItem(name: string): Promise<TimelineStyleInfo | null>;
  /** List all built-in timeline styles. */
  list(): Promise<TimelineStyleInfo[]>;

  // --- Named timeline style registry (custom styles) ---

  /**
   * Add a new custom named timeline style.
   * @param name - Desired style name.
   * @param style - Custom style definition.
   * @param makeUniqueName - When true, auto-appends a suffix if the name collides. Default: false.
   * @returns The final name assigned to the style (may differ from `name` when `makeUniqueName` is true).
   */
  add(name: string, style: SlicerCustomStyle, makeUniqueName?: boolean): Promise<string>;

  /**
   * Get a custom named timeline style by name, or null if not found.
   */
  get(name: string): Promise<NamedTimelineStyle | null>;

  /**
   * Remove a custom named timeline style.
   * @param name - The name of the style to remove.
   */
  remove(name: string): Promise<void>;

  /**
   * Duplicate an existing named timeline style.
   * @param name - The name of the style to duplicate.
   * @returns The name of the newly created copy.
   */
  duplicate(name: string): Promise<string>;
}
