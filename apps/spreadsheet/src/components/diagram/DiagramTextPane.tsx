/**
 * Diagram Text Pane Component
 *
 * UI Components
 *
 * Provides an outline-style text editor for Diagram diagrams showing
 * the node hierarchy with indentation. Users can:
 * - Tab to demote nodes (increase level)
 * - Shift+Tab to promote nodes (decrease level)
 * - Enter to add a new node after the current one
 * - Backspace on an empty line to delete the node
 * - Alt+Arrow keys to move nodes up/down
 *
 * RENDER ISOLATION PATTERN:
 * - Get diagram snapshot ONCE with useMemo, NOT with version counter
 * - Use UIStore ONLY for low-frequency state (selectedNodeId, textPaneVisible)
 * - Use LOCAL STATE for editing text to avoid re-renders
 * - Use dispatch() for ALL UIStore mutations (NO direct calls)
 *
 * @module components/diagram/DiagramTextPane
 */

import React, { memo, useCallback, useMemo, useState } from 'react';

import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { NodeId } from '@mog-sdk/contracts/diagram';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks';
import { useFloatingObject } from '../../hooks/objects';
import { useUIStore } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface DiagramTextPaneProps {
  /** The Diagram object ID to display in the Text Pane */
  diagramId: string;
}

/**
 * Node information for display in the text pane.
 * Extracted from DiagramObject.diagram.nodes
 */
interface TextPaneNode {
  id: string;
  text: string;
  level: number;
  childIds: string[];
}

// =============================================================================
// Helper Hook: Get Diagram Object
// =============================================================================

/**
 * Get a Diagram object from the FloatingObjectCache.
 * Returns undefined if not found or not a Diagram object.
 */
function useDiagramObject(diagramId: string): DiagramObject | undefined {
  const obj = useFloatingObject(diagramId);
  if (!obj || obj.type !== 'diagram') return undefined;
  return obj as DiagramObject;
}

// =============================================================================
// Helper Hook: Ordered Nodes
// =============================================================================

/**
 * Get nodes in document order (depth-first traversal).
 * Returns a flat list of nodes with their hierarchy level for display.
 */
function useOrderedNodes(diagram: DiagramObject | undefined): TextPaneNode[] {
  return useMemo(() => {
    if (!diagram || !diagram.diagram) return [];

    const result: TextPaneNode[] = [];
    const nodes = diagram.diagram.nodes;
    const rootNodeIds = diagram.diagram.rootNodeIds || [];

    // Depth-first traversal to get ordered nodes
    const traverse = (nodeId: NodeId) => {
      const node = nodes.get(nodeId);
      if (!node) return;
      result.push({
        id: node.id,
        text: node.text || '',
        level: node.level ?? 0,
        childIds: node.childIds?.map((id) => id as string) || [],
      });
      const children = node.childIds || [];
      children.forEach(traverse);
    };

    rootNodeIds.forEach(traverse);
    return result;
  }, [diagram]);
}

// =============================================================================
// Component Implementation
// =============================================================================

/**
 * Diagram Text Pane Component
 *
 * Displays an outline-style editor for Diagram nodes with keyboard shortcuts
 * for hierarchy manipulation.
 */
