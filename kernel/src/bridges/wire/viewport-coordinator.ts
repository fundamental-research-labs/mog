/**
 * ViewportCoordinator — Single-owner coordinator for one viewport region's state.
 *
 * Implements the ViewportView read-only interface for consumers (canvas, React
 * hooks, VPI builder) while exposing write methods that only the kernel's
 * mutation pipeline and fetch manager should call.
 *
 * Key invariants:
 *   - All writes are synchronous. Subscribers are notified inline.
 *   - Cell overlay exists solely for re-application after fetch-commit.
 *   - Monotonically increasing version tracks every write.
 *   - After dispose(), all write methods become no-ops.
 */

import type { ViewportChangeEvent } from '@mog-sdk/contracts/api';
import type { BinaryMutationReader } from './binary-mutation-reader';
import {
  BinaryViewportBuffer,
  type CellAccessor,
  type ViewportBounds,
  type BinaryMergeRegion,
  type BinaryRowDimension,
  type BinaryColDimension,
  type DataBarData,
  type IconData,
} from './binary-viewport-buffer';
import { type CellFormat, displayStringOrNull } from '@mog-sdk/contracts/core';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Overlay entry — decoded cell state stored for fetch-commit re-application
// ---------------------------------------------------------------------------

export interface OverlayEntry {
  /** Raw flags word (value type bits + HAS_FORMULA, HAS_COMMENT, etc.) */
  flags: number;
  /** IEEE 754 f64 number value (NaN for non-numeric cells) */
  numberValue: number;
  /** Format palette index (u16). Stable across fetches (palette is append-only). */
  formatIdx: number;
  /** Decoded display string, or null if NO_STRING */
  displayString: string | null;
  /** Decoded error string, or null if NO_STRING */
  errorString: string | null;
  /** Background color override (RGBA u32), 0 = no override */
  bgColorOverride: number;
  /** Font color override (RGBA u32), 0 = no override */
  fontColorOverride: number;
  /** Coordinator version at the time this entry was stored */
  epoch: number;
}

// ---------------------------------------------------------------------------
// Dimension overlay entry
// ---------------------------------------------------------------------------

export interface DimensionPatch {
  /** Row or column index (absolute, not viewport-relative) */
  index: number;
  /** Size in pixels (height for rows, width for cols) */
  size: number;
  /** Whether the row/col is hidden */
  hidden: boolean;
  /** Coordinator version at the time this patch was stored */
  epoch: number;
}

// ---------------------------------------------------------------------------
// Change events — re-exported from contracts
// ---------------------------------------------------------------------------

export type { ViewportChangeEvent };

// ---------------------------------------------------------------------------
// ReadonlyBinaryViewportBuffer — read-only subset of BinaryViewportBuffer
// ---------------------------------------------------------------------------

/**
 * Read-only projection of BinaryViewportBuffer.
 *
 * Consumers (canvas, React hooks, VPI builder) receive this type instead of
 * the full BinaryViewportBuffer, preventing accidental mutation (setBuffer,
 * applyBinaryMutation, writeOverlayEntryToBase, etc.).
 */
export interface ReadonlyBinaryViewportBuffer {
  // --- Buffer state ---
  hasBuffer(): boolean;

  // --- Header getters ---
  getStartRow(): number;
  getStartCol(): number;
  getRows(): number;
  getCols(): number;
  getCellCount(): number;
  getGeneration(): number;
  isDelta(): boolean;
  getProtocolVersion(): number;

  // --- Cell access ---
  createAccessor(): CellAccessor;
  cellOffset(row: number, col: number): number;
  cellIndex(row: number, col: number): number;
  isInViewport(row: number, col: number): boolean;

  // --- String decoding ---
  getOrDecodeString(byteOff: number, byteLen: number): string | null;

  // --- Format palette ---
  getFormatByIndex(idx: number): CellFormat;

  // --- Structural data ---
  getBounds(): ViewportBounds | null;
  getMerges(): BinaryMergeRegion[];
  getRowDimensions(): BinaryRowDimension[];
  getColDimensions(): BinaryColDimension[];
  getRowDimension(row: number): BinaryRowDimension | null;
  getColDimension(col: number): BinaryColDimension | null;

  // --- Position data ---
  getRowTop(row: number): number | null;
  getColLeft(col: number): number | null;
  hasPositions(): boolean;
  getRowPositions(): Float64Array | null;
  getColPositions(): Float64Array | null;

