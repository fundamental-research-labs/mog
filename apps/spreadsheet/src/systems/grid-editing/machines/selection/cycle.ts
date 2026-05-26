/**
 * Selection Machine - Tab/Enter Cycle
 *
 * Reproduces `getNextCellInSelection` (plus its `buildCyclingOptions` viewport
 * lookup) from `actions/handlers/selection/tab-enter.ts` — synchronously and
 * inside the machine layer. This keeps the algorithm near KEY_TAB /
 * KEY_ENTER consult `ctx.getMergedRegionAt` / `ctx.isRowHidden` / `ctx.isColHidden`
 * directly instead of every handler rebuilding a viewport-merges array.
 *
 * The ported algorithm preserves three semantics from the previous handler:
 * 1. **Multi-range cycling.** Tab/Enter walk the union of all selection
 * ranges in the order they appear. After the last cell of one range,
 * the cursor jumps to the first cell of the next range.
 * 2. **Hidden-row/col skipping.** Cells whose row or col is hidden are
 * omitted from the ordered list.
 * 3. **Merge-aware single-stop.** A merged region surfaces in the ordered
 * list at most once, at its origin. The active cell entering a merge at
 * a non-origin position is mapped to the origin for index matching.
 *
 * The async `tab-enter.ts` `await isRowHidden?.(row)` indirection is gone —
 * `ctx.isRowHidden`/`ctx.isColHidden` are sync in the machine context (set
 * via SET_LAYOUT_CALLBACKS), so the cycle is synchronous.
 *
 * @module selection/cycle
 * @see ../../../actions/handlers/selection/tab-enter.ts (handler-side baseline)
 */

import type { CellRange } from '@mog-sdk/contracts/core';

import type { CellCoord } from '../../../shared/types';
import { normalizeRange } from '../../../shared/types';
import { resolveMergeOrigin, type MergedRegionGetter } from './merge-escape';

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Inputs for `getNextCellInSelection`. Mirrors the previous
 * `CyclingOptions` shape but with sync visibility predicates.
 */
export interface CycleOptions {
  /** Sync row-hidden predicate (from `SelectionContext.isRowHidden`). */
  isRowHidden?: (row: number) => boolean;
  /** Sync col-hidden predicate (from `SelectionContext.isColHidden`). */
  isColHidden?: (col: number) => boolean;
  /** Merge-region accessor (from `SelectionContext.getMergedRegionAt`). */
  getMergedRegionAt?: MergedRegionGetter;
}

// =============================================================================
// CYCLE
// =============================================================================

/**
 * Build the ordered list of stop-cells for cycling within `ranges`.
 *
 * Tab uses row-major order (left-to-right within each row, then next row);
 * Enter uses column-major order (top-to-bottom within each column, then next
 * column). Hidden rows/cols are skipped; merges surface only at their origin.
 *
 * Visibility for the merge origin: when a merge has at least one visible
 * cell inside the active range, the origin is included even if the origin
 * row/col itself is hidden. This matches the previous behavior (the
 * `isRowHidden`/`isColHidden` checks gate iteration, not inclusion).
 */
