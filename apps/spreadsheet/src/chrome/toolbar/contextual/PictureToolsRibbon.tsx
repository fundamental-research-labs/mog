/**
 * PictureToolsRibbon
 *
 * Contextual ribbon tab shown when a picture/image is selected.
 * Provides adjust, arrange, and size controls.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Checkbox, Input } from '@mog/shell';
import type { PictureObject } from '@mog-sdk/contracts/floating-objects';
import { useFloatingObject } from '../../../hooks/objects/use-floating-object';
import { useObjectInteraction } from '../../../hooks/objects/use-object-interaction';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';
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

export function PictureToolsRibbon(_props: ContextualTabProps) {
  const dispatch = useDispatch();
  const objectInteraction = useObjectInteraction();
  const selectedObjectId =
    objectInteraction.selectedIds.length === 1 ? objectInteraction.selectedIds[0] : '';
  const selectedObject = useFloatingObject(selectedObjectId);
  const selectedPicture = selectedObject?.type === 'picture' ? selectedObject : undefined;
  const selectedPictureId = selectedPicture?.id;
  const hasSelectedPicture = Boolean(selectedPictureId);
  const [maintainAspectRatio, setMaintainAspectRatio] = useState(true);

  useEffect(() => {
    setMaintainAspectRatio(selectedPicture?.lockAspectRatio ?? true);
  }, [selectedPictureId, selectedPicture?.lockAspectRatio]);

  const pictureSize = useMemo(() => getPictureSize(selectedPicture), [selectedPicture]);

  const updatePicture = useCallback(
    (
      updates: Partial<Pick<PictureObject, 'adjustments'>> & { width?: number; height?: number },
    ) => {
      if (!selectedPictureId) return;
      dispatch('UPDATE_PICTURE', { objectId: selectedPictureId, updates });
    },
    [dispatch, selectedPictureId],
  );

  const handleBrightnessChange = useCallback(() => {
    if (!selectedPicture) return;
    updatePicture({
      adjustments: {
        ...selectedPicture.adjustments,
        brightness: clampAdjustment((selectedPicture.adjustments?.brightness ?? 0) + 10),
      },
    });
  }, [selectedPicture, updatePicture]);

  const handleContrastChange = useCallback(() => {
    if (!selectedPicture) return;
    updatePicture({
      adjustments: {
        ...selectedPicture.adjustments,
        contrast: clampAdjustment((selectedPicture.adjustments?.contrast ?? 0) + 10),
      },
    });
  }, [selectedPicture, updatePicture]);

  const handleReset = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('RESET_PICTURE', { objectId: selectedPictureId });
  }, [dispatch, selectedPictureId]);

  const handleBringToFront = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('BRING_OBJECT_TO_FRONT', { objectId: selectedPictureId });
  }, [dispatch, selectedPictureId]);

  const handleSendToBack = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('SEND_OBJECT_TO_BACK', { objectId: selectedPictureId });
  }, [dispatch, selectedPictureId]);

  const handleBringForward = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('BRING_OBJECT_FORWARD', { objectId: selectedPictureId });
  }, [dispatch, selectedPictureId]);

  const handleSendBackward = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('SEND_OBJECT_BACKWARD', { objectId: selectedPictureId });
  }, [dispatch, selectedPictureId]);

  const handleDelete = useCallback(() => {
    if (!selectedPictureId) return;
    dispatch('DELETE_OBJECT');
  }, [dispatch, selectedPictureId]);

  const handleMaintainAspectRatioChange = useCallback((checked: boolean) => {
    setMaintainAspectRatio(checked);
  }, []);

  const updateSize = useCallback(
    (field: 'width' | 'height', rawValue: string) => {
      if (!selectedPicture || !pictureSize) return;
      const nextValue = parsePositivePixelValue(rawValue);
      if (nextValue == null) return;

      if (!maintainAspectRatio) {
        updatePicture({ [field]: nextValue });
        return;
      }

      const ratio =
        pictureSize.width > 0 && pictureSize.height > 0
          ? pictureSize.height / pictureSize.width
          : 1;
      updatePicture(
        field === 'width'
          ? { width: nextValue, height: Math.max(1, Math.round(nextValue * ratio)) }
          : { width: Math.max(1, Math.round(nextValue / ratio)), height: nextValue },
      );
    },
    [maintainAspectRatio, pictureSize, selectedPicture, updatePicture],
  );

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
            title="Increase picture brightness"
            aria-label="Brightness"
            disabled={!hasSelectedPicture}
          />
          <RibbonButton
            layout="horizontal"
            height="half"
            icon={<PictureIcon />}
            label="Contrast"
            onClick={handleContrastChange}
            title="Increase picture contrast"
            aria-label="Contrast"
            disabled={!hasSelectedPicture}
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
          disabled={!hasSelectedPicture}
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
              disabled={!hasSelectedPicture}
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendToBackIcon />}
              label="Send to Back"
              onClick={handleSendToBack}
              title="Send picture to back (lowest layer)"
              aria-label="Send to Back"
              disabled={!hasSelectedPicture}
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
              disabled={!hasSelectedPicture}
            />
            <RibbonButton
              layout="horizontal"
              height="half"
              icon={<SendBackwardIcon />}
              label="Send Backward"
              onClick={handleSendBackward}
              title="Send picture backward one layer"
              aria-label="Send Backward"
              disabled={!hasSelectedPicture}
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
              type="number"
              min={1}
              value={pictureSize?.width ?? ''}
              className="w-14 px-1 py-0.5 text-ribbon"
              title="Picture width"
              aria-label="Picture width"
              onChange={(event) => updateSize('width', event.currentTarget.value)}
              disabled={!hasSelectedPicture}
            />
            <span className="text-ribbon text-ss-text-tertiary">px</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-ribbon text-ss-text-tertiary w-8">H:</span>
            <Input
              type="number"
              min={1}
              value={pictureSize?.height ?? ''}
              className="w-14 px-1 py-0.5 text-ribbon"
              title="Picture height"
              aria-label="Picture height"
              onChange={(event) => updateSize('height', event.currentTarget.value)}
              disabled={!hasSelectedPicture}
            />
            <span className="text-ribbon text-ss-text-tertiary">px</span>
          </div>
          <Checkbox
            checked={maintainAspectRatio}
            onChange={handleMaintainAspectRatioChange}
            label="Lock aspect ratio"
            className="text-ribbon"
            disabled={!hasSelectedPicture}
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
          disabled={!hasSelectedPicture}
        />
      </ToolbarGroup>
    </>
  );
}

function getPictureSize(
  picture: PictureObject | undefined,
): { width: number; height: number } | null {
  if (!picture) return null;
  const width = picture.position.width ?? picture.originalWidth;
  const height = picture.position.height ?? picture.originalHeight;
  return {
    width: Math.max(1, Math.round(width || 1)),
    height: Math.max(1, Math.round(height || 1)),
  };
}

function parsePositivePixelValue(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function clampAdjustment(value: number): number {
  return Math.max(-100, Math.min(100, value));
}
