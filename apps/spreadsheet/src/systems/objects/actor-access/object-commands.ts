/**
 * Object Command Factory
 *
 * Type-safe wrappers around actor.send() for object interaction state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/objects/actor-access/object-commands
 */

import type {
  ObjectCommands,
  OperationObjectState,
  OperationResizeHandle,
} from '@mog-sdk/contracts/actors';
import type { Point } from '@mog-sdk/contracts/viewport';

// =============================================================================
// TYPES
// =============================================================================

/** Minimal actor interface for sending events */
interface MinimalActor {
  send(event: any): void;
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create object interaction commands from an object actor.
 * Wraps actor.send() with type-safe methods for object events.
 *
 * @param actor - The object interaction state machine actor
 * @returns ObjectCommands interface implementation
 *
 * @see state-machines/src/object-interaction-machine.ts for event definitions
 */
export function createObjectCommands(actor: MinimalActor): ObjectCommands {
  return {
    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------
    selectObject: (objectId: string, shiftKey: boolean, ctrlKey: boolean) =>
      actor.send({ type: 'SELECT_OBJECT', objectId, shiftKey, ctrlKey }),

    selectMultiple: (objectIds: string[]) => actor.send({ type: 'SELECT_MULTIPLE', objectIds }),

    deselectAll: () => actor.send({ type: 'DESELECT_ALL' }),

    // -------------------------------------------------------------------------
    // Keyboard Events
    // -------------------------------------------------------------------------
    keyDelete: () => actor.send({ type: 'KEY_DELETE' }),

    keyEscape: () => actor.send({ type: 'KEY_ESCAPE' }),

    keyArrow: (direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean) =>
      actor.send({ type: 'KEY_ARROW', direction, shiftKey }),

    keyDuplicate: () => actor.send({ type: 'KEY_DUPLICATE' }),

    // -------------------------------------------------------------------------
    // Text Editing
    // -------------------------------------------------------------------------
    doubleClick: (objectId: string) => actor.send({ type: 'DOUBLE_CLICK', objectId }),

    // TextEffect text editing
    doubleClickTextEffect: (objectId: string) =>
      actor.send({ type: 'DOUBLE_CLICK_TEXT_EFFECT', objectId }),

    stopTextEffectEditing: () => actor.send({ type: 'STOP_TEXT_EFFECT_EDITING' }),

    commitText: (text: string) => actor.send({ type: 'COMMIT_TEXT', text }),

    cancelText: () => actor.send({ type: 'CANCEL_TEXT' }),

    // -------------------------------------------------------------------------
    // External Events
    // -------------------------------------------------------------------------
    remoteSelectionChanged: (selectedIds: string[]) =>
      actor.send({ type: 'REMOTE_SELECTION_CHANGED', selectedIds }),

    objectDeleted: (objectId: string) => actor.send({ type: 'OBJECT_DELETED', objectId }),

    reset: () => actor.send({ type: 'RESET' }),

    externalSelectionActive: (context: 'cells' | 'objects' | 'chart') =>
      actor.send({ type: 'EXTERNAL_SELECTION_ACTIVE', context }),

    // -------------------------------------------------------------------------
    // Unified Operation Commands
    // -------------------------------------------------------------------------

    startDrag: (
      objectIds: string[],
      position: Point,
      originalStates: Map<string, OperationObjectState>,
    ) =>
      actor.send({
        type: 'START_DRAG',
        objectIds,
        position,
        originalStates,
      }),

    startResize: (
      objectIds: string[],
      position: Point,
      handle: OperationResizeHandle,
      originalStates: Map<string, OperationObjectState>,
    ) =>
      actor.send({
        type: 'START_RESIZE',
        objectIds,
        position,
        handle,
        originalStates,
      }),

    startRotate: (
      objectIds: string[],
      position: Point,
      rotationCenter: Point,
      originalStates: Map<string, OperationObjectState>,
    ) =>
      actor.send({
        type: 'START_ROTATE',
        objectIds,
        position,
        rotationCenter,
        originalStates,
      }),

    updatePosition: (position: Point) => actor.send({ type: 'UPDATE_POSITION', position }),

    completeOperation: () => actor.send({ type: 'COMPLETE_OPERATION' }),

    cancelOperation: () => actor.send({ type: 'CANCEL_OPERATION' }),

    clearOperation: () => actor.send({ type: 'CLEAR_OPERATION' }),

    // -------------------------------------------------------------------------
    // Insert Mode
    // -------------------------------------------------------------------------

    startInsert: (shapeType: string) => {
      actor.send({ type: 'START_INSERT', shapeType });
    },

    setInsertStart: (position: { x: number; y: number }) =>
      actor.send({ type: 'SET_INSERT_START', position }),

    updateInsertBounds: (position: { x: number; y: number }) =>
      actor.send({ type: 'UPDATE_INSERT_BOUNDS', position }),

    completeInsert: () => actor.send({ type: 'COMPLETE_INSERT' }),

    cancelInsert: () => actor.send({ type: 'CANCEL_INSERT' }),
  };
}
