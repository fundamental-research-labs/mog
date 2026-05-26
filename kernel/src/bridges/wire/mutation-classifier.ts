/**
 * Three-tier mutation classifier for viewport prefetch invalidation.
 *
 * Tiers:
 *   - 'patch':      All changes are within the visible area and already patched in-place.
 *   - 'dirty':      Changes exist in the prefetch zone (outside visible, inside prefetch).
 *                   The buffer is still usable but some prefetched cells are stale.
 *   - 'invalidate': Structural changes that require a full prefetch refresh.
 */

import type { MutationResult } from '../compute/compute-types.gen';
import type { PrefetchBounds } from './viewport-prefetch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationTier = 'patch' | 'dirty' | 'invalidate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInBounds(row: number, col: number, bounds: PrefetchBounds): boolean {
  return (
    row >= bounds.startRow && row < bounds.endRow && col >= bounds.startCol && col < bounds.endCol
  );
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a MutationResult into one of three invalidation tiers.
 *
 * @param result - The mutation result from Rust.
 * @param isStructural - Whether the mutation was a structural change (insert/delete rows/cols).
 * @param prefetchBounds - The current prefetch bounds, or null if no prefetch is active.
 * @param visibleBounds - The current visible bounds, or null if unknown.
 * @returns The invalidation tier.
 */
export function classifyMutation(
  result: MutationResult,
  isStructural: boolean,
  prefetchBounds: PrefetchBounds | null,
  visibleBounds: PrefetchBounds | null,
): MutationTier {
  // No prefetch or no visible bounds → always invalidate
  if (!prefetchBounds || !visibleBounds) return 'invalidate';

  // Tier 3: Structural changes always invalidate
  if (isStructural) return 'invalidate';
  if (result.sortingChanges?.length) return 'invalidate';
  if (result.visibilityChanges?.length) return 'invalidate';
  if (result.dimensionChanges?.length) return 'invalidate';
  if (result.filterChanges?.length) return 'invalidate';
  if (result.cfChanges?.length) return 'invalidate';
  if (result.commentChanges?.length) return 'invalidate';

  // Tier 2: Recalc changes outside visible but inside prefetch
  if (!result.recalc) return 'patch';
  const hasOutOfViewportChanges = result.recalc.changedCells.some((cell) => {
    const pos = cell.position;
    if (!pos) return false;
    return (
      isInBounds(pos.row, pos.col, prefetchBounds) && !isInBounds(pos.row, pos.col, visibleBounds)
    );
  });

  const hasOutOfViewportProjections = result.recalc.projectionChanges?.some((proj) =>
    proj.projectionCells?.some(
      (c) => isInBounds(c.row, c.col, prefetchBounds) && !isInBounds(c.row, c.col, visibleBounds),
    ),
  );

  if (hasOutOfViewportChanges || hasOutOfViewportProjections) return 'dirty';

  // Tier 1: All changes are patchable in-place (handled by applyBinaryMutation)
  return 'patch';
}
