/**
 * ViewportCoordinatorRegistry — Routes multi-viewport patches to coordinators.
 *
 * Unpacks the packed multi-viewport binary format and routes each viewport's
 * patch to the corresponding coordinator.
 */

import type { RenderScheduler } from '@mog/canvas-engine';

import { BinaryMutationReader } from './binary-mutation-reader';
import { ViewportCoordinator } from './viewport-coordinator';
import type { ViewportChangeEvent, ViewportView } from './viewport-coordinator';

// Module-level singleton TextDecoder
const sharedDecoder = new TextDecoder('utf-8');

/**
 * Registry of ViewportCoordinators, one per viewport region.
 *
 * Owns per-viewport state and routes multi-viewport binary patches
 * to the correct coordinator.
 */
export class ViewportCoordinatorRegistry {
  private _coordinators = new Map<string, ViewportCoordinator>();

  /** Global subscribers that receive events from ALL coordinators. */
  private _globalSubscribers = new Set<(event: ViewportChangeEvent) => void>();

  /** Per-coordinator unsubscribe functions for the forwarding subscription. */
  private _coordinatorUnsubs = new Map<string, () => void>();

  /**
   * Current lifecycle (Provider Protocol §4) — Hydration backfill.
   *
   * Set to `true` whenever {@link applyMultiViewportPatches} is called but
   * the patch can't be routed (coordinator not registered yet, or registered
   * but with no buffer). This is the "engine state advanced past the
   * viewport buffer" flag — the most common cause is `Provider.attach()`
   * replaying persisted bytes via `bridge-provider-doc.applyUpdate →
   * ComputeBridge.syncApply` BEFORE the renderer has mounted and registered
   * its coordinators. The patches are dropped on the floor by
   * `applyMultiViewportPatches`, leaving the buffers stale relative to the
   * engine.
   *
   * The next coordinator-mount is the right repair point: it fires
   * {@link _onHydrationDeficitHandler} so the bridge can re-fetch full
   * viewport state from Rust. Reset to `false` once the handler has been
   * invoked, so subsequent silent patches (mid-flight provider replay,
   * future websocket sync, headless seed) re-arm the same recovery path.
   *
   * Generalises across the §3 plan-Q5 cases (UX-FIX-PRINCIPLES §3):
   * the symmetric XLSX-import path, future websocket-Provider replay,
   * and headless-seeded-state boot ALL drop patches when they advance the
   * engine before the renderer mounts. One flag, one callback, one fix.
   */
  private _hydrationDeficit = false;

  /**
   * Callback invoked when one or more patches are dropped
   * (`_hydrationDeficit === true`) and there is a registered coordinator
   * that can be backfilled. Wired by the owning ComputeCore to call
   * `fetchManager.forceRefreshAllViewports()`, which re-fetches full
   * viewport binaries from Rust for every registered coordinator — picking
   * up the engine state the dropped patches would have delivered.
   *
   * Optional because the registry is also used in standalone unit tests
   * where no fetch backend exists; in that mode the deficit flag is set
   * for diagnostics but no recovery fires.
   */
  private _onHydrationDeficitHandler: (() => void) | null = null;

  /**
   * Subscribe to events from ALL coordinators (existing and future).
   * Returns an unsubscribe function.
   */
  subscribe(cb: (event: ViewportChangeEvent) => void): () => void {
    this._globalSubscribers.add(cb);
    return () => {
      this._globalSubscribers.delete(cb);
    };
  }

  /** Forward a coordinator event to all global subscribers. */
  private _forwardEvent = (event: ViewportChangeEvent): void => {
    for (const cb of this._globalSubscribers) {
      try {
        cb(event);
      } catch (e) {
        console.error('[ViewportCoordinatorRegistry] subscriber threw:', e);
      }
    }
  };

  /**
   * Accept (and discard) the render scheduler reference.
   *
   * Previously this injected the scheduler into each coordinator's base buffer,
   * but BinaryViewportBuffer no longer owns a render scheduler — all render
   * scheduling is driven by coordinator subscriptions in renderer-execution.ts.
   * The method signature is preserved so callers (compute-core.ts) don't need
   * to change their wiring.
   */
  setRenderScheduler(_scheduler: RenderScheduler | null): void {
    // No-op: render scheduling is now handled by coordinator subscriptions.
  }

