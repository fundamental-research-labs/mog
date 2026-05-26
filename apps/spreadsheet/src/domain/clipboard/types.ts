/**
 * Clipboard Contract Types
 *
 * CANONICAL clipboard format for cross-view copy/paste.
 * All views export TO this format, import FROM this format.
 * This gives us 2N translations (each view: export + import), NOT N x N.
 *
 * Key insight: `cells` is ALWAYS present (universal format).
 * `tableContext` is OPTIONAL (enables smart paste when available).
 *
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellFormat, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type {
  ColumnSchema,
  ColumnTypeKind,
  SelectOption,
  TableId,
  ViewId,
  ViewType,
} from '@mog-sdk/contracts/views';

// Re-export domain types from contracts so existing consumers of this module still work
export type { ColumnSchema, ColumnTypeKind, SelectOption };

// Preserve backward-compatible aliases used throughout this app
export type ClipboardTableId = TableId;
export type ClipboardViewType = ViewType;
export type ClipboardViewId = ViewId;

// =============================================================================
// Cell Data Types
// =============================================================================

/**
 * Cell format information for clipboard.
 * Exported for convenience with the canonical spreadsheet cell value contract.
 */
export type { CellFormat, CellValue };

// =============================================================================
// CANONICAL Clipboard Payload (CRITICAL)
// =============================================================================

/**
 * CANONICAL clipboard format. All views export TO this, import FROM this.
 *
 * This is the heart of cross-view clipboard support.
 *
 * Translation flows:
 * - Grid -> Grid: Use `cells` directly (preserves formulas)
 * - Grid -> Kanban: Use `cells` to create records (first row = values)
 * - Kanban -> Grid: Use `cells` (Kanban already exported as cells)
 * - Kanban -> Kanban (same table): Use `tableContext.rowIds` to duplicate records
 * - Kanban -> Kanban (diff table): Use `cells` + map columns by name
 * - Any -> External: Use `text` (TSV) or `html`
 * - External -> Any: Parse as cells, no tableContext
 */
export interface ClipboardPayload {
  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIRED: Cell data (universal format)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cell values as 2D array. ALWAYS present.
   * - Grid: direct from selection
   * - Kanban: each card = one row, visible fields = columns
   * - Timeline: each bar = one row
   *
   * Row 0, Col 0 is always top-left of copied region.
   */
  cells: {
    /** 2D array of values [row][col] */
    values: CellValue[][];
    /**
     * 2D array of formulas [row][col].
     * When present, paste should use formula instead of value.
     * null indicates the cell has no formula (use value).
     * Formula strings should include the leading '=' (e.g., "=A1+B1").
     */
    formulas?: (string | null)[][];
    /** Optional: cell formats matching values array */
    formats?: (Partial<CellFormat> | null)[][];
    /** Number of rows */
    rowCount: number;
    /** Number of columns */
    colCount: number;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // OPTIONAL: Rich context (enables smart paste when available)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Present when copying from a table context.
   * Enables: paste-as-records, preserve row identity, column-aware paste.
   */
  tableContext?: {
    /** Source table ID */
    tableId: ClipboardTableId;
    /** Row IDs (for same-table paste to preserve identity) */
    rowIds: RowId[];
    /** Column IDs in order matching cells.values columns */
    colIds: ColId[];
    /** Column schemas for type-aware paste */
    columnSchemas: ColumnSchema[];
  };

  /**
   * Source view information.
   * Used for same-view paste optimization and tracking.
   */
  source: {
    viewType: ClipboardViewType;
    viewId: ClipboardViewId | null;
    sheetId: SheetId | null;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EXTERNAL: Plain text/HTML for system clipboard
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Tab-separated values (TSV) for system clipboard.
   * ALWAYS present - used for external paste (to Excel, text editors, etc.)
   */
  text: string;

  /**
   * HTML table for rich paste into Excel/Google Sheets.
   * Optional - provides better formatting preservation.
   */
  html?: string;
}

// =============================================================================
// View Clipboard Contract
// =============================================================================

/**
 * Contract that views implement for clipboard operations.
 *
 * Each view is responsible for:
 * 1. Exporting its selection to canonical ClipboardPayload format
 * 2. Checking if it can accept a given ClipboardPayload
 * 3. Pasting from ClipboardPayload into its data model
 */
export interface ViewClipboardContract {
  /**
   * EXPORT: Convert view's current selection to canonical format.
   *
   * MUST always produce `cells`. MAY add `tableContext` if in a table.
   */
  getClipboardPayload(): ClipboardPayload;

  /**
   * CAN IMPORT: Check if this view can accept the payload.
   *
   * Examples:
   * - Grid: always true (can paste cells anywhere)
   * - Kanban: true if payload has cells with data
   * - Form: true if single row
   */
  canPaste(payload: ClipboardPayload): boolean;

  /**
   * IMPORT: Consume the canonical format.
   *
   * View decides how to interpret:
   * - Grid: paste cells at selection
   * - Kanban: create records (use tableContext if available, else cells)
   * - Timeline: create records with dates
   */
  paste(payload: ClipboardPayload): void;
}

// =============================================================================
// Clipboard Operation Types
// =============================================================================

/**
 * Clipboard operation type.
 */
export type ClipboardOperation = 'copy' | 'cut';

/**
 * Clipboard service state.
 */
export interface ClipboardServiceState {
  /** Current clipboard payload (internal clipboard) */
  payload: ClipboardPayload | null;
  /** Operation type (copy or cut) */
  operation: ClipboardOperation | null;
  /** Whether cut data has been consumed (single-use) */
  cutConsumed: boolean;
}

// =============================================================================
// Paste Options
// =============================================================================

/**
 * Options for paste operations.
 */
export interface PasteOptions {
  /** Paste only values (no formulas if source had them) */
  valuesOnly?: boolean;
  /** Paste only formatting */
  formattingOnly?: boolean;
  /** Transpose rows and columns */
  transpose?: boolean;
  /** Skip blank cells in source */
  skipBlanks?: boolean;
  /** Arithmetic operation to apply */
  operation?: 'none' | 'add' | 'subtract' | 'multiply' | 'divide';
}

// =============================================================================
// External Clipboard Types
// =============================================================================

/**
 * Data from the system clipboard.
 */
export interface SystemClipboardData {
  /** Plain text (TSV for spreadsheet data) */
  text: string;
  /** HTML content (if available) */
  html?: string;
  /** Files (if any) */
  files?: File[];
}
