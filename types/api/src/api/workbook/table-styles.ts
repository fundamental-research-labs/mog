/**
 * WorkbookTableStyles -- Table style management sub-API interface.
 *
 * Provides CRUD operations for custom table styles and default table style management.
 */
import type { TableStyleConfig, TableStyleInfo } from '../types';

/** A table style with a computed `readOnly` flag (built-in styles are read-only). */
export type TableStyleInfoWithReadOnly = TableStyleInfo & { readOnly: boolean };

export interface WorkbookTableStyles {
  /** Get all table styles (built-in + custom) with a `readOnly` flag. */
  list(): Promise<TableStyleInfoWithReadOnly[]>;

  /** Create a custom table style. Returns the style name/ID. */
  add(name: string, style: TableStyleConfig): Promise<string>;

  /** Update a custom table style. */
  update(name: string, style: Partial<TableStyleConfig>): Promise<void>;

  /** Remove a custom table style. */
  remove(name: string): Promise<void>;

  /** Get the default table style ID applied to new tables. */
  getDefault(): Promise<string | undefined>;

  /** Set the default table style ID for new tables. Pass undefined to reset. */
  setDefault(name: string | undefined): Promise<void>;

  /** Duplicate an existing table style. Returns the new style info. */
  duplicate(name: string, newName: string): Promise<TableStyleInfo>;
}
