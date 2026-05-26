/**
 * Spreadsheet shortcut compatibility reference types
 *
 * Type definition for first-party shortcut compatibility data. Runtime data
 * lives in the spreadsheet app at:
 * apps/spreadsheet/src/keyboard/excel-reference.ts
 */

export interface ExcelShortcutReference {
  /** Unique ID for this reference entry */
  id: string;
  /** Windows shortcut binding used for compatibility analysis */
  windowsBinding: string;
  /** Mac shortcut binding used for compatibility analysis */
  macBinding: string;
  /** First-party behavior description */
  description: string;
  /** Internal compatibility grouping */
  msCategory: string;
  /** Our mapping status */
  status: 'mapped' | 'mapped-disabled' | 'unmapped' | 'deferred' | 'not-applicable';
  /** Our internal shortcut ID if mapped */
  mappedToId?: string;
  /** Notes on any discrepancies */
  notes?: string;
}
