/**
 * Read-only synchronous projection of the kernel's floating-object state.
 *
 * **Architecture role.** This is the inbound counterpart to
 * `ISceneGraphReader`: where `ISceneGraphReader` exposes what the renderer
 * has on-screen (renderer → devtools), `IFloatingObjectsView` exposes what
 * the kernel knows (kernel → renderer + React).
 *
 * The view is one of the projection mirrors mandated by the kernel-projection
 * rule: **kernel state is async, its TS-side projection is sync, the renderer
 * reads only from projections, writes go through the bridge.** Drawings
 * are the first domain to apply this shape end-to-end (Phases 1–5 of
 * already follow it via the viewport buffer.
 *
 * **What an implementation guarantees.**
 *
 * 1. Reads are synchronous (no `Promise`) — the renderer takes the view as
 *    a constructor dependency and reads from it on every frame.
 * 2. The projection is updated by exactly one pipeline:
 *    `MutationResult → applyAndNotify → projection update → push notification`.
 *    Hydration, live mutations, undo/redo, and remote CRDT edits all fan
 *    in here. There is no second writer into the projection.
 * 3. `subscribe(...)` fires after every update, scoped to the affected
 *    sheet. React (`useSyncExternalStore`) and the canvas both subscribe.
 *
 * **What an implementation does NOT do.**
 *
 * - It does not render. The renderer translates `FloatingObjectSnapshot` +
 *   `FloatingObjectBoundsSnapshot` into its own `SceneObject` discriminated
 *   union; the snapshot here is shape-only.
 * - It does not write. Mutations go through `IObjectMutator` /
 *   `FloatingObjectManager` → bridge → kernel → mutation pipeline →
 *   projection update → reader notification. Closing this loop is what
 *   keeps the projection authoritative.
 *
 * **Naming.** "View" (this module) vs "Reader" (`scene-graph-reader.ts`)
 * is intentional: a *view* is the kernel's projection seen from the
 * outside; a *reader* is a renderer-internal accessor exposed for tooling.
 * They sit on opposite sides of the canvas and the names should reflect that.
 */

import type { FloatingObjectKind } from './floating-object-types';
import type { FloatingObject } from './floating-objects';

/**
 * Pre-computed pixel bounds for a floating object, as the kernel
 * (`compute_all_object_bounds`) sees them.
 *
 * Coordinates are in sheet-space pixels: same coordinate system the
 * canvas renderer uses to draw scene objects. `rotation` is in degrees,
 * matching the OOXML / FloatingObject anchor model.
 */
export interface FloatingObjectBoundsSnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/**
 * Public, read-only snapshot of a single floating object as the kernel
 * exposes it to the projection.
 *
 * The shape is the full `FloatingObject` discriminated union — same union
 * the renderer's `buildSceneObject(...)` consumes — re-exported here so
 * `types/objects` is the single source of the contract.
 *
 * Field set is intentionally **not** narrowed: rebuilding the renderer
 * scene-graph entry needs every type-specific subfield (picture src,
 * shape adjustments, chart configuration, …). A narrower read shape
 * would force the renderer back through a Rust round-trip to recover
 * the missing fields, defeating the projection's purpose.
 */
export type FloatingObjectSnapshot = FloatingObject;

/**
 * Subscription callback. Receives the `sheetId` whose projection just
 * updated (or `null` if the change is workbook-scoped). Listeners that
 * only care about a particular sheet should filter on it; listeners that
 * track the whole workbook (e.g. devtools / sidebar lists) can ignore
 * the argument and always re-read.
 */
export type FloatingObjectsViewListener = (sheetId: string | null) => void;

/**
 * Sync, push-notified view over the kernel's floating-object state.
 *
 * Implementations live in the kernel adapter layer (the projection that
 * `MutationResultHandler.applyAndNotify` writes into). Consumers — the
 * grid renderer (canvas), `useSyncExternalStore` hooks (React) — receive
 * a `IFloatingObjectsView` reference and read sync.
 */
export interface IFloatingObjectsView {
  /**
   * Sync read: every floating object on `sheetId`, sorted ascending by
   * `zIndex` so iteration order matches paint order. Returns an empty
   * array (never `undefined`) when the sheet has no objects.
   */
  getInSheet(sheetId: string): readonly FloatingObjectSnapshot[];

  /**
   * Sync read: pre-computed pixel bounds for every object on `sheetId`,
   * keyed by `objectId`. Bounds are produced by the kernel's
   * `compute_all_object_bounds(sheet_id)` and refreshed whenever a
   * dimension change (row resize, column insert, etc.) shifts an
   * anchored object — the projection updates the bounds map and pushes
   * a notification, so the renderer's `syncSceneGraph()` never has to
   * `await` for bounds.
   *
   * Objects whose bounds couldn't be computed (e.g. missing layout)
   * are absent from the map; the renderer must skip rendering them
   * rather than substituting defaults.
   */
  getBoundsInSheet(sheetId: string): ReadonlyMap<string, FloatingObjectBoundsSnapshot>;

  /**
   * Single-object lookup, or `undefined` if absent. Convenience for the
   * incremental-patch path; equivalent to `getInSheet(...).find(...)`
   * but constant-time on the projection's internal map.
   */
  getObjectById(objectId: string): FloatingObjectSnapshot | undefined;

  /**
   * Single-object bounds lookup, or `undefined` if not yet computed.
   */
  getBoundsById(objectId: string): FloatingObjectBoundsSnapshot | undefined;

  /**
   * Subscribe to projection updates. Returns an unsubscribe function.
   *
   * The listener fires **after** the projection has settled, so a sync
   * read inside the listener observes the post-update state. Listeners
   * are invoked in registration order; callers should not rely on
   * batching beyond a single microtask flush boundary.
   */
  subscribe(listener: FloatingObjectsViewListener): () => void;
}

/**
 * Re-export the FloatingObject kind discriminator so consumers can
 * narrow against snapshot.type without reaching into floating-objects.ts
 * directly.
 */
export type { FloatingObjectKind };
