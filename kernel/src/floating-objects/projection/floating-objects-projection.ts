/**
 * Floating Objects Projection
 *
 * The kernel's TS-side mirror of every floating object on every sheet,
 * implementing `IFloatingObjectsView` for sync, push-notified reads.
 *
 * **Architecture role.** Kernel projections follow this data flow:
 *
 * ```
 * Rust kernel state (canonical)
 *   ↓ MutationResult (live + hydration + undo + remote)
 *   ↓ MutationResultHandler.applyAndNotify
 *   ↓ projection update (this module)
 *   ↓ sync read / push subscription (IFloatingObjectsView)
 * canvas + React
 * ```
 *
 * This module owns the in-memory state. Both the canvas renderer (via
 * `IFloatingObjectsView`) and React (via `useSyncExternalStore`) read
 * from it. There is exactly one writer: the population pipeline below,
 * driven by event subscriptions on the workbook event bus.
 *
 * **Why this lives in `kernel/`.** A projection of kernel state is the
 * kernel's responsibility, not the application's. Putting it under
 * `apps/spreadsheet/` (where it used to live as `floatingObjectCache`)
 * conflates a kernel-owned mirror with React glue, and forces React to
 * be the gatekeeper for sync reads from the canvas — a layering inversion
 * that produced the original sheet-switch race.
 *
 * **Population sources.**
 *
 * - `floatingObject:created` / `floatingObject:updated` / `floatingObject:deleted`
 *   from the workbook event bus. These fire from
 *   `MutationResultHandler.handleFloatingObjectChanges` after the Rust
 *   side bundles per-domain changes into a `MutationResult`. Hydration also
 *   emits through this bus.
 * - `dimension:*` events for bounds-only updates when row/col resizes
 *   or inserts shift cell-anchored objects without changing their
 *   anchor config.
 *
 * The store does not poll. Every projection mutation is in response to
 * a kernel-emitted event, applied atomically, then notified to listeners.
 */

import type {
  FloatingObjectBoundsSnapshot,
  FloatingObjectSnapshot,
  FloatingObjectsViewListener,
  IFloatingObjectsView,
} from '@mog-sdk/contracts/objects';

// =============================================================================
// Internal state shape
// =============================================================================

interface FloatingObjectsProjectionState {
  /** All objects, indexed by `objectId`. */
  readonly objects: Map<string, FloatingObjectSnapshot>;
  /** `sheetId → Set<objectId>` index for sheet-scoped reads. */
  readonly objectsBySheet: Map<string, Set<string>>;
  /** Pre-computed pixel bounds, indexed by `objectId`. */
  readonly bounds: Map<string, FloatingObjectBoundsSnapshot>;
}

function emptyState(): FloatingObjectsProjectionState {
  return {
    objects: new Map(),
    objectsBySheet: new Map(),
    bounds: new Map(),
  };
}

// =============================================================================
// FloatingObjectsProjection
// =============================================================================

/**
 * Public concrete projection. Implements `IFloatingObjectsView` for
 * downstream consumers (renderer, React) and exposes a small
 * write-side surface (`apply...`) for the population pipeline to call.
 *
 * The write surface is intentionally narrow — it accepts the post-batch
 * change set from the mutation pipeline and fires exactly one
 * notification per batch. Direct field mutation is forbidden.
 */
export class FloatingObjectsProjection implements IFloatingObjectsView {
  private state: FloatingObjectsProjectionState = emptyState();
  private readonly listeners = new Set<FloatingObjectsViewListener>();

  // ---------------------------------------------------------------------------
  // IFloatingObjectsView (read side)
  // ---------------------------------------------------------------------------

  getInSheet(sheetId: string): readonly FloatingObjectSnapshot[] {
    const ids = this.state.objectsBySheet.get(sheetId);
    if (!ids || ids.size === 0) return EMPTY_OBJECTS;
    const objects: FloatingObjectSnapshot[] = [];
    for (const id of ids) {
      const obj = this.state.objects.get(id);
      if (obj) objects.push(obj);
    }
    objects.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    return objects;
  }

