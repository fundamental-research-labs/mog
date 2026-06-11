/**
 * GridRenderScheduler — Bridges buffer writes to canvas layer invalidation.
 *
 * Implements the "Write = Invalidate" contract: when the BinaryViewportBuffer
 * receives patches, it calls these methods to mark the appropriate canvas
 * layers dirty and wake the render loop.
 *
 * Two-phase dirty expansion pipeline for cell mutations:
 *   Step 1: dependency expansion (render-derived) — delegates to DirtyCellExpander
 *   Step 2: coordinate resolution (data-derived) — resolves cells to pixel rects
 */

import {
  docSpaceRect,
  type CanvasEngine,
  type DirtyCellExpander,
  type DirtyHint,
  type DocSpaceRect,
  type Rect,
  type RenderScheduler,
} from '@mog/canvas-engine';
import type { LayerName } from '@mog-sdk/contracts/rendering';

import type { ViewportMergeIndex } from '@mog/grid-renderer';
import type { ViewportPositionIndex } from '@mog/grid-renderer';

/** Layer IDs that need invalidation for cell content/format changes */
const CELL_LAYERS: readonly LayerName[] = ['cells'];

/**
 * Large structural edits can emit hundreds of thousands of cell patches.
 * Resolving each to a precise dirty rect blocks the main thread longer than a
 * full repaint and the accumulator coalesces large rect sets anyway.
 */
const MAX_PRECISE_DIRTY_CELLS = 10_000;

/** Layer IDs for geometry changes (row/col dimensions) */
const GEOMETRY_LAYERS: readonly LayerName[] = [
  'cells',
  'headers',
  'selection',
  'background',
  'sticky-headers',
  'dividers',
];

export class GridRenderScheduler implements RenderScheduler {
  private engine: CanvasEngine;
  private _positionIndex: ViewportPositionIndex | null = null;
  private _mergeIndex: ViewportMergeIndex | null = null;
  private _cellExpander: DirtyCellExpander | null = null;

  constructor(engine: CanvasEngine) {
    this.engine = engine;
  }

  /** Inject ViewportPositionIndex for cell→pixel resolution. */
  setPositionIndex(index: ViewportPositionIndex | null): void {
    this._positionIndex = index;
  }

  /** Inject ViewportMergeIndex for merge-aware pixel bounds. */
  setMergeIndex(index: ViewportMergeIndex | null): void {
    this._mergeIndex = index;
  }

  /** Inject DirtyCellExpander for render-derived dependency expansion. */
  setCellExpander(expander: DirtyCellExpander | null): void {
    this._cellExpander = expander;
  }

  private markCellLayersFullDirty(): void {
    for (const layerId of CELL_LAYERS) {
      this.engine.markDirty(layerId);
    }
    this.engine.requestFrame();
  }

  markCellsDirty(cells?: { row: number; col: number }[]): void {
    if (!cells || cells.length === 0 || !this._positionIndex) {
      // No cells specified or no position index — fall back to full dirty
      this.markCellLayersFullDirty();
      return;
    }

    if (cells.length > MAX_PRECISE_DIRTY_CELLS) {
      this.markCellLayersFullDirty();
      return;
    }

    // Step 1: dependency expansion (render-derived)
    const expandedCells = this._cellExpander ? this._cellExpander.expandDirtyCells(cells) : cells;
    if (expandedCells.length > MAX_PRECISE_DIRTY_CELLS) {
      this.markCellLayersFullDirty();
      return;
    }

    // Step 2: coordinate resolution (data-derived)
    const pi = this._positionIndex;
    const mi = this._mergeIndex;
    const rects: DocSpaceRect[] = [];

    for (const { row, col } of expandedCells) {
      // Check for merged region
      const merge = mi?.getMergedRegion(row, col);
      if (merge) {
        // Use full merge pixel bounds
        const mergeX = pi.getColLeft(merge.startCol);
        const mergeY = pi.getRowTop(merge.startRow);
        let mergeWidth = 0;
        for (let c = merge.startCol; c <= merge.endCol; c++) {
          mergeWidth += pi.getColWidth(c);
        }
        let mergeHeight = 0;
        for (let r = merge.startRow; r <= merge.endRow; r++) {
          mergeHeight += pi.getRowHeight(r);
        }
        rects.push(docSpaceRect(mergeX, mergeY, mergeWidth, mergeHeight));
      } else {
        // Regular cell pixel bounds (doc-space from ViewportPositionIndex)
        rects.push(
          docSpaceRect(
            pi.getColLeft(col),
            pi.getRowTop(row),
            pi.getColWidth(col),
            pi.getRowHeight(row),
          ),
        );
      }
    }

    const hint: DirtyHint =
      rects.length === 1 ? { type: 'rect', bounds: rects[0] } : { type: 'rects', bounds: rects };

    for (const layerId of CELL_LAYERS) {
      this.engine.markDirty(layerId, hint);
    }
    this.engine.requestFrame();
  }

  markGeometryDirty(): void {
    for (const layerId of GEOMETRY_LAYERS) {
      this.engine.markDirty(layerId);
    }
    this.engine.requestFrame();
  }

  markAllDirty(): void {
    for (const layerId of [...CELL_LAYERS, ...GEOMETRY_LAYERS]) {
      this.engine.markDirty(layerId);
    }
    this.engine.requestFrame();
  }
}
