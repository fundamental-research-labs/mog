/**
 * Canvas Object Manager (Universal)
 *
 * Generic class parameterized by anchor type that works for any app
 * (spreadsheet, slides, whiteboard, etc.). This is the UNIVERSAL manager
 * with ZERO spreadsheet imports.
 *
 * Dependencies:
 * - IObjectStore: Generic CRUD for canvas objects
 * - IPositionResolver: Converts app-specific anchors to pixel positions
 * - ICanvasEventBus: Event emission
 * - IGroupStore: Group CRUD
 *
 * Delegates to:
 * - core/mutations — CRUD operations
 * - core/z-order — Z-order management
 * - core/grouping — Group/ungroup
 * - core/positioning — Move/resize/rotate (pixel math)
 * - core/events — Event emission
 * - managers/ — Type-specific creation (shape, picture, textbox, drawing)
 *
 * @see contracts/src/objects/canvas-object.ts - Universal type contracts
 * @see ./spreadsheet-object-manager.ts - Spreadsheet-specific composition
 */

import type {
  CanvasObject,
  CanvasObjectGroup,
  CanvasObjectPosition,
  ICanvasEventBus,
  IGroupStore,
  IObjectStore,
  IPositionResolver,
} from '@mog-sdk/contracts/objects/canvas-object';

// Core operations (universal, no spreadsheet imports)
import {
  bringForward,
  bringToFront,
  getNextZIndex,
  sendBackward,
  sendToBack,
  type ZOrderDeps,
} from './core/z-order';

import {
  deleteObject as coreDeleteObject,
  deleteObjects as coreDeleteObjects,
  updateObject as coreUpdateObject,
  type MutationDeps,
} from './core/mutations';

import {
  groupObjects as coreGroupObjects,
  ungroupObjects as coreUngroupObjects,
  getGroup,
  type GroupingDeps,
} from './core/grouping';

import { emitGroupCreated, emitGroupDeleted, type EventEmissionDeps } from './core/events';

import { moveByPixels, resizePixels, rotatePixels } from './core/positioning';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies for the CanvasObjectManager.
 *
 * @template TAnchor App-specific anchor type
 */
export interface CanvasObjectManagerDeps<TAnchor = unknown> {
  /** CRUD store for canvas objects */
  store: IObjectStore<CanvasObject<TAnchor>>;
  /** Group store for canvas object groups */
  groupStore: IGroupStore<CanvasObjectGroup>;
  /** Resolves app-specific anchors to pixel positions */
  resolver: IPositionResolver<TAnchor>;
  /** Event bus for emitting canvas object events */
  eventBus: ICanvasEventBus;
}

// =============================================================================
// CANVAS OBJECT MANAGER
// =============================================================================

/**
 * Universal Canvas Object Manager.
 *
 * Works for any app (spreadsheet, slides, whiteboard) by accepting generic
 * IObjectStore, IPositionResolver, and ICanvasEventBus. Has ZERO spreadsheet
 * dependencies.
 *
 * App-specific managers (SpreadsheetObjectManager, SlidesObjectManager, etc.)
 * COMPOSE this class and add their domain-specific methods.
 *
 * @template TAnchor App-specific anchor type (CellAnchor, SlideAnchor, etc.)
 */
export class CanvasObjectManager<TAnchor = unknown> {
  private store: IObjectStore<CanvasObject<TAnchor>>;
  private groupStore: IGroupStore<CanvasObjectGroup>;
  private resolver: IPositionResolver<TAnchor>;
  private eventBus: ICanvasEventBus;

  /** Counter for generating unique object names per type */
  private objectCounters: Map<string, number> = new Map();

  constructor(deps: CanvasObjectManagerDeps<TAnchor>) {
    this.store = deps.store;
    this.groupStore = deps.groupStore;
    this.resolver = deps.resolver;
    this.eventBus = deps.eventBus;
  }

  // ===========================================================================
  // ACCESSOR HELPERS (for composition by app-specific managers)
  // ===========================================================================

  /** Get the underlying object store. */
  getStore(): IObjectStore<CanvasObject<TAnchor>> {
    return this.store;
  }