  /**
   * Register a viewport and return its coordinator.
   * If already registered, returns the existing coordinator.
   *
   * If patches were dropped before this register call
   * (see `_hydrationDeficit`), fire the hydration-deficit handler so the
   * bridge can backfill the new coordinator from current engine state.
   * The handler is wired by ComputeCore to `forceRefreshAllViewports`,
   * which is a Rust-side full viewport re-read — the same data path the
   * renderer's first scroll/refresh would use anyway, just kicked off
   * proactively. Pre-fix the new coordinator stayed empty until the
   * renderer's debounced first-paint refresh arrived (16ms typical, but
   * the fetch promise never completed if the renderer skipped initial
   * refresh — e.g. when SheetView's `_executeViewportRefresh` was already
   * in-flight from an earlier mount).
   */
  register(viewportId: string): ViewportCoordinator {
    const isNew = !this._coordinators.has(viewportId);
    let coordinator = this._coordinators.get(viewportId);
    if (!coordinator) {
      coordinator = new ViewportCoordinator(viewportId);
      this._coordinators.set(viewportId, coordinator);

      // Wire event forwarding to global subscribers
      const unsub = coordinator.subscribe(this._forwardEvent);
      this._coordinatorUnsubs.set(viewportId, unsub);
    }

    // Hydration backfill: if patches were dropped while no coordinator
    // existed, the engine has cell state the new coordinator's buffer
    // doesn't. Fire the bridge-wired handler to force a Rust-side viewport
    // re-read for ALL coordinators (including this new one). Reset the
    // flag so a subsequent silent-patch episode re-arms cleanly.
    //
    // Only on a brand-new coordinator — re-registering the same viewportId
    // doesn't represent a new "first paint" the dropped patches must cover.
    if (isNew && this._hydrationDeficit) {
      this._triggerHydrationDeficitHandler();
    }

    return coordinator;
  }

  /**
   * Wire the hydration-deficit handler. Called once by ComputeCore during
   * its construction; the handler closure forces a Rust-side viewport
   * re-read so newly-registered coordinators pick up engine state that
   * was delivered via dropped patches before they existed.
   *
   * Idempotent — re-wiring replaces the prior handler. Pass `null` to
   * clear (used by tests / dispose paths).
   *
   */
  setOnHydrationDeficit(handler: (() => void) | null): void {
    this._onHydrationDeficitHandler = handler;
  }

  /**
   * Mark that engine state advanced before the renderer had a viewport buffer
   * that could receive patches. The next new coordinator registration will
   * trigger the configured hydration-deficit backfill.
   */
  markHydrationDeficit(): void {
    this._hydrationDeficit = true;
  }

  private _triggerHydrationDeficitHandler(): void {
    if (!this._onHydrationDeficitHandler) return;
    this._hydrationDeficit = false;
    try {
      this._onHydrationDeficitHandler();
    } catch (err) {
      // Recovery path failure should never block coordinator registration or
      // mutation processing — the renderer's own subsequent refresh can still
      // recover. Log and continue.
      console.error('[ViewportCoordinatorRegistry] hydration-deficit handler threw:', err);
    }
  }

  /**
   * Test hook: read the current hydration-deficit flag. Production code
   * never reads this — the recovery is automatic via {@link register}.
   * Exposed only so the unit test in `viewport-coordinator-registry.test.ts`
   * can assert the flag flips on dropped patches and clears on register.
   */
  get hasHydrationDeficit(): boolean {
    return this._hydrationDeficit;
  }

  /** Unregister a viewport. Disposes the coordinator. */
  unregister(viewportId: string): void {
    const coordinator = this._coordinators.get(viewportId);
    if (coordinator) {
      const unsub = this._coordinatorUnsubs.get(viewportId);
      unsub?.();
      this._coordinatorUnsubs.delete(viewportId);

      coordinator.dispose();
      this._coordinators.delete(viewportId);
    }
  }

  /** Get the coordinator for a viewport, or undefined if not registered. */
  get(viewportId: string): ViewportCoordinator | undefined {
    return this._coordinators.get(viewportId);
  }

  /** Get the read-only view for a viewport, or undefined if not registered. */
  getView(viewportId: string): ViewportView | undefined {
    return this._coordinators.get(viewportId);
  }