  // --- CF extras ---
  getDataBar(cellIndex: number): DataBarData | null;
  getIcon(cellIndex: number): IconData | null;

  // --- Visible window ---
  getVisibleWindow(): ViewportBounds | null;

  // --- Format index access (for value-only mutation format preservation) ---
  getFormatIdxAt(row: number, col: number): number;
}

// ---------------------------------------------------------------------------
// ViewportView — read-only interface for consumers
// ---------------------------------------------------------------------------

/**
 * Read-only view of a viewport's state. Exposed to consumers (canvas,
 * React hooks, VPI builder). Consumers cannot mutate viewport state
 * through this interface — only the coordinator's write methods can.
 */
export interface ViewportView {
  /** The underlying binary buffer. Read-only access for flyweight CellAccessor. */
  readonly base: ReadonlyBinaryViewportBuffer;

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(cb: (event: ViewportChangeEvent) => void): () => void;

  /** Current viewport bounds, or null if no buffer loaded. */
  getBounds(): ViewportBounds | null;

  /** Merge regions in the current viewport. */
  getMerges(): BinaryMergeRegion[];

  /** Get a row's dimension (height, hidden), or null if not in the dimension index. */
  getRowDimension(row: number): BinaryRowDimension | null;

  /** Get a col's dimension (width, hidden), or null if not in the dimension index. */
  getColDimension(col: number): BinaryColDimension | null;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Utility to create overlay map keys from row/col.
 * Format: "${row},${col}" — simple, deterministic, no collisions.
 */
export function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

// ---------------------------------------------------------------------------
// ViewportCoordinator
// ---------------------------------------------------------------------------

/**
 * Single-owner coordinator for one viewport region's state.
 *
 * Implements ViewportView so it can be passed directly to consumers,
 * but exposes write methods that only the kernel's mutation pipeline
 * and fetch manager should call.
 *
 * All writes are synchronous. Subscribers are notified inline (synchronously)
 * after each state change.
 */
export class ViewportCoordinator implements ViewportView {
  readonly viewportId: string;
  private readonly _base: BinaryViewportBuffer;

  /** Read-only projection of the underlying buffer (satisfies ViewportView.base). */
  get base(): ReadonlyBinaryViewportBuffer {
    return this._base;
  }

  /** Monotonically increasing version, incremented on every write. */
  private _version: number = 0;

  /** Decoded cell overlay — keyed by cellKey(row, col). */
  private _cellOverlay: Map<string, OverlayEntry> = new Map();

  /** Decoded row dimension overlay — keyed by row index. */
  private _rowDimOverlay: Map<number, DimensionPatch> = new Map();

  /** Decoded col dimension overlay — keyed by col index. */
  private _colDimOverlay: Map<number, DimensionPatch> = new Map();

  /** Subscriber callbacks. */
  private _subscribers: Set<(event: ViewportChangeEvent) => void> = new Set();

  /** Whether dispose() has been called. */
  private _disposed: boolean = false;

  /** Epoch of the last successfully committed fetch. Used to reject stale out-of-order fetches. */
  private _lastCommittedFetchEpoch: number = -1;

  constructor(viewportId: string) {
    this.viewportId = viewportId;
    this._base = new BinaryViewportBuffer();
  }

  // -----------------------------------------------------------------------
  // Read-only interface (ViewportView)
  // -----------------------------------------------------------------------

  /** Current monotonic version number. */
  get version(): number {
    return this._version;
  }

  /** Whether this coordinator has been disposed. */
  get disposed(): boolean {
    return this._disposed;
  }

  subscribe(cb: (event: ViewportChangeEvent) => void): () => void {
    if (this._disposed) return () => {};
    this._subscribers.add(cb);
    return () => {
      this._subscribers.delete(cb);
    };
  }

  getBounds(): ViewportBounds | null {
    return this._base.getBounds();
  }

  getMerges(): BinaryMergeRegion[] {
    return this._base.getMerges();
  }

  getRowDimension(row: number): BinaryRowDimension | null {
    // Check overlay first
    const patch = this._rowDimOverlay.get(row);
    if (patch) return { row, height: patch.size, hidden: patch.hidden };
    // Delegate to base buffer's O(1) lazy dimension index
    return this._base.getRowDimension(row);
  }

