/**
 * ViewportFetchManager — Owns the viewport movement pipeline.
 *
 * This class manages fetching fresh viewport data from Rust when the user
 * moves the viewport window (scroll, resize, sheet switch). It is NEVER
 * triggered by mutations — the mutation pipeline produces complete sync
 * patches independently via `ViewportCoordinatorRegistry.applyMultiViewportPatches()`.
 *
 * The two pipelines write to the same per-viewport buffers but are
 * architecturally independent:
 *
 *   MUTATION PIPELINE (Rust-owned)        VIEWPORT MOVEMENT PIPELINE (TS-owned)
 *   ─────────────────────────────         ─────────────────────────────────────
 *   Trigger: any data mutation            Trigger: scroll, resize, sheet switch
 *   Path:    mutateCore() → patches       Path:    refresh() → IPC fetch
 *   Guarantee: COMPLETE (sync)            Guarantee: EVENTUALLY CONSISTENT (async)
 *
 * Buffer ownership: The ViewportCoordinator is the sole owner of each viewport's
 * BinaryViewportBuffer. This class never stores or caches coordinator references —
 * it looks them up from the registry on every operation. This eliminates zombie
 * reference hazards when the registry disposes a coordinator.
 *
 * Lifecycle: created by ComputeCore, destroyed when ComputeCore is destroyed.
 */

import type { BridgeTransport } from '@rust-bridge/client';

import type { CellAccessor, ViewportBounds } from '../wire/binary-viewport-buffer';
import type {
  ReadonlyBinaryViewportBuffer,
  ViewportCoordinator,
} from '../wire/viewport-coordinator';
import { ViewportCoordinatorRegistry } from '../wire/viewport-coordinator-registry';
import type {
  PrefetchConfig,
  PrefetchBounds,
  ViewportPrefetchState,
  ViewportScrollBehavior,
} from '../wire/viewport-prefetch';
import {
  canSkipRefetch,
  computePrefetchBounds,
  getPrefetchConfigForViewport,
  isWithinPrefetch,
} from '../wire/viewport-prefetch';

// ---------------------------------------------------------------------------
// Viewport delta helpers
// ---------------------------------------------------------------------------

/**
 * Check whether two prefetch rectangles overlap.
 * Used to determine if a delta request can reduce transfer size.
 */
function hasOverlap(a: PrefetchBounds, b: PrefetchBounds): boolean {
  return (
    a.startRow < b.endRow && a.endRow > b.startRow && a.startCol < b.endCol && a.endCol > b.startCol
  );
}

// Horizontal wheel bursts in the free viewport need column runway, but should
// not materially expand the off-axis row fetch during dense movement.
const HORIZONTAL_FREE_SCROLL_OVERSCAN_ROWS = 32;
const HORIZONTAL_FREE_SCROLL_OVERSCAN_COLS = 64;

function isHorizontalOnlyMovement(
  current: PrefetchBounds,
  previous: PrefetchBounds | null,
): boolean {
  return (
    previous !== null &&
    current.startRow === previous.startRow &&
    current.endRow === previous.endRow &&
    (current.startCol !== previous.startCol || current.endCol !== previous.endCol)
  );
}

function prefetchConfigForMovement(
  scrollBehavior: ViewportScrollBehavior,
  visibleBounds: PrefetchBounds,
  lastVisibleBounds: PrefetchBounds | null,
): PrefetchConfig {
  if (scrollBehavior === 'free' && isHorizontalOnlyMovement(visibleBounds, lastVisibleBounds)) {
    return {
      overscanRows: HORIZONTAL_FREE_SCROLL_OVERSCAN_ROWS,
      overscanCols: HORIZONTAL_FREE_SCROLL_OVERSCAN_COLS,
    };
  }
  return getPrefetchConfigForViewport(scrollBehavior);
}

// ---------------------------------------------------------------------------
// ViewportFetchManager class
// ---------------------------------------------------------------------------

