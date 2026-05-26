/**
 * Diagram Actor Selectors
 *
 * Pure functions that extract data from Diagram state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { DiagramState, DiagramUIState } from '@mog-sdk/contracts/actors/diagram';

export const diagramSelectors = {
  // Value selectors
  selectedObjectId: (state: DiagramState) => state.context.selectedObjectId,
  selectedNodeIds: (state: DiagramState) => state.context.selectedNodeIds,
  editingNodeId: (state: DiagramState) => state.context.editingNodeId,

  // Derived value selectors
  selectedNodeId: (state: DiagramState) => {
    const ids = state.context.selectedNodeIds;
    if (ids.length === 0) return null;
    return ids[0];
  },
  selectedCount: (state: DiagramState): number => state.context.selectedNodeIds.length,
  hasSelection: (state: DiagramState): boolean => state.context.selectedNodeIds.length > 0,
  hasMultipleSelected: (state: DiagramState): boolean => state.context.selectedNodeIds.length > 1,

  // State matching selectors
  isIdle: (state: DiagramState): boolean => state.matches('idle'),
  isNodeSelected: (state: DiagramState): boolean => state.matches('nodeSelected'),
  isEditing: (state: DiagramState): boolean => state.matches('editing'),

  // Compound state checks
  isInAnySelectedState: (state: DiagramState): boolean =>
    state.matches('nodeSelected') || state.matches('editing'),

  /**
   * Derive the Diagram UI state from the machine state.
   */
  uiState: (state: DiagramState): DiagramUIState => {
    if (state.matches('editing')) return 'editing';
    if (state.matches('nodeSelected')) return 'nodeSelected';
    return 'idle';
  },
};
