/**
 * Diagram Command Factory
 *
 * Type-safe wrappers around actor.send() for Diagram state machine events.
 *
 * Extracted from coordinator/actor-access/commands.ts
 *
 * @module systems/objects/actor-access/diagram-commands
 */

import type { DiagramCommands, DiagramNodeId } from '@mog-sdk/contracts/actors';

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
 * Create Diagram commands from a Diagram actor.
 * Wraps actor.send() with type-safe methods for Diagram events.
 *
 * Architecture Note:
 * - Selection state (selectedObjectId, selectedNodeIds, editingNodeId) lives in XState
 * - UI state (dialogOpen, textPaneVisible, gallery states) lives in UIStore
 * - This follows the same pattern as createChartCommands
 *
 * @param actor - The Diagram state machine actor
 * @returns DiagramCommands interface implementation
 *
 * @see state-machines/src/diagram-machine.ts for event definitions
 */
export function createDiagramCommands(actor: MinimalActor): DiagramCommands {
  return {
    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------
    selectNode: (objectId: string, nodeId: DiagramNodeId) =>
      actor.send({ type: 'SELECT_NODE', objectId, nodeId }),

    multiSelectNode: (objectId: string, nodeId: DiagramNodeId) =>
      actor.send({ type: 'MULTI_SELECT_NODE', objectId, nodeId }),

    deselect: () => actor.send({ type: 'DESELECT' }),

    externalSelectionActive: () => actor.send({ type: 'EXTERNAL_SELECTION_ACTIVE' }),

    // -------------------------------------------------------------------------
    // Editing
    // -------------------------------------------------------------------------
    startEdit: (nodeId: DiagramNodeId) => actor.send({ type: 'START_EDIT', nodeId }),

    commitEdit: (text: string) => actor.send({ type: 'COMMIT_EDIT', text }),

    cancelEdit: () => actor.send({ type: 'CANCEL_EDIT' }),
  };
}
