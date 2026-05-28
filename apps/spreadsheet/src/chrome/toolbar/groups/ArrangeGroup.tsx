/**
 * ArrangeGroup Component
 *
 * Self-sufficient Arrange group for the Page Layout ribbon.
 * Contains controls for arranging floating objects:
 * - Bring Forward / Send Backward (z-order)
 * - Align objects
 * - Group / Ungroup
 * - Rotate
 *
 * This follows the HomeRibbon group pattern - no props, all state
 * comes from hooks and context.
 *
 * ARCHITECTURE: Uses dispatch() pattern via Unified Action System.
 * All mutation actions route through action handlers in object.ts.
 */

import { useCallback, useState } from 'react';

import { ARRANGE_COLLAPSE_CONFIG } from '@mog-sdk/contracts/ribbon';
import { useObjectInteraction } from '../../../hooks/objects/use-object-interaction';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
import { RibbonButton } from '../primitives/RibbonButton';
import { RibbonDropdownPanel } from '../primitives/RibbonDropdown';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  AlignBottomIcon,
  AlignCenterIcon,
  AlignLeftIcon,
  AlignMiddleIcon,
  AlignRightIcon,
  AlignTopIcon,
  BringForwardIcon,
  BringToFrontIcon,
  GroupIcon,
  SendBackwardIcon,
  SendToBackIcon,
  UngroupIcon,
} from '../primitives/ToolbarIcons';

// Placeholder Rotate icon (will be replaced when available)
const RotateIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-[var(--icon-size)] h-[var(--icon-size)]"
  >
    <path
      d="M13.5 8A5.5 5.5 0 1 1 8 2.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M8 1v3l2.5-1.5L8 1z" fill="currentColor" />
  </svg>
);

// =============================================================================
// Component
// =============================================================================

/**
 * ArrangeGroup - Self-sufficient arrange group for floating objects.
 *
 * Provides z-order, alignment, grouping, and rotation controls.
 * Buttons are disabled when no floating object is selected.
 *
 * ARCHITECTURE: Uses dispatch() pattern - all actions go through
 * the Unified Action System action handlers which use the handle-based
 * Worksheet API (e.g. ws.objects.get(id) -> handle) for data writes.
 */
