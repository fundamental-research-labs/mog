/**
 * WorksheetSettings — Sub-API Interface for Sheet Settings
 *
 * Methods for reading and writing sheet-level settings (default dimensions,
 * gridline color, RTL layout, etc.).
 */
import type { SheetSettingsInfo } from '../types';

/** Sub-API for worksheet settings operations. */
export interface WorksheetSettings {
  /**
   * Get all sheet settings.
   *
   * @returns Current sheet settings
   */
  get(): Promise<SheetSettingsInfo>;

  /**
   * Set an individual sheet setting by key.
   *
   * @param key - Setting key (e.g., 'showGridlines', 'defaultRowHeight')
   * @param value - New value for the setting
   */
  set<K extends keyof SheetSettingsInfo>(key: K, value: SheetSettingsInfo[K]): Promise<void>;

  /**
   * Get the standard (default) row height in pixels.
   * This is the height used for rows that haven't been explicitly sized.
   * Read-only (matches spreadsheet special-cell typesemantics).
   */
  getStandardHeight(): Promise<number>;

  /**
   * Get the standard (default) column width in pixels.
   * This is the width used for columns that haven't been explicitly sized.
   */
  getStandardWidth(): Promise<number>;

  /**
   * Set the standard (default) column width in pixels.
   * This changes the default width for all columns that haven't been explicitly sized.
   *
   * @param width - New default column width in pixels
   */
  setStandardWidth(width: number): Promise<void>;
}
