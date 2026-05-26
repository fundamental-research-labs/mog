/**
 * Diagram node in-place text editor
 *
 * Canvas Integration
 *
 * Renders an in-place text editor overlay when editing a diagram node.
 * The editor is positioned directly over the selected node, accounting for
 * viewport scroll offset for correct positioning.
 *
 * Features:
 * - Position editor overlay directly over the selected node
 * - Handle viewport scroll offset for positioning
 * - Enter key to commit text changes
 * - Escape key to cancel editing
 * - Auto-focus input when editing starts
 * - Uses dispatch() for state changes (DIAGRAM_UPDATE_NODE)
 *
 * RENDER ISOLATION PATTERN:
 * - Use UIStore ONLY for low-frequency state (editingNodeId)
 * - Use LOCAL STATE for editing text to avoid re-renders during typing
 * - Use dispatch() for ALL state mutations (NO direct UIStore calls)
 *
 * @module components/diagram/DiagramNodeEditor
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { ComputedShape, NodeId } from '@mog-sdk/contracts/diagram';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks';
import { useFloatingObject } from '../../hooks/objects';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { PRODUCT_VOCABULARY } from '../../ux/product-vocabulary';

// =============================================================================
// Types
// =============================================================================

export interface DiagramNodeEditorProps {
  /** The Diagram object ID containing the node being edited */
  diagramId: string;
}

// =============================================================================
// Helper: Get Diagram Object
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
// Helper: Get Diagram Object Bounds (accounts for scroll)
// =============================================================================

/**
 * Hook to get the Diagram object bounds in viewport coordinates.
 * Uses ws.objects.get() which returns FloatingObjectInfo with x, y, width, height.
 */
function useDiagramBounds(
  diagram: DiagramObject | undefined,
): { x: number; y: number; width: number; height: number } | null {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const [bounds, setBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!diagram) {
      setBounds(null);
      return;
    }

    void (async () => {
      const info = await ws.objects.getInfo(diagram.id);
      if (!info) {
        setBounds(null);
        return;
      }

      setBounds({
        x: info.x,
        y: info.y,
        width: info.width,
        height: info.height,
      });
    })();
  }, [ws, diagram]);

  return bounds;
}

// =============================================================================
// Helper: Compute Shape from Node ID
// =============================================================================

/**
 * Find the computed shape for a specific node ID.
 * Returns the shape with its position and dimensions.
 */
/**
 * Type guard: treats a non-empty string as a NodeId.
 * NodeId is a branded string type; runtime validation happens via diagram.nodes.get() lookups.
 */
function toNodeId(value: string): NodeId {
  return value as NodeId;
}

function useComputedShape(
  diagram: DiagramObject | undefined,
  nodeId: string | null,
): ComputedShape | null {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const [shape, setShape] = useState<ComputedShape | null>(null);

  useEffect(() => {
    if (!diagram || !nodeId) {
      setShape(null);
      return;
    }

    // Try to get the computed layout from the Diagram bridge via Worksheet API
    const diagramBridge = ws.diagrams;
    if (diagramBridge?.getComputedLayout) {
      const layoutResult = diagramBridge.getComputedLayout(diagram.id);
      // Handle both sync and async return
      Promise.resolve(layoutResult).then((layout) => {
        if (layout) {
          setShape(layout.shapes.find((s: ComputedShape) => s.nodeId === nodeId) || null);
        } else {
          // Fallback: Create a simple shape based on node data
          const typedNodeId = toNodeId(nodeId);
          const node = diagram.diagram?.nodes.get(typedNodeId);
          if (!node) {
            setShape(null);
            return;
          }
          setShape({
            nodeId: typedNodeId,
            shapeType: 'rect' as const,
            x: 0,
            y: 0,
            width: 150,
            height: 50,
            rotation: 0,
            fill: '#4472C4',
            stroke: '#2F5597',
            strokeWidth: 1,
            text: node.text || '',
            textStyle: {
              fontFamily: 'Segoe UI, Arial, sans-serif',
              fontSize: 12,
              fontWeight: 'normal' as const,
              fontStyle: 'normal' as const,
              color: 'var(--color-ss-text-inverse)',
              align: 'center' as const,
              verticalAlign: 'middle' as const,
            },
            effects: {},
          });
        }
      });
    } else {
      // Fallback: Create a simple shape based on node data
      const typedNodeId = toNodeId(nodeId);
      const node = diagram.diagram?.nodes.get(typedNodeId);
      if (!node) {
        setShape(null);
        return;
      }
      setShape({
        nodeId: typedNodeId,
        shapeType: 'rect' as const,
        x: 0,
        y: 0,
        width: 150,
        height: 50,
        rotation: 0,
        fill: '#4472C4',
        stroke: '#2F5597',
        strokeWidth: 1,
        text: node.text || '',
        textStyle: {
          fontFamily: 'Segoe UI, Arial, sans-serif',
          fontSize: 12,
          fontWeight: 'normal' as const,
          fontStyle: 'normal' as const,
          color: 'var(--color-ss-text-inverse)',
          align: 'center' as const,
          verticalAlign: 'middle' as const,
        },
        effects: {},
      });
    }
  }, [ws, diagram, nodeId]);

  return shape;
}

// =============================================================================
// Helper: Calculate Editor Position
// =============================================================================