export function ArrangeGroup() {
  const { selectedIds, hasSelection } = useObjectInteraction();
  const hasMultipleSelected = selectedIds.length > 1;

  // Dropdown states
  const [alignDropdownOpen, setAlignDropdownOpen] = useState(false);
  const [rotateDropdownOpen, setRotateDropdownOpen] = useState(false);

  // ===========================================================================
  // Dispatch Setup
  // ===========================================================================

  const dispatch = useDispatch();

  // ===========================================================================
  // Action Handlers - Now using dispatch()
  // ===========================================================================

  // Z-Order handlers
  const handleBringToFront = useCallback(() => {
    dispatch('BRING_OBJECT_TO_FRONT');
  }, [dispatch]);

  const handleBringForward = useCallback(() => {
    dispatch('BRING_OBJECT_FORWARD');
  }, [dispatch]);

  const handleSendToBack = useCallback(() => {
    dispatch('SEND_OBJECT_TO_BACK');
  }, [dispatch]);

  const handleSendBackward = useCallback(() => {
    dispatch('SEND_OBJECT_BACKWARD');
  }, [dispatch]);

  // Group handlers
  const handleGroup = useCallback(() => {
    dispatch('GROUP_OBJECTS');
  }, [dispatch]);

  const handleUngroup = useCallback(() => {
    dispatch('UNGROUP_OBJECTS');
  }, [dispatch]);

  // Align handlers
  const handleAlignLeft = useCallback(() => {
    dispatch('ALIGN_OBJECTS_LEFT');
  }, [dispatch]);

  const handleAlignCenter = useCallback(() => {
    dispatch('ALIGN_OBJECTS_CENTER');
  }, [dispatch]);

  const handleAlignRight = useCallback(() => {
    dispatch('ALIGN_OBJECTS_RIGHT');
  }, [dispatch]);

  const handleAlignTop = useCallback(() => {
    dispatch('ALIGN_OBJECTS_TOP');
  }, [dispatch]);

  const handleAlignMiddle = useCallback(() => {
    dispatch('ALIGN_OBJECTS_MIDDLE');
  }, [dispatch]);

  const handleAlignBottom = useCallback(() => {
    dispatch('ALIGN_OBJECTS_BOTTOM');
  }, [dispatch]);

  // Rotate handlers
  const handleRotateRight90 = useCallback(() => {
    dispatch('ROTATE_OBJECT_RIGHT_90');
  }, [dispatch]);

  const handleRotateLeft90 = useCallback(() => {
    dispatch('ROTATE_OBJECT_LEFT_90');
  }, [dispatch]);

  const handleFlipVertical = useCallback(() => {
    dispatch('FLIP_OBJECT_VERTICAL');
  }, [dispatch]);

  const handleFlipHorizontal = useCallback(() => {
    dispatch('FLIP_OBJECT_HORIZONTAL');
  }, [dispatch]);

  return (
    <ToolbarGroup
      label="Arrange"
      collapseConfig={ARRANGE_COLLAPSE_CONFIG}
      dropdownIcon={<BringToFrontIcon />}
    >
      <div className="flex items-center gap-[var(--ribbon-group-items-gap)]">
        {/* Z-Order Stack - Bring Forward/To Front, Send Backward/To Back */}
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringToFrontIcon />}
              label="Bring to Front"
              onClick={handleBringToFront}
              title="Bring to Front - Move object to top of z-order"
              aria-label="Bring to Front"
              disabled={!hasSelection}
              visibilityKey="bringToFront"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringForwardIcon />}
              label="Bring Forward"
              onClick={handleBringForward}
              title="Bring Forward - Move object up one level"
              aria-label="Bring Forward"
              disabled={!hasSelection}
            />
          </div>
          <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={handleSendToBack}
              title="Send to Back - Move object to bottom of z-order"
              aria-label="Send to Back"
              disabled={!hasSelection}
              visibilityKey="sendToBack"
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={handleSendBackward}
              title="Send Backward - Move object down one level"
              aria-label="Send Backward"
              disabled={!hasSelection}
            />
          </div>
        </div>

        {/* Align Dropdown */}
        <div className="relative">
          <RibbonButton
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-align"
            icon={<AlignLeftIcon />}
            label="Align"
            hasDropdown
            dropdownPosition="inline"
            onClick={() => setAlignDropdownOpen(!alignDropdownOpen)}
            title="Align - Align multiple objects"
            aria-label="Align"
            disabled={!hasMultipleSelected}
          />
          <RibbonDropdownPanel open={alignDropdownOpen} onClose={() => setAlignDropdownOpen(false)}>
            <div data-testid="ribbon-dropdown-menu-align" className="p-2 min-w-[160px]">
              <div className="text-caption text-ss-text-secondary mb-2">Align Objects</div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  data-value="align-left"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignLeft();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Left"
                  aria-label="Align Left"
                >
                  <AlignLeftIcon />
                </button>
                <button
                  data-value="align-center"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignCenter();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Center"
                  aria-label="Align Center"
                >
                  <AlignCenterIcon />
                </button>
                <button
                  data-value="align-right"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignRight();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Right"
                  aria-label="Align Right"
                >
                  <AlignRightIcon />
                </button>
                <button
                  data-value="align-top"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignTop();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Top"
                  aria-label="Align Top"
                >
                  <AlignTopIcon />
                </button>
                <button
                  data-value="align-middle"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignMiddle();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Middle"
                  aria-label="Align Middle"
                >
                  <AlignMiddleIcon />
                </button>
                <button
                  data-value="align-bottom"
                  className="p-1 hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleAlignBottom();
                    setAlignDropdownOpen(false);
                  }}
                  title="Align Bottom"
                  aria-label="Align Bottom"
                >
                  <AlignBottomIcon />
                </button>
              </div>
            </div>
          </RibbonDropdownPanel>
        </div>

        {/* Group/Ungroup */}
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<GroupIcon />}
            label="Group"
            onClick={handleGroup}
            title="Group - Group selected objects"
            aria-label="Group"
            disabled={!hasMultipleSelected}
          />
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<UngroupIcon />}
            label="Ungroup"
            onClick={handleUngroup}
            title="Ungroup - Ungroup selected objects"
            aria-label="Ungroup"
            disabled={!hasSelection}
          />
        </div>

        {/* Rotate Dropdown */}
        <div className="relative">
          <RibbonButton
            layout="vertical"
            height="full"
            data-testid="ribbon-dropdown-rotate"
            icon={<RotateIcon />}
            label="Rotate"
            hasDropdown
            dropdownPosition="inline"
            onClick={() => setRotateDropdownOpen(!rotateDropdownOpen)}
            title="Rotate - Rotate or flip object"
            aria-label="Rotate"
            disabled={!hasSelection}
          />
          <RibbonDropdownPanel
            open={rotateDropdownOpen}
            onClose={() => setRotateDropdownOpen(false)}
          >
            <div data-testid="ribbon-dropdown-menu-rotate" className="p-2 min-w-[160px]">
              <div className="text-caption text-ss-text-secondary mb-2">Rotate Options</div>
              <div className="flex flex-col gap-1">
                <button
                  data-value="rotate-right-90"
                  className="text-left px-2 py-1 text-dropdown hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleRotateRight90();
                    setRotateDropdownOpen(false);
                  }}
                >
                  Rotate Right 90
                </button>
                <button
                  data-value="rotate-left-90"
                  className="text-left px-2 py-1 text-dropdown hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleRotateLeft90();
                    setRotateDropdownOpen(false);
                  }}
                >
                  Rotate Left 90
                </button>
                <div className="border-t border-ss-border-light my-1" />
                <button
                  data-value="flip-vertical"
                  className="text-left px-2 py-1 text-dropdown hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleFlipVertical();
                    setRotateDropdownOpen(false);
                  }}
                >
                  Flip Vertical
                </button>
                <button
                  data-value="flip-horizontal"
                  className="text-left px-2 py-1 text-dropdown hover:bg-ss-surface-hover rounded"
                  onClick={() => {
                    handleFlipHorizontal();
                    setRotateDropdownOpen(false);
                  }}
                >
                  Flip Horizontal
                </button>
              </div>
            </div>
          </RibbonDropdownPanel>
        </div>
      </div>
    </ToolbarGroup>
  );
}
