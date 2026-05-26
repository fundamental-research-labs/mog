/**
 * Effective State Service
 *
 * Computes the visual state of floating objects during operations.
 * Implements a three-layer model for handling local, remote, and persisted state.
 *
 * Layer 3 (Local): Current user's in-progress operation (0ms latency)
 * Layer 2 (Remote): Other users' operations via presence (~100ms latency)
 * Layer 1 (Base): Persisted state in Yjs (source of truth)
 *
 * The renderer uses effective state for display, not persisted state.
 * On operation complete, final state is committed to Layer 1.
 *
 */

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { ObjectAccessor } from '@mog-sdk/contracts/actors';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { ObjectBounds } from '@mog-sdk/contracts/rendering';
import type { Point } from '@mog-sdk/contracts/viewport';
import {
  calculateStateFromOperation,
  type ObjectState,
  type ObjectType,
} from './operation-calculations';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Remote operation presence data.
 * This is what we receive from other users via presence broadcast.
 */
export interface RemoteOperationPresence {
  userId: string;
  operation: {
    type: 'drag' | 'resize' | 'rotate';
    objectIds: string[];
    delta: Point; // Simplified - just the position delta
  } | null;
}

/**
 * Configuration for creating the effective state service.
 */
export interface EffectiveStateServiceConfig {
  /** Object accessors for reading local operation state */
  accessors: ObjectAccessor;
  /** Floating object store for reading persisted state */
  floatingObjects: IFloatingObjectManager;
  /** Function to get object type for constraint application */
  getObjectType?: (objectId: string) => Promise<ObjectType | undefined> | ObjectType | undefined;
}

/**
 * Effective state result for an object.
 */
export interface EffectiveObjectState {
  /** Whether this state differs from persisted state */
  isEffective: boolean;
  /** Source of the effective state */
  source: 'local' | 'remote' | 'persisted';
  /** The effective bounds */
  bounds: ObjectBounds;
  /** The effective rotation (in degrees) */
  rotation: number;
  /** Pre-computed DrawingObject for unified rendering. Populated when available. */
  drawingObject?: DrawingObject;
}

/**
 * Service interface for computing effective object states.
 */
export interface EffectiveStateService {
  /**
   * Get the effective state for an object.
   * Returns the visual state accounting for local and remote operations.
   */
  getEffectiveState(objectId: string): Promise<EffectiveObjectState | null>;

  /**
   * Get effective states for all objects affected by current operations.
   * Useful for batch rendering updates.
   */
  getAffectedEffectiveStates(): Promise<Map<string, EffectiveObjectState>>;

  /**
   * Check if an object is currently being operated on (local or remote).
   */
  isObjectInOperation(objectId: string): boolean;

  /**
   * Update remote operations presence data.
   * Called when presence updates are received.
   */
  updateRemoteOperations(operations: RemoteOperationPresence[]): void;