  /** Get the underlying group store. */
  getGroupStore(): IGroupStore<CanvasObjectGroup> {
    return this.groupStore;
  }

  /** Get the position resolver. */
  getResolver(): IPositionResolver<TAnchor> {
    return this.resolver;
  }

  /** Get the event bus. */
  getEventBus(): ICanvasEventBus {
    return this.eventBus;
  }

  // ===========================================================================
  // INTERNAL DEP HELPERS
  // ===========================================================================

  private getZOrderDeps(): ZOrderDeps<CanvasObject<TAnchor>> {
    return { store: this.store };
  }

  private getMutationDeps(): MutationDeps<CanvasObject<TAnchor>> {
    return { store: this.store };
  }

  private getGroupingDeps(): GroupingDeps<CanvasObject<TAnchor>, CanvasObjectGroup> {
    return { store: this.store, groupStore: this.groupStore };
  }

  private getEventDeps(): EventEmissionDeps {
    return { eventBus: this.eventBus };
  }

  // ===========================================================================
  // READ OPERATIONS
  // ===========================================================================

  /**
   * Get a single object by ID.
   *
   * @param objectId - The object ID to find
   * @returns The object and its document, or undefined
   */
  async getObject(objectId: string): Promise<CanvasObject<TAnchor> | undefined> {
    const result = await this.store.read(objectId);
    return result.object;
  }

  /**
   * Get all objects in a document.
   *
   * @param containerId - Container to get objects from
   * @returns Array of objects sorted by z-index
   */
  async getObjectsInDocument(containerId: string): Promise<CanvasObject<TAnchor>[]> {
    const objects = await this.store.readInDocument(containerId);
    return objects.sort((a, b) => a.zIndex - b.zIndex);
  }

  // ===========================================================================
  // DELETE OPERATIONS (delegates to core/mutations)
  // ===========================================================================

  /**
   * Delete a single object.
   *
   * @param objectId - Object ID to delete
   * @returns true if the object was deleted
   */
  async deleteObject(objectId: string): Promise<boolean> {
    const result = await coreDeleteObject(this.getMutationDeps(), objectId);
    return result.success;
  }

  /**
   * Delete multiple objects.
   *
   * @param objectIds - Array of object IDs to delete
   * @returns Number of successfully deleted objects
   */
  async deleteObjects(objectIds: string[]): Promise<number> {
    const result = await coreDeleteObjects(this.getMutationDeps(), objectIds);
    return result.deletedCount;
  }

  // ===========================================================================
  // UPDATE OPERATIONS
  // ===========================================================================

  /**
   * Update an object with partial properties.
   *
   * @param objectId - Object ID to update
   * @param updates - Partial properties to merge
   * @returns true if the update succeeded
   */
  async updateObject(objectId: string, updates: Partial<CanvasObject<TAnchor>>): Promise<boolean> {
    return coreUpdateObject(this.getMutationDeps(), objectId, updates);
  }

  // ===========================================================================
  // MOVE / RESIZE / ROTATE (pixel-based, delegates to core/positioning)
  // ===========================================================================

  /**
   * Move an object by a pixel delta.
   *
   * Resolves the current position, applies the delta, converts back to
   * an anchor, and persists the update.
   *
   * @param objectId - Object ID to move
   * @param dx - Horizontal delta in pixels
   * @param dy - Vertical delta in pixels
   * @returns true if the move succeeded
   */
  async moveObject(objectId: string, dx: number, dy: number): Promise<boolean> {
    const found = await this.store.read(objectId);
    if (!found.object || !found.containerId) return false;

    const obj = found.object;
    const currentPos = this.resolver.resolve(obj.containerId, obj.anchor);
    if (!currentPos) return false;

    const newPos = moveByPixels(currentPos, dx, dy);
    const newAnchor = this.resolver.fromPixels(
      obj.containerId,
      newPos.x,
      newPos.y,
      newPos.width,
      newPos.height,
    );

    const result = await this.store.update(
      objectId,
      { anchor: newAnchor } as Partial<CanvasObject<TAnchor>>,
      obj.containerId,
    );

    // No manual event emission — store.update() goes through the compute bridge,
    // which returns floatingObjectChanges. MutationResultHandler emits
    // floatingObject:updated automatically.

    return result.success;
  }

