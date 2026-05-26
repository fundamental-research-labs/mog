/**
 * Event Emission Operations (Universal)
 *
 * App-agnostic event emission for canvas objects.
 * Accepts ICanvasEventBus via deps -- no singleton imports.
 *
 * LIFECYCLE EVENTS (created/updated/deleted):
 * These are NOT emitted here. All object mutations flow through the compute
 * bridge, which returns floatingObjectChanges in the MutationResult.
 * MutationResultHandler emits floatingObject:updated/deleted automatically.
 * This ensures a single event path and eliminates duplicate processing.
 *
 * GROUP EVENTS (grouped/ungrouped):
 * These ARE emitted here because grouping operations have no equivalent
 * in the MutationResult pipeline yet.
 *
 * @module core/events
 */

import type { CanvasObjectEvent, ICanvasEventBus } from '@mog-sdk/contracts/objects/canvas-object';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Dependencies required for event emission operations.
 */
export interface EventEmissionDeps {
  /** Event bus instance for emitting events */
  eventBus: ICanvasEventBus;
}

/**
 * Parameters for emitting a group created event.
 */
export interface GroupCreatedParams {
  /** Container (sheet/slide/page) holding the group */
  containerId: string;
  /** ID of the created group */
  groupId: string;
  /** IDs of objects that are members of the group */
  memberIds: string[];
  /** Source of the change (defaults to 'user') */
  source?: string;
}

/**
 * Parameters for emitting a group deleted event.
 */
export interface GroupDeletedParams {
  /** Container that held the group */
  containerId: string;
  /** ID of the deleted group */
  groupId: string;
  /** IDs of objects that were members of the group */
  memberIds: string[];
  /** Source of the change (defaults to 'user') */
  source?: string;
}

// =============================================================================
// GROUP EVENT EMISSION
// =============================================================================

/**
 * Emit an event when objects are grouped together.
 *
 * @param deps - Event emission dependencies (eventBus)
 * @param params - Parameters for the event
 */
export function emitGroupCreated(deps: EventEmissionDeps, params: GroupCreatedParams): void {
  const { eventBus } = deps;
  const { containerId, source = 'user' } = params;

  const event: CanvasObjectEvent = {
    type: 'canvasObject:grouped',
    containerId,
    timestamp: Date.now(),
    source,
  };
  eventBus.emit(event);
}

/**
 * Emit an event when a group is dissolved (ungrouped).
 *
 * @param deps - Event emission dependencies (eventBus)
 * @param params - Parameters for the event
 */
export function emitGroupDeleted(deps: EventEmissionDeps, params: GroupDeletedParams): void {
  const { eventBus } = deps;
  const { containerId, source = 'user' } = params;

  const event: CanvasObjectEvent = {
    type: 'canvasObject:ungrouped',
    containerId,
    timestamp: Date.now(),
    source,
  };
  eventBus.emit(event);
}
