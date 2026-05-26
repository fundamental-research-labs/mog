/**
 * Diagram format tab
 *
 * Contextual command tab shown when a diagram object is selected.
 * Provides shape and text formatting options.
 *
 * UI Components
 *
 * Groups:
 * - Shape Styles: Fill color, outline color, shape effects
 * - Text effects styles: Text fill, text outline, text effects
 * - Arrange: Bring forward, send backward, z-order controls
 * - Size: Height and width inputs with local state
 *
 * RENDER ISOLATION PATTERN:
 * - Use LOCAL STATE for size inputs to avoid re-renders on every keystroke
 * - Dispatch on blur/Enter, not on change
 * - Use dispatch() for ALL UIStore mutations (NO direct calls)
 *
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { NodeId } from '@mog-sdk/contracts/diagram';
import { dispatch } from '../../actions';
import type { ContextualTabProps } from '../../chrome/toolbar/contextual/contextual-tab-registry';
import { RibbonButton } from '../../chrome/toolbar/primitives/RibbonButton';
import { RibbonDropdownPanel } from '../../chrome/toolbar/primitives/RibbonDropdown';
import { ToolbarGroup } from '../../chrome/toolbar/primitives/ToolbarGroup';
import {
  BoldIcon,
  BringForwardIcon,
  BringToFrontIcon,
  ItalicIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../../chrome/toolbar/primitives/ToolbarIcons';
import { useFloatingObject } from '../../hooks/objects';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore } from '../../infra/context';
import { ColorPicker } from '../pickers/ColorPicker';

// =============================================================================
// Icon Components
// =============================================================================

/**
 * Shape Fill icon for shape fill color/gradient.
 */
function ShapeFillIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="14" height="12" rx="1" fill="#4472C4" stroke="none" />
      <rect x="3" y="16" width="14" height="2" fill="#4472C4" stroke="none" rx="0.5" />
    </svg>
  );
}

/**
 * Shape Outline icon for shape stroke styling.
 */
function ShapeOutlineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="3"
        y="3"
        width="14"
        height="12"
        rx="1"
        fill="none"
        stroke="#4472C4"
        strokeWidth="2"
      />
      <rect x="3" y="16" width="14" height="2" fill="#4472C4" stroke="none" rx="0.5" />
    </svg>
  );
}

/**
 * Shape Effects icon for shadows, glow, etc.
 */
function ShapeEffectsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Shadow offset */}
      <rect x="5" y="5" width="12" height="10" rx="1" fill="#999" opacity="0.4" stroke="none" />
      {/* Main shape */}
      <rect x="3" y="3" width="12" height="10" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Text Fill icon for text color.
 */
function TextFillIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <text x="10" y="13" fontSize="12" textAnchor="middle" fill="currentColor" stroke="none">
        A
      </text>
      <rect x="3" y="15" width="14" height="3" fill="#4472C4" stroke="none" rx="0.5" />
    </svg>
  );
}

/**
 * Text Outline icon for text stroke styling.
 */
function TextOutlineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <text
        x="10"
        y="13"
        fontSize="12"
        textAnchor="middle"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        A
      </text>
      <rect x="3" y="15" width="14" height="3" fill="none" stroke="#4472C4" rx="0.5" />
    </svg>
  );
}

/**
 * Text Effects icon for shadows, glow, etc.
 */
function TextEffectsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Shadow offset */}
      <text x="11" y="14" fontSize="12" textAnchor="middle" fill="#999" stroke="none" opacity="0.5">
        A
      </text>
      {/* Main letter */}
      <text x="10" y="13" fontSize="12" textAnchor="middle" fill="currentColor" stroke="none">
        A
      </text>
    </svg>
  );
}

/**
 * Size icon for width/height controls.
 */
function SizeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Horizontal double arrow */}
      <path d="M1 8H15M3 6L1 8L3 10M13 6L15 8L13 10" />
    </svg>
  );
}

// =============================================================================
// Helper Hook: Get Selected Diagram
// =============================================================================

/**
 * Get the currently selected Diagram object from the FloatingObjectCache.
 * Returns undefined if no Diagram is selected.
 */
