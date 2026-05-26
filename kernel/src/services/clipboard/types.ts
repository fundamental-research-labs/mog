/**
 * Clipboard Service Types
 *
 * Types for the kernel clipboard service.
 * This is the cross-app clipboard that survives app switches.
 *
 */

import type { CallableDisposable } from '@mog/spreadsheet-utils/disposable';
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
export type { ColumnSchema, ColumnTypeKind, SelectOption, TableId, ViewId, ViewType };

/**
 * CANONICAL clipboard format. All views export TO this, import FROM this.
 *
 * Key insight: `cells` is ALWAYS present (universal format).
 * `tableContext` is OPTIONAL (enables smart paste when available).
 *
 * This is 2N translations (each view: export + import), NOT N x N.
 */
export interface ClipboardPayload {
  // ===========================================================================
  // REQUIRED: Cell data (universal format)
  // ===========================================================================

  /**
   * Cell values as 2D array. ALWAYS present.
   */
  cells: {
    values: CellValue[][];
    formulas?: (string | null)[][];
    formats?: (Partial<CellFormat> | null)[][];
    rowCount: number;
    colCount: number;
  };

  // ===========================================================================
  // OPTIONAL: Rich context (enables smart paste when available)
  // ===========================================================================

  /**
   * Present when copying from a table context.
   */
  tableContext?: {
    tableId: TableId;
    rowIds: RowId[];
    colIds: ColId[];
    columnSchemas: ColumnSchema[];
  };

  /**
   * Source view information.
   */
  source: {
    viewType: ViewType;
    viewId: ViewId | null;
    sheetId: SheetId | null;
  };

  // ===========================================================================
  // EXTERNAL: Plain text/HTML for system clipboard
  // ===========================================================================

  /**
   * Tab-separated values (TSV) for system clipboard.
   */
  text: string;

  /**
   * HTML table for rich paste into Excel/Google Sheets.
   */
  html?: string;
}

// =============================================================================
// Clipboard Service State
// =============================================================================

/**
 * Clipboard operation type.
 */
export type ClipboardOperation = 'copy' | 'cut';

/**
 * Clipboard state for the state machine.
 */
export type ClipboardState = 'empty' | 'hasCopy' | 'hasCut' | 'pasting';

/**
 * Clipboard service context (internal state).
 */
export interface ClipboardContext {
  /** Current clipboard payload */
  payload: ClipboardPayload | null;
  /** Operation type (copy or cut) */
  operation: ClipboardOperation | null;
  /** Whether the payload is stale (app lost focus, system clipboard may have changed) */
  isStale: boolean;
  /** Timestamp of last copy/cut */
  timestamp: number | null;
  /** Error message from last paste operation */
  error: string | null;
}

/**
 * Clipboard service snapshot (for consumers).
 * Matches KernelClipboardSnapshot in contracts.
 */
export interface ClipboardSnapshot {
  /** Current state of the clipboard */
  state: ClipboardState;
  /** Current operation (copy/cut/null) */
  operation: ClipboardOperation | null;
  /** Whether clipboard has data */
  hasData: boolean;
  /** Whether the payload is stale */
  isStale: boolean;
  /** Any error message from paste operations */
  error: string | null;
}

// =============================================================================
// Clipboard Events
// =============================================================================

/**
 * Events for the clipboard state machine.
 */
export type ClipboardEvent =
  | { type: 'COPY'; payload: ClipboardPayload }
  | { type: 'CUT'; payload: ClipboardPayload }
  | { type: 'PASTE_START' }
  | { type: 'PASTE_COMPLETE' }
  | { type: 'PASTE_ERROR'; message: string }
  | { type: 'CLEAR' }
  | { type: 'FOCUS_LOST' }
  | { type: 'FOCUS_GAINED' };

// =============================================================================
// Service Interface
// =============================================================================

/**
 * Clipboard service interface.
 * This is the cross-app clipboard that survives app switches.
 */
export interface IClipboardService {
  // State
  getSnapshot(): ClipboardSnapshot;
  getPayload(): ClipboardPayload | null;

  // Commands
  copy(payload: ClipboardPayload): void;
  cut(payload: ClipboardPayload): void;
  startPaste(): void;
  completePaste(): void;
  errorPaste(message: string): void;
  clear(): void;
  markStale(): void;
  markFresh(): void;

  // Subscriptions
  /** Subscribe to clipboard changes. Returns CallableDisposable — call directly or .dispose() to unsubscribe. */
  subscribe(listener: (snapshot: ClipboardSnapshot) => void): CallableDisposable;

  // Lifecycle
  dispose(): void;
}