  getColDimension(col: number): BinaryColDimension | null {
    const patch = this._colDimOverlay.get(col);
    if (patch) return { col, width: patch.size, hidden: patch.hidden };
    return this._base.getColDimension(col);
  }

  // -----------------------------------------------------------------------
  // Metadata write methods (coordinator-owned, used by ViewportFetchManager)
  // -----------------------------------------------------------------------

  /**
   * Whether the underlying buffer has been loaded (i.e., at least one
   * commitFetch has been called, or the buffer was set externally).
   */
  hasBuffer(): boolean {
    return this._base.hasBuffer();
  }

  /**
   * Set the sheet ID on the underlying buffer.
   * Used by ViewportFetchManager when registering a new viewport.
   */
  setSheetId(sheetId: string): void {
    if (this._disposed) return;
    this._base.setSheetId(sheetId);
  }

  /**
   * Set the visible window bounds on the underlying buffer.
   * Used by ViewportFetchManager after scroll/resize to update the
   * visible sub-region within the larger prefetch buffer.
   */
  setVisibleWindow(bounds: ViewportBounds | null): void {
    if (this._disposed) return;
    this._base.setVisibleWindow(bounds);
  }

  /**
   * Tag the underlying buffer with this viewport's scroll behavior so the
   * accessor can decide which axes to gate (see {@link CellAccessor.moveTo}).
   * Called once at registration — the type is fixed for the viewport's lifetime.
   */
  setScrollBehavior(behavior: 'free' | 'horizontal-only' | 'vertical-only' | 'none'): void {
    if (this._disposed) return;
    this._base.setScrollBehavior(behavior);
  }

  // -----------------------------------------------------------------------
  // Write path 1: Mutation patches
  // -----------------------------------------------------------------------

  /**
   * Apply binary mutation patches from a BinaryMutationReader.
   *
   * This is the mutation write path:
   *   1. Apply raw patch to base buffer via applyBinaryMutation()
   *      (writes cell bytes in-place, appends strings to overflow pool)
   *   2. Decode each patched cell: read row, col, flags, numberValue,
   *      displayString, errorString, formatIdx from the reader
   *   3. Store decoded values in _cellOverlay keyed by cellKey(row, col),
   *      tagged with current version+1 as epoch
   *   4. If any in-viewport cells were patched, increment _version
   *   5. Emit 'cells-patched' event with the list of patched cell coordinates
   *      (skipped entirely when no in-viewport cells are dirty)
   *
   * The overlay is NOT consulted on the read path — the base buffer already
   * has correct bytes after applyBinaryMutation(). The overlay exists solely
   * for re-application after fetch-commit.
   */
  applyMutationPatches(reader: BinaryMutationReader): void {
    if (this._disposed) return;

    // Step 1: Apply raw patches to base buffer
    this._base.applyBinaryMutation(reader);

    // Step 2-3: Decode and store overlay entries.
    //
    // No same-batch dedup is required: the Rust scheduler guarantees that a
    // single mutation result never carries contradictory patches for the same
    // cell. See `compute/core/src/scheduler/spill.rs::append_filtered_teardowns`
    // for the source-of-truth filtering. The overlay is therefore a faithful
    // last-writer-wins replay of the wire patches in receipt order.
    const dirtyCells: { row: number; col: number }[] = [];
    const newEpoch = this._version + 1;

    for (let i = 0; i < reader.patchCount; i++) {
      const row = reader.patchRow(i);
      const col = reader.patchCol(i);

      // Skip out-of-viewport patches (same check as base buffer)
      if (!this._base.isInViewport(row, col)) continue;

      dirtyCells.push({ row, col });

      // NOTE: patchDisplayText() returns FormattedText | null (branded string).
      // Use displayStringOrNull() to unwrap to plain string for the overlay,
      // since writeOverlayEntryToBase needs raw strings for UTF-8 encoding.
      const entry: OverlayEntry = {
        flags: reader.patchFlags(i),
        numberValue: reader.patchNumberValue(i),
        formatIdx: reader.patchFormatIdx(i),
        displayString: displayStringOrNull(reader.patchDisplayText(i)),
        errorString: reader.patchErrorText(i),
        bgColorOverride: reader.patchBgColorOverride(i),
        fontColorOverride: reader.patchFontColorOverride(i),
        epoch: newEpoch,
      };

      this._cellOverlay.set(cellKey(row, col), entry);
    }

    // Also process spill patches (same pattern as regular patches).
    for (let i = 0; i < reader.spillPatchCount; i++) {
      const row = reader.spillPatchRow(i);
      const col = reader.spillPatchCol(i);
      const key = cellKey(row, col);

      if (!this._base.isInViewport(row, col)) continue;

      dirtyCells.push({ row, col });

      const entry: OverlayEntry = {
        flags: reader.spillPatchFlags(i),
        numberValue: reader.spillPatchNumberValue(i),
        formatIdx: reader.spillPatchFormatIdx(i),
        displayString: displayStringOrNull(reader.spillPatchDisplayText(i)),
        errorString: reader.spillPatchErrorText(i),
        bgColorOverride: reader.spillPatchBgColorOverride(i),
        fontColorOverride: reader.spillPatchFontColorOverride(i),
        epoch: newEpoch,
      };

      this._cellOverlay.set(key, entry);
    }

    // Step 4-5: Only increment version and emit when there are actual dirty cells
    if (dirtyCells.length > 0) {
      this._version = newEpoch;
      this._emit({ type: 'cells-patched', cells: dirtyCells });
    }
  }