  /**
   * Apply packed multi-viewport patches from Rust.
   *
   * Wire format (all little-endian):
   *   [u16 viewport_count]
   *   For each viewport:
   *     [u8 id_len] [id_bytes UTF-8] [u32 patch_len] [patch_bytes...]
   *
   * Each viewport's patch_bytes is either:
   *   - A mutation patch binary (applied via applyMutationPatches)
   *   - A full viewport binary (applied via commitFetch, detected by WIRE_VERSION
   *     in bits 4-7 of byte 30: produced by produce_cf_viewport_patches /
   *     produce_full_viewport_patches for mutations with broad visual impact)
   */
  applyMultiViewportPatches(packed: Uint8Array): void {
    if (packed.byteLength < 2) return;

    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    const viewportCount = view.getUint16(0, true);
    let offset = 2;

    for (let i = 0; i < viewportCount; i++) {
      if (offset >= packed.byteLength) break;

      // Read viewport ID
      const idLen = view.getUint8(offset);
      offset += 1;
      const idBytes = packed.subarray(offset, offset + idLen);
      const viewportId = sharedDecoder.decode(idBytes);
      offset += idLen;

      // Read patch length
      const patchLen = view.getUint32(offset, true);
      offset += 4;

      // Extract patch bytes
      const patchBytes = packed.subarray(offset, offset + patchLen);
      offset += patchLen;

      // Route to the corresponding coordinator
      const coordinator = this._coordinators.get(viewportId);
      if (coordinator && coordinator.base.hasBuffer() && patchLen > 0) {
        // Detect whether this is a full viewport binary or individual mutation patches.
        //
        // Full viewport binaries (produced by produce_cf_viewport_patches /
        // produce_full_viewport_patches) embed the Rust WIRE_VERSION (=2) in bits
        // 4-7 of byte 30 (the header flags field). Mutation patch binaries don't
        // have this marker at that position. Minimum header size is 36 bytes.
        //
        // Full viewport binaries carry CF extras (data bars, icons) in a dedicated
        // section that applyMutationPatches cannot populate — they must go through
        // commitFetch so BinaryViewportBuffer.setBuffer() parses the full binary.
        const VIEWPORT_WIRE_VERSION_BITS = 0x20; // WIRE_VERSION=2 in bits 4-7
        const isFullViewportBinary =
          patchLen >= 36 && (patchBytes[30] & 0xf0) === VIEWPORT_WIRE_VERSION_BITS;

        if (isFullViewportBinary) {
          const fetchEpoch = coordinator.startFetch();
          coordinator.commitFetch(patchBytes, fetchEpoch);
        } else {
          const reader = new BinaryMutationReader(patchBytes);
          coordinator.applyMutationPatches(reader);
        }
      } else {
        // Patch dropped — the engine state advanced past the viewport
        // buffer. This can happen before a coordinator exists at all
        // (provider replay before renderer mount), or after the coordinator
        // exists but before its first full viewport fetch commits. Mark the
        // deficit; when a coordinator already exists, fire the recovery
        // immediately because there may be no later register event.
        //
        // Patches with patchLen === 0 are not "dropped data" — they're
        // empty notifications. Don't arm the deficit in that case (avoids
        // an unnecessary force-refresh on every mount).
        if (patchLen > 0) {
          this._hydrationDeficit = true;
          if (coordinator) {
            this._triggerHydrationDeficitHandler();
          }
        }
      }
    }
  }

  /** Get all registered coordinators. */
  getAllCoordinators(): ViewportCoordinator[] {
    return Array.from(this._coordinators.values());
  }

  /**
   * Dispose all coordinators and clear the registry.
   *
   * Global subscribers are intentionally preserved — they are long-lived
   * application-level subscriptions (e.g., renderer-execution.ts) that must
   * survive sheet switches. Only coordinator instances and their forwarding
   * subscriptions are torn down.
   */
  clear(): void {
    for (const unsub of this._coordinatorUnsubs.values()) unsub();
    this._coordinatorUnsubs.clear();

    for (const coordinator of this._coordinators.values()) {
      coordinator.dispose();
    }
    this._coordinators.clear();
  }

  /** Number of registered viewports. */
  get size(): number {
    return this._coordinators.size;
  }
}
