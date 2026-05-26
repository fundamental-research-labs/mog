/**
 * Tracks text overflow visual dependencies between cells.
 *
 * Forward map: sourceCell -> { startCol, endCol } (which columns does this cell's text occupy?)
 * Reverse map: (row, col) -> Set<sourceCol> (which cells' text is rendering in this column?)
 *
 * Incrementally maintained across frames -- dirty cells have entries removed and re-recorded
 * during render; clean cells retain entries from previous frames. On full repaint, clear()
 * wipes everything and all cells re-record from scratch.
 */
export class OverflowIndex {
  // Forward: which columns does this cell's text occupy?
  private forward = new Map<string, { startCol: number; endCol: number }>();
  // Reverse: which cells' text is rendering in this column?
  private reverse = new Map<string, Set<number>>();

  /**
   * Called during CellsLayer.render() BEFORE calculating overflow for a cell.
   * Removes the cell's previous overflow entries so they can be re-recorded.
   * Must be called for every cell that is rendered (even if it no longer overflows).
   */
  removeCell(row: number, col: number): void {
    const fwdKey = `${row},${col}`;
    const extent = this.forward.get(fwdKey);
    if (!extent) return;
    for (let c = extent.startCol; c <= extent.endCol; c++) {
      if (c === col) continue;
      const revKey = `${row},${c}`;
      const sources = this.reverse.get(revKey);
      if (sources) {
        sources.delete(col);
        if (sources.size === 0) this.reverse.delete(revKey);
      }
    }
    this.forward.delete(fwdKey);
  }

  /**
   * Called during CellsLayer.render() after calculateTextOverflow().
   * Records that cell (row, sourceCol) visually occupies columns [startCol, endCol].
   * Caller must call removeCell() first to clear stale entries.
   */
  record(row: number, sourceCol: number, startCol: number, endCol: number): void {
    const fwdKey = `${row},${sourceCol}`;
    this.forward.set(fwdKey, { startCol, endCol });
    for (let col = startCol; col <= endCol; col++) {
      if (col === sourceCol) continue;
      const revKey = `${row},${col}`;
      let sources = this.reverse.get(revKey);
      if (!sources) {
        sources = new Set();
        this.reverse.set(revKey, sources);
      }
      sources.add(sourceCol);
    }
  }

  /**
   * Given a dirty cell (row, col), returns all source cells whose text was
   * rendering in that cell's pixel space (from the previous frame).
   */
  getOverflowSources(row: number, col: number): Set<number> | undefined {
    return this.reverse.get(`${row},${col}`);
  }

  /**
   * Given a dirty cell (row, col), returns the columns it was overflowing
   * into (from the previous frame).
   */
  getOverflowExtent(row: number, col: number): { startCol: number; endCol: number } | undefined {
    return this.forward.get(`${row},${col}`);
  }

  /** Full reset -- called only on full repaint (scroll, resize) before re-rendering all cells. */
  clear(): void {
    this.forward.clear();
    this.reverse.clear();
  }
}