  /**
   * Clear all remote operations (e.g., when user disconnects).
   */
  clearRemoteOperations(userId?: string): void;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

/**
 * Create the effective state service.
 */
export function createEffectiveStateService(
  config: EffectiveStateServiceConfig,
): EffectiveStateService {
  const { accessors, floatingObjects, getObjectType } = config;

  // Store remote operations (Layer 2)
  // In a real implementation, this would be updated by presence sync
  let remoteOperations: RemoteOperationPresence[] = [];

  /**
   * Get persisted state for an object (Layer 1).
   */
  async function getPersistedState(objectId: string): Promise<ObjectState | null> {
    const obj = await floatingObjects.getObject(objectId);
    if (!obj) return null;

    const bounds = await floatingObjects.computeObjectBounds(obj);
    if (!bounds) return null;

    return {
      bounds,
      rotation: obj.position.rotation ?? 0,
    };
  }

  /**
   * Apply local operation to get effective state (Layer 3).
   */
  async function getLocalEffectiveState(objectId: string): Promise<ObjectState | null> {
    // Only report local effective state if the machine is actually in the operating state.
    // After COMPLETE_OPERATION, the machine transitions to 'selected' but context.operation
    // stays populated until the async commit fires CLEAR_OPERATION. We must not return
    // stale effective state during that window.
    if (!accessors.isOperating()) {
      return null;
    }

    const operation = accessors.getOperation();
    if (!operation || !operation.objectIds.includes(objectId)) {
      return null;
    }

    try {
      const objectType = await getObjectType?.(objectId);
      // Convert the contracts FloatingObjectOperation to the local type
      // Note: The contracts type uses OperationObjectState with ObjectBounds,
      // while the local type uses ObjectState with ObjectBounds
      const localOperation = {
        type: operation.type,
        objectIds: operation.objectIds,
        startPosition: operation.startPosition,
        currentPosition: operation.currentPosition,
        originalStates: new Map(
          Array.from(operation.originalStates.entries()).map(([id, state]) => [
            id,
            { bounds: state.bounds, rotation: state.rotation },
          ]),
        ),
        resizeHandle: operation.resizeHandle,
        rotationCenter: operation.rotationCenter,
      };
      return calculateStateFromOperation(localOperation, objectId, objectType);
    } catch {
      // Object might not have original state in operation
      return null;
    }
  }

  /**
   * Apply remote operation to get effective state (Layer 2).
   */
  async function getRemoteEffectiveState(objectId: string): Promise<ObjectState | null> {
    // Find remote operation affecting this object
    const remoteOp = remoteOperations.find((r) => r.operation?.objectIds.includes(objectId));

    if (!remoteOp?.operation) return null;

    // Get base persisted state
    const persisted = await getPersistedState(objectId);
    if (!persisted) return null;

    // Apply delta to get remote effective state
    // This is a simplified version - remote operations just send deltas
    return {
      bounds: {
        ...persisted.bounds,
        x: persisted.bounds.x + remoteOp.operation.delta.x,
        y: persisted.bounds.y + remoteOp.operation.delta.y,
      },
      rotation: persisted.rotation,
    };
  }

  /**
   * Get the effective state for an object.
   * Priority: Local (Layer 3) > Remote (Layer 2) > Persisted (Layer 1)
   */
  async function getEffectiveState(objectId: string): Promise<EffectiveObjectState | null> {
    // Layer 3: Check local operation first (highest priority)
    const localState = await getLocalEffectiveState(objectId);
    if (localState) {
      return {
        isEffective: true,
        source: 'local',
        bounds: localState.bounds,
        rotation: localState.rotation,
      };
    }

    // Layer 2: Check remote operations
    const remoteState = await getRemoteEffectiveState(objectId);
    if (remoteState) {
      return {
        isEffective: true,
        source: 'remote',
        bounds: remoteState.bounds,
        rotation: remoteState.rotation,
      };
    }

    // Layer 1: Fall back to persisted state
    const persistedState = await getPersistedState(objectId);
    if (!persistedState) return null;

    return {
      isEffective: false,
      source: 'persisted',
      bounds: persistedState.bounds,
      rotation: persistedState.rotation,
    };
  }

  /**
   * Get effective states for all objects affected by current operations.
   */
  async function getAffectedEffectiveStates(): Promise<Map<string, EffectiveObjectState>> {
    const result = new Map<string, EffectiveObjectState>();

    // Collect objects from local operation
    const localOp = accessors.getOperation();
    if (localOp) {
      for (const objectId of localOp.objectIds) {
        const state = await getEffectiveState(objectId);
        if (state) {
          result.set(objectId, state);
        }
      }
    }

    // Collect objects from remote operations
    for (const remote of remoteOperations) {
      if (remote.operation) {
        for (const objectId of remote.operation.objectIds) {
          if (!result.has(objectId)) {
            // Don't override local
            const state = await getEffectiveState(objectId);
            if (state) {
              result.set(objectId, state);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Check if an object is currently being operated on.
   */
  function isObjectInOperation(objectId: string): boolean {
    // Check local — only if the machine is actually in the operating state.
    // After COMPLETE_OPERATION, context.operation stays populated for async commit,
    // but the machine has already transitioned to 'selected'. We must not report
    // objects as "in operation" during that window.
    if (accessors.isOperating()) {
      const localOp = accessors.getOperation();
      if (localOp?.objectIds.includes(objectId)) {
        return true;
      }
    }

    // Check remote
    return remoteOperations.some((r) => r.operation?.objectIds.includes(objectId));
  }

  /**
   * Update remote operations.
   */
  function updateRemoteOperations(operations: RemoteOperationPresence[]): void {
    remoteOperations = operations;
  }

  /**
   * Clear remote operations.
   */
  function clearRemoteOperations(userId?: string): void {
    if (userId) {
      remoteOperations = remoteOperations.filter((r) => r.userId !== userId);
    } else {
      remoteOperations = [];
    }
  }

  return {
    getEffectiveState,
    getAffectedEffectiveStates,
    isObjectInOperation,
    updateRemoteOperations,
    clearRemoteOperations,
  };
}
