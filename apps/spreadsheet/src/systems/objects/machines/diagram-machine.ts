/**
 * Diagram State Machine
 *
 * Manages Diagram node selection and editing interactions.
 * Handles single selection, multi-selection (Ctrl/Cmd+click),
 * and in-place text editing states.
 *
 * Key design principles:
 * 1. Machine is PURE - no DOM access (coordinator handles all DOM operations)
 * 2. Context is single source of truth - state is derived from context
 * 3. Supports multi-select via MULTI_SELECT_NODE event
 *
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';
import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Diagram machine context.
 */
export interface DiagramContext {
  /** ID of the Diagram object containing the selected nodes */
  selectedObjectId: string | null;

  /** IDs of currently selected nodes (supports multi-select) */
  selectedNodeIds: NodeId[];

  /** ID of the node currently being edited (in-place text edit) */
  editingNodeId: NodeId | null;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the Diagram machine.
 */
export type DiagramEvent =
  | { type: 'SELECT_NODE'; objectId: string; nodeId: NodeId }
  | { type: 'MULTI_SELECT_NODE'; objectId: string; nodeId: NodeId }
  | { type: 'START_EDIT'; nodeId: NodeId }
  | { type: 'COMMIT_EDIT'; text: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'DESELECT' }
  | { type: 'EXTERNAL_SELECTION_ACTIVE' };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the Diagram machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const DiagramEvents = {
  /**
   * Select a single node (replaces existing selection).
   */
  selectNode: (objectId: string, nodeId: NodeId): DiagramEvent => ({
    type: 'SELECT_NODE',
    objectId,
    nodeId,
  }),

  /**
   * Add or remove a node from selection (Ctrl/Cmd+click).
   * If already selected, toggles it off. Otherwise adds to selection.
   */
  multiSelectNode: (objectId: string, nodeId: NodeId): DiagramEvent => ({
    type: 'MULTI_SELECT_NODE',
    objectId,
    nodeId,
  }),

  /**
   * Start in-place text editing for a node.
   */
  startEdit: (nodeId: NodeId): DiagramEvent => ({
    type: 'START_EDIT',
    nodeId,
  }),

  /**
   * Commit text changes and exit editing mode.
   */
  commitEdit: (text: string): DiagramEvent => ({
    type: 'COMMIT_EDIT',
    text,
  }),

  /**
   * Cancel editing and discard changes.
   */
  cancelEdit: (): DiagramEvent => ({
    type: 'CANCEL_EDIT',
  }),

  /**
   * Deselect all nodes.
   */
  deselect: (): DiagramEvent => ({
    type: 'DESELECT',
  }),

  /**
   * External selection (cell, chart, etc.) is active.
   * Clears Diagram selection to avoid multiple active selections.
   */
  externalSelectionActive: (): DiagramEvent => ({
    type: 'EXTERNAL_SELECTION_ACTIVE',
  }),
} as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

export const initialDiagramContext: DiagramContext = {
  selectedObjectId: null,
  selectedNodeIds: [],
  editingNodeId: null,
};

// =============================================================================
// DIAGRAM MACHINE
// =============================================================================

export const diagramMachine = setup({
  types: {
    context: {} as DiagramContext,
    events: {} as DiagramEvent,
  },
  actions: {
    /**
     * Select a single node, replacing any existing selection.
     */
    selectNode: assign({
      selectedObjectId: ({ event }) => {
        if (event.type === 'SELECT_NODE') return event.objectId;
        return null;
      },
      selectedNodeIds: ({ event }) => {
        if (event.type === 'SELECT_NODE') return [event.nodeId];
        return [];
      },
    }),

    /**
     * Toggle a node in/out of multi-selection.
     * If the node is already selected, remove it.
     * Otherwise, add it to the selection.
     */
    multiSelectNode: assign({
      selectedObjectId: ({ context, event }) => {
        if (event.type === 'MULTI_SELECT_NODE') {
          // Keep existing objectId or use the new one
          return context.selectedObjectId ?? event.objectId;
        }
        return context.selectedObjectId;
      },
      selectedNodeIds: ({ context, event }) => {
        if (event.type === 'MULTI_SELECT_NODE') {
          const nodeId = event.nodeId;
          if (context.selectedNodeIds.includes(nodeId)) {
            // Toggle off if already selected
            return context.selectedNodeIds.filter((id) => id !== nodeId);
          }
          // Add to selection
          return [...context.selectedNodeIds, nodeId];
        }
        return context.selectedNodeIds;
      },
    }),

    /**
     * Start editing a node (transition to editing state).
     */
    startEdit: assign({
      editingNodeId: ({ event }) => {
        if (event.type === 'START_EDIT') return event.nodeId;
        return null;
      },
    }),

    /**
     * End editing mode (on commit or cancel).
     */
    endEdit: assign({
      editingNodeId: () => null,
    }),

    /**
     * Clear all selection state.
     */
    clearSelection: assign({
      selectedObjectId: () => null,
      selectedNodeIds: () => [],
      editingNodeId: () => null,
    }),
  },
}).createMachine({
  id: 'diagram',
  initial: 'idle',
  context: initialDiagramContext,

  states: {
    /**
     * IDLE: No node selected.
     * Waiting for user interaction.
     */
    idle: {
      on: {
        SELECT_NODE: {
          target: 'nodeSelected',
          actions: 'selectNode',
        },
      },
    },

    /**
     * NODE_SELECTED: One or more nodes are selected.
     * Can transition to editing on double-click or Enter.
     */
    nodeSelected: {
      on: {
        SELECT_NODE: {
          // Replace selection with new node
          actions: 'selectNode',
        },
        MULTI_SELECT_NODE: {
          // Add to selection (Ctrl/Cmd+click)
          actions: 'multiSelectNode',
        },
        START_EDIT: {
          target: 'editing',
          actions: 'startEdit',
        },
        DESELECT: {
          target: 'idle',
          actions: 'clearSelection',
        },
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: 'clearSelection',
        },
      },
    },

    /**
     * EDITING: In-place text editing for a node.
     * Commit with Enter, cancel with Escape.
     */
    editing: {
      on: {
        COMMIT_EDIT: {
          target: 'nodeSelected',
          actions: 'endEdit',
        },
        CANCEL_EDIT: {
          target: 'nodeSelected',
          actions: 'endEdit',
        },
        EXTERNAL_SELECTION_ACTIVE: {
          target: 'idle',
          actions: 'clearSelection',
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

/**
 * Diagram snapshot for coordinator/component use.
 */
export interface DiagramSnapshot {
  /** Current machine state value */
  state: 'idle' | 'nodeSelected' | 'editing';

  /** ID of the Diagram object with selection */
  selectedObjectId: string | null;

  /** IDs of selected nodes */
  selectedNodeIds: NodeId[];

  /** ID of node being edited */
  editingNodeId: NodeId | null;

  /** Whether any node is selected */
  hasSelection: boolean;

  /** Whether in editing mode */
  isEditing: boolean;

  /** Whether multiple nodes are selected */
  isMultiSelect: boolean;
}

/**
 * Get a normalized snapshot from the Diagram machine state.
 */
export function getDiagramSnapshot(snapshot: SnapshotFrom<typeof diagramMachine>): DiagramSnapshot {
  const { context } = snapshot;
  const stateValue = snapshot.value as 'idle' | 'nodeSelected' | 'editing';

  return {
    state: stateValue,
    selectedObjectId: context.selectedObjectId,
    selectedNodeIds: context.selectedNodeIds,
    editingNodeId: context.editingNodeId,
    hasSelection: context.selectedNodeIds.length > 0,
    isEditing: context.editingNodeId !== null,
    isMultiSelect: context.selectedNodeIds.length > 1,
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type DiagramMachine = typeof diagramMachine;
export type DiagramActor = ActorRefFrom<typeof diagramMachine>;
export type DiagramState = SnapshotFrom<typeof diagramMachine>;
