/**
 * Operation Calculation Functions
 *
 * Pure functions for calculating effective object state from operations.
 * These are used by both the effective state service and for final state calculation.
 *
 * All functions are PURE - no side effects, easily testable.
 *
 */

import {
  calculateRotationDelta,
  calculateResizeBounds as engineResizeBounds,
  type ResizeConstraints,
} from '@mog/canvas-engine';
import type { ObjectBounds } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';

// =============================================================================
// LOCAL TYPES (will be imported from contracts once is complete)
// =============================================================================

/**
 * Resize handle direction for floating object operations.
 * Named differently from chart-machine's ResizeHandle to avoid export conflicts.
 */
export type ObjectResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * Object state for calculations.
 * Contains bounds, rotation, and optional type for constraint application.
 */
export interface ObjectState {
  bounds: ObjectBounds;
  rotation: number;
  /** Object type carried through from OperationObjectState for constraint lookup. */
  objectType?: string;
}

/**
 * Floating object operation descriptor.
 * Captures all state needed to calculate effective positions during drag/resize/rotate.
 */
export interface FloatingObjectOperation {
  type: 'drag' | 'resize' | 'rotate';
  objectIds: string[];
  startPosition: Point;
  currentPosition: Point;
  originalStates: Map<string, ObjectState>;
  resizeHandle?: ObjectResizeHandle;
  rotationCenter?: Point;
}

/**
 * Object type for resize constraint application.
 * Accepts any FloatingObjectType string — the constraint logic maps internally.
 */
export type ObjectType = string;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Minimum chart width in pixels */
const MIN_CHART_WIDTH = 100;

/** Minimum chart height in pixels */
const MIN_CHART_HEIGHT = 80;

/** Minimum dimension for any object */
const MIN_DIMENSION = 1;

function isAspectLockedObjectType(objectType: ObjectType | undefined): boolean {
  return objectType === 'image' || objectType === 'picture';
}

// =============================================================================
// MAIN CALCULATION FUNCTIONS
// =============================================================================

/**
 * Calculate the effective state for an object from an operation.
 * This is the main entry point - dispatches to appropriate calculation based on operation type.
 *
 * @param operation - The current operation
 * @param objectId - The object to calculate state for
 * @param objectType - Optional object type for constraint application
 * @returns The calculated state for the object
 * @throws Error if no original state exists for the object
 */
export function calculateStateFromOperation(
  operation: FloatingObjectOperation,
  objectId: string,
  objectType?: ObjectType,
): ObjectState {
  const original = operation.originalStates.get(objectId);
  if (!original) {
    throw new Error(`No original state for object ${objectId}`);
  }

  // Use explicitly passed type, or fall back to type embedded in original state
  const resolvedType = objectType ?? original.objectType;

  switch (operation.type) {
    case 'drag':
      return calculateDragState(operation, original);
    case 'resize':
      return calculateResizeState(operation, original, resolvedType);
    case 'rotate':
      return calculateRotateState(operation, original);
  }
}

/**
 * Calculate state for a drag operation.
 * Applies position delta from mouse movement to original bounds.
 *
 * @param operation - The drag operation
 * @param original - The original state before drag started
 * @returns New state with updated position
 */
export function calculateDragState(
  operation: FloatingObjectOperation,
  original: ObjectState,
): ObjectState {
  const deltaX = operation.currentPosition.x - operation.startPosition.x;
  const deltaY = operation.currentPosition.y - operation.startPosition.y;

  return {
    bounds: {
      ...original.bounds,
      x: original.bounds.x + deltaX,
      y: original.bounds.y + deltaY,
    },
    rotation: original.rotation,
  };
}

/**
 * Calculate state for a resize operation.
 * Handles all 8 resize handles with object-type-specific constraints.
 *
 * Object-type constraints:
 * - Images: Preserve aspect ratio
 * - Charts: Enforce minimum size (100x80 pixels)
 * - Shapes: Free resize (no constraints)
 *
 * @param operation - The resize operation
 * @param original - The original state before resize started
 * @param objectType - Optional object type for constraint application
 * @returns New state with updated bounds
 */
export function calculateResizeState(
  operation: FloatingObjectOperation,
  original: ObjectState,
  objectType?: ObjectType,
): ObjectState {
  const handle = operation.resizeHandle!;
  const deltaX = operation.currentPosition.x - operation.startPosition.x;
  const deltaY = operation.currentPosition.y - operation.startPosition.y;

  // Extract Rect from ObjectBounds (canvas-engine Rect has no rotation field)
  const originalRect = {
    x: original.bounds.x,
    y: original.bounds.y,
    width: original.bounds.width,
    height: original.bounds.height,
  };

  // Build constraints from object type.
  // Pictures are persisted as 'picture' but coordination/test helpers use the 'image' alias.
  // Both preserve aspect ratio; charts enforce minimum size; all others free resize.
  let constraints: ResizeConstraints;
  if (isAspectLockedObjectType(objectType)) {
    constraints = {
      aspectRatio: original.bounds.width / original.bounds.height,
      minWidth: MIN_DIMENSION,
      minHeight: MIN_DIMENSION,
    };
  } else if (objectType === 'chart') {
    constraints = { minWidth: MIN_CHART_WIDTH, minHeight: MIN_CHART_HEIGHT };
  } else {
    constraints = { minWidth: MIN_DIMENSION, minHeight: MIN_DIMENSION };
  }

  const newRect = engineResizeBounds(originalRect, handle, deltaX, deltaY, constraints);

  return {
    bounds: { ...newRect, rotation: original.bounds.rotation },
    rotation: original.rotation,
  };
}

/**
 * Calculate state for a rotate operation.
 * Uses the rotation center and calculates angle delta from mouse positions.
 *
 * @param operation - The rotate operation
 * @param original - The original state before rotate started
 * @returns New state with updated rotation
 */
export function calculateRotateState(
  operation: FloatingObjectOperation,
  original: ObjectState,
): ObjectState {
  const center = operation.rotationCenter!;
  const deltaAngle = calculateRotationDelta(
    center,
    operation.startPosition,
    operation.currentPosition,
  );

  return {
    bounds: original.bounds,
    rotation: original.rotation + deltaAngle,
  };
}

/**
 * Calculate final states for all objects in an operation.
 * Used when committing the operation to get the final positions.
 *
 * @param operation - The operation to calculate final states for
 * @param getObjectType - Optional function to get object type for constraint application
 * @returns Map of object IDs to their final states
 */
export async function calculateFinalStates(
  operation: FloatingObjectOperation,
  getObjectType?: (objectId: string) => Promise<ObjectType | undefined> | ObjectType | undefined,
): Promise<Map<string, ObjectState>> {
  const result = new Map<string, ObjectState>();

  for (const objectId of operation.objectIds) {
    const objectType = await getObjectType?.(objectId);
    const finalState = calculateStateFromOperation(operation, objectId, objectType);
    result.set(objectId, finalState);
  }

  return result;
}
