/**
 * Viewport prefetch utilities — overscan bounds computation and containment checks.
 *
 * When scrolling within the prefetch region, the data is already in the binary
 * buffer, so no Rust IPC call is needed. Only when the visible window moves
 * outside the prefetch bounds do we fetch a new oversized buffer.
 *
 * Per-viewport prefetch: Each viewport region (frozen-corner,
 * frozen-rows, frozen-cols, main) has its own prefetch state with
 * scroll-direction-aware overscan. This eliminates the bounding-box union
 * that wasted ~2.4MB with frozen rows scrolled to distant rows.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Numeric viewport bounds (row/col ranges, no sheetId). */
export interface PrefetchBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface PrefetchConfig {
  overscanRows: number;
  overscanCols: number;
}

/**
 * Scroll behavior types for viewport regions.
 * Determines which directions get overscan.
 */
export type ViewportScrollBehavior =
  | 'none' // frozen-corner: no scroll, no overscan
  | 'horizontal-only' // frozen-rows: scrolls horizontally only
  | 'vertical-only' // frozen-cols: scrolls vertically only
  | 'free'; // main: full scroll, full overscan

/**
 * Per-viewport prefetch state. Each registered viewport region maintains
 * its own prefetch bounds and dirty tracking.
 */
export interface ViewportPrefetchState {
  /** Viewport region ID (e.g., 'main', 'frozen-corner', 'frozen-rows', 'frozen-cols') */
  viewportId: string;
  /** How this viewport scrolls — determines overscan strategy */
  scrollBehavior: ViewportScrollBehavior;
  /** Current prefetch bounds (oversized region around visible window), null if never fetched */
  prefetchBounds: PrefetchBounds | null;
  /** The visible bounds at last fetch */
  lastVisibleBounds: PrefetchBounds | null;
  /** Dirty tracking for three-tier invalidation */
  prefetchDirtyState: {
    staleCells: Set<number>;
    dirtyRegion: 'full' | 'partial' | null;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

// Fast wheel/trackpad scroll can advance hundreds of rows before the next
// viewport fetch commits. Keep enough row runway for visible content to stay
// readable during sustained scrolling without leaving the production data path.
const DEFAULT_OVERSCAN_ROWS = 1000;
const DEFAULT_OVERSCAN_COLS = 64;

// ---------------------------------------------------------------------------
// Per-viewport prefetch config
// ---------------------------------------------------------------------------

/**
 * Get the prefetch config for a viewport based on its scroll behavior.
 *
 * - frozen-corner: zero overscan (always small and static)
 * - frozen-rows: overscan only horizontally
 * - frozen-cols: overscan only vertically
 * - main: full overscan in both directions
 */
export function getPrefetchConfigForViewport(
  scrollBehavior: ViewportScrollBehavior,
): PrefetchConfig {
  switch (scrollBehavior) {
    case 'none':
      // Frozen corner: no overscan needed
      return { overscanRows: 0, overscanCols: 0 };
    case 'horizontal-only':
      // Frozen rows: only scrolls horizontally, overscan in cols only
      return { overscanRows: 0, overscanCols: DEFAULT_OVERSCAN_COLS };
    case 'vertical-only':
      // Frozen cols: only scrolls vertically, overscan in rows only
      return { overscanRows: DEFAULT_OVERSCAN_ROWS, overscanCols: 0 };
    case 'free':
      // Main viewport: full overscan
      return { overscanRows: DEFAULT_OVERSCAN_ROWS, overscanCols: DEFAULT_OVERSCAN_COLS };
  }
}

/**
 * Determine if a viewport region can skip refetch based on scroll direction.
 *
 * Smart skip logic:
 * - frozen-corner: skip if bounds unchanged since last fetch
 * - frozen-rows: skip if only vertical scroll changed (row bounds same)
 * - frozen-cols: skip if only horizontal scroll changed (col bounds same)
 * - main: never skip (always check prefetch containment)
 */
export function canSkipRefetch(
  scrollBehavior: ViewportScrollBehavior,
  currentBounds: PrefetchBounds,
  lastBounds: PrefetchBounds | null,
): boolean {
  if (!lastBounds) return false;

  switch (scrollBehavior) {
    case 'none':
      // Frozen corner: skip if bounds haven't changed at all
      return boundsEqual(currentBounds, lastBounds);
    case 'horizontal-only':
      // Frozen rows: skip if only vertical scroll changed (col range unchanged)
      return (
        currentBounds.startCol === lastBounds.startCol &&
        currentBounds.endCol === lastBounds.endCol &&
        currentBounds.startRow === lastBounds.startRow &&
        currentBounds.endRow === lastBounds.endRow
      );
    case 'vertical-only':
      // Frozen cols: skip if only horizontal scroll changed (row range unchanged)
      return (
        currentBounds.startRow === lastBounds.startRow &&
        currentBounds.endRow === lastBounds.endRow &&
        currentBounds.startCol === lastBounds.startCol &&
        currentBounds.endCol === lastBounds.endCol
      );
    case 'free':
      // Main viewport: never skip via this path (use prefetch containment instead)
      return false;
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Normalize viewport bounds before they cross the Rust bridge.
 *
 * Some pane layouts legitimately produce a degenerate visible range, e.g. a
 * frozen-corner viewport with no frozen columns has `endCol: -1`. The Rust ABI
 * takes unsigned coordinates, so negative ends must be collapsed before IPC
 * instead of wrapping to `u32::MAX`.
 */
export function normalizeViewportBounds(
  bounds: PrefetchBounds,
  sheetDimensions: { maxRow: number; maxCol: number } = { maxRow: 1048576, maxCol: 16384 },
): PrefetchBounds {
  const maxRow = Math.max(0, sheetDimensions.maxRow);
  const maxCol = Math.max(0, sheetDimensions.maxCol);
  const startRow = Math.min(maxRow, Math.max(0, bounds.startRow));
  const startCol = Math.min(maxCol, Math.max(0, bounds.startCol));
  const endRow = Math.min(maxRow, Math.max(startRow, bounds.endRow));
  const endCol = Math.min(maxCol, Math.max(startCol, bounds.endCol));

  return {
    startRow,
    startCol,
    endRow,
    endCol,
  };
}

/**
 * Compute oversized prefetch bounds around the visible area.
 * Clamps to [0, sheetDimensions.maxRow/maxCol].
 */
export function computePrefetchBounds(
  visibleBounds: PrefetchBounds,
  sheetDimensions: { maxRow: number; maxCol: number },
  config: PrefetchConfig = {
    overscanRows: DEFAULT_OVERSCAN_ROWS,
    overscanCols: DEFAULT_OVERSCAN_COLS,
  },
): PrefetchBounds {
  return normalizeViewportBounds(
    {
      startRow: visibleBounds.startRow - config.overscanRows,
      startCol: visibleBounds.startCol - config.overscanCols,
      endRow: visibleBounds.endRow + config.overscanRows,
      endCol: visibleBounds.endCol + config.overscanCols,
    },
    sheetDimensions,
  );
}

/**
 * Check whether the visible bounds are fully contained within the prefetch bounds.
 * If true, no Rust call is needed — the data is already in the buffer.
 */
export function isWithinPrefetch(
  visibleBounds: PrefetchBounds,
  prefetchBounds: PrefetchBounds,
): boolean {
  return (
    visibleBounds.startRow >= prefetchBounds.startRow &&
    visibleBounds.startCol >= prefetchBounds.startCol &&
    visibleBounds.endRow <= prefetchBounds.endRow &&
    visibleBounds.endCol <= prefetchBounds.endCol
  );
}

/**
 * Check whether two bounds rectangles are identical.
 */
export function boundsEqual(a: PrefetchBounds, b: PrefetchBounds): boolean {
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol
  );
}
