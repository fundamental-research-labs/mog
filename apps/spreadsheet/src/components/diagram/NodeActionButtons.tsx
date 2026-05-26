/**
 * Diagram Node Action Buttons
 *
 * UI Components
 *
 * Split button components for node operations in Diagram diagrams.
 * Provides:
 * - "Add Shape" split button with position options (after, before, above, below, assistant)
 *
 * ARCHITECTURE:
 * - Uses dispatch() for ALL actions (NO direct UIStore mutations)
 * - Uses existing SplitButton and RibbonDropdown components for consistency
 * - Follows ChartToolsRibbon pattern
 *
 * @module components/diagram/NodeActionButtons
 */

import React, { memo, useCallback, useState } from 'react';

import type { NodePosition } from '@mog-sdk/contracts/api';
import { dispatch } from '../../actions';
import {
  RibbonDropdownItem,
  RibbonDropdownPanel,
} from '../../chrome/toolbar/primitives/RibbonDropdown';
import { SplitButton } from '../../chrome/toolbar/primitives/SplitButton';
import { useActionDependencies } from '../../hooks';
import { useUIStore } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

/**
 * Props for AddShapeButton.
 */
export interface AddShapeButtonProps {
  /** The ID of the Diagram object to add shapes to */
  diagramId: string;
  /** Whether to show the "Add Assistant" option (only for org chart layouts) */
  showAssistant?: boolean;
  /** Optional className for styling */
  className?: string;
}

// =============================================================================
// Icons
// =============================================================================

/**
 * Add Shape icon - a plus sign with a shape silhouette.
 */
function AddShapeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
      {/* Base shape (rounded rect) */}
      <rect x="3" y="5" width="10" height="10" rx="2" opacity="0.6" />
      {/* Plus sign */}
      <path d="M15 8v4M13 10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// =============================================================================
// AddShapeButton Component
// =============================================================================

/**
 * Add Shape split button for Diagram diagrams.
 *
 * Default action: Add shape after the currently selected node.
 * Dropdown options:
 * - Add Shape After: Insert after selected node (same level)
 * - Add Shape Before: Insert before selected node (same level)
 * - Add Shape Above: Insert as parent of selected node
 * - Add Shape Below: Insert as child of selected node
 * - Add Assistant: Insert as assistant (org charts only)
 *
 * Uses dispatch('DIAGRAM_ADD_NODE', deps, { position, objectId, referenceNodeId })
 *
 * @example
 * ```tsx
 * <AddShapeButton diagramId={diagram.id} showAssistant={isOrgChart} />
 * ```
 */
export const AddShapeButton = memo(function AddShapeButton({
  diagramId,
  showAssistant = false,
  className = '',
}: AddShapeButtonProps): React.ReactElement {
  const deps = useActionDependencies();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Get the first selected node from UIStore (selectedNodeIds is an array for multi-select)
  const selectedNodeId = useUIStore((s) => s.selectedNodeIds[0] ?? null);

  /**
   * Add a shape at the specified position.
   * Uses DIAGRAM_ADD_NODE action with position parameter.
   */
  const handleAddShape = useCallback(
    (position: NodePosition) => {
      dispatch('DIAGRAM_ADD_NODE', deps, {
        objectId: diagramId,
        position,
        referenceNodeId: selectedNodeId,
        text: '',
      });
      setDropdownOpen(false);
    },
    [deps, diagramId, selectedNodeId],
  );

  /**
   * Default action: Add shape after selected node.
   */
  const handleMainClick = useCallback(() => {
    handleAddShape('after');
  }, [handleAddShape]);

  /**
   * Toggle dropdown visibility.
   */
  const handleDropdownClick = useCallback(() => {
    setDropdownOpen((prev) => !prev);
  }, []);

  return (
    <div className={`relative inline-flex ${className}`}>
      <SplitButton
        icon={<AddShapeIcon />}
        label="Add Shape"
        variant="large"
        isOpen={dropdownOpen}
        onMainClick={handleMainClick}
        onDropdownClick={handleDropdownClick}
        title="Add Shape"
        aria-label="Add Shape"
      />

      <RibbonDropdownPanel open={dropdownOpen} onClose={() => setDropdownOpen(false)}>
        <div className="bg-ss-surface border border-ss-border rounded shadow-ss-md py-1 min-w-[180px]">
          <RibbonDropdownItem onClick={() => handleAddShape('after')} closeOnClick>
            Add Shape After
          </RibbonDropdownItem>

          <RibbonDropdownItem onClick={() => handleAddShape('before')} closeOnClick>
            Add Shape Before
          </RibbonDropdownItem>

          <div className="border-t border-ss-border my-1" />

          <RibbonDropdownItem onClick={() => handleAddShape('above')} closeOnClick>
            Add Shape Above
          </RibbonDropdownItem>

          <RibbonDropdownItem onClick={() => handleAddShape('below')} closeOnClick>
            Add Shape Below
          </RibbonDropdownItem>

          {showAssistant && (
            <>
              <div className="border-t border-ss-border my-1" />
              <RibbonDropdownItem onClick={() => handleAddShape('child')} closeOnClick>
                Add Assistant
              </RibbonDropdownItem>
            </>
          )}
        </div>
      </RibbonDropdownPanel>
    </div>
  );
});

// =============================================================================
// Default Export
// =============================================================================

export default AddShapeButton;
