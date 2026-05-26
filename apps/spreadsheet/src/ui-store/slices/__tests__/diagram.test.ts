/**
 * Diagram UI Slice Tests
 *
 * Tests for the Diagram UI state management in UIStore.
 * This slice manages dialog visibility, selection state, editing state,
 * text pane visibility, and gallery states.
 *
 * @see engine/src/state/ui-store/slices/diagram.ts
 */

import { create } from 'zustand';

import {
  createDiagramUISlice,
  selectHasNodesSelected,
  selectHasDiagramSelected,
  selectIsAnyGalleryOpen,
  selectIsEditingNode,
  selectIsDiagramDialogOpen,
  type DiagramUISlice,
} from '../objects/diagram';

// Create a test store with just the diagram slice
function createTestStore() {
  return create<DiagramUISlice>()(createDiagramUISlice);
}

describe('DiagramUISlice', () => {
  describe('initial state', () => {
    it('should have correct initial values', () => {
      const store = createTestStore();
      const state = store.getState();

      expect(state.dialogOpen).toBe(false);
      expect(state.selectedDiagramId).toBeNull();
      expect(state.selectedNodeIds).toEqual([]);
      expect(state.editingNodeId).toBeNull();
      expect(state.textPaneVisible).toBe(false);
      expect(state.layoutGalleryOpen).toBe(false);
      expect(state.stylesGalleryOpen).toBe(false);
      expect(state.colorsGalleryOpen).toBe(false);
    });
  });

  describe('dialog actions', () => {
    it('should open the Diagram dialog', () => {
      const store = createTestStore();

      store.getState().openDiagramDialog();

      expect(store.getState().dialogOpen).toBe(true);
    });

    it('should close the Diagram dialog', () => {
      const store = createTestStore();

      // First open it
      store.getState().openDiagramDialog();
      expect(store.getState().dialogOpen).toBe(true);

      // Then close it
      store.getState().closeDiagramDialog();
      expect(store.getState().dialogOpen).toBe(false);
    });

    it('should be idempotent when opening multiple times', () => {
      const store = createTestStore();

      store.getState().openDiagramDialog();
      store.getState().openDiagramDialog();

      expect(store.getState().dialogOpen).toBe(true);
    });

    it('should be idempotent when closing multiple times', () => {
      const store = createTestStore();

      store.getState().closeDiagramDialog();
      store.getState().closeDiagramDialog();

      expect(store.getState().dialogOpen).toBe(false);
    });
  });

  describe('selection actions', () => {
    describe('selectDiagram', () => {
      it('should set selectedDiagramId', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');

        expect(store.getState().selectedDiagramId).toBe('diagram-123');
      });

      it('should clear selectedNodeIds when selecting a new Diagram', () => {
        const store = createTestStore();

        // First select some nodes
        store.getState().selectNodes(['node-1', 'node-2']);
        expect(store.getState().selectedNodeIds).toEqual(['node-1', 'node-2']);

        // Then select a Diagram
        store.getState().selectDiagram('diagram-123');

        expect(store.getState().selectedNodeIds).toEqual([]);
      });

      it('should clear editingNodeId when selecting a new Diagram', () => {
        const store = createTestStore();

        // First start editing a node
        store.getState().startEditingNode('node-1');
        expect(store.getState().editingNodeId).toBe('node-1');

        // Then select a Diagram
        store.getState().selectDiagram('diagram-123');

        expect(store.getState().editingNodeId).toBeNull();
      });

      it('should allow selecting a different Diagram', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');
        store.getState().selectDiagram('diagram-456');

        expect(store.getState().selectedDiagramId).toBe('diagram-456');
      });
    });

    describe('deselectDiagram', () => {
      it('should clear selectedDiagramId', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');
        store.getState().deselectDiagram();

        expect(store.getState().selectedDiagramId).toBeNull();
      });

      it('should clear selectedNodeIds', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');
        store.getState().selectNodes(['node-1', 'node-2']);
        store.getState().deselectDiagram();

        expect(store.getState().selectedNodeIds).toEqual([]);
      });

      it('should clear editingNodeId', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');
        store.getState().startEditingNode('node-1');
        store.getState().deselectDiagram();

        expect(store.getState().editingNodeId).toBeNull();
      });

      it('should hide the text pane', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');
        store.getState().setTextPaneVisible(true);
        store.getState().deselectDiagram();

        expect(store.getState().textPaneVisible).toBe(false);
      });

      it('should be safe to call when nothing is selected', () => {
        const store = createTestStore();

        store.getState().deselectDiagram();

        expect(store.getState().selectedDiagramId).toBeNull();
        expect(store.getState().selectedNodeIds).toEqual([]);
        expect(store.getState().editingNodeId).toBeNull();
        expect(store.getState().textPaneVisible).toBe(false);
      });
    });
  });

  describe('node selection actions', () => {
    describe('selectNode', () => {
      it('should set selectedNodeIds to a single node', () => {
        const store = createTestStore();

        store.getState().selectNode('node-1');

        expect(store.getState().selectedNodeIds).toEqual(['node-1']);
      });

      it('should replace existing node selection', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2']);
        store.getState().selectNode('node-3');

        expect(store.getState().selectedNodeIds).toEqual(['node-3']);
      });

      it('should clear editingNodeId', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().selectNode('node-2');

        expect(store.getState().editingNodeId).toBeNull();
      });
    });

    describe('selectNodes', () => {
      it('should set selectedNodeIds to multiple nodes', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2', 'node-3']);

        expect(store.getState().selectedNodeIds).toEqual(['node-1', 'node-2', 'node-3']);
      });

      it('should replace existing node selection', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2']);
        store.getState().selectNodes(['node-3', 'node-4']);

        expect(store.getState().selectedNodeIds).toEqual(['node-3', 'node-4']);
      });

      it('should clear editingNodeId', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().selectNodes(['node-2', 'node-3']);

        expect(store.getState().editingNodeId).toBeNull();
      });

      it('should handle empty array', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1']);
        store.getState().selectNodes([]);

        expect(store.getState().selectedNodeIds).toEqual([]);
      });
    });

    describe('deselectNodes', () => {
      it('should clear selectedNodeIds', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2']);
        store.getState().deselectNodes();

        expect(store.getState().selectedNodeIds).toEqual([]);
      });

      it('should clear editingNodeId', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().deselectNodes();

        expect(store.getState().editingNodeId).toBeNull();
      });

      it('should be safe to call when no nodes are selected', () => {
        const store = createTestStore();

        store.getState().deselectNodes();

        expect(store.getState().selectedNodeIds).toEqual([]);
        expect(store.getState().editingNodeId).toBeNull();
      });
    });
  });

  describe('editing actions', () => {
    describe('startEditingNode', () => {
      it('should set editingNodeId', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');

        expect(store.getState().editingNodeId).toBe('node-1');
      });

      it('should select the node being edited', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');

        expect(store.getState().selectedNodeIds).toEqual(['node-1']);
      });

      it('should replace existing node selection with the editing node', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2']);
        store.getState().startEditingNode('node-3');

        expect(store.getState().selectedNodeIds).toEqual(['node-3']);
        expect(store.getState().editingNodeId).toBe('node-3');
      });

      it('should allow changing which node is being edited', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().startEditingNode('node-2');

        expect(store.getState().editingNodeId).toBe('node-2');
        expect(store.getState().selectedNodeIds).toEqual(['node-2']);
      });
    });

    describe('stopEditingNode', () => {
      it('should clear editingNodeId', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().stopEditingNode();

        expect(store.getState().editingNodeId).toBeNull();
      });

      it('should preserve selectedNodeIds', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');
        store.getState().stopEditingNode();

        // The node should still be selected even after stopping edit
        expect(store.getState().selectedNodeIds).toEqual(['node-1']);
      });

      it('should be safe to call when not editing', () => {
        const store = createTestStore();

        store.getState().stopEditingNode();

        expect(store.getState().editingNodeId).toBeNull();
      });
    });
  });

  describe('text pane actions', () => {
    describe('toggleTextPane', () => {
      it('should toggle textPaneVisible from false to true', () => {
        const store = createTestStore();

        store.getState().toggleTextPane();

        expect(store.getState().textPaneVisible).toBe(true);
      });

      it('should toggle textPaneVisible from true to false', () => {
        const store = createTestStore();

        store.getState().setTextPaneVisible(true);
        store.getState().toggleTextPane();

        expect(store.getState().textPaneVisible).toBe(false);
      });

      it('should toggle multiple times correctly', () => {
        const store = createTestStore();

        store.getState().toggleTextPane(); // false -> true
        expect(store.getState().textPaneVisible).toBe(true);

        store.getState().toggleTextPane(); // true -> false
        expect(store.getState().textPaneVisible).toBe(false);

        store.getState().toggleTextPane(); // false -> true
        expect(store.getState().textPaneVisible).toBe(true);
      });
    });

    describe('setTextPaneVisible', () => {
      it('should set textPaneVisible to true', () => {
        const store = createTestStore();

        store.getState().setTextPaneVisible(true);

        expect(store.getState().textPaneVisible).toBe(true);
      });

      it('should set textPaneVisible to false', () => {
        const store = createTestStore();

        store.getState().setTextPaneVisible(true);
        store.getState().setTextPaneVisible(false);

        expect(store.getState().textPaneVisible).toBe(false);
      });

      it('should be idempotent', () => {
        const store = createTestStore();

        store.getState().setTextPaneVisible(true);
        store.getState().setTextPaneVisible(true);

        expect(store.getState().textPaneVisible).toBe(true);
      });
    });
  });

  describe('gallery actions', () => {
    describe('layout gallery', () => {
      it('should open layout gallery', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();

        expect(store.getState().layoutGalleryOpen).toBe(true);
      });

      it('should close other galleries when opening layout gallery', () => {
        const store = createTestStore();

        store.getState().openStylesGallery();
        store.getState().openColorsGallery();
        store.getState().openLayoutGallery();

        expect(store.getState().layoutGalleryOpen).toBe(true);
        expect(store.getState().stylesGalleryOpen).toBe(false);
        expect(store.getState().colorsGalleryOpen).toBe(false);
      });

      it('should close layout gallery', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();
        store.getState().closeLayoutGallery();

        expect(store.getState().layoutGalleryOpen).toBe(false);
      });
    });

    describe('styles gallery', () => {
      it('should open styles gallery', () => {
        const store = createTestStore();

        store.getState().openStylesGallery();

        expect(store.getState().stylesGalleryOpen).toBe(true);
      });

      it('should close other galleries when opening styles gallery', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();
        store.getState().openColorsGallery();
        store.getState().openStylesGallery();

        expect(store.getState().layoutGalleryOpen).toBe(false);
        expect(store.getState().stylesGalleryOpen).toBe(true);
        expect(store.getState().colorsGalleryOpen).toBe(false);
      });

      it('should close styles gallery', () => {
        const store = createTestStore();

        store.getState().openStylesGallery();
        store.getState().closeStylesGallery();

        expect(store.getState().stylesGalleryOpen).toBe(false);
      });
    });

    describe('colors gallery', () => {
      it('should open colors gallery', () => {
        const store = createTestStore();

        store.getState().openColorsGallery();

        expect(store.getState().colorsGalleryOpen).toBe(true);
      });

      it('should close other galleries when opening colors gallery', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();
        store.getState().openStylesGallery();
        store.getState().openColorsGallery();

        expect(store.getState().layoutGalleryOpen).toBe(false);
        expect(store.getState().stylesGalleryOpen).toBe(false);
        expect(store.getState().colorsGalleryOpen).toBe(true);
      });

      it('should close colors gallery', () => {
        const store = createTestStore();

        store.getState().openColorsGallery();
        store.getState().closeColorsGallery();

        expect(store.getState().colorsGalleryOpen).toBe(false);
      });
    });

    describe('closeAllGalleries', () => {
      it('should close all galleries', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();
        store.getState().closeAllGalleries();

        expect(store.getState().layoutGalleryOpen).toBe(false);
        expect(store.getState().stylesGalleryOpen).toBe(false);
        expect(store.getState().colorsGalleryOpen).toBe(false);
      });

      it('should be safe to call when no galleries are open', () => {
        const store = createTestStore();

        store.getState().closeAllGalleries();

        expect(store.getState().layoutGalleryOpen).toBe(false);
        expect(store.getState().stylesGalleryOpen).toBe(false);
        expect(store.getState().colorsGalleryOpen).toBe(false);
      });
    });
  });

  describe('selectors', () => {
    describe('selectIsDiagramDialogOpen', () => {
      it('should return false when dialog is closed', () => {
        const store = createTestStore();

        expect(selectIsDiagramDialogOpen(store.getState())).toBe(false);
      });

      it('should return true when dialog is open', () => {
        const store = createTestStore();

        store.getState().openDiagramDialog();

        expect(selectIsDiagramDialogOpen(store.getState())).toBe(true);
      });
    });

    describe('selectHasDiagramSelected', () => {
      it('should return false when no Diagram is selected', () => {
        const store = createTestStore();

        expect(selectHasDiagramSelected(store.getState())).toBe(false);
      });

      it('should return true when a Diagram is selected', () => {
        const store = createTestStore();

        store.getState().selectDiagram('diagram-123');

        expect(selectHasDiagramSelected(store.getState())).toBe(true);
      });
    });

    describe('selectHasNodesSelected', () => {
      it('should return false when no nodes are selected', () => {
        const store = createTestStore();

        expect(selectHasNodesSelected(store.getState())).toBe(false);
      });

      it('should return true when nodes are selected', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1']);

        expect(selectHasNodesSelected(store.getState())).toBe(true);
      });

      it('should return true when multiple nodes are selected', () => {
        const store = createTestStore();

        store.getState().selectNodes(['node-1', 'node-2']);

        expect(selectHasNodesSelected(store.getState())).toBe(true);
      });
    });

    describe('selectIsEditingNode', () => {
      it('should return false when not editing', () => {
        const store = createTestStore();

        expect(selectIsEditingNode(store.getState())).toBe(false);
      });

      it('should return true when editing a node', () => {
        const store = createTestStore();

        store.getState().startEditingNode('node-1');

        expect(selectIsEditingNode(store.getState())).toBe(true);
      });
    });

    describe('selectIsAnyGalleryOpen', () => {
      it('should return false when no galleries are open', () => {
        const store = createTestStore();

        expect(selectIsAnyGalleryOpen(store.getState())).toBe(false);
      });

      it('should return true when layout gallery is open', () => {
        const store = createTestStore();

        store.getState().openLayoutGallery();

        expect(selectIsAnyGalleryOpen(store.getState())).toBe(true);
      });

      it('should return true when styles gallery is open', () => {
        const store = createTestStore();

        store.getState().openStylesGallery();

        expect(selectIsAnyGalleryOpen(store.getState())).toBe(true);
      });

      it('should return true when colors gallery is open', () => {
        const store = createTestStore();

        store.getState().openColorsGallery();

        expect(selectIsAnyGalleryOpen(store.getState())).toBe(true);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle complex selection workflow', () => {
      const store = createTestStore();

      // Select a Diagram
      store.getState().selectDiagram('diagram-1');
      expect(store.getState().selectedDiagramId).toBe('diagram-1');

      // Select some nodes
      store.getState().selectNodes(['node-1', 'node-2']);
      expect(store.getState().selectedNodeIds).toEqual(['node-1', 'node-2']);

      // Start editing a node (should select only that node)
      store.getState().startEditingNode('node-1');
      expect(store.getState().selectedNodeIds).toEqual(['node-1']);
      expect(store.getState().editingNodeId).toBe('node-1');

      // Stop editing (should preserve selection)
      store.getState().stopEditingNode();
      expect(store.getState().selectedNodeIds).toEqual(['node-1']);
      expect(store.getState().editingNodeId).toBeNull();

      // Deselect nodes
      store.getState().deselectNodes();
      expect(store.getState().selectedNodeIds).toEqual([]);

      // Diagram should still be selected
      expect(store.getState().selectedDiagramId).toBe('diagram-1');

      // Deselect Diagram
      store.getState().deselectDiagram();
      expect(store.getState().selectedDiagramId).toBeNull();
    });

    it('should handle gallery and text pane interactions', () => {
      const store = createTestStore();

      // Select a Diagram and show text pane
      store.getState().selectDiagram('diagram-1');
      store.getState().setTextPaneVisible(true);

      // Open a gallery
      store.getState().openLayoutGallery();

      // Text pane should still be visible
      expect(store.getState().textPaneVisible).toBe(true);
      expect(store.getState().layoutGalleryOpen).toBe(true);

      // Close all galleries
      store.getState().closeAllGalleries();

      // Text pane should still be visible
      expect(store.getState().textPaneVisible).toBe(true);

      // Deselect Diagram should hide text pane
      store.getState().deselectDiagram();
      expect(store.getState().textPaneVisible).toBe(false);
    });

    it('should handle rapid selection changes', () => {
      const store = createTestStore();

      // Rapidly change selections
      for (let i = 0; i < 10; i++) {
        store.getState().selectDiagram(`diagram-${i}`);
        store.getState().selectNode(`node-${i}`);
      }

      expect(store.getState().selectedDiagramId).toBe('diagram-9');
      expect(store.getState().selectedNodeIds).toEqual(['node-9']);
    });

    it('should maintain independence between dialog and selection state', () => {
      const store = createTestStore();

      // Open dialog
      store.getState().openDiagramDialog();

      // Select something
      store.getState().selectDiagram('diagram-1');

      // Close dialog should not affect selection
      store.getState().closeDiagramDialog();

      expect(store.getState().dialogOpen).toBe(false);
      expect(store.getState().selectedDiagramId).toBe('diagram-1');
    });
  });
});
