/**
 * Canvas Object Events
 *
 * Event emission layer for canvas object lifecycle events, generalized from
 * the spreadsheet-specific floating-object-events.ts. Uses `containerId`
 * instead of `sheetId` and accepts ICanvasEventBus via deps.
 *
 * Events:
 * - canvasObject:created   -- A new object was created
 * - canvasObject:updated   -- An object's properties changed
 * - canvasObject:deleted   -- An object was removed
 * - canvasObject:moved     -- An object was repositioned
 * - canvasObject:resized   -- An object was resized
 * - canvasObject:rotated   -- An object was rotated
 * - canvasObject:reordered -- Z-order changed for one or more objects
 * - canvasObject:grouped   -- Objects were grouped together
 * - canvasObject:ungrouped -- A group was dissolved
 *
 * Architecture:
 * - Stateless functions: each takes ICanvasEventBus + parameters
 * - No direct CRDT dependency
 * - No computation -- just event construction and emission
 * - Callers compose Store operations + Event emissions as needed
 *
 * @see ./object-store.ts          -- IObjectStore implementation
 * @see ./core/events.ts           -- Canonical universal event implementations
 * @see ../context/event-bus.ts    -- EventBus implementation
 */

import type {
  CanvasObjectEvent,
  CanvasObjectPosition,
  ICanvasEventBus,
} from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// Re-exports from core/events.ts (canonical universal implementations)
// =============================================================================

export {
  emitGroupCreated,
  emitGroupDeleted,
  type EventEmissionDeps,
  type GroupCreatedParams,
  type GroupDeletedParams,
} from './core/events';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies for event emission.
 */
export interface CanvasEventDeps {
  /** ICanvasEventBus instance */
  eventBus: ICanvasEventBus;
}

/**
 * Common parameters shared by most events.
 */
interface BaseEventParams {
  /** Container (sheet/slide/page) holding the object */
  containerId: string;
  /** Source of the change */
  source?: string;
}

// =============================================================================
// Move / Resize / Rotate / Reorder Events
// =============================================================================

/**
 * Emit an event when a canvas object is moved.
 *
 * @param deps - Event dependencies
 * @param params - Event parameters including old and new positions
 */
export function emitCanvasObjectMoved(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectId: string;
    previousPosition: CanvasObjectPosition;
    newPosition: CanvasObjectPosition;
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectId, source = 'user' } = params;

  const event: CanvasObjectEvent = {
    type: 'canvasObject:moved',
    containerId,
    objectId,
    timestamp: Date.now(),
    source,
  };
  eventBus.emit(event);
}

/**
 * Emit an event when a canvas object is resized.
 *
 * @param deps - Event dependencies
 * @param params - Event parameters including old and new dimensions
 */
export function emitCanvasObjectResized(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectId: string;
    previousWidth: number;
    previousHeight: number;
    newWidth: number;
    newHeight: number;
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectId, source = 'user' } = params;

  const event: CanvasObjectEvent = {
    type: 'canvasObject:resized',
    containerId,
    objectId,
    timestamp: Date.now(),
    source,
  };
  eventBus.emit(event);
}

/**
 * Emit an event when a canvas object is rotated.
 *
 * @param deps - Event dependencies
 * @param params - Event parameters including old and new rotation
 */
export function emitCanvasObjectRotated(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectId: string;
    previousRotation: number;
    newRotation: number;
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectId, source = 'user' } = params;

  const event: CanvasObjectEvent = {
    type: 'canvasObject:rotated',
    containerId,
    objectId,
    timestamp: Date.now(),
    source,
  };
  eventBus.emit(event);
}

/**
 * Emit events when z-order changes for objects.
 *
 * Emits one `canvasObject:zOrderChanged` event per object whose
 * z-index changed.
 *
 * @param deps - Event dependencies
 * @param params - Event parameters
 */
export function emitCanvasObjectsReordered(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    /** Objects whose z-order changed */
    changes: Array<{ objectId: string; oldZIndex: number; newZIndex: number }>;
  },
): void {
  const { eventBus } = deps;
  const { containerId, changes, source = 'user' } = params;

  const timestamp = Date.now();
  const events: CanvasObjectEvent[] = changes.map(({ objectId }) => ({
    type: 'canvasObject:zOrderChanged' as const,
    containerId,
    objectId,
    source,
    timestamp,
  }));

  if (events.length > 0) {
    eventBus.emitBatch(events);
  }
}

// =============================================================================
// Batch Event Emission
// =============================================================================

/**
 * Emit created events for multiple objects.
 * Uses ICanvasEventBus.emitBatch for efficient batching.
 *
 * @param deps - Event dependencies
 * @param params - Batch parameters
 */
export function emitBatchCanvasObjectsCreated(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectIds: string[];
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectIds, source = 'user' } = params;

  if (objectIds.length === 0) return;

  const timestamp = Date.now();
  const events: CanvasObjectEvent[] = objectIds.map((objectId) => ({
    type: 'canvasObject:created' as const,
    containerId,
    objectId,
    source,
    timestamp,
  }));

  eventBus.emitBatch(events);
}

/**
 * Emit deleted events for multiple objects.
 * Uses ICanvasEventBus.emitBatch for efficient batching.
 *
 * @param deps - Event dependencies
 * @param params - Batch parameters
 */
export function emitBatchCanvasObjectsDeleted(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectIds: string[];
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectIds, source = 'user' } = params;

  if (objectIds.length === 0) return;

  const timestamp = Date.now();
  const events: CanvasObjectEvent[] = objectIds.map((objectId) => ({
    type: 'canvasObject:deleted' as const,
    containerId,
    objectId,
    source,
    timestamp,
  }));

  eventBus.emitBatch(events);
}

/**
 * Emit updated events for multiple objects.
 * Uses ICanvasEventBus.emitBatch for efficient batching.
 *
 * @param deps - Event dependencies
 * @param params - Batch parameters
 */
export function emitBatchCanvasObjectsUpdated(
  deps: CanvasEventDeps,
  params: BaseEventParams & {
    objectIds: string[];
  },
): void {
  const { eventBus } = deps;
  const { containerId, objectIds, source = 'user' } = params;

  if (objectIds.length === 0) return;

  const timestamp = Date.now();
  const events: CanvasObjectEvent[] = objectIds.map((objectId) => ({
    type: 'canvasObject:updated' as const,
    containerId,
    objectId,
    source,
    timestamp,
  }));

  eventBus.emitBatch(events);
}
