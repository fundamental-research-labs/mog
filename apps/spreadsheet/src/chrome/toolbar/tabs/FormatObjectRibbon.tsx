/**
 * Format Object Ribbon
 *
 * A contextual ribbon that appears when a floating object is selected.
 * Provides formatting options for pictures, shapes, and text boxes.
 *
 * Following the coordinator/machine architecture:
 * - Object selection state is managed by object-interaction-machine
 * - Formatting operations go through FloatingObjectManager
 * - This component reads state from the machine via useObjectInteraction hook
 *
 * @see docs/renderer/README.md - Coordinator architecture
 */

import React from 'react';

import { DeleteSvg } from '@mog/icons';
import {
  FORMAT_OBJECT_ACTIONS_COLLAPSE_CONFIG,
  FORMAT_OBJECT_ARRANGE_COLLAPSE_CONFIG,
} from '@mog-sdk/contracts/ribbon';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BringForwardIcon,
  BringToFrontIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../primitives/ToolbarIcons';

// Delete icon for floating objects - using larger size
function DeleteObjectIcon() {
  return <DeleteSvg style={{ width: 20, height: 20 }} />;
}

// =============================================================================
// Types
// =============================================================================

interface FormatObjectRibbonProps {
  /** Type of selected object */
  objectType: 'picture' | 'shape' | 'textbox' | null;
  /** Called when bring to front is requested */
  onBringToFront?: () => void;
  /** Called when send to back is requested */
  onSendToBack?: () => void;
  /** Called when bring forward is requested */
  onBringForward?: () => void;
  /** Called when send backward is requested */
  onSendBackward?: () => void;
  /** Called when delete is requested */
  onDelete?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function FormatObjectRibbon({
  objectType,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
  onDelete,
}: FormatObjectRibbonProps) {
  // Get a nice display name for the object type
  const objectTypeName = React.useMemo(() => {
    switch (objectType) {
      case 'picture':
        return 'Picture';
      case 'shape':
        return 'Shape';
      case 'textbox':
        return 'Text Box';
      default:
        return 'Object';
    }
  }, [objectType]);

  return (
    <>
      {/* Contextual Header */}
      <div className="bg-ss-primary-lighter text-ss-primary py-0.5 px-3 text-ribbon font-semibold border-b border-ss-primary-light text-center">
        {objectTypeName} Format
      </div>

      {/* Arrange Group - Z-Order controls */}
      <ToolbarGroup
        label="Arrange"
        collapseConfig={FORMAT_OBJECT_ARRANGE_COLLAPSE_CONFIG}
        dropdownIcon={<BringToFrontIcon />}
      >
        <RibbonButton
          layout="icon-only"
          icon={<BringToFrontIcon />}
          onClick={onBringToFront}
          title="Bring to Front"
          aria-label="Bring to Front"
        />
        <RibbonButton
          layout="icon-only"
          icon={<SendToBackIcon />}
          onClick={onSendToBack}
          title="Send to Back"
          aria-label="Send to Back"
        />
        <RibbonButton
          layout="icon-only"
          icon={<BringForwardIcon />}
          onClick={onBringForward}
          title="Bring Forward"
          aria-label="Bring Forward"
        />
        <RibbonButton
          layout="icon-only"
          icon={<SendBackwardIcon />}
          onClick={onSendBackward}
          title="Send Backward"
          aria-label="Send Backward"
        />
      </ToolbarGroup>

      {/* Actions Group */}
      <ToolbarGroup
        label="Actions"
        isLast
        collapseConfig={FORMAT_OBJECT_ACTIONS_COLLAPSE_CONFIG}
        dropdownIcon={<DeleteObjectIcon />}
      >
        <RibbonButton
          layout="icon-only"
          icon={<DeleteObjectIcon />}
          onClick={onDelete}
          className="text-ss-error hover:text-ss-error"
          title="Delete (Del)"
          aria-label="Delete Object"
        />
      </ToolbarGroup>
    </>
  );
}
