/**
 * Diagram UI Slice
 *
 * Manages ephemeral UI state for Diagram diagrams.
 *
 * ARCHITECTURE NOTE - STATE OWNERSHIP:
 *
 * Following the same pattern as charts (see chart-ui.ts), Diagram state is split:
 *
 * 1. XState Machine (state-machines/src/diagram-machine.ts) - SINGLE SOURCE OF TRUTH for:
 * - selectedObjectId (which Diagram object has selection)
 * - selectedNodeIds (which nodes are selected within the Diagram)
 * - editingNodeId (which node is being text-edited)
 * These are INTERACTION states that form a complex state graph.
 *
 * 2. This Zustand Slice - For EPHEMERAL UI state only:
 * - dialogOpen (Insert Diagram dialog visibility)
 * - textPaneVisible (Text Pane panel visibility)
 * - layoutGalleryOpen, stylesGalleryOpen, colorsGalleryOpen (gallery dialogs)
 * These are simple UI toggles with no state machine semantics.
 *
 * MIGRATION STATUS:
 * - The selection/editing state (selectedDiagramId, selectedNodeIds, editingNodeId)
 * currently exists in BOTH places for backward compatibility.
 * - Components should migrate to use `useDiagramUI()` hook which reads from XState.
 * - The UIStore selection state will be DEPRECATED once all consumers are migrated.
 *
 * @see state-machines/src/diagram-machine.ts for XState machine
 * @see state/hooks/use-diagram.ts for the hook that reads from XState
 * @see chart-ui.ts for the reference pattern (charts already migrated)
 * @see contracts/src/diagram/types.ts for Diagram data types
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// State Interface
// =============================================================================

/**
 * Diagram UI state managed by this slice.
 */
export interface DiagramUIState {
  /** Whether the Insert Diagram dialog is open */
  dialogOpen: boolean;

  /**
   * Currently selected Diagram object ID (null if none selected)
   * @deprecated Use useDiagramUI().selectedObjectId from XState instead.
   * This will be removed once all consumers migrate to the XState hook.
   */
  selectedDiagramId: string | null;

  /**
   * Selected node IDs within the selected Diagram (for multi-select)
   * @deprecated Use useDiagramUI().selectedNodeIds from XState instead.
   * This will be removed once all consumers migrate to the XState hook.
   */
  selectedNodeIds: string[];

  /**
   * Node currently being text-edited (null if not editing)
   * @deprecated Use useDiagramUI().editingNodeId from XState instead.
   * This will be removed once all consumers migrate to the XState hook.
   */
  editingNodeId: string | null;

  /** Whether the Text Pane panel is visible */
  textPaneVisible: boolean;

  /** Whether the Layout gallery dialog is open */
  layoutGalleryOpen: boolean;

  /** Whether the Styles gallery dialog is open */
  stylesGalleryOpen: boolean;

  /** Whether the Colors gallery dialog is open */
  colorsGalleryOpen: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Diagram UI slice with state and actions.
 */
export interface DiagramUISlice extends DiagramUIState {
  // Dialog actions
  /**
   * Open the Insert Diagram dialog.
   */
  openDiagramDialog: () => void;

  /**
   * Close the Insert Diagram dialog.
   */
  closeDiagramDialog: () => void;

  // Selection actions
  /**
   * Select a Diagram object.
   * Clears any node selection when selecting a new Diagram.
   * @param objectId - The Diagram object ID to select
   * @deprecated Use useDiagramUI().selectNode() from XState instead.
   */
  selectDiagram: (objectId: string) => void;

  /**
   * Deselect the currently selected Diagram.
   * Also clears node selection and stops any editing.
   * @deprecated Use useDiagramUI().deselect() from XState instead.
   */
  deselectDiagram: () => void;

  // Node selection actions
  /**
   * Select a single node within the Diagram.
   * Replaces any existing node selection.
   * @param nodeId - The node ID to select
   * @deprecated Use useDiagramUI().selectNode() from XState instead.
   */
  selectNode: (nodeId: string) => void;

  /**
   * Select multiple nodes within the Diagram.
   * Replaces any existing node selection.
   * @param nodeIds - The node IDs to select
   * @deprecated Use useDiagramUI().multiSelectNode() from XState instead.
   */
  selectNodes: (nodeIds: string[]) => void;

  /**
   * Clear all node selections.
   * @deprecated Use useDiagramUI().deselect() from XState instead.
   */
  deselectNodes: () => void;

  // Node editing actions
  /**
   * Start editing a node's text.
   * @param nodeId - The node ID to start editing
   * @deprecated Use useDiagramUI().startEdit() from XState instead.
   */
  startEditingNode: (nodeId: string) => void;

  /**
   * Stop editing the current node.
   * @deprecated Use useDiagramUI().commitEdit() or cancelEdit() from XState instead.
   */
  stopEditingNode: () => void;