  getBoundsInSheet(sheetId: string): ReadonlyMap<string, FloatingObjectBoundsSnapshot> {
    const ids = this.state.objectsBySheet.get(sheetId);
    if (!ids || ids.size === 0) return EMPTY_BOUNDS;
    const out = new Map<string, FloatingObjectBoundsSnapshot>();
    for (const id of ids) {
      const b = this.state.bounds.get(id);
      if (b) out.set(id, b);
    }
    return out;
  }

  getObjectById(objectId: string): FloatingObjectSnapshot | undefined {
    return this.state.objects.get(objectId);
  }

  getBoundsById(objectId: string): FloatingObjectBoundsSnapshot | undefined {
    return this.state.bounds.get(objectId);
  }

  subscribe(listener: FloatingObjectsViewListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Write side (called only by the population pipeline)
  // ---------------------------------------------------------------------------

  /**
   * Atomic batch application. The mutation pipeline coalesces a batch of
   * `created` / `updated` / `deleted` events through this single call so
   * subscribers see exactly one notification per logical mutation.
   *
   * `boundsUpdates` may include entries for objects in `updates` (the
   * common case: floating object created with computed bounds attached)
   * and entries for objects whose data didn't change but whose bounds
   * shifted (the dimension-change case).
   *
   * Sheet IDs that have at least one object touched by this batch are
   * collected and used to fire one notification per affected sheet.
   * Workbook-scoped notifications (no sheet associated, e.g. after
   * `clear()`) fire with `null`.
   */
  applyBatch(
    updates: readonly FloatingObjectSnapshot[],
    deleteIds: readonly string[],
    boundsUpdates?: ReadonlyMap<string, FloatingObjectBoundsSnapshot>,
  ): void {
    const hasUpdates = updates.length > 0;
    const hasDeletes = deleteIds.length > 0;
    const hasBoundsUpdates = boundsUpdates != null && boundsUpdates.size > 0;
    if (!hasUpdates && !hasDeletes && !hasBoundsUpdates) return;

    let { objects, objectsBySheet, bounds } = this.state;

    if (hasUpdates || hasDeletes) {
      objects = new Map(objects);
      objectsBySheet = new Map(objectsBySheet);

      for (const id of deleteIds) {
        deleteObject(objects, objectsBySheet, id);
      }
      for (const obj of updates) {
        upsertObject(objects, objectsBySheet, obj);
      }
    }

    if (hasBoundsUpdates || hasDeletes) {
      const hasBoundsDeletes = hasDeletes && deleteIds.some((id) => bounds.has(id));
      if (hasBoundsUpdates || hasBoundsDeletes) {
        bounds = new Map(bounds);
        for (const id of deleteIds) {
          bounds.delete(id);
        }
        if (boundsUpdates) {
          for (const [id, b] of boundsUpdates) {
            bounds.set(id, b);
          }
        }
      }
    }

    this.state = { objects, objectsBySheet, bounds };

    // Collect affected sheet ids: every update's sheet, plus the sheet
    // that owned each deleted object (looked up before we cleared it,
    // which we track via the per-id removal in deleteObject). For
    // simplicity we recompute affected sheets here from the new state +
    // the input lists.
    const affectedSheets = new Set<string>();
    for (const obj of updates) {
      affectedSheets.add(obj.sheetId);
    }
    // Bounds-only updates and pure deletes also need notifications;
    // resolve their sheet ids from the post-state for any object that
    // remains, falling back to a workbook-scoped notification otherwise.
    if (boundsUpdates) {
      for (const id of boundsUpdates.keys()) {
        const obj = this.state.objects.get(id);
        if (obj) affectedSheets.add(obj.sheetId);
      }
    }

    if (affectedSheets.size === 0) {
      // Pure deletes (no remaining sheet info) — notify workbook-scoped.
      this.notify(null);
    } else {
      for (const sheetId of affectedSheets) {
        this.notify(sheetId);
      }
    }
  }

  /**
   * Replace all entries for a sheet (the initial-population path used
   * by `setObjectsForSheet` in the legacy Zustand cache). Useful for
   * the bridge initialization seed before live mutations start flowing.
   */
  setObjectsForSheet(
    sheetId: string,
    next: readonly FloatingObjectSnapshot[],
    nextBounds?: ReadonlyMap<string, FloatingObjectBoundsSnapshot>,
  ): void {
    const objects = new Map(this.state.objects);
    const objectsBySheet = new Map(this.state.objectsBySheet);

    // Drop existing entries for this sheet.
    const prevIds = objectsBySheet.get(sheetId);
    let bounds = this.state.bounds;
    if (prevIds) {
      const hasBoundsToDrop = [...prevIds].some((id) => bounds.has(id));
      if (hasBoundsToDrop) {
        bounds = new Map(bounds);
        for (const id of prevIds) {
          objects.delete(id);
          bounds.delete(id);
        }
      } else {
        for (const id of prevIds) {
          objects.delete(id);
        }
      }
    }

    // Insert new entries.
    const nextIds = new Set<string>();
    for (const obj of next) {
      objects.set(obj.id, obj);
      nextIds.add(obj.id);
    }
    if (nextIds.size > 0) {
      objectsBySheet.set(sheetId, nextIds);
    } else {
      objectsBySheet.delete(sheetId);
    }

    if (nextBounds && nextBounds.size > 0) {
      if (bounds === this.state.bounds) bounds = new Map(bounds);
      for (const [id, b] of nextBounds) {
        bounds.set(id, b);
      }
    }

    this.state = { objects, objectsBySheet, bounds };
    this.notify(sheetId);
  }

  /** Reset the projection to empty (e.g. on document dispose). */
  clear(): void {
    if (
      this.state.objects.size === 0 &&
      this.state.objectsBySheet.size === 0 &&
      this.state.bounds.size === 0
    ) {
      return;
    }
    this.state = emptyState();
    this.notify(null);
  }

  // ---------------------------------------------------------------------------
  // Notification
  // ---------------------------------------------------------------------------

  private notify(sheetId: string | null): void {
    // Snapshot listeners so a listener that unsubscribes during fan-out
    // doesn't skip its successor.
    const snapshot = [...this.listeners];
    for (const listener of snapshot) {
      try {
        listener(sheetId);
      } catch (err) {
        // Listeners must not throw; isolate failures.
        // eslint-disable-next-line no-console
        console.error('[FloatingObjectsProjection] listener threw', err);
      }
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

const EMPTY_OBJECTS: readonly FloatingObjectSnapshot[] = Object.freeze([]);
const EMPTY_BOUNDS: ReadonlyMap<string, FloatingObjectBoundsSnapshot> = new Map();

function upsertObject(
  objects: Map<string, FloatingObjectSnapshot>,
  bySheet: Map<string, Set<string>>,
  obj: FloatingObjectSnapshot,
): void {
  const previous = objects.get(obj.id);
  objects.set(obj.id, obj);

  // Cross-sheet move: drop from old sheet's index.
  if (previous && previous.sheetId !== obj.sheetId) {
    const oldSet = bySheet.get(previous.sheetId);
    if (oldSet) {
      const updated = new Set(oldSet);
      updated.delete(obj.id);
      if (updated.size === 0) {
        bySheet.delete(previous.sheetId);
      } else {
        bySheet.set(previous.sheetId, updated);
      }
    }
  }

  const existing = bySheet.get(obj.sheetId);
  if (existing) {
    if (!existing.has(obj.id)) {
      const updated = new Set(existing);
      updated.add(obj.id);
      bySheet.set(obj.sheetId, updated);
    }
  } else {
    bySheet.set(obj.sheetId, new Set([obj.id]));
  }
}

function deleteObject(
  objects: Map<string, FloatingObjectSnapshot>,
  bySheet: Map<string, Set<string>>,
  id: string,
): boolean {
  const obj = objects.get(id);
  if (!obj) return false;
  objects.delete(id);
  const sheetSet = bySheet.get(obj.sheetId);
  if (sheetSet) {
    const updated = new Set(sheetSet);
    updated.delete(id);
    if (updated.size === 0) {
      bySheet.delete(obj.sheetId);
    } else {
      bySheet.set(obj.sheetId, updated);
    }
  }
  return true;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a fresh projection instance. One per document — analogous to
 * the previous `createFloatingObjectCache` factory at
 * `apps/spreadsheet/src/cache/floating-object-cache.ts`.
 */
export function createFloatingObjectsProjection(): FloatingObjectsProjection {
  return new FloatingObjectsProjection();
}
