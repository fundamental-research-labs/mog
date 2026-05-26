/**
 * WorksheetObjectCollection — universal floating object collection.
 *
 * Returns base FloatingObjectHandle instances. For type-specific handles
 * with content operations, use the typed collections (ws.shapes, ws.drawings, etc.)
 * or type-narrow from the base handle.
 */
import type { ObjectBounds } from '@mog/types-objects/objects/floating-object-manager';
import type { TextWarpPreset } from '@mog/types-objects/text-effects';
import type { FloatingObjectInfo } from '../../types';
import type { FloatingObjectHandle } from '../handles/floating-object-handle';

export interface WorksheetObjectCollection {
  /** Get a floating object handle by ID. Returns null if not found. */
  get(id: string): Promise<FloatingObjectHandle | null>;
  /** Get summary info (with spatial fields) for a floating object. Returns null if not found. */
  getInfo(id: string): Promise<FloatingObjectInfo | null>;
  /** List all floating objects on the sheet. */
  list(): Promise<FloatingObjectHandle[]>;
  /** Remove multiple floating objects. Returns count of successfully removed. */
  removeMany(ids: string[]): Promise<number>;

  // ── Single-ID convenience methods ──────────────────────────
  // Thin wrappers over get→handle.method() for fire-and-forget callers.

  /** Remove a single floating object by ID. Returns true if removed. */
  remove(id: string): Promise<boolean>;
  /** Bring a floating object to the front (highest z-order). */
  bringToFront(id: string): Promise<void>;
  /** Send a floating object to the back (lowest z-order). */
  sendToBack(id: string): Promise<void>;
  /** Bring a floating object forward by one layer. */
  bringForward(id: string): Promise<void>;
  /** Send a floating object backward by one layer. */
  sendBackward(id: string): Promise<void>;
  /** Update arbitrary properties of a floating object. */
  update(objectId: string, updates: Record<string, unknown>): Promise<void>;

  // ── TextEffect conversion ─────────────────────────────────────

  /** Convert a text box to decorative text by applying text-effect styling. */
  convertToTextEffect(objectId: string, warpPreset?: TextWarpPreset): Promise<void>;
  /** Convert decorative text back to a regular text box by removing text-effect styling. */
  convertToTextBox(objectId: string): Promise<void>;

  // ── Sheet-level bounds queries ─────────────────────────────

  /** Compute pixel bounding box for a floating object (async — uses ComputeBridge). */
  computeObjectBounds(objectId: string): Promise<ObjectBounds | null>;
  /** Batch-compute pixel bounds for all floating objects on this sheet. */
  computeAllObjectBounds(): Promise<Map<string, ObjectBounds>>;

  // ── Grouping (type-agnostic — any floating object can be grouped) ──

  /** Group multiple floating objects. Returns the group ID. */
  group(ids: string[]): Promise<string>;
  /** Ungroup a floating object group. */
  ungroup(groupId: string): Promise<void>;
}
