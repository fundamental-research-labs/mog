/**
 * Viewport Position Index
 *
 * Thin wrapper that provides sync O(1) lookups using position arrays from
 * BinaryViewportBuffer. Replaces DimensionProvider for the hot render path.
 *
 * Position arrays cover the viewport's prefetch range (startRow..endRow,
 * startCol..endCol). For indices outside this range, extrapolates from
 * the nearest known position with the default dimension so callers keep a
 * continuous document-space coordinate system even when the hydrated window
 * contains custom row heights or column widths.
 *
 * @module canvas/coordinates/viewport-position-index
 */

import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../shared/constants';

/**
 * Viewport-scoped position index backed by Float64Arrays from the binary viewport buffer.
 * Provides O(1) position lookups for the canvas renderer's hot path.
 */
export class ViewportPositionIndex {
  private _rowPositions: Float64Array | null = null;
  private _colPositions: Float64Array | null = null;
  private _startRow = 0;
  private _startCol = 0;
  private _rowCount: number | null = null;
  private _colCount: number | null = null;
  private _defaultRowHeight: number;
  private _defaultColWidth: number;
  private _hiddenRows: Set<number> = new Set();
  private _hiddenCols: Set<number> = new Set();
  private _totalRows = 1_048_576;
  private _totalCols = 16_384;

  constructor(defaultRowHeight = DEFAULT_ROW_HEIGHT, defaultColWidth = DEFAULT_COL_WIDTH) {
    this._defaultRowHeight = defaultRowHeight;
    this._defaultColWidth = defaultColWidth;
  }

  /** Update with new position data from viewport buffer */
  setPositions(
    rowPositions: Float64Array | null,
    colPositions: Float64Array | null,
    startRow: number,
    startCol: number,
    rowCount?: number,
    colCount?: number,
    defaultRowHeight?: number,
    defaultColWidth?: number,
  ): void {
    this._rowPositions = rowPositions;
    this._colPositions = colPositions;
    this._startRow = startRow;
    this._startCol = startCol;
    this._rowCount = normalizeCount(rowCount);
    this._colCount = normalizeCount(colCount);
    if (isPositiveFinite(defaultRowHeight)) this._defaultRowHeight = defaultRowHeight;
    if (isPositiveFinite(defaultColWidth)) this._defaultColWidth = defaultColWidth;
  }

  /** O(1) - pixel position of row's top edge. Extrapolates continuously if out of range. */
  getRowTop(row: number): number {
    if (this._rowPositions && this._rowPositions.length > 0) {
      const idx = row - this._startRow;
      if (idx >= 0 && idx < this._rowPositions.length) {
        return this._rowPositions[idx];
      }
      if (idx < 0) {
        return this._rowPositions[0] - (this._startRow - row) * this._defaultRowHeight;
      }

      const lastIdx = this._rowPositions.length - 1;
      const lastTop = this._rowPositions[lastIdx];
      return lastTop + (idx - lastIdx) * this._defaultRowHeight;
    }
    return row * this._defaultRowHeight;
  }

  /** O(1) - pixel position of column's left edge. Extrapolates continuously if out of range. */
  getColLeft(col: number): number {
    if (this._colPositions && this._colPositions.length > 0) {
      const idx = col - this._startCol;
      if (idx >= 0 && idx < this._colPositions.length) {
        return this._colPositions[idx];
      }
      if (idx < 0) {
        return this._colPositions[0] - (this._startCol - col) * this._defaultColWidth;
      }

      const lastIdx = this._colPositions.length - 1;
      const lastLeft = this._colPositions[lastIdx];
      return lastLeft + (idx - lastIdx) * this._defaultColWidth;
    }
    return col * this._defaultColWidth;
  }

  /** O(1) - row height (derived from consecutive positions) */
  getRowHeight(row: number): number {
    if (this._rowPositions) {
      const idx = row - this._startRow;
      if (idx >= 0 && idx < this.realRowCount && idx + 1 < this._rowPositions.length) {
        return this._rowPositions[idx + 1] - this._rowPositions[idx];
      }
    }
    return this._defaultRowHeight;
  }

  /** O(1) - column width (derived from consecutive positions) */
  getColWidth(col: number): number {
    if (this._colPositions) {
      const idx = col - this._startCol;
      if (idx >= 0 && idx < this.realColCount && idx + 1 < this._colPositions.length) {
        return this._colPositions[idx + 1] - this._colPositions[idx];
      }
    }
    return this._defaultColWidth;
  }

  /** Whether position data is available */
  get hasData(): boolean {
    return this._rowPositions !== null && this._colPositions !== null;
  }

  /** Start row of the covered range */
  get startRow(): number {
    return this._startRow;
  }

  /** Start col of the covered range */
  get startCol(): number {
    return this._startCol;
  }

  /** Number of rows covered */
  get rowCount(): number {
    return this.realRowCount;
  }

  /** Number of cols covered */
  get colCount(): number {
    return this.realColCount;
  }

  private get realRowCount(): number {
    if (this._rowCount !== null) return this._rowCount;
    return this._rowPositions?.length ?? 0;
  }