  /**
   * Resize an object to new pixel dimensions.
   *
   * Resolves the current position, applies the new size, converts back to
   * an anchor, and persists the update.
   *
   * @param objectId - Object ID to resize
   * @param width - New width in pixels
   * @param height - New height in pixels
   * @returns true if the resize succeeded
   */
  async resizeObject(objectId: string, width: number, height: number): Promise<boolean> {
    const found = await this.store.read(objectId);
    if (!found.object || !found.containerId) return false;

    const obj = found.object;
    const currentPos = this.resolver.resolve(obj.containerId, obj.anchor);
    if (!currentPos) return false;

    const newPos = resizePixels(currentPos, width, height);
    const newAnchor = this.resolver.fromPixels(
      obj.containerId,
      newPos.x,
      newPos.y,
      newPos.width,
      newPos.height,
    );

    const result = await this.store.update(
      objectId,
      { anchor: newAnchor } as Partial<CanvasObject<TAnchor>>,
      obj.containerId,
    );

    return result.success;
  }

  /**
   * Rotate an object to a new angle.
   *
   * @param objectId - Object ID to rotate
   * @param angle - New rotation angle in degrees
   * @returns true if the rotation succeeded
   */
  async rotateObject(objectId: string, angle: number): Promise<boolean> {
    const found = await this.store.read(objectId);
    if (!found.object || !found.containerId) return false;

    const obj = found.object;
    const currentPos = this.resolver.resolve(obj.containerId, obj.anchor);
    if (!currentPos) return false;

    const newPos = rotatePixels(currentPos, angle);

    // Rotation doesn't change the anchor, just the rotation metadata.
    // We need to update a rotation field if the object supports it,
    // or store it as part of the anchor depending on the app.
    // For now, we re-derive the anchor (which preserves position but may lose rotation).
    const newAnchor = this.resolver.fromPixels(
      obj.containerId,
      newPos.x,
      newPos.y,
      newPos.width,
      newPos.height,
    );

    const result = await this.store.update(
      objectId,
      { anchor: newAnchor } as Partial<CanvasObject<TAnchor>>,
      obj.containerId,
    );

    return result.success;
  }

  // ===========================================================================
  // Z-ORDER OPERATIONS (delegates to core/z-order)
  // ===========================================================================

  /**
   * Bring an object to the front (highest z-index).
   */
  async bringToFront(containerId: string, objectId: string): Promise<boolean> {
    const result = await bringToFront(this.getZOrderDeps(), containerId, objectId);
    return result.success;
  }

  /**
   * Send an object to the back (lowest z-index).
   */
  async sendToBack(containerId: string, objectId: string): Promise<boolean> {
    const result = await sendToBack(this.getZOrderDeps(), containerId, objectId);
    return result.success;
  }

  /**
   * Bring an object one step forward in z-order.
   */
  async bringForward(containerId: string, objectId: string): Promise<boolean> {
    const result = await bringForward(this.getZOrderDeps(), containerId, objectId);
    return result.success;
  }

  /**
   * Send an object one step backward in z-order.
   */
  async sendBackward(containerId: string, objectId: string): Promise<boolean> {
    const result = await sendBackward(this.getZOrderDeps(), containerId, objectId);
    return result.success;
  }

  // ===========================================================================
  // GROUPING OPERATIONS (delegates to core/grouping)
  // ===========================================================================

  /**
   * Group multiple objects together.
   *
   * @param containerId - Container holding the objects
   * @param objectIds - Array of object IDs to group (minimum 2)
   * @returns The created group ID, or null if grouping failed
   */
  async groupObjects(containerId: string, objectIds: string[]): Promise<string | null> {
    try {
      const groupId = await coreGroupObjects(this.getGroupingDeps(), objectIds);

      emitGroupCreated(this.getEventDeps(), {
        containerId,
        groupId,
        memberIds: objectIds,
      });

      return groupId;
    } catch {
      return null;
    }
  }

