/**
 * Viewport reader contracts
 *
 * Duck-typed reader interfaces that renderers and scroll engines use to pull
 * sync cell data from pre-populated viewport buffers. Moved from
 * contracts/src/api/types.ts to break a rendering ↔ api (Tier 2 ↔ Tier 2)
 * cycle: renderer code needs these for 60fps paths, and the api package
 * needs RenderScheduler from rendering.
 *
 * These are duck-typed contracts; they avoid hard dependency on kernel
 * classes. Consumers (worksheet.viewportReader, grid-renderer render-context)
 * receive these interfaces by parameter.
 *
 * @module @mog/types-viewport/viewport/reader
 */

import type { CellFormat, CellValue, FormattedText } from '@mog/types-core';

/**
 * Cell data from the viewport buffer (sync, pre-fetched for 60fps rendering).
 *
 * Produced by BinaryViewportBuffer's CellAccessor. Fields match the binary
 * cell record layout. Fields not in the binary record (cellId, editText,
 * hyperlinkUrl) are optional — use async Worksheet APIs for those.
 */
export interface ViewportCellData {
  row: number;
  col: number;
  /**
   * Typed cell value: number for numbers, string for text, boolean for booleans,
   * CellError for errors, null for empty cells.
   */
  value: CellValue;
  /** Cell ID (CRDT identifier). Not in binary record — only populated by legacy path. */
  cellId?: string;
  /** Display text (formatted value as string). */
  displayText: FormattedText | null;
  /** Whether the cell contains a formula. */
  hasFormula: boolean;
  /** Whether the cell has a comment indicator. */
  hasComment: boolean;
  /** Whether the cell has a sparkline. */
  hasSparkline: boolean;
  /** Whether the cell has a hyperlink. */
  hasHyperlink: boolean;
  /** Error text if the cell is in error state. */
  error?: string;
  /** Edit text (raw input string for editor). Not in binary record. */
  editText?: string;
  /** Hyperlink URL. Not in binary record — use hasHyperlink flag + async API. */
  hyperlinkUrl?: string;
  /** Cell format from the binary format palette. */
  format?: unknown;
  /** Schema type for this cell (e.g., 'boolean' for checkbox cells). Not always populated. */
  schema_type?: string;
}

/**
 * Active cell data for formula bar, editors, and status bar.
 *
 * Produced by ComputeBridge.getActiveCellData(). Field names match the
 * generated ActiveCellData type from compute-types.gen.ts.
 */
export interface ActiveCellInfo {
  cellId: string;
  value: CellValue;
  formula?: string;
  format?: unknown;
  metadata?: unknown;
  editText?: string;
  isFormulaHidden: boolean;
  hyperlinkUrl?: string;
  numberFormat?: string;
}

/** Merge region within the viewport. Wire type from Rust. */
export interface ViewportMergeRegion {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
}

/** Row dimension data from viewport. Wire type from Rust. */
export interface ViewportRowDimension {
  row: number;
  height: number;
  hidden: boolean;
}

/** Column dimension data from viewport. Wire type from Rust. */
export interface ViewportColDimension {
  col: number;
  width: number;
  hidden: boolean;
}

/** The visible cell range bounds for the viewport. */
export interface ViewportBounds {
  sheetId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Binary cell data for zero-copy canvas rendering. */
export interface BinaryCellData {
  row: number;
  col: number;
  /** Raw binary payload for direct rendering. */
  data?: ArrayBuffer;
}

/**
 * Binary viewport reader for ultra-fast canvas rendering.
 * Reads from an ArrayBuffer-based representation (zero-copy on WASM path).
 */
export interface BinaryViewportReader {
  /** Read cell data from binary buffer. */
  getCellData(row: number, col: number): BinaryCellData | null;
  /** Get the underlying binary buffer for direct canvas rendering. */
  getBuffer(): ArrayBuffer | null;
  /** Check if binary data is available for this viewport. */
  isReady(): boolean;
}

/**
 * Duck-typed binary cell reader for the canvas cells layer hot path.
 * Matches the flyweight CellAccessor shape from the kernel's BinaryViewportBuffer.
 * Duck-typed to avoid hard dependency from contracts to kernel.
 */
export interface BinaryCellReader {
  moveTo(row: number, col: number): boolean;
  readonly valueType: number;
  readonly numberValue: number;
  readonly displayText: FormattedText | null;
  readonly errorText: string | null;
  readonly format: CellFormat;
  readonly hasFormula: boolean;
  readonly hasComment: boolean;
  readonly hasSparkline: boolean;
  readonly hasHyperlink: boolean;
  readonly isCheckbox: boolean;
  readonly isProjectedPosition: boolean;
  readonly hasValidationError: boolean;
}

/**
 * Sync viewport reader for 60fps render paths.
 *
 * Read-only interface over the pre-populated viewport buffer.
 * All methods are synchronous — the buffer is populated from Rust via async
 * IPC, but reads are O(1) lookups into the local cache.
 *
 * Replaces direct `ctx.viewportBuffer` access in the app layer (48 files).
 */
export interface ViewportReader {
  /** Get cell data for a visible cell (sync, O(1)). Returns null if outside viewport. */
  getCellData(row: number, col: number): ViewportCellData | null;
  /** Get data for the active cell (formula bar, editors). */
  getActiveCellData(): ActiveCellInfo | null;
  /** Get all merge regions visible in the viewport. */
  getMerges(): ViewportMergeRegion[];
  /** Check if a cell has a comment indicator. */
  hasComment(row: number, col: number): boolean;
  /** Get row dimension (height, hidden state) for a visible row. */
  getRowDimension(row: number): ViewportRowDimension | null;
  /** Get column dimension (width, hidden state) for a visible column. */
  getColDimension(col: number): ViewportColDimension | null;
  /** Get the current viewport bounds, or null if not yet populated. */
  getBounds(): ViewportBounds | null;
  /**
   * Absolute pixel top edge of each row in the prefetch range, plus a trailing
   * sentinel (top edge of `endRow + 1`).
   *
   * Length: `endRow - startRow + 2` for non-empty viewports, 0 (or null) before
   * the first fetch. Sourced directly from Rust's `LayoutIndex` via the wire
   * buffer — zero TS-side recomputation.
   *
   * The sentinel lets consumers derive `height_of(endRow)` as
   * `arr[length - 1] - arr[length - 2]` without a separate query.
   *
   * Returns null when no fetch has populated the buffer yet.
   */
  getRowPositions(): Float64Array | null;
  /** Mirror of {@link getRowPositions} for columns. */
  getColPositions(): Float64Array | null;
  /** Binary transfer path for ultra-fast rendering. */
  readonly binary: BinaryViewportReader;
  /**
   * Binary cell reader (flyweight accessor for renderer).
   * Duck-typed to avoid leaking kernel class references.
   */
  readonly binaryCellReader: BinaryCellReader | null;
  /**
   * Per-viewport binary cell reader resolver.
   * Returns a flyweight accessor for the given viewport's binary buffer.
   * Duck-typed to avoid leaking kernel class references.
   */
  readonly binaryCellReaderForViewport?: (viewportId: string) => BinaryCellReader | undefined;
}
