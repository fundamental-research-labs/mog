/**
 * Object Interaction Operation Types
 *
 * Defines types for the unified floating object operation model.
 * All operations (drag, resize, rotate) use ONE state machine state
 * with operation details stored in context.
 *
 * This enables:
 * - Direct canvas updates (objects move with cursor, not preview outlines)
 * - Real-time collaboration (operations broadcast via presence channel)
 * - Single completion path (impossible to forget handling one operation type)
 * - Clean undo (single Yjs transaction per operation)
 *
 * @module @mog-sdk/contracts/actors/object-interaction
 */

import type { FloatingObjectKind } from '@mog/types-objects/objects/floating-objects';
import type { ObjectBounds } from '@mog/types-viewport/rendering/bounds';
import type { Point } from '@mog/types-viewport';

// =============================================================================
// RESIZE HANDLE TYPE
// =============================================================================

/**
 * Resize handle directions.
 * Represents the 8 compass points for resize handles around an object.
 */
export type OperationResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

// =============================================================================
// OBJECT STATE
// =============================================================================

/**
 * State of an object (bounds + rotation) for operation tracking.
 * Captures the complete geometric state needed to render an object.
 */
export interface OperationObjectState {
  /** Object bounds in pixel coordinates */
  bounds: ObjectBounds;
  /** Rotation angle in radians */
  rotation: number;
  /** Object type for constraint application during resize preview.
   *  Captured at operation start to avoid async IPC during rendering. */
  objectType?: FloatingObjectKind;
}

// =============================================================================
// FLOATING OBJECT OPERATION
// =============================================================================

/**
 * Unified floating object operation.
 * Captures all information needed for drag/resize/rotate operations.
 *
 * This is stored in the state machine context during an operation,
 * enabling:
 * - Pure calculation functions to derive effective state
 * - Single completion handler for all operation types
 * - Clean serialization for presence broadcast
 *
 * @example
 * ```typescript
 * // Start a drag operation
 * const operation: FloatingObjectOperation = {
 *   type: 'drag',
 *   objectIds: ['shape-1', 'shape-2'],
 *   startPosition: { x: 100, y: 100 },
 *   currentPosition: { x: 150, y: 120 },
 *   originalStates: new Map([
 *     ['shape-1', { bounds: { x: 50, y: 50, width: 100, height: 80, rotation: 0 }, rotation: 0 }],
 *     ['shape-2', { bounds: { x: 200, y: 50, width: 100, height: 80, rotation: 0 }, rotation: 0 }]
 *   ])
 * };
 * ```
 */
export interface FloatingObjectOperation {
  /** Operation type discriminator */
  type: 'drag' | 'resize' | 'rotate';
  /** IDs of objects being operated on (supports multi-select) */
  objectIds: string[];
  /** Mouse position at operation start (viewport coordinates) */
  startPosition: Point;
  /** Current mouse position (viewport coordinates) */
  currentPosition: Point;
  /**
   * Original states of all objects at operation start.
   * Used to calculate effective position during operation and
   * detect actual changes for undo.
   */
  originalStates: Map<string, OperationObjectState>;
  /** Resize handle being used (only for resize operations) */
  resizeHandle?: OperationResizeHandle;
  /** Center point for rotation (only for rotate operations) */
  rotationCenter?: Point;
}

// =============================================================================
// STATE MACHINE EVENTS
// =============================================================================

/**
 * Event to start a drag operation.
 * Transitions from selected → operating state.
 */
export interface StartDragEvent {
  type: 'START_DRAG';
  /** IDs of objects to drag */
  objectIds: string[];
  /** Starting mouse position */
  position: Point;
  /** Original states of all objects */
  originalStates: Map<string, OperationObjectState>;
}

/**
 * Event to start a resize operation.
 * Transitions from selected → operating state.
 */
export interface StartResizeEvent {
  type: 'START_RESIZE';
  /** IDs of objects to resize */
  objectIds: string[];
  /** Starting mouse position */
  position: Point;
  /** Which resize handle was grabbed */
  handle: OperationResizeHandle;
  /** Original states of all objects */
  originalStates: Map<string, OperationObjectState>;
}

/**
 * Event to start a rotate operation.
 * Transitions from selected → operating state.
 */
export interface StartRotateEvent {
  type: 'START_ROTATE';
  /** IDs of objects to rotate */
  objectIds: string[];
  /** Starting mouse position */
  position: Point;
  /** Center point for rotation calculation */
  rotationCenter: Point;
  /** Original states of all objects */
  originalStates: Map<string, OperationObjectState>;
}

/**
 * Event to update the current position during an operation.
 * Fires on mouse move while operating.
 */
export interface UpdatePositionEvent {
  type: 'UPDATE_POSITION';
  /** New mouse position */
  position: Point;
}

/**
 * Event to complete the current operation.
 * Transitions from operating → selected state.
 * Operation remains in context for the completion subscription to read.
 */
export interface CompleteOperationEvent {
  type: 'COMPLETE_OPERATION';
}

/**
 * Event to cancel the current operation.
 * Transitions from operating → selected state and clears the operation.
 * Objects return to their original positions.
 */
export interface CancelOperationEvent {
  type: 'CANCEL_OPERATION';
}

/**
 * Event to clear the operation from context after commit.
 * Called by the completion subscription after persisting to Yjs.
 */
export interface ClearOperationEvent {
  type: 'CLEAR_OPERATION';
}

// =============================================================================
// EVENT UNION TYPE
// =============================================================================

/**
 * Union of all operation-related events.
 * Used for type-safe event handling in the state machine.
 */
export type OperationEvent =
  | StartDragEvent
  | StartResizeEvent
  | StartRotateEvent
  | UpdatePositionEvent
  | CompleteOperationEvent
  | CancelOperationEvent
  | ClearOperationEvent;