  // Text Pane actions
  /**
   * Toggle the Text Pane visibility.
   */
  toggleTextPane: () => void;

  /**
   * Set the Text Pane visibility.
   * @param visible - Whether the Text Pane should be visible
   */
  setTextPaneVisible: (visible: boolean) => void;

  // Gallery actions
  /**
   * Open the Layout gallery dialog.
   */
  openLayoutGallery: () => void;

  /**
   * Close the Layout gallery dialog.
   */
  closeLayoutGallery: () => void;

  /**
   * Open the Styles gallery dialog.
   */
  openStylesGallery: () => void;

  /**
   * Close the Styles gallery dialog.
   */
  closeStylesGallery: () => void;

  /**
   * Open the Colors gallery dialog.
   */
  openColorsGallery: () => void;

  /**
   * Close the Colors gallery dialog.
   */
  closeColorsGallery: () => void;

  /**
   * Close all gallery dialogs.
   */
  closeAllGalleries: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialDiagramUIState: DiagramUIState = {
  dialogOpen: false,
  selectedDiagramId: null,
  selectedNodeIds: [],
  editingNodeId: null,
  textPaneVisible: false,
  layoutGalleryOpen: false,
  stylesGalleryOpen: false,
  colorsGalleryOpen: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the Diagram UI slice.
 */
export const createDiagramUISlice: StateCreator<DiagramUISlice, [], [], DiagramUISlice> = (
  set,
) => ({
  // Initial state
  ...initialDiagramUIState,

  // Dialog actions
  openDiagramDialog: () => {
    set({ dialogOpen: true });
  },

  closeDiagramDialog: () => {
    set({ dialogOpen: false });
  },

  // Selection actions
  selectDiagram: (objectId: string) => {
    set({
      selectedDiagramId: objectId,
      selectedNodeIds: [],
      editingNodeId: null,
    });
  },

  deselectDiagram: () => {
    set({
      selectedDiagramId: null,
      selectedNodeIds: [],
      editingNodeId: null,
      textPaneVisible: false,
    });
  },

  // Node selection actions
  selectNode: (nodeId: string) => {
    set({
      selectedNodeIds: [nodeId],
      editingNodeId: null,
    });
  },

  selectNodes: (nodeIds: string[]) => {
    set({
      selectedNodeIds: nodeIds,
      editingNodeId: null,
    });
  },

  deselectNodes: () => {
    set({
      selectedNodeIds: [],
      editingNodeId: null,
    });
  },

  // Node editing actions
  startEditingNode: (nodeId: string) => {
    set({
      selectedNodeIds: [nodeId],
      editingNodeId: nodeId,
    });
  },

  stopEditingNode: () => {
    set({ editingNodeId: null });
  },

  // Text Pane actions
  toggleTextPane: () => {
    set((state) => ({ textPaneVisible: !state.textPaneVisible }));
  },

  setTextPaneVisible: (visible: boolean) => {
    set({ textPaneVisible: visible });
  },

  // Gallery actions
  openLayoutGallery: () => {
    set({
      layoutGalleryOpen: true,
      stylesGalleryOpen: false,
      colorsGalleryOpen: false,
    });
  },

  closeLayoutGallery: () => {
    set({ layoutGalleryOpen: false });
  },

  openStylesGallery: () => {
    set({
      layoutGalleryOpen: false,
      stylesGalleryOpen: true,
      colorsGalleryOpen: false,
    });
  },

  closeStylesGallery: () => {
    set({ stylesGalleryOpen: false });
  },

  openColorsGallery: () => {
    set({
      layoutGalleryOpen: false,
      stylesGalleryOpen: false,
      colorsGalleryOpen: true,
    });
  },

  closeColorsGallery: () => {
    set({ colorsGalleryOpen: false });
  },

  closeAllGalleries: () => {
    set({
      layoutGalleryOpen: false,
      stylesGalleryOpen: false,
      colorsGalleryOpen: false,
    });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select whether the Insert Diagram dialog is open.
 */
export function selectIsDiagramDialogOpen(state: DiagramUISlice): boolean {
  return state.dialogOpen;
}

/**
 * Select whether a Diagram object is currently selected.
 */
export function selectHasDiagramSelected(state: DiagramUISlice): boolean {
  return state.selectedDiagramId !== null;
}

/**
 * Select whether any nodes are currently selected.
 */
export function selectHasNodesSelected(state: DiagramUISlice): boolean {
  return state.selectedNodeIds.length > 0;
}

/**
 * Select whether a node is currently being edited.
 */
export function selectIsEditingNode(state: DiagramUISlice): boolean {
  return state.editingNodeId !== null;
}

/**
 * Select whether any gallery dialog is open.
 */
export function selectIsAnyGalleryOpen(state: DiagramUISlice): boolean {
  return state.layoutGalleryOpen || state.stylesGalleryOpen || state.colorsGalleryOpen;
}