function useSelectedDiagram(): DiagramObject | undefined {
  const selectedDiagramId = useUIStore((s) => s.selectedDiagramId);
  const obj = useFloatingObject(selectedDiagramId ?? '');
  if (!obj || obj.type !== 'diagram') return undefined;
  return obj as DiagramObject;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Diagram Format Tab - Contextual ribbon tab for Diagram formatting.
 *
 * This tab only renders when a Diagram object is selected. It provides:
 * - Shape Styles group: Fill, Outline, Effects
 * - TextEffect Styles group: Text Fill, Text Outline, Text Effects
 * - Arrange group: Z-order controls
 * - Size group: Height and width inputs
 *
 * RENDER ISOLATION:
 * - Uses local state for size inputs to prevent re-renders during typing
 * - Dispatches on blur/Enter to commit changes
 */
export const DiagramFormatTab = memo(function DiagramFormatTab(
  _props: ContextualTabProps,
): React.JSX.Element | null {
  const deps = useActionDependencies();

  // Get selected Diagram object
  const diagram = useSelectedDiagram();

  // Get selected node ID for node-specific formatting
  const selectedNodeIds = useUIStore((s) => s.selectedNodeIds);
  const selectedNodeId = selectedNodeIds[0] ?? null;

  // Get selected node for format display
  const selectedNode = useMemo(() => {
    if (!diagram || !selectedNodeId) return null;
    return diagram.diagram?.nodes?.get(selectedNodeId as NodeId) ?? null;
  }, [diagram, selectedNodeId]);

  // ============================================================================
  // Local State for Size Inputs (Render Isolation)
  // ============================================================================

  const [localHeight, setLocalHeight] = useState<number>(diagram?.position?.height ?? 200);
  const [localWidth, setLocalWidth] = useState<number>(diagram?.position?.width ?? 300);

  // Sync local state when diagram changes from external source
  useEffect(() => {
    if (diagram?.position) {
      setLocalHeight(diagram.position.height ?? 200);
      setLocalWidth(diagram.position.width ?? 300);
    }
  }, [diagram?.position?.height, diagram?.position?.width, diagram?.position]);

  // ============================================================================
  // Color Picker State
  // ============================================================================

  const [shapeFillOpen, setShapeFillOpen] = useState(false);
  const [shapeOutlineOpen, setShapeOutlineOpen] = useState(false);
  const [textFillOpen, setTextFillOpen] = useState(false);

  // ============================================================================
  // Size Input Handlers (Dispatch on blur/Enter)
  // ============================================================================

  const handleHeightBlur = useCallback(() => {
    if (diagram && localHeight !== diagram.position?.height) {
      // NOTE: SET_OBJECT_HEIGHT action may not be implemented yet
      // This is a placeholder for future implementation
      console.log('Set Diagram height:', localHeight);
      // dispatch('SET_OBJECT_HEIGHT', deps, { objectId: diagram.id, height: localHeight });
    }
  }, [diagram, localHeight]);

  const handleWidthBlur = useCallback(() => {
    if (diagram && localWidth !== diagram.position?.width) {
      // NOTE: SET_OBJECT_WIDTH action may not be implemented yet
      // This is a placeholder for future implementation
      console.log('Set Diagram width:', localWidth);
      // dispatch('SET_OBJECT_WIDTH', deps, { objectId: diagram.id, width: localWidth });
    }
  }, [diagram, localWidth]);

  const handleHeightKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleHeightBlur();
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleHeightBlur],
  );

  const handleWidthKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleWidthBlur();
        (e.target as HTMLInputElement).blur();
      }
    },
    [handleWidthBlur],
  );

  // ============================================================================
  // Shape Styles Handlers
  // ============================================================================

  const handleShapeFillChange = useCallback(
    (color: string | null) => {
      if (!diagram || !selectedNodeId) return;
      dispatch('DIAGRAM_UPDATE_NODE', deps, {
        objectId: diagram.id,
        nodeId: selectedNodeId,
        updates: { fillColor: color ?? undefined },
      });
      setShapeFillOpen(false);
    },
    [deps, diagram, selectedNodeId],
  );

  const handleShapeOutlineChange = useCallback(
    (color: string | null) => {
      if (!diagram || !selectedNodeId) return;
      dispatch('DIAGRAM_UPDATE_NODE', deps, {
        objectId: diagram.id,
        nodeId: selectedNodeId,
        updates: { borderColor: color ?? undefined },
      });
      setShapeOutlineOpen(false);
    },
    [deps, diagram, selectedNodeId],
  );

  const handleShapeEffects = useCallback(() => {
    // NOTE: OPEN_SHAPE_EFFECTS_MENU action may not be implemented yet
    console.log('Open Shape Effects menu');
  }, []);

  // ============================================================================
  // TextEffect Styles Handlers
  // ============================================================================

  const handleTextFillChange = useCallback(
    (color: string | null) => {
      if (!diagram || !selectedNodeId) return;
      dispatch('DIAGRAM_UPDATE_NODE', deps, {
        objectId: diagram.id,
        nodeId: selectedNodeId,
        updates: { textColor: color ?? undefined },
      });
      setTextFillOpen(false);
    },
    [deps, diagram, selectedNodeId],
  );

  const handleTextOutline = useCallback(() => {
    // NOTE: OPEN_TEXT_OUTLINE_MENU action may not be implemented yet
    console.log('Open Text Outline menu');
  }, []);

  const handleTextEffects = useCallback(() => {
    // NOTE: OPEN_TEXT_EFFECTS_MENU action may not be implemented yet
    console.log('Open Text Effects menu');
  }, []);

  // ============================================================================
  // Text Format Handlers
  // ============================================================================

  const handleToggleBold = useCallback(() => {
    if (!diagram || !selectedNodeId) return;
    const currentBold = selectedNode?.fontWeight === 'bold';
    dispatch('DIAGRAM_UPDATE_NODE', deps, {
      objectId: diagram.id,
      nodeId: selectedNodeId,
      updates: { fontWeight: currentBold ? 'normal' : 'bold' },
    });
  }, [deps, diagram, selectedNodeId, selectedNode?.fontWeight]);

  const handleToggleItalic = useCallback(() => {
    if (!diagram || !selectedNodeId) return;
    const currentItalic = selectedNode?.fontStyle === 'italic';
    dispatch('DIAGRAM_UPDATE_NODE', deps, {
      objectId: diagram.id,
      nodeId: selectedNodeId,
      updates: { fontStyle: currentItalic ? 'normal' : 'italic' },
    });
  }, [deps, diagram, selectedNodeId, selectedNode?.fontStyle]);

  // ============================================================================
  // Arrange Handlers
  // ============================================================================

  const handleBringToFront = useCallback(() => {
    if (diagram) {
      dispatch('BRING_OBJECT_TO_FRONT', deps);
    }
  }, [deps, diagram]);

  const handleSendToBack = useCallback(() => {
    if (diagram) {
      dispatch('SEND_OBJECT_TO_BACK', deps);
    }
  }, [deps, diagram]);

  const handleBringForward = useCallback(() => {
    if (diagram) {
      dispatch('BRING_OBJECT_FORWARD', deps);
    }
  }, [deps, diagram]);

  const handleSendBackward = useCallback(() => {
    if (diagram) {
      dispatch('SEND_OBJECT_BACKWARD', deps);
    }
  }, [deps, diagram]);

  // Don't render if no Diagram is selected
  if (!diagram) return null;

  return (
    <>
      {/* Shape Styles Group */}
      <ToolbarGroup label="Shape Styles">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          {/* Shape Fill with Color Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="diagram-shape-fill"
              layout="vertical"
              height="full"
              icon={<ShapeFillIcon />}
              label="Shape Fill"
              hasDropdown
              dropdownPosition="inline"
              isOpen={shapeFillOpen}
              onClick={() => setShapeFillOpen(!shapeFillOpen)}
              title="Shape Fill"
              aria-label="Shape Fill"
              disabled={!selectedNodeId}
            />
            <RibbonDropdownPanel open={shapeFillOpen} onClose={() => setShapeFillOpen(false)}>
              <ColorPicker
                value={selectedNode?.fillColor ?? undefined}
                onChange={handleShapeFillChange}
                onClose={() => setShapeFillOpen(false)}
                showNoColor
                noColorLabel="No Fill"
              />
            </RibbonDropdownPanel>
          </div>

          {/* Shape Outline with Color Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="diagram-shape-outline"
              layout="vertical"
              height="full"
              icon={<ShapeOutlineIcon />}
              label="Shape Outline"
              hasDropdown
              dropdownPosition="inline"
              isOpen={shapeOutlineOpen}
              onClick={() => setShapeOutlineOpen(!shapeOutlineOpen)}
              title="Shape Outline"
              aria-label="Shape Outline"
              disabled={!selectedNodeId}
            />
            <RibbonDropdownPanel open={shapeOutlineOpen} onClose={() => setShapeOutlineOpen(false)}>
              <ColorPicker
                value={selectedNode?.borderColor ?? undefined}
                onChange={handleShapeOutlineChange}
                onClose={() => setShapeOutlineOpen(false)}
                showNoColor
                noColorLabel="No Outline"
              />
            </RibbonDropdownPanel>
          </div>

          {/* Shape Effects */}
          <RibbonButton
            id="diagram-shape-effects"
            layout="vertical"
            height="full"
            icon={<ShapeEffectsIcon />}
            label="Shape Effects"
            hasDropdown
            dropdownPosition="inline"
            onClick={handleShapeEffects}
            title="Shape Effects"
            aria-label="Shape Effects"
            disabled={!selectedNodeId}
          />
        </div>
      </ToolbarGroup>

      {/* Text effects styles group */}
      <ToolbarGroup label="Text effects styles">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          {/* Text Formatting - Bold/Italic */}
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              id="diagram-bold"
              layout="icon-only"
              icon={<BoldIcon />}
              onClick={handleToggleBold}
              isOpen={selectedNode?.fontWeight === 'bold'}
              title="Bold (Ctrl+B)"
              aria-label="Bold"
              aria-pressed={selectedNode?.fontWeight === 'bold'}
              disabled={!selectedNodeId}
            />
            <RibbonButton
              id="diagram-italic"
              layout="icon-only"
              icon={<ItalicIcon />}
              onClick={handleToggleItalic}
              isOpen={selectedNode?.fontStyle === 'italic'}
              title="Italic (Ctrl+I)"
              aria-label="Italic"
              aria-pressed={selectedNode?.fontStyle === 'italic'}
              disabled={!selectedNodeId}
            />
          </div>

          {/* Text Fill with Color Picker */}
          <div className="relative inline-flex">
            <RibbonButton
              id="diagram-text-fill"
              layout="vertical"
              height="full"
              icon={<TextFillIcon />}
              label="Text Fill"
              hasDropdown
              dropdownPosition="inline"
              isOpen={textFillOpen}
              onClick={() => setTextFillOpen(!textFillOpen)}
              title="Text Fill"
              aria-label="Text Fill"
              disabled={!selectedNodeId}
            />
            <RibbonDropdownPanel open={textFillOpen} onClose={() => setTextFillOpen(false)}>
              <ColorPicker
                value={selectedNode?.textColor ?? undefined}
                onChange={handleTextFillChange}
                onClose={() => setTextFillOpen(false)}
                showNoColor
                noColorLabel="No Fill"
              />
            </RibbonDropdownPanel>
          </div>

          {/* Text Outline */}
          <RibbonButton
            id="diagram-text-outline"
            layout="vertical"
            height="full"
            icon={<TextOutlineIcon />}
            label="Text Outline"
            hasDropdown
            dropdownPosition="inline"
            onClick={handleTextOutline}
            title="Text Outline"
            aria-label="Text Outline"
            disabled={!selectedNodeId}
          />

          {/* Text Effects */}
          <RibbonButton
            id="diagram-text-effects"
            layout="vertical"
            height="full"
            icon={<TextEffectsIcon />}
            label="Text Effects"
            hasDropdown
            dropdownPosition="inline"
            onClick={handleTextEffects}
            title="Text Effects"
            aria-label="Text Effects"
            disabled={!selectedNodeId}
          />
        </div>
      </ToolbarGroup>

      {/* Arrange Group */}
      <ToolbarGroup label="Arrange">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              id="diagram-bring-front"
              layout="horizontal"
              height="half"
              icon={<BringToFrontIcon />}
              label="Bring to Front"
              onClick={handleBringToFront}
              title="Bring to Front"
              aria-label="Bring to Front"
            />
            <RibbonButton
              id="diagram-send-back"
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={handleSendToBack}
              title="Send to Back"
              aria-label="Send to Back"
            />
          </div>
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              id="diagram-bring-forward"
              layout="horizontal"
              height="half"
              icon={<BringForwardIcon />}
              label="Bring Forward"
              onClick={handleBringForward}
              title="Bring Forward"
              aria-label="Bring Forward"
            />
            <RibbonButton
              id="diagram-send-backward"
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={handleSendBackward}
              title="Send Backward"
              aria-label="Send Backward"
            />
          </div>
        </div>
      </ToolbarGroup>

      {/* Size Group - Local state with dispatch on blur */}
      <ToolbarGroup label="Size" isLast>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <RibbonButton
              id="diagram-size-icon"
              layout="icon-only"
              icon={<SizeIcon />}
              title="Size"
              aria-label="Size"
              disabled
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-ribbon-compact text-ss-text-secondary">
              <span className="w-8">Height:</span>
              <input
                type="number"
                className="w-14 px-1 py-0.5 border border-ss-border rounded text-ribbon-compact bg-ss-surface"
                value={localHeight}
                onChange={(e) => setLocalHeight(Number(e.target.value))}
                onBlur={handleHeightBlur}
                onKeyDown={handleHeightKeyDown}
                min={0}
                aria-label="Height"
              />
              <span className="text-ss-text-tertiary">px</span>
            </label>
            <label className="flex items-center gap-1 text-ribbon-compact text-ss-text-secondary">
              <span className="w-8">Width:</span>
              <input
                type="number"
                className="w-14 px-1 py-0.5 border border-ss-border rounded text-ribbon-compact bg-ss-surface"
                value={localWidth}
                onChange={(e) => setLocalWidth(Number(e.target.value))}
                onBlur={handleWidthBlur}
                onKeyDown={handleWidthKeyDown}
                min={0}
                aria-label="Width"
              />
              <span className="text-ss-text-tertiary">px</span>
            </label>
          </div>
        </div>
      </ToolbarGroup>
    </>
  );
});

// =============================================================================
// Default Export
// =============================================================================

export default DiagramFormatTab;
