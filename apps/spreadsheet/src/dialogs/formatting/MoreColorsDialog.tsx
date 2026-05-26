/**
 * More Colors Dialog
 *
 * Dialog for selecting custom colors with RGB, HSL, and hex input.
 * Includes a color picker with preview and recent colors history.
 *
 * Excel parity 14.5: More Colors Dialog
 */

import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { dispatch, useUIStore } from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  TabPanel,
  Tabs,
} from '@mog/shell';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';

// =============================================================================
// Standard Color Palette
// =============================================================================

const STANDARD_COLORS = [
  // Row 1: Theme colors (primary)
  '#FFFFFF',
  '#F2F2F2',
  '#D8D8D8',
  '#BFBFBF',
  '#A5A5A5',
  '#7F7F7F',
  '#595959',
  '#3F3F3F',
  '#262626',
  '#000000',
  // Row 2: Theme accents
  '#4472C4',
  '#ED7D31',
  '#A5A5A5',
  '#FFC000',
  '#5B9BD5',
  '#70AD47',
  '#9E480E',
  '#636363',
  '#997300',
  '#264478',
  // Row 3: Standard colors
  '#C00000',
  '#FF0000',
  '#FFC000',
  '#FFFF00',
  '#92D050',
  '#00B050',
  '#00B0F0',
  '#0070C0',
  '#002060',
  '#7030A0',
  // Row 4: More standard colors
  '#FF6600',
  '#FF9900',
  '#FFCC00',
  '#CCFF00',
  '#00FF00',
  '#00FFCC',
  '#00CCFF',
  '#3366FF',
  '#9933FF',
  '#FF33CC',
];

// =============================================================================
// Component
// =============================================================================

