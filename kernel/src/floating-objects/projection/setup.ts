/**
 * Wire a `FloatingObjectsProjection` to the workbook event bus + initial
 * sheet population.
 *
 * After hydration of the floating-objects render-decoupling plan
 * `floatingObject:created` / `:updated` / `:deleted` events fire on
 * **every** mutation pipeline that emits a `MutationResult` — including
 * XLSX/CSV hydration, undo/redo, and remote CRDT edits — so this single
 * subscription path keeps the projection in sync across every code path
 * that can change kernel state.
 *
 * The setup is intentionally narrow: it does not own the projection
 * lifecycle and does not own the eager initial seed for additional
 * sheets. The composition root (`SheetCoordinator`) constructs the
 * projection, calls `setup(...)` once, and disposes the returned
 * cleanup on destroy.
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';

import type {
  FloatingObjectBoundsSnapshot,
  FloatingObjectSnapshot,
} from '@mog-sdk/contracts/objects';

import type { FloatingObjectsProjection } from './floating-objects-projection';

export interface FloatingObjectsProjectionSetup {
  /** Tear down all event subscriptions registered during setup. */
  dispose(): void;
}

export interface FloatingObjectsProjectionSetupOptions {
  /** The projection to populate. */
  projection: FloatingObjectsProjection;
  /** Workbook event bus — source of `floatingObject:*` events. */
  workbook: WorkbookInternal;
  /** Manager — used to fetch object data for events that don't carry inline payload. */
  floatingObjects: IFloatingObjectManager;
  /**
   * Optional initial sheet to populate on setup. Other sheets populate
   * lazily as their objects appear in the event stream.
   */
  initialSheetId?: string | null;
}

/**
 * Subscribe the projection to the workbook event bus and seed the
 * initial sheet. Returns a `dispose()` to unsubscribe everything on
 * coordinator teardown.
 *
 * **Coalescing semantics.** Multiple synchronous `floatingObject:*`
 * events (common during batch operations and during hydration's
 * `applyAndNotify` per-domain fan-out) are coalesced into a single
 * microtask flush. The flush issues parallel fetches for any objects
 * whose events lacked inline data and applies the entire batch via
 * `projection.applyBatch(...)` so subscribers see exactly one
 * notification per logical mutation.
 */
