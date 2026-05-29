/**
 * Clipboard Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * States:
 * - empty: No clipboard data
 * - hasCopy: Copied data available
 * - hasCut: Cut data available (source shows marching ants)
 * - pastePreview: Showing preview of paste result
 * - pasting: Paste operation in progress
 *
 * @see state-machines/src/clipboard-machine.ts
 */

import type { CellRange, CellValue } from '@mog/types-core';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Sentinel value for sourceSheetId when clipboard data comes from external source */
export const EXTERNAL_SOURCE_SHEET_ID = '__external__';

// =============================================================================
// TYPES (from clipboard-machine.ts)
// =============================================================================

/**
 * A comment with position relative to clipboard origin.
 * Used for preserving comments during copy/paste operations.
 */
export interface RelativeComment {
  /** Offset from source origin row */
  rowOffset: number;
  /** Offset from source origin column */
  colOffset: number;
  /** Author name */
  author: string;
  /** Author ID (optional) */
  authorId?: string;
  /** Comment content (rich text as plain string for clipboard) */
  content: string;
  /** Original created timestamp */
  createdAt: number;
  /** Whether the comment was resolved */
  resolved?: boolean;
  /** Comment kind from the worksheet API. */
  commentType?: 'note' | 'threadedComment';
  /** Thread grouping for threaded comments. */
  threadId?: string | null;
  /** Parent comment ID for replies. */
  parentId?: string | null;
}

/**
 * Individual cell data in clipboard.
 */
export interface ClipboardCellData {
  raw: unknown;
  formula?: string;
  format?: unknown;
  /** Comments attached to this cell position */
  comments?: RelativeComment[];
  /** Hyperlink URL attached to this cell */
  hyperlink?: string;
}

/**
 * A merged region with positions relative to clipboard origin.
 */
export interface RelativeMerge {
  startRowOffset: number;
  startColOffset: number;
  endRowOffset: number;
  endColOffset: number;
}

/**
 * A conditional formatting rule with positions relative to clipboard origin.
 */
export interface RelativeConditionalFormat {
  rules: Array<{
    type: string;
    priority: number;
    stopIfTrue?: boolean;
    [key: string]: unknown;
  }>;
  ranges: Array<{
    startRowOffset: number;
    startColOffset: number;
    endRowOffset: number;
    endColOffset: number;
  }>;
}

/**
 * A data validation rule with positions relative to clipboard origin.
 */
export interface RelativeValidation {
  schema: {
    type?: string;
    constraints?: Record<string, unknown>;
  };
  enforcement: 'none' | 'info' | 'warning' | 'strict';
  ui?: {
    showDropdown?: boolean;
    inputMessage?: { title?: string; message?: string };
    errorMessage?: { title?: string; message?: string };
  };
  ranges: Array<{
    startRowOffset: number;
    startColOffset: number;
    endRowOffset: number;
    endColOffset: number;
  }>;
}

/**
 * Clipboard data structure containing copied/cut cell data.
 */
export interface ClipboardData {
  /** The ranges that were copied/cut */
  sourceRanges: CellRange[];
  /** Cell data indexed by relative position from top-left (e.g., "0,0", "0,1") */
  cells: Record<string, ClipboardCellData>;
  /** Original sheet ID for cross-sheet paste detection */
  sourceSheetId: string;
  /**
   * Text signature written to system clipboard (TSV format).
   * Used to detect if system clipboard was overwritten by another app.
   */
  textSignature?: string;
  /** Merged regions within the copied range */
  merges?: RelativeMerge[];
  /** Data validation rules within the copied range */
  validation?: RelativeValidation[];
  /** Conditional formatting rules within the copied range */
  conditionalFormatting?: RelativeConditionalFormat[];
  /** Source column widths for "Keep Source Column Widths" paste option */
  sourceColumnWidths?: (number | undefined)[];
}

/**
 * Cell coordinate type for paste target.
 */
export interface CellCoord {
  row: number;
  col: number;
}

/**
 * Paste special options for controlling what gets pasted.
 */
