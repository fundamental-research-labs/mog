/**
 * Viewport Merge Index
 *
 * Provides O(1) merge point-queries for the canvas renderer's hot path.
 * Replaces the linear-scan `getMergedRegion` that was previously on
 * DimensionProvider.
 *
 * The binary viewport buffer from Rust sends merge records as
 * `BinaryMergeInput` objects. The hot loop `forEachVisibleCell` calls
 * `getMergedRegion(row, col)` for every visible cell, so lookups must
 * be O(1).
 *
 * Implementation: a flat `Map<number, MergeRegion>` keyed by
 * `row * MAX_COLS + col` (MAX_COLS = 16384, the Excel column limit).
 * Every cell coordinate within every merge points to the same
 * MergeRegion object, trading memory for constant-time lookup with
 * zero string allocation / GC pressure.
 *
 * @module canvas/coordinates/viewport-merge-index
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalized merge region with camelCase field names. */
export interface MergeRegion {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/** Input merge record from binary viewport buffer (snake_case per wire format). */
export interface BinaryMergeInput {
  start_row: number;
  start_col: number;
  end_row: number;
  end_col: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of columns in Excel (2^14). Used as multiplier for the numeric map key. */
const MAX_COLS = 16384;

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * Viewport-scoped merge index backed by a numeric-keyed Map.
 * Provides O(1) merge lookups for the canvas renderer's hot path.
 */
export class ViewportMergeIndex {
  private _map: Map<number, MergeRegion> = new Map();
  private _merges: MergeRegion[] = [];

  /** Populate the index from binary viewport buffer merge records. */
  setMerges(merges: BinaryMergeInput[]): void {
    this._map.clear();
    this._merges = [];

    for (let i = 0; i < merges.length; i++) {
      const m = merges[i];
      const region: MergeRegion = {
        startRow: m.start_row,
        startCol: m.start_col,
        endRow: m.end_row,
        endCol: m.end_col,
      };
      this._merges.push(region);

      for (let r = region.startRow; r <= region.endRow; r++) {
        for (let c = region.startCol; c <= region.endCol; c++) {
          this._map.set(r * MAX_COLS + c, region);
        }
      }
    }
  }

  /** O(1) - returns the MergeRegion containing (row, col), or null. */
  getMergedRegion(row: number, col: number): MergeRegion | null {
    return this._map.get(row * MAX_COLS + col) ?? null;
  }

  /** Returns all merge regions (for consumers that iterate). */
  getMerges(): readonly MergeRegion[] {
    return this._merges;
  }

  /** Clear all state. */
  clear(): void {
    this._map.clear();
    this._merges = [];
  }

  /** Whether any merges are present. */
  get hasMerges(): boolean {
    return this._merges.length > 0;
  }

  /** Number of merge regions. */
  get mergeCount(): number {
    return this._merges.length;
  }
}