  /**
   * Ungroup a group, leaving member objects intact.
   *
   * @param groupId - Group ID to ungroup
   * @returns true if the group was dissolved
   */
  async ungroupObjects(groupId: string): Promise<boolean> {
    const group = await getGroup(this.getGroupingDeps(), groupId);
    if (!group) return false;

    const memberIds = await coreUngroupObjects(this.getGroupingDeps(), groupId);

    if (memberIds.length > 0) {
      emitGroupDeleted(this.getEventDeps(), {
        containerId: group.containerId,
        groupId,
        memberIds,
      });
    }

    return memberIds.length > 0;
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  /**
   * Duplicate an object, creating a new copy with a slight offset.
   *
   * @param objectId - Object ID to duplicate
   * @returns The new object, or null if duplication failed
   */
  async duplicateObject(objectId: string): Promise<CanvasObject<TAnchor> | null> {
    const found = await this.store.read(objectId);
    if (!found.object || !found.containerId) return null;

    const obj = found.object;

    // Resolve current position, offset by 20px, convert back to anchor
    const currentPos = this.resolver.resolve(obj.containerId, obj.anchor);
    if (!currentPos) return null;

    const offsetPos = moveByPixels(currentPos, 20, 20);
    const newAnchor = this.resolver.fromPixels(
      obj.containerId,
      offsetPos.x,
      offsetPos.y,
      offsetPos.width,
      offsetPos.height,
    );

    const nextZ = await getNextZIndex(this.getZOrderDeps(), obj.containerId);

    const newObject: CanvasObject<TAnchor> = {
      ...obj,
      id: this.generateObjectId(),
      name: obj.name ? `${obj.name} (Copy)` : undefined,
      anchor: newAnchor,
      zIndex: nextZ,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = await this.store.create(obj.containerId, newObject);
    if (!result.success || !result.object) return null;

    return result.object;
  }

  /**
   * Hit-test: find the topmost object at (x, y) in a document.
   *
   * Checks objects in reverse z-order (topmost first).
   *
   * @param containerId - Container to test in
   * @param x - X coordinate in pixels
   * @param y - Y coordinate in pixels
   * @returns The hit object, or null
   */
  async hitTest(containerId: string, x: number, y: number): Promise<CanvasObject<TAnchor> | null> {
    const objects = await this.getObjectsInDocument(containerId);

    // Check in reverse z-order (topmost first)
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      const pos = this.resolver.resolve(containerId, obj.anchor);
      if (!pos) continue;

      if (x >= pos.x && x <= pos.x + pos.width && y >= pos.y && y <= pos.y + pos.height) {
        return obj;
      }
    }

    return null;
  }

  // ===========================================================================
  // POSITION RESOLUTION
  // ===========================================================================

  /**
   * Resolve an anchor to pixel bounds.
   *
   * @param containerId - Container context
   * @param anchor - App-specific anchor to resolve
   * @returns Pixel bounds, or null if anchor is invalid
   */
  resolvePosition(containerId: string, anchor: TAnchor): CanvasObjectPosition | null {
    return this.resolver.resolve(containerId, anchor);
  }

  // ===========================================================================
  // NAME & ID GENERATION
  // ===========================================================================

  /**
   * Generate a unique object ID.
   */
  generateObjectId(): string {
    return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Generate a unique object name for a given type.
   *
   * @param type - The object type string
   * @returns A unique name like "Shape 1", "Picture 2", etc.
   */
  generateObjectName(type: string): string {
    const count = (this.objectCounters.get(type) ?? 0) + 1;
    this.objectCounters.set(type, count);

    // Capitalize first letter
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    return `${label} ${count}`;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a CanvasObjectManager instance.
 *
 * @template TAnchor App-specific anchor type
 * @param deps - Manager dependencies
 * @returns A new CanvasObjectManager
 */
export function createCanvasObjectManager<TAnchor = unknown>(
  deps: CanvasObjectManagerDeps<TAnchor>,
): CanvasObjectManager<TAnchor> {
  return new CanvasObjectManager(deps);
}