export interface PasteSpecialOptions {
  /** Paste only values (no formulas) */
  values?: boolean;
  /** Paste formulas (default true) */
  formulas?: boolean;
  /** Paste formats */
  formats?: boolean;
  /** Paste data validation rules */
  validation?: boolean;
  /** Paste conditional formatting rules */
  conditionalFormatting?: boolean;
  /** Paste comments */
  comments?: boolean;
  /** Transpose rows/columns */
  transpose?: boolean;
  /** Arithmetic operation to apply */
  operation?: 'none' | 'add' | 'subtract' | 'multiply' | 'divide';
  /** Skip blank cells in source */
  skipBlanks?: boolean;
  /** Paste as links (create formula references to source cells) */
  pasteLink?: boolean;
  /** Skip hidden rows in the target when pasting */
  skipHiddenRows?: boolean;
  /** Set of target cell keys to skip during paste */
  skipCells?: Set<string>;
  /** Keep source column widths when pasting */
  columnWidths?: boolean;
  /** Progress callback for large paste operations */
  onProgress?: (progress: {
    processed: number;
    total: number;
    percent: number;
    estimatedTimeRemaining: number | null;
  }) => void;
  /** AbortSignal for cancellation support */
  signal?: AbortSignal;
}

/**
 * Payload for external paste commands/events.
 * HTML and paste options are both optional, so callers use an object payload
 * to avoid positional ambiguity.
 */
export interface ExternalPastePayload {
  /** Plain text from clipboard */
  text: string;
  /** Target cell for paste */
  targetCell: CellCoord;
  /** Optional HTML from clipboard */
  html?: string;
  /** Optional explicit/defaulted paste options */
  options?: PasteSpecialOptions;
}

/**
 * Options available in the paste dropdown menu UI.
 * Different from PasteOption in commands.ts (which is the machine-level API).
 */
export type PasteMenuOption =
  | 'all'
  | 'valuesOnly'
  | 'formulas'
  | 'formatting'
  | 'keepSourceFormatting'
  | 'matchDestination'
  | 'transpose'
  | 'valuesAndFormatting'
  | 'pasteLink'
  | 'columnWidths';

// =============================================================================
// STATE TYPE (matches XState snapshot shape)
// =============================================================================

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 */
export interface ClipboardState {
  context: {
    /** The ranges that were copied/cut */
    sourceRanges: CellRange[] | null;
    /** Full clipboard data (values, formulas, formats) */
    data: ClipboardData | null;
    /** Whether current clipboard is from a cut operation */
    isCut: boolean;
    /** Target cell for paste preview */
    pastePreviewTarget: CellCoord | null;
    /** Current phase for marching ants animation (0-7) */
    marchingAntsPhase: number;
    /** Error message from failed paste */
    errorMessage: string | null;
    /** Paste special options for current operation */
    pasteOptions: PasteSpecialOptions | null;
    /** Whether to skip size mismatch check (user already confirmed) */
    skipSizeCheck: boolean;
    /** Whether clipboard data is stale (app lost focus) */
    isStale: boolean;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

export interface ClipboardAccessor {
  // Value accessors (match selectors)
  getSourceRanges(): CellRange[] | null;
  getData(): ClipboardData | null;
  getIsCut(): boolean;
  getPastePreviewTarget(): CellCoord | null;
  getMarchingAntsPhase(): number;
  getErrorMessage(): string | null;
  getPasteOptions(): PasteSpecialOptions | null;
  getSkipSizeCheck(): boolean;
  getIsStale(): boolean;

  // Derived value accessors
  hasData(): boolean;

  // State matching accessors (match selectors)
  isEmpty(): boolean;
  hasCopy(): boolean;
  hasCut(): boolean;
  isPastePreview(): boolean;
  isPasting(): boolean;

  // Derived accessors for snapshot
  hasCopyAvailable(): boolean;
  isExternalClipboard(): boolean;
  getCutSource(): CellRange[] | null;
  getCopySource(): CellRange[] | null;
  /**
   * Get the source sheet ID from the current clipboard data.
   * Returns null for external clipboard data or when clipboard is empty.
   */
  getSourceSheetId(): string | null;

  /**
   * Check if marching ants should be visible for the given active sheet.
   * Ants are only shown on the sheet where the copy/cut originated.
   * @param activeSheetId - The currently active sheet ID
   */
  hasMarchingAnts(activeSheetId: string): boolean;

  // Raw state access (for unifiedPaste integration)
  getSnapshot(): ClipboardState;
}

// =============================================================================
// PASTE VALIDATION
// =============================================================================

/**
 * Validation violation from a paste operation.
 * Reported when a pasted value does not match the target cell's validation schema.
 *
 * @seePaste validation checking
 */
export interface PasteValidationViolation {
  row: number;
  col: number;
  value: CellValue;
  expectedType: string;
  enforcement: 'strict' | 'warn' | 'info';
}