export function MoreColorsDialog() {
  const deps = useActionDependencies();
  const dialog = useUIStore((s) => s.moreColorsDialog);
  const setMoreColorsActiveTab = useUIStore((s) => s.setMoreColorsActiveTab);
  const setMoreColorsRGB = useUIStore((s) => s.setMoreColorsRGB);
  const setMoreColorsHSL = useUIStore((s) => s.setMoreColorsHSL);
  const setMoreColorsHex = useUIStore((s) => s.setMoreColorsHex);
  const addRecentColor = useUIStore((s) => s.addRecentColor);
  const loadRecentColorsFromStorage = useUIStore((s) => s.loadRecentColorsFromStorage);
  const closeMoreColorsDialog = useUIStore((s) => s.closeMoreColorsDialog);
  const getSelectedColorHex = useUIStore((s) => s.getSelectedColorHex);

  // Load recent colors on mount
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedRef.current) {
      loadRecentColorsFromStorage();
      hasLoadedRef.current = true;
    }
  }, [loadRecentColorsFromStorage]);

  // Get current hex color for preview
  const selectedHex = useMemo(() => getSelectedColorHex(), [getSelectedColorHex, dialog.rgb]);

  // Title based on color target
  const dialogTitle = useMemo(() => {
    switch (dialog.colorTarget) {
      case 'fill':
        return 'More Fill Colors';
      case 'font':
        return 'More Font Colors';
      case 'border':
        return 'More Border Colors';
      default:
        return 'More Colors';
    }
  }, [dialog.colorTarget]);

  // Tab change handler
  const handleTabChange = useCallback(
    (tab: string) => {
      setMoreColorsActiveTab(tab as 'standard' | 'custom');
    },
    [setMoreColorsActiveTab],
  );

  // RGB input handlers
  const handleRChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsRGB({ r: val });
      }
    },
    [setMoreColorsRGB],
  );

  const handleGChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsRGB({ g: val });
      }
    },
    [setMoreColorsRGB],
  );

  const handleBChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsRGB({ b: val });
      }
    },
    [setMoreColorsRGB],
  );

  // HSL input handlers
  const handleHChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsHSL({ h: val });
      }
    },
    [setMoreColorsHSL],
  );

  const handleSChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsHSL({ s: val });
      }
    },
    [setMoreColorsHSL],
  );

  const handleLChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val)) {
        setMoreColorsHSL({ l: val });
      }
    },
    [setMoreColorsHSL],
  );

  // Hex input handler
  const handleHexChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value;
      // Ensure it starts with #
      if (!value.startsWith('#')) {
        value = '#' + value;
      }
      setMoreColorsHex(value);
    },
    [setMoreColorsHex],
  );

  // Standard color click handler
  const handleStandardColorClick = useCallback(
    (color: string) => {
      setMoreColorsHex(color);
    },
    [setMoreColorsHex],
  );

  // Recent color click handler
  const handleRecentColorClick = useCallback(
    (color: string) => {
      setMoreColorsHex(color);
    },
    [setMoreColorsHex],
  );

  // OK handler - apply the color
  const handleOk = useCallback(() => {
    if (dialog.hexError) {
      return;
    }

    const colorHex = getSelectedColorHex();

    // Add to recent colors
    addRecentColor(colorHex);

    // Dispatch the appropriate action based on color target
    const actionType =
      dialog.colorTarget === 'fill'
        ? 'APPLY_MORE_COLORS_FILL'
        : dialog.colorTarget === 'font'
          ? 'APPLY_MORE_COLORS_FONT'
          : 'APPLY_MORE_COLORS_BORDER';

    dispatch(actionType, deps, { color: colorHex });

    closeMoreColorsDialog();
  }, [
    dialog.colorTarget,
    dialog.hexError,
    deps,
    getSelectedColorHex,
    addRecentColor,
    closeMoreColorsDialog,
  ]);

  // Cancel handler
  const handleClose = useCallback(() => {
    closeMoreColorsDialog();
  }, [closeMoreColorsDialog]);

  if (!dialog.isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={dialog.isOpen}
      onClose={handleClose}
      dialogId="more-colors-dialog"
      width="md"
    >
      <DialogHeader onClose={handleClose}>{dialogTitle}</DialogHeader>

      <DialogBody>
        <Tabs
          tabs={[
            { id: 'standard', label: 'Standard' },
            { id: 'custom', label: 'Custom' },
          ]}
          activeTab={dialog.activeTab}
          onTabChange={handleTabChange}
        />

        {/* Standard Colors Tab */}
        <TabPanel tabId="standard">
          <div className="flex flex-col gap-4 pt-4">
            <div className="text-body-sm text-ss-text-secondary">Colors:</div>
            <div className="grid grid-cols-10 gap-1">
              {STANDARD_COLORS.map((color, index) => (
                <button
                  key={`${color}-${index}`}
                  type="button"
                  onClick={() => handleStandardColorClick(color)}
                  className="w-6 h-6 rounded border border-ss-border hover:border-ss-primary focus:outline-none focus:ring-2 focus:ring-ss-primary"
                  style={{ backgroundColor: color }}
                  aria-label={`Select color ${color}`}
                />
              ))}
            </div>
          </div>
        </TabPanel>

        {/* Custom Colors Tab */}
        <TabPanel tabId="custom">
          <div className="flex flex-col gap-4">
            {/* Color Model Selection and Inputs */}
            <div className="grid grid-cols-2 gap-6">
              {/* Left side: RGB inputs */}
              <div className="flex flex-col gap-3">
                <div className="text-body-sm text-ss-text-secondary font-medium">RGB</div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">R:</label>
                  <Input
                    type="number"
                    min={0}
                    max={255}
                    value={dialog.rgb.r}
                    onChange={handleRChange}
                    className="w-20"
                    aria-label="Red value"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">G:</label>
                  <Input
                    type="number"
                    min={0}
                    max={255}
                    value={dialog.rgb.g}
                    onChange={handleGChange}
                    className="w-20"
                    aria-label="Green value"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">B:</label>
                  <Input
                    type="number"
                    min={0}
                    max={255}
                    value={dialog.rgb.b}
                    onChange={handleBChange}
                    className="w-20"
                    aria-label="Blue value"
                  />
                </div>
              </div>

              {/* Right side: HSL inputs */}
              <div className="flex flex-col gap-3">
                <div className="text-body-sm text-ss-text-secondary font-medium">HSL</div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">H:</label>
                  <Input
                    type="number"
                    min={0}
                    max={360}
                    value={dialog.hsl.h}
                    onChange={handleHChange}
                    className="w-20"
                    aria-label="Hue value"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">S:</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={dialog.hsl.s}
                    onChange={handleSChange}
                    className="w-20"
                    aria-label="Saturation value"
                  />
                  <span className="text-body-xs text-ss-text-tertiary">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-body-sm text-ss-text-secondary w-8">L:</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={dialog.hsl.l}
                    onChange={handleLChange}
                    className="w-20"
                    aria-label="Lightness value"
                  />
                  <span className="text-body-xs text-ss-text-tertiary">%</span>
                </div>
              </div>
            </div>

            {/* Hex input */}
            <div className="flex items-center gap-3">
              <label className="text-body-sm text-ss-text-secondary">Hex:</label>
              <Input
                type="text"
                value={dialog.hexInput}
                onChange={handleHexChange}
                className="w-28"
                placeholder="#RRGGBB"
                aria-label="Hex color value"
              />
              {dialog.hexError && (
                <span className="text-body-xs text-ss-error">{dialog.hexError}</span>
              )}
            </div>

            {/* Color Preview */}
            <div className="flex items-center gap-4">
              <div className="text-body-sm text-ss-text-secondary">Preview:</div>
              <div className="flex border border-ss-border rounded overflow-hidden">
                {/* New color */}
                <div
                  className="w-16 h-12"
                  style={{ backgroundColor: selectedHex }}
                  title={`New: ${selectedHex}`}
                />
                {/* Current color (if available) */}
                {dialog.currentColor && (
                  <div
                    className="w-16 h-12 border-l border-ss-border"
                    style={{ backgroundColor: dialog.currentColor }}
                    title={`Current: ${dialog.currentColor}`}
                  />
                )}
              </div>
              <div className="flex flex-col text-body-xs text-ss-text-tertiary">
                <span>New</span>
                {dialog.currentColor && <span>Current</span>}
              </div>
            </div>
          </div>
        </TabPanel>

        {/* Recent Colors */}
        {dialog.recentColors.length > 0 && (
          <div className="mt-4 pt-4 border-t border-ss-border">
            <div className="text-body-sm text-ss-text-secondary mb-2">Recent Colors:</div>
            <div className="flex gap-1 flex-wrap">
              {dialog.recentColors.map((color: string, index: number) => (
                <button
                  key={`recent-${color}-${index}`}
                  type="button"
                  onClick={() => handleRecentColorClick(color)}
                  className="w-6 h-6 rounded border border-ss-border hover:border-ss-primary focus:outline-none focus:ring-2 focus:ring-ss-primary"
                  style={{ backgroundColor: color }}
                  aria-label={`Select recent color ${color}`}
                />
              ))}
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!!dialog.hexError}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