function buildOrderedCells(
  ranges: CellRange[],
  mode: 'tab' | 'enter',
  options: CycleOptions,
): CellCoord[] {
  const { isRowHidden, isColHidden, getMergedRegionAt } = options;
  const seenMergeOrigins = new Set<string>();
  const ordered: CellCoord[] = [];

  for (const range of ranges) {
    const norm = normalizeRange(range);

    if (mode === 'tab') {
      // Row-major: left → right within each row, then next row.
      for (let row = norm.startRow; row <= norm.endRow; row++) {
        if (isRowHidden?.(row)) continue;
        for (let col = norm.startCol; col <= norm.endCol; col++) {
          if (isColHidden?.(col)) continue;
          if (getMergedRegionAt) {
            const merge = getMergedRegionAt(row, col);
            if (merge) {
              const key = `${merge.startRow},${merge.startCol}`;
              if (seenMergeOrigins.has(key)) continue;
              // The merge's origin must lie inside the current range —
              // a merge that overlaps the range only via tail cells doesn't
              // belong to this range's stop set.
              if (
                merge.startRow < norm.startRow ||
                merge.startRow > norm.endRow ||
                merge.startCol < norm.startCol ||
                merge.startCol > norm.endCol
              ) {
                continue;
              }
              seenMergeOrigins.add(key);
              ordered.push({ row: merge.startRow, col: merge.startCol });
              continue;
            }
          }
          ordered.push({ row, col });
        }
      }
    } else {
      // Column-major: top → bottom within each column, then next column.
      for (let col = norm.startCol; col <= norm.endCol; col++) {
        if (isColHidden?.(col)) continue;
        for (let row = norm.startRow; row <= norm.endRow; row++) {
          if (isRowHidden?.(row)) continue;
          if (getMergedRegionAt) {
            const merge = getMergedRegionAt(row, col);
            if (merge) {
              const key = `${merge.startRow},${merge.startCol}`;
              if (seenMergeOrigins.has(key)) continue;
              if (
                merge.startRow < norm.startRow ||
                merge.startRow > norm.endRow ||
                merge.startCol < norm.startCol ||
                merge.startCol > norm.endCol
              ) {
                continue;
              }
              seenMergeOrigins.add(key);
              ordered.push({ row: merge.startRow, col: merge.startCol });
              continue;
            }
          }
          ordered.push({ row, col });
        }
      }
    }
  }

  return ordered;
}

/**
 * Get the next cell in cycle order, wrapping at range bounds.
 *
 * `forward` direction:
 * - Tab → next cell in row-major order; wraps to first cell at end.
 * - Enter → next cell in column-major order; wraps similarly.
 * `backward` direction is the symmetric reverse.
 *
 * Returns `null` to signal "fall back to default keyboard movement" — i.e.,
 * the ranges are empty or contain no visible stops. The previous handler
 * dispatched `commands.selection.keyTab(shift)` in that case; the consumer
 * inside the machine should match that fallback.
 */
export function getNextCellInSelection(
  activeCell: CellCoord,
  ranges: CellRange[],
  direction: 'forward' | 'backward',
  mode: 'tab' | 'enter',
  options: CycleOptions = {},
): CellCoord | null {
  if (ranges.length === 0) return null;

  const ordered = buildOrderedCells(ranges, mode, options);
  if (ordered.length === 0) return null;

  // Map an active cell that's mid-merge back to the merge origin so
  // findIndex can locate it in the ordered list (the list only contains
  // origins for merged regions).
  const search = resolveMergeOrigin(activeCell, options.getMergedRegionAt);
  const currentIndex = ordered.findIndex((c) => c.row === search.row && c.col === search.col);

  if (currentIndex === -1) {
    // Active cell is not in the cycle (selection mutated, focus moved
    // outside, etc.) — restart from the appropriate end.
    return direction === 'forward' ? ordered[0] : ordered[ordered.length - 1];
  }

  const len = ordered.length;
  const nextIndex =
    direction === 'forward' ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
  return ordered[nextIndex];
}

/**
 * Convenience: are there at least two distinct stop-cells in the cycle?
 *
 * The cycle is meaningful only when the ranges list contains a multi-cell
 * stop set. A single-cell selection or a multi-range selection that
 * collapses to one visible stop should fall through to the default Tab/Enter
 * "move freely" behavior. This mirrors `hasMultiCellSelection` from the
 * previous helpers but is merge- and hidden-aware (a 3×3 range entirely
 * inside one merge has only one stop and shouldn't cycle).
 */
export function hasCyclableStops(ranges: CellRange[], options: CycleOptions = {}): boolean {
  if (ranges.length === 0) return false;
  // Cheap fast-path: a single 1×1 range trivially can't cycle.
  if (ranges.length === 1) {
    const r = normalizeRange(ranges[0]);
    if (r.startRow === r.endRow && r.startCol === r.endCol) return false;
  }
  const ordered = buildOrderedCells(ranges, 'tab', options);
  return ordered.length >= 2;
}