export function setupFloatingObjectsProjection(
  opts: FloatingObjectsProjectionSetupOptions,
): FloatingObjectsProjectionSetup {
  const { projection, workbook, floatingObjects, initialSheetId } = opts;

  /** objectId → inline data (object) or `true` if a fetch is needed. */
  const pendingFetches = new Map<string, FloatingObject | true>();
  /** objectId → bounds from the event (when available). */
  const pendingBounds = new Map<string, FloatingObjectBoundsSnapshot>();
  /** objectIds to remove. */
  const pendingDeletes = new Set<string>();
  /** Bounds-only updates (no data change, no fetch needed). */
  const pendingBoundsOnly = new Map<string, FloatingObjectBoundsSnapshot>();
  let flushScheduled = false;
  let disposed = false;
  let generation = 0;

  const scheduleFlush = (): void => {
    if (disposed) return;
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  };

  const scheduleObjectFetch = (
    objectId: string,
    data?: FloatingObject,
    eventBounds?: FloatingObjectBoundsSnapshot,
  ): void => {
    if (disposed) return;
    pendingDeletes.delete(objectId);
    if (data == null && eventBounds) {
      if (!pendingFetches.has(objectId)) {
        pendingBoundsOnly.set(objectId, eventBounds);
      }
      scheduleFlush();
      return;
    }
    pendingBoundsOnly.delete(objectId);
    pendingFetches.set(objectId, data ?? true);
    if (eventBounds) {
      pendingBounds.set(objectId, eventBounds);
    }
    scheduleFlush();
  };

  const scheduleObjectDelete = (objectId: string): void => {
    if (disposed) return;
    pendingFetches.delete(objectId);
    pendingBounds.delete(objectId);
    pendingBoundsOnly.delete(objectId);
    pendingDeletes.add(objectId);
    scheduleFlush();
  };

  const flush = async (): Promise<void> => {
    if (disposed) {
      flushScheduled = false;
      return;
    }
    const flushGeneration = generation;
    flushScheduled = false;

    const fetchEntries = [...pendingFetches.entries()];
    const boundsSnapshot = pendingBounds.size > 0 ? new Map(pendingBounds) : undefined;
    const boundsOnlySnapshot = pendingBoundsOnly.size > 0 ? new Map(pendingBoundsOnly) : undefined;
    const deleteIds = [...pendingDeletes];
    pendingFetches.clear();
    pendingBounds.clear();
    pendingBoundsOnly.clear();
    pendingDeletes.clear();

    const fetched: FloatingObjectSnapshot[] = [];
    const needsFetch: string[] = [];

    for (const [id, data] of fetchEntries) {
      if (data !== true && data != null) {
        fetched.push(data as FloatingObjectSnapshot);
      } else {
        needsFetch.push(id);
      }
    }

    if (needsFetch.length > 0) {
      const results = await Promise.all(needsFetch.map((id) => floatingObjects.getObject(id)));
      if (disposed || generation !== flushGeneration) return;
      for (const obj of results) {
        if (obj) fetched.push(obj as FloatingObjectSnapshot);
      }
    }

    let mergedBounds = boundsSnapshot;
    if (boundsOnlySnapshot) {
      mergedBounds = mergedBounds ? new Map(mergedBounds) : new Map();
      for (const [id, b] of boundsOnlySnapshot) {
        mergedBounds.set(id, b);
      }
    }

    if (fetched.length > 0 || deleteIds.length > 0 || (mergedBounds && mergedBounds.size > 0)) {
      if (disposed || generation !== flushGeneration) return;
      projection.applyBatch(fetched, deleteIds, mergedBounds);
    }
  };

  const cleanups: Array<() => void> = [];

  cleanups.push(
    workbook.on('floatingObject:created', (event) => {
      if (event.objectId) {
        scheduleObjectFetch(
          event.objectId,
          event.data as FloatingObject | undefined,
          event.bounds as FloatingObjectBoundsSnapshot | undefined,
        );
      }
    }),
  );
  cleanups.push(
    workbook.on('floatingObject:updated', (event) => {
      if (event.objectId) {
        scheduleObjectFetch(
          event.objectId,
          event.data as FloatingObject | undefined,
          event.bounds as FloatingObjectBoundsSnapshot | undefined,
        );
      }
    }),
  );
  cleanups.push(
    workbook.on('floatingObject:deleted', (event) => {
      if (event.objectId) {
        scheduleObjectDelete(event.objectId);
      }
    }),
  );

  // Initial-sheet seed. After hydration (XLSX hydration emits per-object
  // `floatingObject:created` events through `applyAndNotify`), the
  // initial seed is largely redundant — the projection populates from
  // the hydration event stream. We keep it for two cases:
  //   1. The bridge created an empty document (no hydration) and the
  //      sheet may already have programmatically-added objects.
  //   2. Defense in depth: if a future code path bypasses the mutation
  //      pipeline, the seed surfaces existing objects on coordinator
  //      construction rather than leaving a blank canvas.
  if (initialSheetId) {
    const seedSheet = initialSheetId;
    const seedGeneration = generation;
    void (async () => {
      try {
        if (disposed || generation !== seedGeneration) return;
        const sheet = toSheetId(seedSheet);
        const [objects, bounds] = await Promise.all([
          floatingObjects.getObjectsInSheet(sheet),
          floatingObjects.computeAllObjectBounds(sheet),
        ]);
        if (disposed || generation !== seedGeneration) return;
        if (objects.length > 0) {
          projection.setObjectsForSheet(seedSheet, objects as FloatingObjectSnapshot[], bounds);
        }
      } catch (err) {
        // Initial seed must never crash the coordinator.
        // eslint-disable-next-line no-console
        console.error('[FloatingObjectsProjection] initial seed failed', err);
      }
    })();
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      flushScheduled = false;
      pendingFetches.clear();
      pendingBounds.clear();
      pendingBoundsOnly.clear();
      pendingDeletes.clear();
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[FloatingObjectsProjection] cleanup threw', err);
        }
      }
      cleanups.length = 0;
    },
  };
}