/**
 * Owns the viewport movement pipeline (scroll, resize, sheet switch).
 * Never triggered by mutations. The mutation pipeline writes to the same
 * buffers via `ViewportCoordinatorRegistry.applyMultiViewportPatches()`, but the
 * two systems are independent.
 */
export class ViewportFetchManager {
  // --- State (moved from ComputeCore) ---

  /**
   * Per-viewport prefetch state map. Each viewport region (frozen-corner,
   * frozen-rows, frozen-cols, main) has its own prefetch bounds and dirty tracking.
   *
   * Coordinators are NOT cached here — they are looked up from the registry
   * on every operation to avoid zombie references.
   */
  private perViewportState: Map<string, ViewportPrefetchState> = new Map();

  /** Per-viewport CellAccessor cache — one flyweight per viewport buffer. */
  private perViewportAccessors: Map<string, CellAccessor> = new Map();

  /** Monotonic request token per viewport. Older movement fetches are discarded. */
  private perViewportFetchSeq: Map<string, number> = new Map();

  constructor(
    private transport: BridgeTransport,
    private docId: string,
    private coordinatorRegistry: ViewportCoordinatorRegistry,
    private readonly getShowFormulasForSheet: (sheetId: string) => boolean,
  ) {}

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Get or create per-viewport prefetch state.
   * Ensures the coordinator is registered but does NOT cache it.
   * Always returns a defined state — eliminates `| undefined` narrowing issues.
   */
  private getOrCreateState(
    viewportId: string,
    sheetId: string,
    scrollBehavior: ViewportScrollBehavior,
  ): ViewportPrefetchState {
    const existing = this.perViewportState.get(viewportId);
    if (existing) return existing;

    // Register with the coordinator registry — the coordinator owns the buffer.
    const coordinator = this.coordinatorRegistry.register(viewportId);
    coordinator.setSheetId(sheetId);
    // Tag the buffer with its scroll behavior so the accessor's moveTo gate
    // knows whether to clip backward overscan into frozen panes (free=both
    // axes, vertical-only=row only, horizontal-only=col not gated, none=no-op).
    coordinator.setScrollBehavior(scrollBehavior);

    const state: ViewportPrefetchState = {
      viewportId,
      scrollBehavior,
      prefetchBounds: null,
      lastVisibleBounds: null,
      prefetchDirtyState: { staleCells: new Set(), dirtyRegion: null },
    };
    this.perViewportState.set(viewportId, state);
    return state;
  }

