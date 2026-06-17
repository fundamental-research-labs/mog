/**
 * Shared base interface for floating-object handles.
 *
 * This module hosts the canonical `FloatingObjectHandle` interface (base
 * members only) so subtype handles can extend it without pulling in the
 * aggregator `./floating-object-handle.ts`. The aggregator augments this
 * interface with narrowing methods (`isShape()`, `asShape()`, ...) via TS
 * declaration merging, which does not create a module-graph edge back into
 * this file. Imports flow in one direction only:
 *
 *   subtypes         -> types.ts
 *   floating-object-handle.ts -> types.ts
 *   floating-object-handle.ts -> subtypes (one-way aggregation)
 */
import type {
  FloatingObject,
  FloatingObjectKind,
} from '@mog/types-objects/objects/floating-objects';
import type { ObjectBounds } from '@mog/types-objects/objects/object-bounds-reader';
import type {
  FloatingObjectHandleMutationReceipt,
  FloatingObjectRemoveReceipt,
  FloatingObjectMutationReceipt,
} from '../../mutation-receipt';

export interface FloatingObjectHandle {
  /** Stable object ID. */
  readonly id: string;

  /** Discriminator for type narrowing. */
  readonly type: FloatingObjectKind;

  // -- Spatial (all types) -------------------------------------
  /**
   * Move by delta. dx/dy are pixel offsets (relative).
   * Rust resolves to new cell anchor.
   */
  move(dx: number, dy: number): Promise<FloatingObjectMutationReceipt>;
  /** Set absolute dimensions in pixels. */
  resize(width: number, height: number): Promise<FloatingObjectMutationReceipt>;
  /** Set absolute rotation angle in degrees. */
  rotate(angle: number): Promise<void>;
  /** Flip horizontally or vertically. */
  flip(axis: 'horizontal' | 'vertical'): Promise<void>;

  // -- Z-order (all types) -------------------------------------
  bringToFront(): Promise<void>;
  sendToBack(): Promise<void>;
  bringForward(): Promise<void>;
  sendBackward(): Promise<void>;

  // -- Lifecycle (all types) -----------------------------------
  delete(): Promise<FloatingObjectRemoveReceipt>;
  duplicate(
    offsetX?: number,
    offsetY?: number,
  ): Promise<FloatingObjectHandleMutationReceipt<FloatingObjectHandle>>;

  // -- Reads (all types) --------------------------------------
  /** Sync pixel bounds from scene graph. Null if not rendered yet. */
  getBounds(): ObjectBounds | null;
  /** Full object data (async — reads from store). */
  getData(): Promise<FloatingObject>;

  // Narrowing methods (`isShape()`, `asShape()`, ...) are contributed by
  // `./floating-object-handle.ts` via declaration merging, so references to
  // subtype handles do not create an import-graph edge from this module.
}
