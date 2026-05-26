/**
 * WorkbookPivotTableStyles -- Pivot table style presets and default style management.
 *
 * Provides access to the workbook-level default pivot table style preset.
 * Equivalent API shape: `workbook.pivotTableStyles`.
 */

export interface PivotTableStyleInfo {
  name: string;
  isDefault: boolean;
}

export interface WorkbookPivotTableStyles {
  /** Get the workbook's default pivot table style preset. Returns 'PivotStyleLight16' if not explicitly set. */
  getDefault(): Promise<string>;
  /** Set the workbook's default pivot table style preset. Pass null to reset to 'PivotStyleLight16'. */
  setDefault(style: string | null): Promise<void>;
  /** Get the count of built-in pivot table styles. */
  getCount(): Promise<number>;
  /** Get a pivot table style by name, or null if not found. */
  getItem(name: string): Promise<PivotTableStyleInfo | null>;
  /** List all built-in pivot table styles. */
  list(): Promise<PivotTableStyleInfo[]>;
}
