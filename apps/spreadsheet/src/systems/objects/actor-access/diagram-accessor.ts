/**
 * Diagram Actor Access Implementation
 *
 * Implements DiagramAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/diagram
 */

import { diagramSelectors } from '../../../selectors';
import type { DiagramAccessor, DiagramState } from '@mog-sdk/contracts/actors';

/**
 * Minimal actor interface for Diagram accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type DiagramActor = { getSnapshot(): DiagramState };

/**
 * Creates a DiagramAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState Diagram actor
 * @returns DiagramAccessor interface for handlers
 */
export function createDiagramAccessor(actor: DiagramActor): DiagramAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getSelectedObjectId: () => diagramSelectors.selectedObjectId(snap()),
    getSelectedNodeIds: () => diagramSelectors.selectedNodeIds(snap()),
    getEditingNodeId: () => diagramSelectors.editingNodeId(snap()),

    // ===========================================================================
    // Derived Value Accessors
    // ===========================================================================

    getSelectedNodeId: () => diagramSelectors.selectedNodeId(snap()),
    getSelectedCount: () => diagramSelectors.selectedCount(snap()),
    hasSelection: () => diagramSelectors.hasSelection(snap()),
    hasMultipleSelected: () => diagramSelectors.hasMultipleSelected(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isIdle: () => diagramSelectors.isIdle(snap()),
    isNodeSelected: () => diagramSelectors.isNodeSelected(snap()),
    isEditing: () => diagramSelectors.isEditing(snap()),

    // ===========================================================================
    // Compound State Checks
    // ===========================================================================

    isInAnySelectedState: () => diagramSelectors.isInAnySelectedState(snap()),

    // ===========================================================================
    // Derived State
    // ===========================================================================

    getUIState: () => diagramSelectors.uiState(snap()),
  };
}
