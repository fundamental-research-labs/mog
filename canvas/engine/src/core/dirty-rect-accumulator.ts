import type { Rect, DocSpaceRect, DirtyHint } from './types';

/**
 * Accumulates dirty regions for a single layer within a frame.
 *
 * Replaces the boolean `_dirty` flag with rect-level granularity.
 * Multiple `add()` calls merge hints:
 * - Any `full` hint promotes the entire accumulator to full
 * - Rect hints accumulate until a threshold, then coalesce
 * - If the union area exceeds 50% of the viewport, promotes to full
 *
 * Between frames: callers add hints via `add()`.
 * At render time: the render loop reads via `isDirty()`, `isFull()`, `getRects()`.
 * After render: `clear()` resets for the next frame.
 */
export class DirtyRectAccumulator {
  private _rects: DocSpaceRect[] = [];
  private _full = false;

  /** Maximum number of discrete rects before coalescing */
  private static readonly COALESCE_THRESHOLD = 16;

  /** If union area exceeds this fraction of viewport, promote to full */
  private static readonly FULL_PROMOTION_RATIO = 0.5;

  add(hint: DirtyHint): void {
    if (hint.type === 'full') {
      this._full = true;
      this._rects.length = 0; // no point keeping rects
      return;
    }
    if (this._full) return; // already full, ignore further rects

    if (hint.type === 'regions') {
      // Region hints promote to full (no geometric info available)
      this._full = true;
      this._rects.length = 0;
      return;
    }

    if (hint.type === 'rect') {
      this._rects.push(hint.bounds);
    } else if (hint.type === 'rects') {
      if (this._rects.length + hint.bounds.length > DirtyRectAccumulator.COALESCE_THRESHOLD) {
        this.mergeRectsIntoBoundingUnion(hint.bounds);
      } else {
        for (const bounds of hint.bounds) {
          this._rects.push(bounds);
        }
      }
    }

    if (this._rects.length > DirtyRectAccumulator.COALESCE_THRESHOLD) {
      this.coalesce();
    }
  }

  isDirty(): boolean {
    return this._full || this._rects.length > 0;
  }

  isFull(): boolean {
    return this._full;
  }

  getRects(): readonly DocSpaceRect[] {
    return this._rects;
  }

  clear(): void {
    this._rects.length = 0;
    this._full = false;
  }

  /**
   * Promote to full dirty. Used by the render loop when scroll
   * offset changes between frames (dirty rects would be in stale coordinates).
   */
  promoteToFull(): void {
    this._full = true;
    this._rects.length = 0;
  }

  /**
   * Merge overlapping/adjacent rects. If the resulting union exceeds
   * FULL_PROMOTION_RATIO of the given viewport area, promote to full.
   */
  coalesce(viewportArea?: number): void {
    if (this._full || this._rects.length <= 1) return;

    // Compute bounding union of all rects
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of this._rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    const unionArea = (maxX - minX) * (maxY - minY);

    // If union area exceeds threshold of viewport, promote to full
    if (viewportArea !== undefined && viewportArea > 0) {
      if (unionArea / viewportArea > DirtyRectAccumulator.FULL_PROMOTION_RATIO) {
        this._full = true;
        this._rects.length = 0;
        return;
      }
    }

    // Replace all rects with the bounding union (stays in doc-space)
    this._rects.length = 0;
    this._rects.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    } as DocSpaceRect);
  }

  private mergeRectsIntoBoundingUnion(rects: readonly DocSpaceRect[]): void {
    if (rects.length === 0) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const r of this._rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    this._rects.length = 0;
    this._rects.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    } as DocSpaceRect);
  }
}