export const DiagramTextPane = memo(function DiagramTextPane({
  diagramId,
}: DiagramTextPaneProps): React.ReactElement | null {
  const deps = useActionDependencies();

  // UIStore subscription for low-frequency state (selection, visibility)
  const selectedNodeId = useUIStore((s) => s.selectedNodeIds?.[0] ?? null);
  const isVisible = useUIStore((s) => s.textPaneVisible);

  // Local editing state to avoid re-renders during text input
  const [editingText, setEditingText] = useState<Map<string, string>>(new Map());

  // Get Diagram object from FloatingObjectManager
  const diagram = useDiagramObject(diagramId);

  // Get ordered nodes for display
  const orderedNodes = useOrderedNodes(diagram);

  /**
   * Handle keyboard events for hierarchy manipulation.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, nodeId: string) => {
      const currentText = editingText.get(nodeId);
      const nodeData = orderedNodes.find((n) => n.id === nodeId);

      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch('DIAGRAM_PROMOTE_NODE', deps, { objectId: diagramId, nodeId });
        } else {
          dispatch('DIAGRAM_DEMOTE_NODE', deps, { objectId: diagramId, nodeId });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // Commit current text before adding new node
        if (currentText !== undefined && nodeData && currentText !== nodeData.text) {
          dispatch('DIAGRAM_UPDATE_NODE', deps, {
            objectId: diagramId,
            nodeId,
            updates: { text: currentText },
          });
          setEditingText((prev) => {
            const next = new Map(prev);
            next.delete(nodeId);
            return next;
          });
        }
        // Add new node after current
        dispatch('DIAGRAM_ADD_NODE', deps, {
          objectId: diagramId,
          position: 'after',
          referenceNodeId: nodeId,
          text: '',
        });
      } else if (e.key === 'Backspace') {
        // Check if text is empty (use editing text if available, otherwise node text)
        const displayText = currentText ?? nodeData?.text ?? '';
        if (displayText === '') {
          e.preventDefault();
          // Delete the node
          dispatch('DIAGRAM_REMOVE_NODE', deps, { objectId: diagramId, nodeId });
        }
      } else if (e.key === 'ArrowUp' && e.altKey) {
        e.preventDefault();
        dispatch('DIAGRAM_MOVE_NODE_UP', deps, { objectId: diagramId, nodeId });
      } else if (e.key === 'ArrowDown' && e.altKey) {
        e.preventDefault();
        dispatch('DIAGRAM_MOVE_NODE_DOWN', deps, { objectId: diagramId, nodeId });
      }
    },
    [deps, editingText, orderedNodes, diagramId],
  );

  /**
   * Handle text input change - update local state only (not UIStore).
   */
  const handleTextChange = useCallback((nodeId: string, text: string) => {
    setEditingText((prev) => new Map(prev).set(nodeId, text));
  }, []);

  /**
   * Handle input blur - commit changes to UIStore via dispatch.
   */
  const handleTextBlur = useCallback(
    (nodeId: string) => {
      const text = editingText.get(nodeId);
      if (text !== undefined) {
        const nodeData = orderedNodes.find((n) => n.id === nodeId);
        if (nodeData && text !== nodeData.text) {
          // Update through dispatch
          dispatch('DIAGRAM_UPDATE_NODE', deps, {
            objectId: diagramId,
            nodeId,
            updates: { text },
          });
        }
      }
      // Clear local editing state for this node
      setEditingText((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
    },
    [deps, editingText, orderedNodes, diagramId],
  );

  /**
   * Handle node click - select node via dispatch (architecture-compliant).
   */
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      dispatch('DIAGRAM_SELECT_NODE', deps, { nodeId });
    },
    [deps],
  );

  /**
   * Handle close button click - toggle text pane visibility via dispatch (architecture-compliant).
   */
  const handleClose = useCallback(() => {
    dispatch('TOGGLE_DIAGRAM_TEXT_PANE', deps);
  }, [deps]);

  // Don't render if not visible or no diagram
  if (!isVisible || orderedNodes.length === 0) {
    return null;
  }

  return (
    <div className="w-64 border-r border-ss-border bg-ss-surface flex flex-col">
      {/* Header */}
      <div className="p-2 border-b border-ss-border flex items-center justify-between">
        <span className="text-body-sm font-medium">Text Pane</span>
        <button
          className="text-ss-text-secondary hover:text-ss-text p-1 rounded hover:bg-ss-surface-hover"
          onClick={handleClose}
          aria-label="Close Text Pane"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 1L11 11M1 11L11 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Node List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="text-caption text-ss-text-secondary mb-2">Type your text here</div>

        {orderedNodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const displayText = editingText.get(node.id) ?? node.text;
          const indent = node.level * 16;

          return (
            <div
              key={node.id}
              className={`flex items-start py-1 cursor-pointer rounded ${
                isSelected ? 'bg-ss-primary/10' : 'hover:bg-ss-surface-hover'
              }`}
              style={{ paddingLeft: indent + 8 }}
              onClick={() => handleNodeClick(node.id)}
            >
              <span className="text-ss-text-secondary mr-2 mt-0.5">
                {/* Bullet point */}
                <svg
                  width="6"
                  height="6"
                  viewBox="0 0 6 6"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="3" cy="3" r="3" />
                </svg>
              </span>
              <input
                type="text"
                value={displayText}
                onChange={(e) => handleTextChange(node.id, e.target.value)}
                onBlur={() => handleTextBlur(node.id)}
                onKeyDown={(e) => handleKeyDown(e, node.id)}
                className="flex-1 bg-transparent border-none outline-none text-body-sm min-w-0"
                placeholder="[Text]"
                aria-label={`Node text at level ${node.level}`}
              />
            </div>
          );
        })}
      </div>

      {/* Footer with keyboard shortcuts help */}
      <div className="p-2 border-t border-ss-border text-caption text-ss-text-secondary">
        <div>Tab: Demote | Shift+Tab: Promote</div>
        <div>Enter: Add shape | Alt+Arrows: Move</div>
      </div>
    </div>
  );
});

// =============================================================================
// Default Export
// =============================================================================

export default DiagramTextPane;