  /**
   * Upsert the Rust-side viewport registration for the exact TS coordinator
   * that will receive mutation patches.
   *
   * `compute_update_viewport_bounds` is intentionally not used here: Rust
   * treats updates for unknown viewport IDs as no-ops. A refresh is the first
   * lifecycle point for many web viewports, so the movement pipeline must
   * establish the first-class viewport identity before fetching data.
   */
  private async syncViewportRegistration(
    viewportId: string,
    sheetId: string,
    bounds: PrefetchBounds,
  ): Promise<void> {
    await this.transport.call<void>('compute_register_viewport', {
      docId: this.docId,
      viewportId,
      sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
  }

  private stripSheetId(bounds: ViewportBounds): PrefetchBounds {
    return {
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    };
  }

  /**
   * Force refreshes bypass refresh(), so mirror the committed coordinator
   * buffer back into the per-viewport cache that render/devtools consumers read.
   */
  private markForceRefreshedViewportFresh(coordinator: ViewportCoordinator): void {
    const vpState = this.perViewportState.get(coordinator.viewportId);
    if (!vpState) return;

    const refreshedBufferBounds = coordinator.base.getBounds();
    const visibleWindow = coordinator.base.getVisibleWindow();

    if (refreshedBufferBounds) {
      vpState.prefetchBounds = this.stripSheetId(refreshedBufferBounds);
    }
    if (visibleWindow) {
      vpState.lastVisibleBounds = this.stripSheetId(visibleWindow);
    }
    vpState.prefetchDirtyState = { staleCells: new Set(), dirtyRegion: null };
  }

  // ===========================================================================
  // Public API (moved from ComputeCore)
  // ===========================================================================

  /**
   * Refresh data for a single viewport region.
   *
   * Called on scroll, resize, sheet switch — never by a mutation code path.
   */
  async refresh(
    viewportId: string,
    sheetId: string,
    bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
    scrollBehavior: ViewportScrollBehavior = 'free',
  ): Promise<void> {
    const vpState = this.getOrCreateState(viewportId, sheetId, scrollBehavior);
    const fetchSeq = (this.perViewportFetchSeq.get(viewportId) ?? 0) + 1;
    this.perViewportFetchSeq.set(viewportId, fetchSeq);

    // Update scroll behavior (may change on viewport config change)
    if (vpState.scrollBehavior !== scrollBehavior) {
      vpState.scrollBehavior = scrollBehavior;
      this.coordinatorRegistry.get(viewportId)?.setScrollBehavior(scrollBehavior);
    }

    const visibleBounds: PrefetchBounds = {
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    };

    // Smart skip: check if this viewport can skip refetch based on scroll direction
    if (canSkipRefetch(scrollBehavior, visibleBounds, vpState.lastVisibleBounds)) {
      if (vpState.prefetchBounds) {
        await this.syncViewportRegistration(viewportId, sheetId, vpState.prefetchBounds);
      }
      return;
    }

    // Look up coordinator from registry (single source of truth)
    const coordinator = this.coordinatorRegistry.get(viewportId)!;

    // Prefetch containment check: if visible bounds within existing prefetch, skip
    if (
      vpState.prefetchBounds &&
      coordinator.hasBuffer() &&
      isWithinPrefetch(visibleBounds, vpState.prefetchBounds)
    ) {
      await this.syncViewportRegistration(viewportId, sheetId, vpState.prefetchBounds);
      coordinator.setVisibleWindow({
        sheetId,
        startRow: bounds.startRow,
        startCol: bounds.startCol,
        endRow: bounds.endRow,
        endCol: bounds.endCol,
      });
      vpState.lastVisibleBounds = visibleBounds;
      return;
    }

    // Need to fetch — compute per-viewport prefetch bounds
    const prefetchConfig = prefetchConfigForMovement(
      scrollBehavior,
      visibleBounds,
      vpState.lastVisibleBounds,
    );
    const sheetDims = { maxRow: 1048576, maxCol: 16384 };
    const prefetch = computePrefetchBounds(visibleBounds, sheetDims, prefetchConfig);

    // Delta path: if we have an existing buffer with overlap, request only the new strip
    const canDelta =
      vpState.prefetchBounds &&
      coordinator.hasBuffer() &&
      hasOverlap(prefetch, vpState.prefetchBounds);

    // Sync the actual TS viewport ID to Rust BEFORE fetching data. Mutation
    // patches are generated by Rust against registered viewport IDs and routed
    // by TS to coordinators with the same IDs, so these names must match.
    // Must be awaited: Tauri IPC commands are concurrent, so fire-and-forget
    // would race with the mutation that triggers the patch.
    await this.syncViewportRegistration(viewportId, sheetId, prefetch);
    if (this.perViewportFetchSeq.get(viewportId) !== fetchSeq) {
      return;
    }

    // Capture fetch epoch BEFORE the async IPC call.
    // The coordinator uses this to determine which overlay entries to retain
    // (those with epoch > fetchEpoch were written during the fetch round-trip).
    const fetchEpoch = coordinator.startFetch();

    // Convert inclusive prefetch end bounds to exclusive end bounds for Rust.
    // TypeScript CellRange uses inclusive endRow/endCol (endRow=0 means row 0 is
    // included), but Rust's get_viewport_binary iterates `for row in start..end`
    // (exclusive end). For frozen viewports where startRow == endRow, passing the
    // inclusive endRow as-is gives Rust rows = 0 — an empty buffer.
    const rustEndRow = prefetch.endRow + 1;
    const rustEndCol = prefetch.endCol + 1;

    if (canDelta) {
      const deltaBuffer: Uint8Array = await this.transport.call<Uint8Array>(
        'compute_get_viewport_binary_delta',
        {
          docId: this.docId,
          sheetId,
          startRow: prefetch.startRow,
          startCol: prefetch.startCol,
          endRow: rustEndRow,
          endCol: rustEndCol,
          showFormulas: this.getShowFormulasForSheet(sheetId),
        },
      );

      // Coordinator's epoch-based overlay filtering handles consistency —
      // mutations that arrived during the fetch have epoch > fetchEpoch
      // and will be retained and re-applied during commit.
      const isDelta = deltaBuffer.length >= 31 && (deltaBuffer[30] & 0x01) !== 0;
      if (this.perViewportFetchSeq.get(viewportId) !== fetchSeq) {
        return;
      }
      if (isDelta) {
        coordinator.commitDelta(
          deltaBuffer,
          prefetch.startRow,
          prefetch.startCol,
          rustEndRow,
          rustEndCol,
          fetchEpoch,
        );
      } else {
        coordinator.commitFetch(deltaBuffer, fetchEpoch);
      }
    } else {
      const buffer: Uint8Array = await this.transport.call<Uint8Array>(
        'compute_get_viewport_binary',
        {
          docId: this.docId,
          sheetId,
          startRow: prefetch.startRow,
          startCol: prefetch.startCol,
          endRow: rustEndRow,
          endCol: rustEndCol,
          showFormulas: this.getShowFormulasForSheet(sheetId),
        },
      );

      // Coordinator's epoch-based overlay filtering handles consistency —
      // no stale check or retry needed.
      if (this.perViewportFetchSeq.get(viewportId) !== fetchSeq) {
        return;
      }
      coordinator.commitFetch(buffer, fetchEpoch);
    }

    coordinator.setVisibleWindow({
      sheetId,
      startRow: bounds.startRow,
      startCol: bounds.startCol,
      endRow: bounds.endRow,
      endCol: bounds.endCol,
    });
    vpState.prefetchBounds = prefetch;
    vpState.lastVisibleBounds = visibleBounds;
    vpState.prefetchDirtyState = { staleCells: new Set(), dirtyRegion: null };
  }

  /**
   * Get the per-viewport binary buffer (read-only) for a specific viewport region.
   * Returns null if the viewport hasn't been registered or fetched yet.
   */
  getBuffer(viewportId: string): ReadonlyBinaryViewportBuffer | null {
    return this.coordinatorRegistry.get(viewportId)?.base ?? null;
  }

  /**
   * Get or create a CellAccessor for a specific viewport region.
   * The accessor is a flyweight bound to the viewport's binary buffer.
   * Returns undefined if the viewport hasn't been created yet.
   */
  getAccessor(viewportId: string): CellAccessor | undefined {
    // Check cache first
    const cached = this.perViewportAccessors.get(viewportId);
    if (cached) return cached;

    // Create from coordinator's read-only buffer
    const coordinator = this.coordinatorRegistry.get(viewportId);
    if (!coordinator) {
      return undefined;
    }

    const accessor = coordinator.base.createAccessor();
    this.perViewportAccessors.set(viewportId, accessor);
    return accessor;
  }

  /**
   * Get all per-viewport states. Used for debugging and testing.
   */
  getPerViewportStates(): ReadonlyMap<string, ViewportPrefetchState> {
    return this.perViewportState;
  }

  /**
   * Force-refresh all registered viewports by fetching fresh data from Rust
   * and committing it. This triggers 'fetch-committed' on each coordinator,
   * which causes VPI rebuilds in the renderer.
   *
   * Called after structural changes (insert/delete rows/cols) to ensure the
   * VPI reflects shifted dimensions. Must be called AFTER the structural
   * mutation completes — Rust already has the correct post-mutation state.
   */
  async forceRefreshAllViewports(): Promise<void> {
    const coordinators = this.coordinatorRegistry.getAllCoordinators();
    const refreshes: Promise<void>[] = [];

    for (const coordinator of coordinators) {
      // Use the coordinator's current buffer bounds to know what region to re-fetch.
      const bounds = coordinator.base.getBounds();
      if (!bounds || !coordinator.base.hasBuffer()) continue;

      refreshes.push(
        (async () => {
          await this.syncViewportRegistration(coordinator.viewportId, bounds.sheetId, bounds);

          const fetchEpoch = coordinator.startFetch();
          // getBounds() returns inclusive endRow/endCol; Rust expects exclusive end.
          const buffer: Uint8Array = await this.transport.call<Uint8Array>(
            'compute_get_viewport_binary',
            {
              docId: this.docId,
              sheetId: bounds.sheetId,
              startRow: bounds.startRow,
              startCol: bounds.startCol,
              endRow: bounds.endRow + 1,
              endCol: bounds.endCol + 1,
              showFormulas: this.getShowFormulasForSheet(bounds.sheetId),
            },
          );
          coordinator.commitFetch(buffer, fetchEpoch);
          this.markForceRefreshedViewportFresh(coordinator);
        })(),
      );
    }

    await Promise.all(refreshes);
  }

  /**
   * Force-refresh registered viewports for one sheet after a view option changes.
   *
   * This bypasses prefetch-hit skipping so display-shape settings such as
   * showFormulas take effect immediately for already-visible cells.
   */
  async forceRefreshSheetViewports(sheetId: string): Promise<void> {
    const coordinators = this.coordinatorRegistry.getAllCoordinators();
    const refreshes: Promise<void>[] = [];

    for (const coordinator of coordinators) {
      const bounds = coordinator.base.getBounds();
      if (!bounds || !coordinator.base.hasBuffer() || bounds.sheetId !== sheetId) continue;

      refreshes.push(
        (async () => {
          await this.syncViewportRegistration(coordinator.viewportId, bounds.sheetId, bounds);

          const fetchEpoch = coordinator.startFetch();
          const buffer: Uint8Array = await this.transport.call<Uint8Array>(
            'compute_get_viewport_binary',
            {
              docId: this.docId,
              sheetId: bounds.sheetId,
              startRow: bounds.startRow,
              startCol: bounds.startCol,
              endRow: bounds.endRow + 1,
              endCol: bounds.endCol + 1,
              showFormulas: this.getShowFormulasForSheet(bounds.sheetId),
            },
          );
          coordinator.commitFetch(buffer, fetchEpoch);
          this.markForceRefreshedViewportFresh(coordinator);
        })(),
      );
    }

    await Promise.all(refreshes);
  }

  /**
   * Invalidate all per-viewport prefetch bounds.
   * Called on structural changes to mark prefetch cache as stale so the
   * next *scroll* fetches fresh data. This is not "triggering a fetch" —
   * it's marking cache as stale.
   */
  invalidateAllPrefetch(): void {
    for (const vpState of this.perViewportState.values()) {
      vpState.prefetchBounds = null;
      vpState.lastVisibleBounds = null;
      vpState.prefetchDirtyState = { staleCells: new Set(), dirtyRegion: null };
    }
  }

  /**
   * Clear all per-viewport state for a sheet switch.
   * Removes all viewport prefetch state, and accessor caches.
   */
  clear(): void {
    this.perViewportState.clear();
    this.perViewportAccessors.clear();
    this.perViewportFetchSeq.clear();
    this.coordinatorRegistry.clear();
  }

  /**
   * Remove a specific viewport's state (for unregister).
   */
  removeViewport(viewportId: string): void {
    this.perViewportState.delete(viewportId);
    this.perViewportAccessors.delete(viewportId);
    this.perViewportFetchSeq.delete(viewportId);
    this.coordinatorRegistry.unregister(viewportId);
  }

  /**
   * Dispose: clean up resources.
   */
  dispose(): void {
    // No pending timers to cancel after retry removal.
  }
}
