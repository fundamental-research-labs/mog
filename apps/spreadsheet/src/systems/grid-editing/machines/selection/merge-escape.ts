/**
 * Selection Machine - Merge Escape Helper
 *
 * Centralizes "navigate one cell past a merged region in the arrow direction"
 * for KEY_ARROW / KEY_HOME / KEY_END / KEY_TAB / KEY_ENTER. Consumes
 * `ctx.getMergedRegionAt` (set via SET_LAYOUT_CALLBACKS by the coordinator).
 *
 * Before this helper, merge-escape was reimplemented per-handler in
 * `actions/handlers/selection/movement.ts` (4× via `createMergedRegionGetter`)
 * and the cycle helpers in `tab-enter.ts` had their own viewport-merge lookup.
 * promotes merge resolution into `SelectionContext` so every
 * navigation path resolves merges through one machine-internal site.
 *
 * Behavior:
 * - If `getMergedRegionAt` is not yet wired (e.g., very early in the React
 * bootstrap before the `useEffect` runs, or in unit tests that don't push
 * layout callbacks), the helper degrades gracefully — it returns the
 * target cell unchanged.
 * - If the target cell is *not* in a merge, it's returned unchanged.
 * - If the target cell is in a merge, the helper jumps one cell past the
 * merge boundary in the arrow direction. Adjacent merges are treated as one
 * continuous obstacle: the helper keeps resolving until it reaches an
 * unmerged cell or a sheet boundary. If the post-merge cell would go
 * off-sheet, it falls back to the boundary merge's origin.
 *
 * @module selection/merge-escape
 */

import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';

import type { CellCoord, Direction } from '../../../shared/types';

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Sync merge-region accessor. Same shape as
 * `SelectionContext['getMergedRegionAt']`. Pulled into a named alias so the
 * helper does not import from `./types.ts` (cycle-prevention).
 */
export type MergedRegionGetter = (row: number, col: number) => CellRange | null;

// =============================================================================
// MERGE ESCAPE
// =============================================================================

/**
 * Given a target cell `(row, col)` arrived at via an arrow-direction move,
 * decide whether the move should "escape" the merged region the cell sits in.
 *
 * The helper is intentionally direction-aware: a merge of `B2:D4` reached by
 * moving `right` should land at `E?` (post-merge column on whatever the
 * caller's row is); the same merge reached by moving `down` should land at
 * `?5` (post-merge row).
 *
 * If the post-merge cell would be off-sheet (e.g., merge extends to the last
 * column and we're moving right), the helper falls back to the merge's
 * origin — matching the previous behavior in `movement.ts`'s
 * `createMergedRegionGetter` consumers.
 *
 * @param target - The cell we'd land on without merge-aware adjustment.
 * @param direction - Arrow direction the user moved in.
 * @param getMergedRegionAt - Optional merge-region accessor (from ctx).
 * @returns The adjusted cell — `target` itself if no merge or no callback.
 */
export function escapeMergeOnMove(
  target: CellCoord,
  direction: Direction,
  getMergedRegionAt: MergedRegionGetter | undefined,
): CellCoord {
  if (!getMergedRegionAt) return target;

  let current = target;
  const seenMerges = new Set<string>();

  for (;;) {
    const merge = getMergedRegionAt(current.row, current.col);
    if (!merge) return current;

    const key = `${merge.startRow}:${merge.startCol}:${merge.endRow}:${merge.endCol}`;
    if (seenMerges.has(key)) {
      return { row: merge.startRow, col: merge.startCol };
    }
    seenMerges.add(key);

    switch (direction) {
      case 'right': {
        const nextCol = merge.endCol + 1;
        if (nextCol >= MAX_COLS) {
          return { row: merge.startRow, col: merge.startCol };
        }
        // Stay on the row the caller targeted, jump past the merge horizontally.
        current = { row: current.row, col: nextCol };
        break;
      }
      case 'left': {
        const prevCol = merge.startCol - 1;
        if (prevCol < 0) {
          return { row: merge.startRow, col: merge.startCol };
        }
        current = { row: current.row, col: prevCol };
        break;
      }
      case 'down': {
        const nextRow = merge.endRow + 1;
        if (nextRow >= MAX_ROWS) {
          return { row: merge.startRow, col: merge.startCol };
        }
        current = { row: nextRow, col: current.col };
        break;
      }
      case 'up': {
        const prevRow = merge.startRow - 1;
        if (prevRow < 0) {
          return { row: merge.startRow, col: merge.startCol };
        }
        current = { row: prevRow, col: current.col };
        break;
      }
    }
  }
}

/**
 * Resolve a cell to the merge origin if it sits inside a merged region. Used
 * by the Tab/Enter cycle to (a) map an active cell that's mid-merge back to
 * the merge anchor for `findIndex` matching against the ordered cycle list,
 * and (b) by Home/End fallbacks that should not land on a non-origin cell of
 * a merge.
 *
 * Returns the cell unchanged when there's no merge or no callback.
 */
export function resolveMergeOrigin(
  cell: CellCoord,
  getMergedRegionAt: MergedRegionGetter | undefined,
): CellCoord {
  if (!getMergedRegionAt) return cell;
  const merge = getMergedRegionAt(cell.row, cell.col);
  if (!merge) return cell;
  return { row: merge.startRow, col: merge.startCol };
}
