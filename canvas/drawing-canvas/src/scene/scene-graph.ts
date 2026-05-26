/**
 * Scene Graph
 *
 * Maintains a collection of SceneObjects with sorted z-order access.
 * getByZOrder() always computes a fresh sorted array from the Map —
 * no caching, no invalidation, no stale references. For typical canvas
 * scenes (<1000 objects), the sort cost is negligible (~10μs).
 *
 * Mutation notification: SceneGraph accepts an onDirty callback at
 * construction. All mutating methods (add, remove, update) call onDirty()
 * with the affected bounds (old + new) so downstream layers can perform
 * partial repaint instead of full-layer invalidation.
 *
 * @module @mog/drawing-canvas/scene/scene-graph
 */

import type { Rect } from '@mog/canvas-engine';
import type { SceneObject } from './types';

/**
 * Callback signature for scene graph mutation notifications.
 *
 * @param affectedBounds - Axis-aligned bounding boxes of the affected objects
 *   (old bounds + new bounds). Empty array means full dirty (e.g., clear()).
 */
export type SceneGraphDirtyCallback = (affectedBounds: Rect[]) => void;

export class SceneGraph {
  private readonly objects = new Map<string, SceneObject>();
  private readonly dirtyIds = new Set<string>();
  private readonly onDirty: SceneGraphDirtyCallback | null;

  constructor(onDirty?: SceneGraphDirtyCallback) {
    this.onDirty = onDirty ?? null;
  }

  /** Add a scene object. Replaces if ID already exists. */
  add(obj: SceneObject): void {
    const existing = this.objects.get(obj.id);
    this.objects.set(obj.id, obj);
    this.dirtyIds.add(obj.id);

    if (this.onDirty) {
      const bounds: Rect[] = [];
      // If replacing an existing object, dirty its old bounds
      if (existing) {
        bounds.push(existing.bounds);
      }
      // Dirty the new object's bounds
      bounds.push(obj.bounds);
      this.onDirty(bounds);
    }
  }

  /** Remove a scene object by ID. Returns true if the object existed. */
  remove(id: string): boolean {
    const existing = this.objects.get(id);
    const existed = this.objects.delete(id);
    if (existed) {
      this.dirtyIds.add(id);
      if (this.onDirty && existing) {
        // Dirty the removed object's bounds
        this.onDirty([existing.bounds]);
      }
    }
    return existed;
  }

  /** Update an existing scene object. Returns true if the object existed. */
  update(id: string, updates: Partial<Omit<SceneObject, 'id' | 'type'>>): boolean {
    const existing = this.objects.get(id);
    if (!existing) return false;

    const updated = { ...existing, ...updates } as SceneObject;
    this.objects.set(id, updated);

    this.dirtyIds.add(id);
    if (this.onDirty) {
      const bounds: Rect[] = [existing.bounds];
      // If bounds changed, also dirty the new bounds
      if (
        updated.bounds.x !== existing.bounds.x ||
        updated.bounds.y !== existing.bounds.y ||
        updated.bounds.width !== existing.bounds.width ||
        updated.bounds.height !== existing.bounds.height
      ) {
        bounds.push(updated.bounds);
      }
      this.onDirty(bounds);
    }
    return true;
  }

  /** Get all objects sorted by z-index (ascending). Always fresh. */
  getByZOrder(): ReadonlyArray<SceneObject> {
    return Array.from(this.objects.values()).sort((a, b) => a.zIndex - b.zIndex);
  }

  /** Get a specific object by ID. */
  getById(id: string): SceneObject | undefined {
    return this.objects.get(id);
  }

  /** Get all objects in a group. */
  getGroupMembers(groupId: string): SceneObject[] {
    const members: SceneObject[] = [];
    for (const obj of this.objects.values()) {
      if (obj.groupId === groupId) {
        members.push(obj);
      }
    }
    return members;
  }

  /** Get the union bounding box of all members in a group. */
  getGroupBounds(groupId: string): Rect | null {
    const members = this.getGroupMembers(groupId);
    if (members.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const obj of members) {
      minX = Math.min(minX, obj.bounds.x);
      minY = Math.min(minY, obj.bounds.y);
      maxX = Math.max(maxX, obj.bounds.x + obj.bounds.width);
      maxY = Math.max(maxY, obj.bounds.y + obj.bounds.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /** Remove all objects from the scene graph. */
  clear(): void {
    if (this.objects.size === 0) return;
    for (const id of this.objects.keys()) {
      this.dirtyIds.add(id);
    }
    this.objects.clear();
    // Clear affects all objects — pass empty array to signal full dirty
    this.onDirty?.([]);
  }

  /** Get IDs of objects that have been mutated since last clearDirtyIds(). */
  getDirtyIds(): ReadonlySet<string> {
    return this.dirtyIds;
  }

  /** Clear the dirty IDs set (called after spatial index update). */
  clearDirtyIds(): void {
    this.dirtyIds.clear();
  }

  /** Get total number of objects. */
  get size(): number {
    return this.objects.size;
  }

  /** Check if scene graph has any objects. */
  get isEmpty(): boolean {
    return this.objects.size === 0;
  }
}
