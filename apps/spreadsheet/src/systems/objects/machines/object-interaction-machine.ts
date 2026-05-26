/**
 * Object Interaction State Machine
 *
 * Manages all floating object interactions including selection, drag,
 * resize, rotation, and text editing for pictures, text boxes, and shapes.
 *
 * Following the established architecture pattern:
 * - Machine owns state (pure transitions, no side effects)
 * - Coordinator owns execution (canvas, rendering, Yjs)
 *
 * @see ARCHITECTURE.md - State Machine pattern
 * @see contracts/src/floating-objects.ts - Type contracts
 * @see docs/renderer/README.md - Coordinator pattern
 */

import { objectSelectors } from '../../../selectors';
import type {
  CancelOperationEvent,
  ClearOperationEvent,
  CompleteOperationEvent,
  FloatingObjectOperation,
  ObjectState,
  OperationObjectState,
  OperationResizeHandle,
  StartDragEvent,
  StartResizeEvent,
  StartRotateEvent,
  UpdatePositionEvent,
} from '@mog-sdk/contracts/actors';
import type { ObjectHitRegion, ObjectInteractionState } from '@mog-sdk/contracts/floating-objects';
import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';
import type { Point } from '../../shared/types';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Context for the object interaction machine.
 * Tracks selected objects and interaction state.
 */
export interface ObjectInteractionContext {
  /** Currently selected object IDs (empty if idle) */
  selectedIds: string[];
  /** Active resize/rotation handle (if applicable) */
  activeHandle: ObjectHitRegion | null;
  /** Object being edited (for text editing state) */
  editingObjectId: string | null;
  /** Whether shift key was held (for constrained resize) */
  shiftKey: boolean;
  /** Current operation (null when not operating) - unified operation model */
  operation: FloatingObjectOperation | null;

  // Insert mode context
  /** Shape type being inserted (null when not in insert mode) */
  insertShapeType: string | null;
  /** Starting canvas position for drag-to-insert (null until pointerdown) */
  insertStartPosition: { x: number; y: number } | null;
  /** Current canvas position during drag-to-insert (null until pointermove) */
  insertCurrentPosition: { x: number; y: number } | null;
}

// =============================================================================
// EVENTS
// =============================================================================