  // -----------------------------------------------------------------------
  // Format index restoration — prevents value-only mutations from clobbering format
  // -----------------------------------------------------------------------

  /**
   * Restore a cell's format_idx in both the base buffer and the overlay.
   * Called after a value-only mutation patch has been applied (which writes
   * format_idx = 0 for all changed cells because the Rust binary patch
   * does not carry the real format for value mutations).
   */
  restoreFormatIdx(row: number, col: number, formatIdx: number): void {
    if (this._disposed) return;
    // Write back to base buffer
    this._base.setFormatIdxAt(row, col, formatIdx);
    // Also fix the overlay entry so fetch-commit re-application doesn't re-clobber
    const key = cellKey(row, col);
    const entry = this._cellOverlay.get(key);
    if (entry) {
      entry.formatIdx = formatIdx;
    }
  }

  // -----------------------------------------------------------------------
  // Write path 2: Dimension patches
  // -----------------------------------------------------------------------

  /**
   * Apply a dimension patch (row height or column width change).
   *
   * Stores in overlay dimension maps, writes to base buffer via
   * patchRowDimension/patchColDimension, increments version, emits event.
   */
  applyDimensionPatch(axis: 'row' | 'col', index: number, size: number, hidden: boolean): void {
    if (this._disposed) return;

    const newEpoch = this._version + 1;

    const patch: DimensionPatch = { index, size, hidden, epoch: newEpoch };

    if (axis === 'row') {
      this._rowDimOverlay.set(index, patch);
      this._base.patchRowDimension(index, size, hidden);
    } else {
      this._colDimOverlay.set(index, patch);
      this._base.patchColDimension(index, size, hidden);
    }

    this._version = newEpoch;
    this._emit({ type: 'dimensions-patched', axis });
  }

  // -----------------------------------------------------------------------
  // Write path 3: Fetch commit
  // -----------------------------------------------------------------------

  /**
   * Record the current version as the fetch epoch and return it.
   *
   * The caller (ViewportFetchManager) calls this before initiating an async
   * fetch to Rust. When the fetch response arrives, the caller passes the
   * epoch back to commitFetch() so the coordinator knows which overlay
   * entries to retain (those with epoch > fetchEpoch).
   */
  startFetch(): number {
    return this._version;
  }

  /**
   * Commit a full fetch response.
   *
   * This is the critical write path where overlay re-application happens:
   *   1. Call base.setBuffer(buffer) — replaces the buffer, its string pool,
   *      and resets the overflow pool
   *   2. Filter overlay: remove entries with epoch <= fetchEpoch
   *   3. Re-apply retained entries to the new base buffer:
   *      - Write numeric fields (flags, numberValue, formatIdx) via
   *        base.writeOverlayEntryToBase(row, col, entry)
   *      - Append display/error strings to overflow pool via
   *        base.appendToOverflowPool() and update cell record offsets
   *   4. Same for dimension overlay entries
   *   5. Increment version
   *   6. Emit 'fetch-committed' event
   */
  commitFetch(buffer: Uint8Array, fetchEpoch: number): void {
    if (this._disposed) return;

    // Reject stale out-of-order fetches — a newer fetch has already been committed.
    if (fetchEpoch < this._lastCommittedFetchEpoch) return;

    // Step 1: Swap base buffer
    this._base.setBuffer(buffer);

    // Step 2-3: Filter and re-apply cell overlay
    this._filterAndReapplyCellOverlay(fetchEpoch);

    // Step 4: Filter and re-apply dimension overlays
    this._filterAndReapplyDimensionOverlay(fetchEpoch);

    // Step 5: Increment version
    this._version++;
    this._lastCommittedFetchEpoch = fetchEpoch;

    // Step 6: Emit event
    this._emit({ type: 'fetch-committed' });
  }