  private get realColCount(): number {
    if (this._colCount !== null) return this._colCount;
    return this._colPositions?.length ?? 0;
  }

  /** End row (exclusive) of the covered range */
  get endRow(): number {
    return this._startRow + this.rowCount;
  }

  /** End col (exclusive) of the covered range */
  get endCol(): number {
    return this._startCol + this.colCount;
  }

  /**
   * Check if a row index is within the covered range.
   */
  isRowInRange(row: number): boolean {
    if (!this._rowPositions) return false;
    const idx = row - this._startRow;
    return idx >= 0 && idx < this.realRowCount;
  }

  /**
   * Check if a column index is within the covered range.
   */
  isColInRange(col: number): boolean {
    if (!this._colPositions) return false;
    const idx = col - this._startCol;
    return idx >= 0 && idx < this.realColCount;
  }

  /**
   * Binary search for the row at a given Y position.
   * Returns an extrapolated row if Y is outside the covered range.
   */
  findRowAtY(y: number): number | null {
    if (!this._rowPositions || this._rowPositions.length === 0) return null;

    const positions = this._rowPositions;
    const firstTop = positions[0];
    const lastRealIdx = this.realRowCount - 1;
    const lastTop = positions[Math.max(0, Math.min(lastRealIdx, positions.length - 1))];

    if (this.realRowCount <= 0) return null;

    if (y < firstTop) {
      const rowsBeforeStart = Math.ceil((firstTop - y) / this._defaultRowHeight);
      return Math.max(0, this._startRow - rowsBeforeStart);
    }
    const lastHeight = this.getRowHeight(this._startRow + lastRealIdx);
    if (y >= lastTop + lastHeight) {
      const lastRow = this._startRow + lastRealIdx;
      const rowsAfterLast = Math.floor((y - lastTop) / this._defaultRowHeight);
      return Math.min(this._totalRows - 1, lastRow + rowsAfterLast);
    }

    let low = 0;
    let high = lastRealIdx;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midTop = positions[mid];
      const nextTop =
        mid + 1 < positions.length ? positions[mid + 1] : midTop + this._defaultRowHeight;

      if (y < midTop) {
        high = mid - 1;
      } else if (y >= nextTop) {
        low = mid + 1;
      } else {
        return mid + this._startRow;
      }
    }

    return low + this._startRow;
  }

  /**
   * Binary search for the column at a given X position.
   * Returns an extrapolated column if X is outside the covered range.
   */
  findColAtX(x: number): number | null {
    if (!this._colPositions || this._colPositions.length === 0) return null;

    const positions = this._colPositions;
    const firstLeft = positions[0];
    const lastRealIdx = this.realColCount - 1;
    const lastLeft = positions[Math.max(0, Math.min(lastRealIdx, positions.length - 1))];

    if (this.realColCount <= 0) return null;

    if (x < firstLeft) {
      const colsBeforeStart = Math.ceil((firstLeft - x) / this._defaultColWidth);
      return Math.max(0, this._startCol - colsBeforeStart);
    }
    const lastWidth = this.getColWidth(this._startCol + lastRealIdx);
    if (x >= lastLeft + lastWidth) {
      const lastCol = this._startCol + lastRealIdx;
      const colsAfterLast = Math.floor((x - lastLeft) / this._defaultColWidth);
      return Math.min(this._totalCols - 1, lastCol + colsAfterLast);
    }

    let low = 0;
    let high = lastRealIdx;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midLeft = positions[mid];
      const nextLeft =
        mid + 1 < positions.length ? positions[mid + 1] : midLeft + this._defaultColWidth;

      if (x < midLeft) {
        high = mid - 1;
      } else if (x >= nextLeft) {
        low = mid + 1;
      } else {
        return mid + this._startCol;
      }
    }

    return low + this._startCol;
  }

  // ---------------------------------------------------------------------------
  // Hidden state
  // ---------------------------------------------------------------------------

  /** Replace the current hidden row/col sets (called from BinaryViewportBuffer wiring) */
  setHiddenState(hiddenRows: Set<number>, hiddenCols: Set<number>): void {
    this._hiddenRows = hiddenRows;
    this._hiddenCols = hiddenCols;
  }

  /** Whether the given row is hidden */
  isRowHidden(row: number): boolean {
    return this._hiddenRows.has(row);
  }

  /** Whether the given column is hidden */
  isColHidden(col: number): boolean {
    return this._hiddenCols.has(col);
  }

  // ---------------------------------------------------------------------------
  // Total dimensions
  // ---------------------------------------------------------------------------

  /** Replace the total row/col counts (defaults to Excel maximums) */
  setTotalDimensions(totalRows: number, totalCols: number): void {
    this._totalRows = totalRows;
    this._totalCols = totalCols;
  }

  /** Total number of rows in the sheet */
  get totalRows(): number {
    return this._totalRows;
  }

  /** Total number of columns in the sheet */
  get totalCols(): number {
    return this._totalCols;
  }
}

function normalizeCount(count: number | undefined): number | null {
  if (count == null) return null;
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
