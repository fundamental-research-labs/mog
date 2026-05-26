/**
 * Diagram UI State Hook
 *
 * React hook that wraps the Diagram state machine actor.
 * Provides type-safe access to Diagram UI state and actions.
 *
 * This follows the same pattern as useChartUI:
 * - XState machine handles: selection, editing (complex state graphs)
 * - UIStore slice handles: dialogs, galleries, text pane visibility (simple UI state)
 *
 * Architecture: Actor Access Layer
 * - All reactive reads use imported selectors with useSelector
 * - All writes use commands from createDiagramCommands
 * - NO inline selector functions
 * - NO direct .send() calls
 *
 * @see state-machines/src/diagram-machine.ts
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { diagramSelectors } from '../../selectors';
import type { DiagramNodeId, DiagramState, DiagramUIState } from '@mog-sdk/contracts/actors';

import { createDiagramCommands } from '../../coordinator/actor-access';
// Note: useCoordinator is in use-coordinator.tsx but imported without extension
import { useCoordinator } from '../shared/use-coordinator';

// Type-safe selector wrapper to handle XState snapshot type compatibility

type AnySelector<T> = (state: any) => T;
const asSelector = <T>(selector: (state: DiagramState) => T): AnySelector<T> => selector;

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseDiagramUIReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE (from XState machine)
  // ═══════════════════════════════════════════════════════════════════════════

  /** ID of the Diagram object containing the selected nodes */
  selectedObjectId: string | null;

  /** IDs of currently selected nodes (supports multi-select) */
  selectedNodeIds: DiagramNodeId[];

  /** ID of the node currently being edited (in-place text edit) */
  editingNodeId: DiagramNodeId | null;

  /** First selected node ID (convenience for single-select scenarios) */
  selectedNodeId: DiagramNodeId | null;

  /** Number of selected nodes */
  selectedCount: number;

  /** Whether any node is selected */
  hasSelection: boolean;

  /** Whether multiple nodes are selected */
  hasMultipleSelected: boolean;

  /** Whether in idle state (no node selected) */
  isIdle: boolean;

  /** Whether in nodeSelected state (one or more nodes selected) */
  isNodeSelected: boolean;

  /** Whether in editing state (in-place text editing) */
  isEditing: boolean;

  /** Whether in any selected state (nodeSelected or editing) */
  isInAnySelectedState: boolean;

  /** Current UI state as a string enum */
  uiState: DiagramUIState;

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECTION ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Select a single node (replaces existing selection).
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to select
   */
  selectNode: (objectId: string, nodeId: DiagramNodeId) => void;

  /**
   * Toggle a node in multi-selection (Ctrl/Cmd+click).
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to toggle
   */
  multiSelectNode: (objectId: string, nodeId: DiagramNodeId) => void;

  /**
   * Clear all selection.
   */
  deselect: () => void;

  /**
   * Handle external selection (cell, chart, etc.) becoming active.
   * Clears Diagram selection to avoid multiple active selections.
   */
  externalSelectionActive: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // EDITING ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start in-place text editing for a node.
   * @param nodeId - Node ID to edit
   */
  startEdit: (nodeId: DiagramNodeId) => void;

  /**
   * Commit text changes and exit editing mode.
   * @param text - New text value
   */
  commitEdit: (text: string) => void;

  /**
   * Cancel editing and discard changes.
   */
  cancelEdit: () => void;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the Diagram UI state machine.
 *
 * This hook provides access to Diagram selection and editing state from the
 * XState machine. For UI state like dialog visibility and text pane, use the
 * UIStore hooks (useDiagramDialogOpen, useTextPaneVisible, etc.).
 *
 * The Diagram actor is wired into the SheetCoordinator via ActorManager and
 * is available for reactive state access and commands.
 *
 * @example
 * ```tsx
 * function DiagramToolbar() {
 * const {
 * selectedObjectId,
 * selectedNodeIds,
 * isEditing,
 * selectNode,
 * startEdit,
 * deselect,
 * } = useDiagramUI;
 *
 * return (
 * <div>
 * {selectedNodeIds.length > 0 && (
 * <>
 * <button onClick={ => startEdit(selectedNodeIds[0])}>Edit Text</button>
 * <button onClick={deselect}>Deselect</button>
 * </>
 * )}
 * </div>
 * );
 * }
 * ```
 */
export function useDiagramUI(): UseDiagramUIReturn {
  const coordinator = useCoordinator();
  // Diagram actor is wired into SheetCoordinator via ActorManager
  const actor = coordinator.objects.access.actors.diagram;

  // If no Diagram actor is available, return a default state
  // This can happen during initial render or if Diagram feature is not enabled
  const defaultReturn = useMemo(
    (): UseDiagramUIReturn => ({
      // State
      selectedObjectId: null,
      selectedNodeIds: [],
      editingNodeId: null,
      selectedNodeId: null,
      selectedCount: 0,
      hasSelection: false,
      hasMultipleSelected: false,
      isIdle: true,
      isNodeSelected: false,
      isEditing: false,
      isInAnySelectedState: false,
      uiState: 'idle',
      // Actions (no-ops when no actor)
      selectNode: () => {},
      multiSelectNode: () => {},
      deselect: () => {},
      externalSelectionActive: () => {},
      startEdit: () => {},
      commitEdit: () => {},
      cancelEdit: () => {},
    }),
    [],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE - Using imported selectors (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const selectedObjectId = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.selectedObjectId) : () => null,
  );
  const selectedNodeIds = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.selectedNodeIds) : () => [],
  );
  const editingNodeId = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.editingNodeId) : () => null,
  );
  const selectedNodeId = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.selectedNodeId) : () => null,
  );
  const selectedCount = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.selectedCount) : () => 0,
  );
  const hasSelection = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.hasSelection) : () => false,
  );
  const hasMultipleSelected = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.hasMultipleSelected) : () => false,
  );
  const isIdle = useSelector(actor, actor ? asSelector(diagramSelectors.isIdle) : () => true);
  const isNodeSelected = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.isNodeSelected) : () => false,
  );
  const isEditing = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.isEditing) : () => false,
  );
  const isInAnySelectedState = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.isInAnySelectedState) : () => false,
  );
  const uiState = useSelector(
    actor,
    actor ? asSelector(diagramSelectors.uiState) : () => 'idle' as DiagramUIState,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMANDS - Using createDiagramCommands (Actor Access Layer pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  const commands = useMemo(() => (actor ? createDiagramCommands(actor) : null), [actor]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  // Return default if no actor available
  if (!actor || !commands) {
    return defaultReturn;
  }

  return {
    // State
    selectedObjectId,
    selectedNodeIds,
    editingNodeId,
    selectedNodeId,
    selectedCount,
    hasSelection,
    hasMultipleSelected,
    isIdle,
    isNodeSelected,
    isEditing,
    isInAnySelectedState,
    uiState,

    // Selection actions
    selectNode: commands.selectNode,
    multiSelectNode: commands.multiSelectNode,
    deselect: commands.deselect,
    externalSelectionActive: commands.externalSelectionActive,

    // Editing actions
    startEdit: commands.startEdit,
    commitEdit: commands.commitEdit,
    cancelEdit: commands.cancelEdit,
  };
}
