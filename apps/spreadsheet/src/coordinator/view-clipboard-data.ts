/**
 * View Clipboard Data Type
 *
 * Local type definition for the clipboard machine's internal format.
 * Extracted from views/types.ts to break the coordinator/ -> views/ DAG violation.
 *
 * This type is used internally by ShellCoordinator's clipboard conversion methods
 * to bridge between ClipboardPayload (canonical format) and the clipboard machine.
 *
 * @deprecated Use ClipboardPayload from '../domain/clipboard/types' instead.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellData, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { ViewId, ViewType } from '@mog-sdk/contracts/views';

/**
 * View clipboard data with multiple formats for cross-view compatibility.
 *
 * @deprecated Use ClipboardPayload from '../domain/clipboard/types' instead.
 * Kept for compatibility with the clipboard machine's internal state.
 */
export interface ViewClipboardData {
  /** Source view information */
  source: {
    viewType: ViewType;
    viewId: ViewId;
  };

  /** Cell-based format preserving formulas and all cell properties. */
  cells?: {
    sheetId: SheetId;
    origin: { row: number; col: number };
    /** 2D array of cell data [row][col] */
    data: CellData[][];
  };

  /** Record-based format for table-structured data. */
  records?: {
    tableId: string;
    rowIds: RowId[];
    columns: ColId[];
    /** Map: rowId -> (colId -> computed value) */
    values: Map<RowId, Map<ColId, CellValue>>;
  };

  /** Plain text representation (TSV format). */
  text: string;

  /** View-specific clipboard data. */
  viewSpecific?: unknown;
}