  /**
   * Commit a delta fetch response (scroll optimization).
   *
   * Same as commitFetch but calls base.applyDelta() instead of setBuffer().
   */
  commitDelta(
    deltaBuffer: Uint8Array,
    newStartRow: number,
    newStartCol: number,
    newEndRow: number,
    newEndCol: number,
    fetchEpoch: number,
  ): void {
    if (this._disposed) return;

    // Reject stale out-of-order fetches — a newer fetch has already been committed.
    if (fetchEpoch < this._lastCommittedFetchEpoch) return;

    // Apply delta merge
    this._base.applyDelta(deltaBuffer, newStartRow, newStartCol, newEndRow, newEndCol);

    // Filter and re-apply overlays
    this._filterAndReapplyCellOverlay(fetchEpoch);
    this._filterAndReapplyDimensionOverlay(fetchEpoch);

    this._version++;
    this._lastCommittedFetchEpoch = fetchEpoch;

    this._emit({ type: 'fetch-committed' });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Dispose the coordinator. Clears all state, removes all subscribers,
   * and prevents further operations.
   */
  dispose(): void {
    this._disposed = true;
    this._cellOverlay.clear();
    this._rowDimOverlay.clear();
    this._colDimOverlay.clear();
    this._subscribers.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Filter cell overlay: discard entries with epoch <= fetchEpoch.
   * Re-apply retained entries to the base buffer.
   */
  private _filterAndReapplyCellOverlay(fetchEpoch: number): void {
    // Safe to delete during Map iteration per ES6 spec (deleted entries are not re-visited)
    for (const [key, entry] of this._cellOverlay) {
      if (entry.epoch <= fetchEpoch) {
        this._cellOverlay.delete(key);
      } else {
        // Parse row,col from key
        const comma = key.indexOf(',');
        const row = parseInt(key.substring(0, comma), 10);
        const col = parseInt(key.substring(comma + 1), 10);

        // Re-apply to new base buffer if cell is within new viewport bounds.
        // If the cell is outside the new viewport, prune it from the overlay
        // to prevent unbounded growth during long sessions with frequent
        // scrolling + mutations.
        if (this._base.isInViewport(row, col)) {
          this._base.writeOverlayEntryToBase(row, col, entry);
        } else {
          this._cellOverlay.delete(key);
        }
      }
    }
  }

  /**
   * Filter dimension overlays: discard entries with epoch <= fetchEpoch.
   * Re-apply retained entries to the base buffer.
   */
  private _filterAndReapplyDimensionOverlay(fetchEpoch: number): void {
    const startRow = this._base.getStartRow();
    const endRow = startRow + this._base.getRows();
    for (const [index, patch] of this._rowDimOverlay) {
      if (patch.epoch <= fetchEpoch) {
        this._rowDimOverlay.delete(index);
      } else if (index < startRow || index >= endRow) {
        // Prune out-of-viewport entries to prevent unbounded growth
        this._rowDimOverlay.delete(index);
      } else {
        this._base.patchRowDimension(index, patch.size, patch.hidden);
      }
    }

    const startCol = this._base.getStartCol();
    const endCol = startCol + this._base.getCols();
    for (const [index, patch] of this._colDimOverlay) {
      if (patch.epoch <= fetchEpoch) {
        this._colDimOverlay.delete(index);
      } else if (index < startCol || index >= endCol) {
        // Prune out-of-viewport entries to prevent unbounded growth
        this._colDimOverlay.delete(index);
      } else {
        this._base.patchColDimension(index, patch.size, patch.hidden);
      }
    }
  }

  /** Emit an event to all subscribers synchronously. Subscribers must not throw. */
  private _emit(event: ViewportChangeEvent): void {
    for (const cb of this._subscribers) {
      try {
        cb(event);
      } catch (e) {
        // Subscriber threw — log but don't disrupt other subscribers.
        // eslint-disable-next-line no-console
        console.error('[ViewportCoordinator] subscriber threw:', e);
      }
    }
  }
}