export type ObjectInteractionEvent =
  // Selection events
  | { type: 'SELECT_OBJECT'; objectId: string; shiftKey: boolean; ctrlKey: boolean }
  | { type: 'SELECT_MULTIPLE'; objectIds: string[] }
  | { type: 'DESELECT_ALL' }
  // Keyboard events
  | { type: 'KEY_DELETE' }
  | { type: 'KEY_ESCAPE' }
  | { type: 'KEY_ARROW'; direction: 'up' | 'down' | 'left' | 'right'; shiftKey: boolean }
  | { type: 'KEY_DUPLICATE' } // Ctrl+D
  // Text editing events
  | { type: 'DOUBLE_CLICK'; objectId: string }
  | { type: 'COMMIT_TEXT'; text: string }
  | { type: 'CANCEL_TEXT' }
  // TextEffect-specific events
  | { type: 'DOUBLE_CLICK_TEXT_EFFECT'; objectId: string }
  | { type: 'STOP_TEXT_EFFECT_EDITING' }
  | { type: 'UPDATE_TEXT_EFFECT_TEXT'; text: string }
  | { type: 'START_WARP_ADJUST'; objectId: string; startY: number }
  | { type: 'UPDATE_WARP_PREVIEW'; warpAdjust: number }
  | { type: 'COMMIT_WARP_ADJUST' }
  | { type: 'CANCEL_WARP_ADJUST' }
  // Insert mode events
  | { type: 'START_INSERT'; shapeType: string }
  | { type: 'SET_INSERT_START'; position: { x: number; y: number } }
  | { type: 'UPDATE_INSERT_BOUNDS'; position: { x: number; y: number } }
  | { type: 'COMPLETE_INSERT' }
  | { type: 'CANCEL_INSERT' }
  // External events (from coordinator/Yjs)
  | { type: 'REMOTE_SELECTION_CHANGED'; selectedIds: string[] }
  | { type: 'OBJECT_DELETED'; objectId: string }
  | { type: 'RESET' }
  // Cross-Machine Communication - External selection event
  // Sent by coordinator when another selection context (cells, chart) takes focus
  | { type: 'EXTERNAL_SELECTION_ACTIVE'; context: 'cells' | 'objects' | 'chart' }
  // Unified operation events
  | StartDragEvent
  | StartResizeEvent
  | StartRotateEvent
  | UpdatePositionEvent
  | CompleteOperationEvent
  | CancelOperationEvent
  | ClearOperationEvent;

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the object interaction machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const ObjectInteractionEvents = {
  // Selection events
  selectObject: (objectId: string, shiftKey = false, ctrlKey = false): ObjectInteractionEvent => ({
    type: 'SELECT_OBJECT',
    objectId,
    shiftKey,
    ctrlKey,
  }),

  selectMultiple: (objectIds: string[]): ObjectInteractionEvent => ({
    type: 'SELECT_MULTIPLE',
    objectIds,
  }),

  deselectAll: (): ObjectInteractionEvent => ({
    type: 'DESELECT_ALL',
  }),

  // Keyboard events
  keyDelete: (): ObjectInteractionEvent => ({
    type: 'KEY_DELETE',
  }),

  keyEscape: (): ObjectInteractionEvent => ({
    type: 'KEY_ESCAPE',
  }),

  keyArrow: (
    direction: 'up' | 'down' | 'left' | 'right',
    shiftKey = false,
  ): ObjectInteractionEvent => ({
    type: 'KEY_ARROW',
    direction,
    shiftKey,
  }),

  keyDuplicate: (): ObjectInteractionEvent => ({
    type: 'KEY_DUPLICATE',
  }),

  // Text editing events
  doubleClick: (objectId: string): ObjectInteractionEvent => ({
    type: 'DOUBLE_CLICK',
    objectId,
  }),

  commitText: (text: string): ObjectInteractionEvent => ({
    type: 'COMMIT_TEXT',
    text,
  }),

  cancelText: (): ObjectInteractionEvent => ({
    type: 'CANCEL_TEXT',
  }),

  // TextEffect-specific events
  /**
   * Enter TextEffect text editing mode on double-click.
   * Transitions from selected → textEffectsEditing state.
   */
  doubleClickTextEffect: (objectId: string): ObjectInteractionEvent => ({
    type: 'DOUBLE_CLICK_TEXT_EFFECT',
    objectId,
  }),

  /**
   * Exit TextEffect text editing mode.
   * Transitions from textEffectsEditing → selected state.
   */
  stopTextEffectEditing: (): ObjectInteractionEvent => ({
    type: 'STOP_TEXT_EFFECT_EDITING',
  }),

  /**
   * Update TextEffect text during editing.
   * Stays in textEffectsEditing state, coordinator handles Yjs update.
   */
  updateTextEffectText: (text: string): ObjectInteractionEvent => ({
    type: 'UPDATE_TEXT_EFFECT_TEXT',
    text,
  }),

  /**
   * Start warp adjustment on handle drag.
   * Transitions from selected → adjustingWarp state.
   */
  startWarpAdjust: (objectId: string, startY: number): ObjectInteractionEvent => ({
    type: 'START_WARP_ADJUST',
    objectId,
    startY,
  }),

  /**
   * Update warp preview during drag.
   * Stays in adjustingWarp state, provides live preview.
   */
  updateWarpPreview: (warpAdjust: number): ObjectInteractionEvent => ({
    type: 'UPDATE_WARP_PREVIEW',
    warpAdjust,
  }),

  /**
   * Commit warp adjustment on mouse up.
   * Transitions from adjustingWarp → selected state.
   */
  commitWarpAdjust: (): ObjectInteractionEvent => ({
    type: 'COMMIT_WARP_ADJUST',
  }),

  /**
   * Cancel warp adjustment on Escape.
   * Transitions from adjustingWarp → selected state, reverts to original.
   */
  cancelWarpAdjust: (): ObjectInteractionEvent => ({
    type: 'CANCEL_WARP_ADJUST',
  }),

  // Insert mode events
  /**
   * Enter insert mode for a shape type.
   * Transitions from idle → inserting state.
   * Canvas cursor changes to crosshair; next pointerdown starts the drag rectangle.
   */
  startInsert: (shapeType: string): ObjectInteractionEvent => ({
    type: 'START_INSERT',
    shapeType,
  }),

  /**
   * Record where the user pressed down on the canvas (start corner of the insert rect).
   * Stays in inserting state.
   */
  setInsertStart: (position: { x: number; y: number }): ObjectInteractionEvent => ({
    type: 'SET_INSERT_START',
    position,
  }),

  /**
   * Update the current pointer position during drag-to-insert.
   * Stays in inserting state, coordinator renders preview rectangle.
   */
  updateInsertBounds: (position: { x: number; y: number }): ObjectInteractionEvent => ({
    type: 'UPDATE_INSERT_BOUNDS',
    position,
  }),

  /**
   * Complete the insert on pointerup.
   * Transitions from inserting → idle (coordinator dispatches INSERT_SHAPE).
   */
  completeInsert: (): ObjectInteractionEvent => ({
    type: 'COMPLETE_INSERT',
  }),

  /**
   * Cancel the insert (e.g. Escape key).
   * Transitions from inserting → idle, clears insert context.
   */
  cancelInsert: (): ObjectInteractionEvent => ({
    type: 'CANCEL_INSERT',
  }),

  // External events
  remoteSelectionChanged: (selectedIds: string[]): ObjectInteractionEvent => ({
    type: 'REMOTE_SELECTION_CHANGED',
    selectedIds,
  }),

  objectDeleted: (objectId: string): ObjectInteractionEvent => ({
    type: 'OBJECT_DELETED',
    objectId,
  }),

  reset: (): ObjectInteractionEvent => ({
    type: 'RESET',
  }),

  // Cross-Machine Communication
  /**
   * Signal that another selection context has taken focus.
   * Called by coordinator when cells or charts are selected.
   * This causes object selection to clear.
   */
  externalSelectionActive: (context: 'cells' | 'objects' | 'chart'): ObjectInteractionEvent => ({
    type: 'EXTERNAL_SELECTION_ACTIVE',
    context,
  }),

  // Unified operation events
  /**
   * Start a drag operation on one or more objects.
   * Transitions from selected/multiSelected → operating state.
   */
  startDrag: (
    objectIds: string[],
    position: Point,
    originalStates: Map<string, OperationObjectState>,
  ): ObjectInteractionEvent => ({
    type: 'START_DRAG',
    objectIds,
    position,
    originalStates,
  }),

  /**
   * Start a resize operation on one or more objects.
   * Transitions from selected → operating state.
   */
  startResize: (
    objectIds: string[],
    position: Point,
    handle: OperationResizeHandle,
    originalStates: Map<string, OperationObjectState>,
  ): ObjectInteractionEvent => ({
    type: 'START_RESIZE',
    objectIds,
    position,
    handle,
    originalStates,
  }),

  /**
   * Start a rotate operation on one or more objects.
   * Transitions from selected → operating state.
   */
  startRotate: (
    objectIds: string[],
    position: Point,
    rotationCenter: Point,
    originalStates: Map<string, OperationObjectState>,
  ): ObjectInteractionEvent => ({
    type: 'START_ROTATE',
    objectIds,
    position,
    rotationCenter,
    originalStates,
  }),

  /**
   * Update the current position during an operation.
   * Fires on mouse move while in operating state.
   */
  updatePosition: (position: Point): ObjectInteractionEvent => ({
    type: 'UPDATE_POSITION',
    position,
  }),

  /**
   * Complete the current operation.
   * Transitions from operating → selected state.
   * Operation stays in context for subscription to read before commit.
   */
  completeOperation: (): ObjectInteractionEvent => ({
    type: 'COMPLETE_OPERATION',
  }),

  /**
   * Cancel the current operation.
   * Transitions from operating → selected state and clears operation.
   * Objects return to their original positions.
   */
  cancelOperation: (): ObjectInteractionEvent => ({
    type: 'CANCEL_OPERATION',
  }),

  /**
   * Clear the operation from context after commit.
   * Called by completion subscription after persisting to Yjs.
   */
  clearOperation: (): ObjectInteractionEvent => ({
    type: 'CLEAR_OPERATION',
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: ObjectInteractionContext = {
  selectedIds: [],
  activeHandle: null,
  editingObjectId: null,
  shiftKey: false,
  operation: null,
  insertShapeType: null,
  insertStartPosition: null,
  insertCurrentPosition: null,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a handle is a resize handle (not body/border/rotation).
 */
function isResizeHandle(handle: ObjectHitRegion): boolean {
  return handle.startsWith('resize-');
}

// =============================================================================
// STATE MACHINE
// =============================================================================

export const objectInteractionMachine = setup({
  types: {
    context: {} as ObjectInteractionContext,
    events: {} as ObjectInteractionEvent,
  },
  guards: {
    isShiftClick: ({ event }) => {
      return event.type === 'SELECT_OBJECT' && event.shiftKey && !event.ctrlKey;
    },
    isCtrlClick: ({ event }) => {
      return event.type === 'SELECT_OBJECT' && event.ctrlKey && !event.shiftKey;
    },
    hasSelection: ({ context }) => {
      return context.selectedIds.length > 0;
    },
    hasMultipleSelected: ({ context }) => {
      return context.selectedIds.length > 1;
    },
    isTextEditableObject: ({ context, event }) => {
      // Coordinator will verify this is a textbox or shape with text
      // Machine just provides the signal
      if (event.type !== 'DOUBLE_CLICK') return false;
      return context.selectedIds.includes(event.objectId);
    },
  },
  actions: {
    // Selection actions
    selectSingleObject: assign(({ event }) => {
      if (event.type !== 'SELECT_OBJECT') return {};
      return {
        selectedIds: [event.objectId],
        activeHandle: null,
        editingObjectId: null,
      };
    }),

    addToSelection: assign(({ context, event }) => {
      if (event.type !== 'SELECT_OBJECT') return {};
      const newIds = context.selectedIds.includes(event.objectId)
        ? context.selectedIds.filter((id) => id !== event.objectId) // Toggle off
        : [...context.selectedIds, event.objectId]; // Add
      return {
        selectedIds: newIds,
      };
    }),

    selectMultiple: assign(({ event }) => {
      if (event.type !== 'SELECT_MULTIPLE') return {};
      return {
        selectedIds: event.objectIds,
        activeHandle: null,
        editingObjectId: null,
      };
    }),

    clearSelection: assign(() => ({
      selectedIds: [],
      activeHandle: null,
      editingObjectId: null,
      operation: null,
    })),

    /**
     * Clear selection state only, preserving operation context.
     * Used when external selection changes but operation may still be committing.
     * Operation is cleared only by CLEAR_OPERATION after commit completes.
     */
    clearSelectionOnly: assign(() => ({
      selectedIds: [],
      activeHandle: null,
      editingObjectId: null,
      // NOTE: operation intentionally NOT cleared here
      // Operation is cleared only by CLEAR_OPERATION after commit
    })),

    // Text editing actions
    enterTextEditing: assign(({ event }) => {
      if (event.type !== 'DOUBLE_CLICK') return {};
      return {
        editingObjectId: event.objectId,
      };
    }),

    exitTextEditing: assign(() => ({
      editingObjectId: null,
    })),

    // TextEffect editing actions
    enterTextEffectEditing: assign(({ event }) => {
      if (event.type !== 'DOUBLE_CLICK_TEXT_EFFECT') return {};
      return {
        editingObjectId: event.objectId,
      };
    }),

    exitTextEffectEditing: assign(() => ({
      editingObjectId: null,
    })),

    // Handle deleted object
    removeDeletedObject: assign(({ context, event }) => {
      if (event.type !== 'OBJECT_DELETED') return {};
      return {
        selectedIds: context.selectedIds.filter((id) => id !== event.objectId),
        editingObjectId:
          context.editingObjectId === event.objectId ? null : context.editingObjectId,
      };
    }),

    // Handle remote selection (for collaboration)
    handleRemoteSelection: assign(({ event }) => {
      if (event.type !== 'REMOTE_SELECTION_CHANGED') return {};
      // Remote selections are shown but don't affect local selection
      // The coordinator handles rendering remote selections
      return {};
    }),

    // Insert mode actions
    clearInsertContext: assign(() => ({
      insertShapeType: null,
      insertStartPosition: null,
      insertCurrentPosition: null,
    })),

    // Reset
    resetState: assign(() => initialContext),
  },
}).createMachine({
  id: 'objectInteraction',
  initial: 'idle',
  context: initialContext,
  states: {
    // =========================================================================
    // IDLE - No object selected, clicks go to cells
    // =========================================================================
    idle: {
      on: {
        SELECT_OBJECT: [
          {
            guard: 'isCtrlClick',
            target: 'selected',
            actions: 'addToSelection',
          },
          {
            target: 'selected',
            actions: 'selectSingleObject',
          },
        ],
        SELECT_MULTIPLE: {
          target: 'multiSelected',
          actions: 'selectMultiple',
        },
        REMOTE_SELECTION_CHANGED: {
          actions: 'handleRemoteSelection',
        },
        RESET: {
          actions: 'resetState',
        },
        // Clear operation after async commit completes (may arrive while idle)
        CLEAR_OPERATION: {
          actions: assign({ operation: null }),
        },
        // Insert mode: transition to inserting state when toolbar triggers shape insert
        START_INSERT: {
          target: 'inserting',
          actions: assign({
            insertShapeType: ({ event }) =>
              event.type === 'START_INSERT' ? event.shapeType : null,
            insertStartPosition: null,
            insertCurrentPosition: null,
          }),
        },
      },
    },

    // =========================================================================
    // SELECTED - Single object selected, showing handles
    // =========================================================================
    selected: {
      on: {
        // Selection changes
        SELECT_OBJECT: [
          {
            guard: 'isCtrlClick',
            target: 'multiSelected',
            actions: 'addToSelection',
          },
          {
            target: 'selected',
            actions: 'selectSingleObject',
          },
        ],
        DESELECT_ALL: {
          target: 'idle',
          actions: 'clearSelection',
        },

        // Double-click for text editing
        DOUBLE_CLICK: {
          guard: 'isTextEditableObject',
          target: 'editingText',
          actions: 'enterTextEditing',
        },

        // TextEffect-specific transitions
        // Note: Coordinator determines if selected object is TextEffect and sends appropriate event
        DOUBLE_CLICK_TEXT_EFFECT: {
          target: 'textEffectsEditing',
          actions: 'enterTextEffectEditing',
        },
        START_WARP_ADJUST: {
          target: 'adjustingWarp',
          // Coordinator captures initial warp adjust value and startY
        },

        // Keyboard
        KEY_DELETE: {
          target: 'idle',
          actions: 'clearSelection',
          // Coordinator handles actual deletion via Yjs
        },
        KEY_ESCAPE: {
          target: 'idle',
          actions: 'clearSelection',
        },
        KEY_ARROW: {
          // Nudge object - coordinator handles movement
          // Stay in selected state
        },
        KEY_DUPLICATE: {
          // Coordinator handles duplication
          // Stay in selected state
        },

        // External events
        OBJECT_DELETED: {
          target: 'idle',
          actions: 'removeDeletedObject',
        },
        REMOTE_SELECTION_CHANGED: {
          actions: 'handleRemoteSelection',
        },
        RESET: {
          target: 'idle',
          actions: 'resetState',
        },
        // Cross-Machine Communication
        // When another selection context (cells, chart) takes focus, deselect objects
        // Use clearSelectionOnly to preserve pending operation during async commit
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: 'clearSelectionOnly',
        },

        // Clear operation after async commit completes
        CLEAR_OPERATION: {
          actions: assign({ operation: null }),
        },

        // Unified operation start events
        START_DRAG: {
          target: 'operating',
          actions: assign({
            operation: ({ event }) => {
              const e = event as StartDragEvent;
              return {
                type: 'drag' as const,
                objectIds: e.objectIds,
                startPosition: e.position,
                currentPosition: e.position,
                originalStates: e.originalStates,
              };
            },
          }),
        },
        START_RESIZE: {
          target: 'operating',
          actions: assign({
            operation: ({ event }) => {
              const e = event as StartResizeEvent;
              return {
                type: 'resize' as const,
                objectIds: e.objectIds,
                startPosition: e.position,
                currentPosition: e.position,
                originalStates: e.originalStates,
                resizeHandle: e.handle,
              };
            },
          }),
        },
        START_ROTATE: {
          target: 'operating',
          actions: assign({
            operation: ({ event }) => {
              const e = event as StartRotateEvent;
              return {
                type: 'rotate' as const,
                objectIds: e.objectIds,
                startPosition: e.position,
                currentPosition: e.position,
                originalStates: e.originalStates,
                rotationCenter: e.rotationCenter,
              };
            },
          }),
        },
      },
    },

    // =========================================================================
    // MULTI-SELECTED - Multiple objects selected
    // =========================================================================
    multiSelected: {
      on: {
        // Selection changes
        SELECT_OBJECT: [
          {
            guard: 'isCtrlClick',
            actions: 'addToSelection',
            // Check if we should transition back to selected or stay in multiSelected
          },
          {
            target: 'selected',
            actions: 'selectSingleObject',
          },
        ],
        DESELECT_ALL: {
          target: 'idle',
          actions: 'clearSelection',
        },

        // Keyboard
        KEY_DELETE: {
          target: 'idle',
          actions: 'clearSelection',
        },
        KEY_ESCAPE: {
          target: 'idle',
          actions: 'clearSelection',
        },
        KEY_ARROW: {
          // Nudge all selected objects
        },

        // External events
        OBJECT_DELETED: [
          {
            guard: ({ context, event }) =>
              event.type === 'OBJECT_DELETED' &&
              context.selectedIds.filter((id) => id !== event.objectId).length === 1,
            target: 'selected',
            actions: 'removeDeletedObject',
          },
          {
            guard: ({ context, event }) =>
              event.type === 'OBJECT_DELETED' &&
              context.selectedIds.filter((id) => id !== event.objectId).length === 0,
            target: 'idle',
            actions: 'removeDeletedObject',
          },
          {
            actions: 'removeDeletedObject',
          },
        ],
        REMOTE_SELECTION_CHANGED: {
          actions: 'handleRemoteSelection',
        },
        RESET: {
          target: 'idle',
          actions: 'resetState',
        },
        // Cross-Machine Communication
        // When another selection context (cells, chart) takes focus, deselect objects
        // Use clearSelectionOnly to preserve pending operation during async commit
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: 'clearSelectionOnly',
        },

        // Clear operation after async commit completes
        CLEAR_OPERATION: {
          actions: assign({ operation: null }),
        },

        // Unified operation start event (multi-object drag)
        START_DRAG: {
          target: 'operating',
          actions: assign({
            operation: ({ event }) => {
              const e = event as StartDragEvent;
              return {
                type: 'drag' as const,
                objectIds: e.objectIds,
                startPosition: e.position,
                currentPosition: e.position,
                originalStates: e.originalStates,
              };
            },
          }),
        },
      },
    },

    // =========================================================================
    // OPERATING - Unified operation state for drag/resize/rotate
    // Operation type is DATA in context, not STATE
    // =========================================================================
    operating: {
      on: {
        UPDATE_POSITION: {
          actions: assign({
            operation: ({ context, event }) => {
              if (!context.operation) return null;
              return {
                ...context.operation,
                currentPosition: (event as UpdatePositionEvent).position,
              };
            },
          }),
        },
        COMPLETE_OPERATION: {
          target: 'selected',
          // Operation stays in context for subscription to read before commit
        },
        CANCEL_OPERATION: {
          target: 'selected',
          actions: assign({ operation: null }),
        },
        CLEAR_OPERATION: {
          actions: assign({ operation: null }),
        },
        KEY_ESCAPE: {
          target: 'selected',
          actions: assign({ operation: null }),
        },
        OBJECT_DELETED: {
          target: 'idle',
          actions: ['clearSelection', assign({ operation: null })],
        },
        // Protected state - ignore external selection to let operation complete
        EXTERNAL_SELECTION_ACTIVE: {},
      },
    },

    // =========================================================================
    // EDITING TEXT - Editing text inside textbox or shape
    // =========================================================================
    editingText: {
      on: {
        COMMIT_TEXT: {
          target: 'selected',
          actions: 'exitTextEditing',
          // Coordinator handles saving text to Yjs
        },
        CANCEL_TEXT: {
          target: 'selected',
          actions: 'exitTextEditing',
        },
        KEY_ESCAPE: {
          target: 'selected',
          actions: 'exitTextEditing',
        },
        // Clicking outside (on another object or cell)
        SELECT_OBJECT: {
          target: 'selected',
          actions: ['exitTextEditing', 'selectSingleObject'],
        },
        DESELECT_ALL: {
          target: 'idle',
          actions: ['exitTextEditing', 'clearSelection'],
        },
        OBJECT_DELETED: {
          target: 'idle',
          actions: ['exitTextEditing', 'removeDeletedObject'],
        },
        RESET: {
          target: 'idle',
          actions: ['exitTextEditing', 'resetState'],
        },
        // Cross-Machine Communication
        // When another selection context takes focus, exit text editing and deselect
        // Use clearSelectionOnly to preserve pending operation during async commit
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: ['exitTextEditing', 'clearSelectionOnly'],
        },
      },
    },

    // =========================================================================
    // TEXT_EFFECT EDITING - Editing TextEffect text inline
    // =========================================================================
    textEffectsEditing: {
      on: {
        // Text updates during editing (coordinator handles Yjs sync)
        UPDATE_TEXT_EFFECT_TEXT: {
          // Stay in editing state, coordinator handles the actual text update
        },
        // Exit editing
        STOP_TEXT_EFFECT_EDITING: {
          target: 'selected',
          actions: 'exitTextEffectEditing',
        },
        KEY_ESCAPE: {
          target: 'selected',
          actions: 'exitTextEffectEditing',
        },
        // Clicking outside (on another object or cell)
        SELECT_OBJECT: {
          target: 'selected',
          actions: ['exitTextEffectEditing', 'selectSingleObject'],
        },
        DESELECT_ALL: {
          target: 'idle',
          actions: ['exitTextEffectEditing', 'clearSelection'],
        },
        OBJECT_DELETED: {
          target: 'idle',
          actions: ['exitTextEffectEditing', 'removeDeletedObject'],
        },
        RESET: {
          target: 'idle',
          actions: ['exitTextEffectEditing', 'resetState'],
        },
        // Cross-Machine Communication
        // When another selection context takes focus, exit editing and deselect
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: ['exitTextEffectEditing', 'clearSelectionOnly'],
        },
      },
    },

    // =========================================================================
    // INSERTING - Drag-to-insert a new shape on the canvas
    // =========================================================================
    inserting: {
      on: {
        // Record where the user pressed down on the canvas
        SET_INSERT_START: {
          actions: assign({
            insertStartPosition: ({ event }) =>
              event.type === 'SET_INSERT_START' ? event.position : null,
          }),
        },
        // Live bounds update during drag
        UPDATE_INSERT_BOUNDS: {
          actions: assign({
            insertCurrentPosition: ({ event }) =>
              event.type === 'UPDATE_INSERT_BOUNDS' ? event.position : null,
          }),
        },
        // Complete on pointerup - coordinator reads context and dispatches INSERT_SHAPE
        COMPLETE_INSERT: {
          target: 'idle',
          actions: 'clearInsertContext',
        },
        // Cancel on Escape
        CANCEL_INSERT: {
          target: 'idle',
          actions: 'clearInsertContext',
        },
        KEY_ESCAPE: {
          target: 'idle',
          actions: 'clearInsertContext',
        },
        // Handle object deletion during insert (unlikely but safe)
        OBJECT_DELETED: {
          target: 'idle',
          actions: ['clearInsertContext', 'clearSelection'],
        },
        // Protected state - ignore external selection during insert
        EXTERNAL_SELECTION_ACTIVE: {},
        RESET: {
          target: 'idle',
          actions: 'resetState',
        },
      },
    },

    // =========================================================================
    // ADJUSTING WARP - Dragging warp adjust handle
    // =========================================================================
    adjustingWarp: {
      on: {
        // Live preview update during drag
        UPDATE_WARP_PREVIEW: {
          // Stay in adjusting state, coordinator renders preview
          // The warpAdjust value is passed to coordinator via event
        },
        // Commit on mouse up
        COMMIT_WARP_ADJUST: {
          target: 'selected',
          // Coordinator reads final warpAdjust and commits to Yjs
        },
        // Cancel on Escape
        CANCEL_WARP_ADJUST: {
          target: 'selected',
          // Coordinator reverts to original warpAdjust value
        },
        KEY_ESCAPE: {
          target: 'selected',
          // Same as CANCEL_WARP_ADJUST
        },
        // Handle object deletion during adjustment
        OBJECT_DELETED: {
          target: 'idle',
          actions: 'clearSelection',
        },
        // Protected state - ignore external selection during adjustment
        EXTERNAL_SELECTION_ACTIVE: {},
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ObjectInteractionMachine = typeof objectInteractionMachine;
export type ObjectInteractionActor = ActorRefFrom<ObjectInteractionMachine>;
export type ObjectInteractionStateValue = ReturnType<ObjectInteractionActor['getSnapshot']>;
export type ObjectInteractionState_ = SnapshotFrom<typeof objectInteractionMachine>;

// =============================================================================
// HELPER TO EXTRACT SNAPSHOT
// =============================================================================

/**
 * Extract a snapshot from the machine state.
 * Used by the coordinator and hooks.
 *
 * ARCHITECTURE: This function composes selectors (the single primitive).
 * All extraction logic is defined once in objectSelectors.
 */
export function getObjectInteractionSnapshot(state: ObjectInteractionStateValue): {
  /** Current interaction state */
  interactionState: ObjectInteractionState;
  /** Currently selected object IDs */
  selectedIds: string[];
  /** Object being text-edited (if any) */
  editingObjectId: string | null;
  /** Whether editing text */
  isEditingText: boolean;
  /** Whether in unified operating state */
  isOperating: boolean;
  /** Whether in insert mode */
  isInserting: boolean;
  /** Active resize/rotation handle */
  activeHandle: ObjectHitRegion | null;
  /** Whether shift key is held (for constrained operations) */
  shiftKey: boolean;
  /** Current unified operation */
  operation: FloatingObjectOperation | null;
  /** Shape type being inserted (null when not in insert mode) */
  insertShapeType: string | null;
  /** Start position for drag-to-insert */
  insertStartPosition: { x: number; y: number } | null;
  /** Current position for drag-to-insert */
  insertCurrentPosition: { x: number; y: number } | null;
} {
  // Cast state to compatible type for selectors
  const s = state as ObjectState;

  return {
    // Derived state selectors
    interactionState: objectSelectors.interactionState(s),

    // Value selectors
    selectedIds: objectSelectors.selectedIds(s),
    editingObjectId: objectSelectors.editingObjectId(s),
    activeHandle: objectSelectors.activeHandle(s),
    shiftKey: objectSelectors.shiftKey(s),
    operation: objectSelectors.operation(s),

    // State matching selectors
    isEditingText: objectSelectors.isEditingText(s),
    isOperating: objectSelectors.isInteractingUnified(s),
    isInserting: objectSelectors.isInserting(s),

    // Insert mode context
    insertShapeType: objectSelectors.insertShapeType(s),
    insertStartPosition: objectSelectors.insertStartPosition(s),
    insertCurrentPosition: objectSelectors.insertCurrentPosition(s),
  };
}

/**
 * Get the cursor style for the current interaction state.
 * Used by the coordinator to set canvas cursor.
 */
export function getCursorForState(
  state: ObjectInteractionStateValue,
  hoveredHandle: ObjectHitRegion | null,
): string {
  const snapshot = getObjectInteractionSnapshot(state);

  // If in insert mode, show crosshair cursor
  if (snapshot.isInserting) {
    return 'crosshair';
  }

  // If currently in an operation, show appropriate cursor based on operation type
  if (snapshot.isOperating && snapshot.operation) {
    switch (snapshot.operation.type) {
      case 'drag':
        return 'grabbing';
      case 'rotate':
        return 'crosshair';
      case 'resize':
        if (snapshot.operation.resizeHandle) {
          return getResizeCursor(`resize-${snapshot.operation.resizeHandle}` as ObjectHitRegion);
        }
        return 'default';
    }
  }

  // If hovering over a handle, show handle cursor
  if (hoveredHandle) {
    if (hoveredHandle === 'rotation') return 'crosshair';
    if (hoveredHandle === 'body' || hoveredHandle === 'border') return 'grab';
    if (isResizeHandle(hoveredHandle)) return getResizeCursor(hoveredHandle);
  }

  // Default
  return 'default';
}

/**
 * Get the appropriate resize cursor for a handle.
 */
function getResizeCursor(handle: ObjectHitRegion): string {
  switch (handle) {
    case 'resize-n':
    case 'resize-s':
      return 'ns-resize';
    case 'resize-e':
    case 'resize-w':
      return 'ew-resize';
    case 'resize-ne':
    case 'resize-sw':
      return 'nesw-resize';
    case 'resize-nw':
    case 'resize-se':
      return 'nwse-resize';
    default:
      return 'default';
  }
}
