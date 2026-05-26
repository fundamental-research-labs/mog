/**
 * PictureToolsRibbon
 *
 * Contextual ribbon tab shown when a picture/image is selected.
 * Provides adjust, arrange, and size controls.
 *
 * NOTE: This is a stub implementation. Picture selection and management
 * is not yet implemented. This component will be fully functional when
 * the picture/image system is added.
 *
 * Groups:
 * - Adjust: Brightness, Contrast, Reset (stubs)
 * - Arrange: Bring Forward, Send Backward, Align
 * - Size: Width, Height inputs, Reset
 */

import { useCallback } from 'react';

import { Checkbox, Input } from '@mog/shell';
import { RibbonButton } from '../primitives/RibbonButton';
import { ToolbarGroup } from '../primitives/ToolbarGroup';
import {
  BringForwardIcon,
  BringToFrontIcon,
  ClearFormatIcon,
  DeleteIcon,
  PictureIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../primitives/ToolbarIcons';
import type { ContextualTabProps } from './contextual-tab-registry';

// =============================================================================
// Component
// =============================================================================

/**
 * PictureToolsRibbon - Contextual tab for picture/image editing.
 *
 * This is currently a stub implementation since the picture selection
 * system is not yet implemented. The UI is functional but actions
 * will have no effect until the picture system is added.
 */
export function PictureToolsRibbon(_props: ContextualTabProps) {
  // ==========================================================================
  // Placeholder Handlers
  // NOTE: These will be connected to actual picture operations when implemented
  // ==========================================================================

  const handleBrightnessChange = useCallback(() => {
    // TODO: Implement brightness adjustment when picture system is ready
    console.log('[PictureToolsRibbon] Brightness adjustment not yet implemented');
  }, []);

  const handleContrastChange = useCallback(() => {
    // TODO: Implement contrast adjustment when picture system is ready
    console.log('[PictureToolsRibbon] Contrast adjustment not yet implemented');
  }, []);

  const handleReset = useCallback(() => {
    // TODO: Implement reset when picture system is ready
    console.log('[PictureToolsRibbon] Reset not yet implemented');
  }, []);

  const handleBringToFront = useCallback(() => {
    // TODO: Implement z-order when picture system is ready
    console.log('[PictureToolsRibbon] Bring to front not yet implemented');
  }, []);

  const handleSendToBack = useCallback(() => {
    // TODO: Implement z-order when picture system is ready
    console.log('[PictureToolsRibbon] Send to back not yet implemented');
  }, []);

  const handleBringForward = useCallback(() => {
    // TODO: Implement z-order when picture system is ready
    console.log('[PictureToolsRibbon] Bring forward not yet implemented');
  }, []);

  const handleSendBackward = useCallback(() => {
    // TODO: Implement z-order when picture system is ready
    console.log('[PictureToolsRibbon] Send backward not yet implemented');
  }, []);

  const handleDelete = useCallback(() => {
    // TODO: Implement delete when picture system is ready
    console.log('[PictureToolsRibbon] Delete not yet implemented');
  }, []);

  const handleMaintainAspectRatioChange = useCallback(() => {
    // TODO: Implement aspect ratio lock when picture system is ready
    console.log('[PictureToolsRibbon] Aspect ratio toggle not yet implemented');
  }, []);

  return (
    <>
      {/* Adjust Group */}
      <ToolbarGroup label="Adjust">
        <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<PictureIcon />}
            label="Brightness"
            onClick={handleBrightnessChange}
            title="Adjust picture brightness"
            aria-label="Brightness"
            disabled
          />
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<PictureIcon />}
            label="Contrast"
            onClick={handleContrastChange}
            title="Adjust picture contrast"
            aria-label="Contrast"
            disabled
          />
        </div>
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<ClearFormatIcon />}
          label="Reset"
          onClick={handleReset}
          title="Reset picture to original settings"
          aria-label="Reset Picture"
          disabled
        />
      </ToolbarGroup>

      {/* Arrange Group - Z-Order controls */}
      <ToolbarGroup label="Arrange">
        <div className="flex items-center gap-[var(--ribbon-button-inline-gap)]">
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringToFrontIcon />}
              label="Bring to Front"
              onClick={handleBringToFront}
              title="Bring picture to front (highest layer)"
              aria-label="Bring to Front"
              disabled
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={handleSendToBack}
              title="Send picture to back (lowest layer)"
              aria-label="Send to Back"
              disabled
            />
          </div>
          <div className="flex flex-col gap-[var(--ribbon-button-gap)]">
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<BringForwardIcon />}
              label="Bring Forward"
              onClick={handleBringForward}
              title="Bring picture forward one layer"
              aria-label="Bring Forward"
              disabled
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={handleSendBackward}
              title="Send picture backward one layer"
              aria-label="Send Backward"
              disabled
            />
          </div>
        </div>
      </ToolbarGroup>

      {/* Size Group */}
      <ToolbarGroup label="Size">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-ribbon text-ss-text-tertiary w-8">W:</span>
            <Input
              type="text"
              defaultValue="100"
              className="w-14 px-1 py-0.5 text-ribbon"
              title="Picture width"
              disabled
            />
            <span className="text-ribbon text-ss-text-tertiary">px</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-ribbon text-ss-text-tertiary w-8">H:</span>
            <Input
              type="text"
              defaultValue="100"
              className="w-14 px-1 py-0.5 text-ribbon"
              title="Picture height"
              disabled
            />
            <span className="text-ribbon text-ss-text-tertiary">px</span>
          </div>
          <Checkbox
            checked={true}
            onChange={handleMaintainAspectRatioChange}
            label="Lock aspect ratio"
            className="text-ribbon"
            disabled
          />
        </div>
      </ToolbarGroup>

      {/* Delete Group */}
      <ToolbarGroup label="Actions" isLast>
        <RibbonButton
          layout="vertical"
          height="full"
          icon={<DeleteIcon />}
          label="Delete"
          onClick={handleDelete}
          title="Delete selected picture"
          aria-label="Delete Picture"
          disabled
        />
      </ToolbarGroup>
    </>
  );
}
