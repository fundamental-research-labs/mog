/**
 * WorkbookStyles -- Re-exports from split table-styles and cell-styles modules.
 *
 * The old unified WorkbookStyles interface has been split into
 * WorkbookTableStyles and WorkbookCellStyles for clarity.
 */
export type { WorkbookTableStyles, TableStyleInfoWithReadOnly } from './table-styles';
export type { WorkbookCellStyles } from './cell-styles';
