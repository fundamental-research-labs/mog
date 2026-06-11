/**
 * Viewport Management — Kernel Implementation
 *
 * ViewportRegionImpl wraps computeBridge viewport lifecycle calls behind
 * a handle (IDisposable). WorkbookViewportImpl is the sub-API that creates
 * and tracks these handles via the workbook's DisposableStore.
 *
 */

import type {
  ViewportChangeEvent,
  ViewportRegion,
  WorkbookViewport,
  WorkbookViewportBounds,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { RenderScheduler } from '@mog-sdk/contracts/rendering';
import { DisposableBase, type DisposableStore } from '@mog/spreadsheet-utils/disposable';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import {
  normalizeViewportBounds,
  type ViewportScrollBehavior,
} from '../../bridges/wire/viewport-prefetch';

type ViewportBounds = WorkbookViewportBounds;

// =============================================================================
// ViewportRegionImpl
// =============================================================================

let regionCounter = 0;

function isDisposedBridgeError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'BRIDGE_DISPOSED'
  );
}

export class ViewportRegionImpl extends DisposableBase implements ViewportRegion {
  readonly id: string;
  readonly sheetId: SheetId;

  private readonly computeBridge: ComputeBridge;
  private bounds: ViewportBounds;
  private readonly registration: Promise<void>;
  private readonly registrationSucceeded: Promise<boolean>;

  constructor(
    sheetId: SheetId,
    bounds: ViewportBounds,
    computeBridge: ComputeBridge,
    viewportId?: string,
  ) {
    super();
    this.id = viewportId ?? `vp-${++regionCounter}`;
    this.sheetId = sheetId;
    this.computeBridge = computeBridge;
    this.bounds = normalizeViewportBounds(bounds);

    // Register with the Rust engine. Refresh/dispose are ordered against this
    // promise so a newly-created region cannot fetch before Rust knows its
    // viewport ID, and disposal cannot reorder unregister before register.
    this.registration = this.computeBridge.registerViewportRegion(this.id, sheetId, this.bounds);
    this.registrationSucceeded = this.registration.then(
      () => true,
      (err) => {
        if (isDisposedBridgeError(err)) return false;
        console.error('[ViewportRegionImpl] registerViewportRegion failed:', err);
        return false;
      },
    );
    void this.registrationSucceeded.catch(() => {
      // The promise body handles and normalizes registration failures.
    });
  }

  /**
   * Update the locally-tracked visible bounds (e.g., on scroll or resize).
   *
   * This is intentionally a local-state-only update — it does NOT push bounds
   * to the Rust compute engine. Rust-side viewport bounds (the prefetch range)
   * are exclusively managed by the fetch manager via {@link refresh}. Pushing
   * visible bounds here would overwrite the wider prefetch range on every
   * scroll, causing off-screen mutations to be silently dropped.
   *
   * Called by `syncViewportRegistrations()` in renderer-execution.ts on every
   * layout recompute. The stored bounds are consumed by {@link refresh} to
   * calculate the correct prefetch range.
   *
   */
  updateBounds(bounds: ViewportBounds): void {
    this.throwIfDisposed();
    this.bounds = normalizeViewportBounds(bounds);
    this.computeBridge.updateViewportVisibleWindow(this.id, this.sheetId, this.bounds);
  }

  async refresh(scrollBehavior?: unknown): Promise<void> {
    this.throwIfDisposed();
    await this.registration;
    this.throwIfDisposed();
    await this.computeBridge.refreshViewportForRegion(
      this.id,
      this.sheetId,
      this.bounds,
      (scrollBehavior as ViewportScrollBehavior | undefined) ?? 'free',
    );
  }

  protected _dispose(): void {
    void this.registrationSucceeded
      .then((registered) => {
        if (!registered) return undefined;
        return this.computeBridge.unregisterViewportRegion(this.id);
      })
      .catch((err) => {
        if (isDisposedBridgeError(err)) return;
        console.warn('[ViewportRegionImpl] unregister failed during dispose:', err);
      });
  }
}

// =============================================================================
// WorkbookViewportImpl
// =============================================================================

export class WorkbookViewportImpl implements WorkbookViewport {
  private readonly computeBridge: ComputeBridge;
  private readonly disposables: DisposableStore;

  constructor(computeBridge: ComputeBridge, disposables: DisposableStore) {
    this.computeBridge = computeBridge;
    this.disposables = disposables;
  }

  createRegion(sheetId: SheetId, bounds: ViewportBounds, viewportId?: string): ViewportRegion {
    const region = new ViewportRegionImpl(sheetId, bounds, this.computeBridge, viewportId);
    this.disposables.track(region);
    return region;
  }

  resetSheetRegions(sheetId: SheetId): void {
    void this.computeBridge.resetSheetViewportRegions(sheetId);
  }

  setRenderScheduler(scheduler: RenderScheduler | null): void {
    this.computeBridge.setRenderScheduler(scheduler);
  }

  subscribe(cb: (event: ViewportChangeEvent) => void): () => void {
    return this.computeBridge.subscribeToViewportEvents(cb);
  }

  setShowFormulas(value: boolean): void {
    this.computeBridge.setShowFormulas(value);
  }
}
