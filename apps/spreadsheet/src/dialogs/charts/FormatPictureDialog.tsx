/**
 * Format Picture Dialog
 *
 * A dialog that allows users to format picture properties including:
 * - Size & Properties: dimensions, position, locking
 * - Picture Format: crop, adjustments (brightness, contrast, transparency)
 * - Border: border style, color, width
 *
 * Matches Excel's Format Picture dialog for familiarity.
 *
 * Architecture notes:
 * - Reads picture data directly from FloatingObjectManager (reads are OK)
 * - Writes picture updates via dispatch('UPDATE_PICTURE') for Unified Action System compliance
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Unified Action System pattern
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import {
  Button,
  Checkbox,
  ColorInput,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
  Select,
  TabPanel,
  Tabs,
} from '@mog/shell';
import type {
  ObjectBorder,
  PictureAdjustments,
  PictureCrop,
  PictureObject,
} from '@mog-sdk/contracts/floating-objects';
import { useFloatingObject } from '../../hooks/objects/use-floating-object';

// =============================================================================
// Constants
// =============================================================================

const BORDER_STYLE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

const TAB_OPTIONS = [
  { id: 'size', label: 'Size & Properties' },
  { id: 'format', label: 'Picture Format' },
  { id: 'border', label: 'Border' },
];

// =============================================================================
// Component
// =============================================================================

export function FormatPictureDialog() {
  const formatPictureDialog = useUIStore((s) => s.formatPictureDialog);
  const closeDialog = useUIStore((s) => s.closeFormatPictureDialog);
  const deps = useActionDependencies();

  // Active tab
  const [activeTab, setActiveTab] = useState<'size' | 'format' | 'border'>('size');

  // Size & Properties state
  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [locked, setLocked] = useState(false);
  const [printable, setPrintable] = useState(true);

  // Picture Format state (adjustments)
  const [brightness, setBrightness] = useState<string>('0');
  const [contrast, setContrast] = useState<string>('0');
  const [transparency, setTransparency] = useState<string>('0');

  // Crop state
  const [cropTop, setCropTop] = useState<string>('0');
  const [cropRight, setCropRight] = useState<string>('0');
  const [cropBottom, setCropBottom] = useState<string>('0');
  const [cropLeft, setCropLeft] = useState<string>('0');

  // Border state
  const [borderStyle, setBorderStyle] = useState<'none' | 'solid' | 'dashed' | 'dotted'>('none');
  const [borderColor, setBorderColor] = useState('#000000');
  const [borderWidth, setBorderWidth] = useState<string>('1');

  const { isOpen, targetObjectId } = formatPictureDialog;

  // Get the picture object
  const obj = useFloatingObject(targetObjectId ?? '');
  const picture = obj?.type === 'picture' ? (obj as PictureObject) : undefined;

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen && picture) {
      // Size & Properties
      setWidth(String(picture.position.width ?? 200));
      setHeight(String(picture.position.height ?? 150));
      setLocked(picture.locked);
      setPrintable(picture.printable);

      // Picture Format (adjustments)
      setBrightness(String(picture.adjustments?.brightness ?? 0));
      setContrast(String(picture.adjustments?.contrast ?? 0));
      setTransparency(String(picture.adjustments?.transparency ?? 0));

      // Crop
      setCropTop(String(picture.crop?.top ?? 0));
      setCropRight(String(picture.crop?.right ?? 0));
      setCropBottom(String(picture.crop?.bottom ?? 0));
      setCropLeft(String(picture.crop?.left ?? 0));

      // Border
      setBorderStyle(picture.border?.style ?? 'none');
      setBorderColor(picture.border?.color ?? '#000000');
      setBorderWidth(String(picture.border?.width ?? 1));

      // Reset to first tab
      setActiveTab('size');
    }
  }, [isOpen, picture]);

  // Handle Apply button click - uses dispatch() for Unified Action System compliance
  const handleApply = useCallback(() => {
    if (!targetObjectId || !picture) return;

    // Parse numeric values
    const parsedWidth = parseFloat(width);
    const parsedHeight = parseFloat(height);
    const parsedBrightness = parseFloat(brightness);
    const parsedContrast = parseFloat(contrast);
    const parsedTransparency = parseFloat(transparency);
    const parsedCropTop = parseFloat(cropTop);
    const parsedCropRight = parseFloat(cropRight);
    const parsedCropBottom = parseFloat(cropBottom);
    const parsedCropLeft = parseFloat(cropLeft);
    const parsedBorderWidth = parseFloat(borderWidth);

    // Build updates object
    const adjustments: PictureAdjustments = {
      brightness: isNaN(parsedBrightness) ? 0 : Math.max(-100, Math.min(100, parsedBrightness)),
      contrast: isNaN(parsedContrast) ? 0 : Math.max(-100, Math.min(100, parsedContrast)),
      transparency: isNaN(parsedTransparency) ? 0 : Math.max(0, Math.min(100, parsedTransparency)),
    };

    const crop: PictureCrop = {
      top: isNaN(parsedCropTop) ? 0 : Math.max(0, Math.min(100, parsedCropTop)),
      right: isNaN(parsedCropRight) ? 0 : Math.max(0, Math.min(100, parsedCropRight)),
      bottom: isNaN(parsedCropBottom) ? 0 : Math.max(0, Math.min(100, parsedCropBottom)),
      left: isNaN(parsedCropLeft) ? 0 : Math.max(0, Math.min(100, parsedCropLeft)),
    };

    const clampedBorderWidth = isNaN(parsedBorderWidth) ? 1 : Math.max(0, parsedBorderWidth);
    const border: ObjectBorder = {
      style: borderStyle,
      color: borderColor,
      width: borderStyle === 'none' ? 0 : clampedBorderWidth,
    };

    // Update the picture via dispatch() for Unified Action System compliance
    const updates = {
      position: {
        ...picture.position,
        width: isNaN(parsedWidth) ? picture.position.width : Math.max(10, parsedWidth),
        height: isNaN(parsedHeight) ? picture.position.height : Math.max(10, parsedHeight),
      },
      locked,
      printable,
      adjustments,
      crop,
      border,
    };

    dispatch('UPDATE_PICTURE', deps, { objectId: targetObjectId, updates });
    closeDialog();
  }, [
    deps,
    targetObjectId,
    picture,
    width,
    height,
    locked,
    printable,
    brightness,
    contrast,
    transparency,
    cropTop,
    cropRight,
    cropBottom,
    cropLeft,
    borderStyle,
    borderColor,
    borderWidth,
    closeDialog,
  ]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  if (!isOpen || !picture) return null;

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={isOpen}
      onClose={closeDialog}
      dialogId="format-picture-dialog"
      width={520}
    >
      <DialogHeader onClose={handleCancel}>Format Picture</DialogHeader>

      <DialogBody>
        <Tabs
          tabs={TAB_OPTIONS}
          activeTab={activeTab}
          onTabChange={setActiveTab as (id: string) => void}
        >
          {/* Size & Properties Tab */}
          <TabPanel tabId="size" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="width-input">Width (px)</Label>
                <Input
                  id="width-input"
                  type="text"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="height-input">Height (px)</Label>
                <Input
                  id="height-input"
                  type="text"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Checkbox
                checked={locked}
                onChange={(checked) => setLocked(checked)}
                label="Lock picture (prevent moving/resizing)"
              />
              <Checkbox
                checked={printable}
                onChange={(checked) => setPrintable(checked)}
                label="Print picture"
              />
            </div>
          </TabPanel>

          {/* Picture Format Tab */}
          <TabPanel tabId="format" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div>
                <Label htmlFor="brightness-input">
                  Brightness ({brightness}%)
                  <span className="text-caption text-ss-text-secondary ml-2">(-100 to 100)</span>
                </Label>
                <Input
                  id="brightness-input"
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={brightness}
                  onChange={(e) => setBrightness(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <Label htmlFor="contrast-input">
                  Contrast ({contrast}%)
                  <span className="text-caption text-ss-text-secondary ml-2">(-100 to 100)</span>
                </Label>
                <Input
                  id="contrast-input"
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  value={contrast}
                  onChange={(e) => setContrast(e.target.value)}
                  className="w-full"
                />
              </div>

              <div>
                <Label htmlFor="transparency-input">
                  Transparency ({transparency}%)
                  <span className="text-caption text-ss-text-secondary ml-2">(0 to 100)</span>
                </Label>
                <Input
                  id="transparency-input"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={transparency}
                  onChange={(e) => setTransparency(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="border-t pt-4 mt-4">
              <Label className="mb-2">Crop (% from each edge)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="crop-top-input" className="text-caption">
                    Top
                  </Label>
                  <Input
                    id="crop-top-input"
                    type="text"
                    value={cropTop}
                    onChange={(e) => setCropTop(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="crop-right-input" className="text-caption">
                    Right
                  </Label>
                  <Input
                    id="crop-right-input"
                    type="text"
                    value={cropRight}
                    onChange={(e) => setCropRight(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="crop-bottom-input" className="text-caption">
                    Bottom
                  </Label>
                  <Input
                    id="crop-bottom-input"
                    type="text"
                    value={cropBottom}
                    onChange={(e) => setCropBottom(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="crop-left-input" className="text-caption">
                    Left
                  </Label>
                  <Input
                    id="crop-left-input"
                    type="text"
                    value={cropLeft}
                    onChange={(e) => setCropLeft(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>
          </TabPanel>

          {/* Border Tab */}
          <TabPanel tabId="border" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="border-style-select">Border Style</Label>
              <Select
                id="border-style-select"
                value={borderStyle}
                onChange={(value) =>
                  setBorderStyle(value as 'none' | 'solid' | 'dashed' | 'dotted')
                }
                options={BORDER_STYLE_OPTIONS}
                className="w-full"
              />
            </div>

            {borderStyle !== 'none' && (
              <>
                <div>
                  <Label htmlFor="border-color-input">Border Color</Label>
                  <ColorInput
                    id="border-color-input"
                    value={borderColor}
                    onChange={(e) => setBorderColor(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="border-width-input">Border Width (px)</Label>
                  <Input
                    id="border-width-input"
                    type="text"
                    value={borderWidth}
                    onChange={(e) => setBorderWidth(e.target.value)}
                    className="w-full"
                  />
                </div>
              </>
            )}
          </TabPanel>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          Apply
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