/**
 * Calculate editor position in viewport coordinates from shape coordinates.
 * The objectBounds already account for viewport scroll offset (from computeObjectBounds).
 *
 * @param shape - The computed shape with relative x/y within the diagram
 * @param objectBounds - Diagram object bounds in viewport coordinates (scroll-adjusted)
 * @param diagramBounds - The diagram's logical bounds (for scaling)
 */
function calculateEditorPosition(
  shape: ComputedShape,
  objectBounds: { x: number; y: number; width: number; height: number },
  diagramBounds: { width: number; height: number } = { width: 400, height: 300 },
): { x: number; y: number; width: number; height: number } {
  // Calculate the scale from diagram coordinates to viewport coordinates
  const scaleX = objectBounds.width / diagramBounds.width;
  const scaleY = objectBounds.height / diagramBounds.height;
  const effectiveScale = Math.min(scaleX, scaleY);

  // Center the diagram within the object bounds
  const offsetX = (objectBounds.width - diagramBounds.width * effectiveScale) / 2;
  const offsetY = (objectBounds.height - diagramBounds.height * effectiveScale) / 2;

  // Calculate shape position in viewport coordinates
  const shapeX = objectBounds.x + offsetX + shape.x * effectiveScale;
  const shapeY = objectBounds.y + offsetY + shape.y * effectiveScale;
  const shapeWidth = shape.width * effectiveScale;
  const shapeHeight = shape.height * effectiveScale;

  return {
    x: shapeX,
    y: shapeY,
    width: shapeWidth,
    height: shapeHeight,
  };
}

// =============================================================================
// Component Implementation
// =============================================================================

/**
 * Diagram Node In-Place Text Editor
 *
 * Renders an input field positioned over the editing node.
 */
export const DiagramNodeEditor = memo(function DiagramNodeEditor({
  diagramId,
}: DiagramNodeEditorProps): React.ReactElement | null {
  const deps = useActionDependencies();

  // UIStore subscription for editing state
  const editingNodeId = useUIStore((s) => s.editingNodeId);
  const selectedDiagramId = useUIStore((s) => s.selectedDiagramId);

  // Get Diagram object and computed shape
  const diagram = useDiagramObject(diagramId);
  const shape = useComputedShape(diagram, editingNodeId);

  // Get Diagram object bounds (already accounts for scroll offset)
  const objectBounds = useDiagramBounds(diagram);

  // Local editing state to avoid re-renders during text input
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize text when editing starts
  useEffect(() => {
    if (editingNodeId && shape) {
      setText(shape.text || '');
    }
  }, [editingNodeId, shape]);

  // Auto-focus when editing starts
  useEffect(() => {
    if (editingNodeId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingNodeId]);

  /**
   * Commit the text change via dispatch.
   */
  const handleCommit = useCallback(() => {
    if (!editingNodeId || !selectedDiagramId) return;

    if (shape && text !== shape.text) {
      // Use dispatch() for state mutation
      dispatch('DIAGRAM_UPDATE_NODE', deps, {
        objectId: selectedDiagramId,
        nodeId: editingNodeId,
        updates: { text },
      });
    }

    // Stop editing mode via dispatch (architecture-compliant)
    dispatch('DIAGRAM_STOP_EDITING', deps);
  }, [deps, editingNodeId, selectedDiagramId, shape, text]);

  /**
   * Cancel editing and restore original text.
   */
  const handleCancel = useCallback(() => {
    // Restore original text
    if (shape) {
      setText(shape.text || '');
    }

    // Stop editing mode via dispatch (architecture-compliant)
    dispatch('DIAGRAM_STOP_EDITING', deps);
  }, [deps, shape]);

  /**
   * Handle keyboard events for commit and cancel.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      }
    },
    [handleCommit, handleCancel],
  );

  /**
   * Handle text input change.
   */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  /**
   * Handle blur - commit on focus loss.
   */
  const handleBlur = useCallback(() => {
    // Small delay to allow click events on other elements to process first
    setTimeout(() => {
      handleCommit();
    }, 100);
  }, [handleCommit]);

  // Don't render if not editing or missing data
  if (!editingNodeId || !shape || !diagram || !objectBounds || selectedDiagramId !== diagramId) {
    return null;
  }

  // Calculate editor position using bounds (already accounts for scroll offset)
  const editorPosition = calculateEditorPosition(shape, objectBounds);

  // Editor style - positioned absolutely over the node
  // Note: background and border colors use Tailwind classes for design system compliance
  const editorStyle: React.CSSProperties = {
    position: 'absolute',
    left: editorPosition.x,
    top: editorPosition.y,
    width: Math.max(editorPosition.width, 80), // Minimum width for usability
    height: Math.max(editorPosition.height, 24), // Minimum height for usability
    fontSize: `${shape.textStyle?.fontSize || 12}px`,
    fontFamily: shape.textStyle?.fontFamily || 'Segoe UI, Arial, sans-serif',
    fontWeight: shape.textStyle?.fontWeight || 'normal',
    textAlign: (shape.textStyle?.align as React.CSSProperties['textAlign']) || 'center',
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={editorStyle}
      className="px-2 py-1 border-2 border-ss-primary rounded-ss-sm bg-ss-surface outline-none box-border z-ss-modal"
      aria-label={`Edit ${PRODUCT_VOCABULARY.diagram.label.toLowerCase()} node text`}
    />
  );
});

// =============================================================================
// Default Export
// =============================================================================

export default DiagramNodeEditor;
