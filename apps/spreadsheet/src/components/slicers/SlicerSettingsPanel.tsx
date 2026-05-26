/**
 * Slicer Settings Panel
 *
 * Slicers Implementation
 *
 * A side panel for configuring slicer properties:
 * - Caption (header text)
 * - Style preset selection
 * - Layout options (column count, button height)
 * - Display options (show header, selection indicator, items with no data)
 * - Sort order
 *
 * Architecture:
 * - UI state managed by Zustand (slicerSettingsPanel slice)
 * - Changes applied immediately (live preview)
 *
 * Removed: All @mog-sdk/kernel/store imports
 */

import React, { useCallback } from 'react';

import type { SlicerStylePreset } from '@mog-sdk/contracts/slicers';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { Button, Checkbox, Input, Label, Select } from '@mog/shell/components/ui';

// =============================================================================
// Style Presets
// =============================================================================

// Predefined slicer themes - colors match Excel slicer style presets
const STYLE_PRESETS: { value: SlicerStylePreset; label: string; headerBg: string }[] = [
  { value: 'light1', label: 'Blue Light', headerBg: '#4472c4' },
  { value: 'light2', label: 'Orange Light', headerBg: '#ed7d31' },
  { value: 'light3', label: 'Gray Light', headerBg: '#a5a5a5' },
  { value: 'light4', label: 'Yellow Light', headerBg: '#ffc000' },
  { value: 'light5', label: 'Sky Light', headerBg: '#5b9bd5' },
  { value: 'light6', label: 'Green Light', headerBg: '#70ad47' },
  { value: 'dark1', label: 'Blue Dark', headerBg: '#1e3a5f' },
  { value: 'dark2', label: 'Orange Dark', headerBg: '#7c2d12' },
  { value: 'dark3', label: 'Gray Dark', headerBg: '#374151' },
  { value: 'dark4', label: 'Yellow Dark', headerBg: '#854d0e' },
  { value: 'dark5', label: 'Sky Dark', headerBg: '#1e40af' },
  { value: 'dark6', label: 'Green Dark', headerBg: '#166534' },
  { value: 'other1', label: 'Purple', headerBg: '#7c3aed' },
  { value: 'other2', label: 'Pink', headerBg: '#db2777' },
];

const SORT_OPTIONS = [
  { value: 'ascending', label: 'A to Z' },
  { value: 'descending', label: 'Z to A' },
  { value: 'dataSourceOrder', label: 'Data Source Order' },
] as const;

const COLUMN_COUNT_OPTIONS = [
  { value: '1', label: '1 column' },
  { value: '2', label: '2 columns' },
  { value: '3', label: '3 columns' },
  { value: '4', label: '4 columns' },
  { value: '5', label: '5 columns' },
];

// =============================================================================
// Style Preview Component
// =============================================================================

interface StylePreviewProps {
  preset: SlicerStylePreset;
  headerBg: string;
  isSelected: boolean;
  onClick: () => void;
}

const StylePreview = React.memo(function StylePreview({
  preset,
  headerBg,
  isSelected,
  onClick,
}: StylePreviewProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
 w-8 h-8 rounded border-2 transition-all
 ${isSelected ? 'border-ss-primary ring-2 ring-ss-primary/30' : 'border-transparent hover:border-ss-border'}
 `}
      style={{ backgroundColor: headerBg }}
      title={preset}
      aria-label={`Style: ${preset}`}
    />
  );
});

// =============================================================================
// Component
// =============================================================================

export function SlicerSettingsPanel() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();

  // UI Store state
  const panelState = useUIStore((s) => s.slicerSettingsPanel);
  const closePanel = useUIStore((s) => s.closeSlicerSettingsPanel);
  const updateSettings = useUIStore((s) => s.updateSlicerSettings);

  const {
    isOpen,
    slicerId,
    caption,
    stylePreset,
    columnCount,
    buttonHeight,
    showHeader,
    showSelectionIndicator,
    crossFilter,
    sortOrder,
  } = panelState;

  const applyChanges = useCallback(() => {
    if (!slicerId) return;

    const ws = wb.getSheetById(activeSheetId);
    // Cast needed: API SlicerConfig is a create-config type, but updateSlicerConfig
    // accepts full slicer config fields (caption, style, showHeader) at runtime.
    void ws.slicers.update(slicerId, {
      caption,
      showHeader,
      style: {
        preset: stylePreset,
        columnCount,
        buttonHeight,
        showSelectionIndicator,
        crossFilter,
        customListSort: true,
        showItemsWithNoData: true,
        sortOrder,
      },
    });
  }, [
    wb,
    activeSheetId,
    slicerId,
    caption,
    showHeader,
    stylePreset,
    columnCount,
    buttonHeight,
    showSelectionIndicator,
    crossFilter,
    sortOrder,
  ]);

  // Handle caption change
  const handleCaptionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateSettings({ caption: e.target.value });
    },
    [updateSettings],
  );

  // Handle caption blur - apply immediately
  const handleCaptionBlur = useCallback(() => {
    applyChanges();
  }, [applyChanges]);

  // Handle style preset change
  const handleStyleChange = useCallback(
    (preset: SlicerStylePreset) => {
      updateSettings({ stylePreset: preset });
      // Apply immediately for live preview
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        style: {
          preset,
          columnCount,
          buttonHeight,
          showSelectionIndicator,
          crossFilter,
          customListSort: true,
          showItemsWithNoData: true,
          sortOrder,
        },
      });
    },
    [
      wb,
      activeSheetId,
      slicerId,
      updateSettings,
      columnCount,
      buttonHeight,
      showSelectionIndicator,
      crossFilter,
      sortOrder,
    ],
  );

  // Handle column count change
  const handleColumnCountChange = useCallback(
    (value: string) => {
      const newCount = parseInt(value, 10);
      updateSettings({ columnCount: newCount });
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        style: {
          preset: stylePreset,
          columnCount: newCount,
          buttonHeight,
          showSelectionIndicator,
          crossFilter,
          customListSort: true,
          showItemsWithNoData: true,
          sortOrder,
        },
      });
    },
    [
      wb,
      activeSheetId,
      slicerId,
      updateSettings,
      stylePreset,
      buttonHeight,
      showSelectionIndicator,
      crossFilter,
      sortOrder,
    ],
  );

  // Handle button height change
  const handleButtonHeightChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newHeight = parseInt(e.target.value, 10) || 24;
      updateSettings({ buttonHeight: Math.max(16, Math.min(48, newHeight)) });
    },
    [updateSettings],
  );

  const handleButtonHeightBlur = useCallback(() => {
    applyChanges();
  }, [applyChanges]);

  // Handle checkbox changes
  const handleShowHeaderChange = useCallback(
    (checked: boolean) => {
      updateSettings({ showHeader: checked });
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        showHeader: checked,
      });
    },
    [wb, activeSheetId, slicerId, updateSettings],
  );

  const handleShowSelectionIndicatorChange = useCallback(
    (checked: boolean) => {
      updateSettings({ showSelectionIndicator: checked });
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        style: {
          preset: stylePreset,
          columnCount,
          buttonHeight,
          showSelectionIndicator: checked,
          crossFilter,
          customListSort: true,
          showItemsWithNoData: true,
          sortOrder,
        },
      });
    },
    [
      wb,
      activeSheetId,
      slicerId,
      updateSettings,
      stylePreset,
      columnCount,
      buttonHeight,
      crossFilter,
      sortOrder,
    ],
  );

  const handleShowNoDataChange = useCallback(
    (checked: boolean) => {
      const newCrossFilter = checked
        ? ('showItemsWithNoData' as const)
        : ('showItemsWithDataAtTop' as const);
      updateSettings({ crossFilter: newCrossFilter });
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        style: {
          preset: stylePreset,
          columnCount,
          buttonHeight,
          showSelectionIndicator,
          crossFilter: newCrossFilter,
          customListSort: true,
          showItemsWithNoData: true,
          sortOrder,
        },
      });
    },
    [
      wb,
      activeSheetId,
      slicerId,
      updateSettings,
      stylePreset,
      columnCount,
      buttonHeight,
      showSelectionIndicator,
      sortOrder,
    ],
  );

  // Handle sort order change
  const handleSortOrderChange = useCallback(
    (value: string) => {
      const newOrder = value as 'ascending' | 'descending' | 'dataSourceOrder';
      updateSettings({ sortOrder: newOrder });
      if (!slicerId) return;
      const ws = wb.getSheetById(activeSheetId);
      void ws.slicers.update(slicerId, {
        style: {
          preset: stylePreset,
          columnCount,
          buttonHeight,
          showSelectionIndicator,
          crossFilter,
          customListSort: true,
          showItemsWithNoData: true,
          sortOrder: newOrder,
        },
      });
    },
    [
      wb,
      activeSheetId,
      slicerId,
      updateSettings,
      stylePreset,
      columnCount,
      buttonHeight,
      showSelectionIndicator,
      crossFilter,
    ],
  );

  // Handle close
  const handleClose = useCallback(() => {
    closePanel();
  }, [closePanel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed right-0 top-0 h-full w-72 bg-ss-surface border-l border-ss-border shadow-ss-lg z-ss-overlay flex flex-col"
      data-testid="slicer-settings-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ss-border">
        <h2 className="text-body-sm font-semibold">Slicer Settings</h2>
        <Button variant="ghost" size="sm" onClick={handleClose}>
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
          </svg>
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Caption */}
        <div>
          <Label htmlFor="slicer-caption" className="mb-1.5">
            Caption
          </Label>
          <Input
            id="slicer-caption"
            value={caption}
            onChange={handleCaptionChange}
            onBlur={handleCaptionBlur}
            placeholder="Slicer caption"
          />
        </div>

        {/* Style */}
        <div>
          <Label className="mb-1.5">Style</Label>
          <div className="grid grid-cols-7 gap-1">
            {STYLE_PRESETS.map((preset) => (
              <StylePreview
                key={preset.value}
                preset={preset.value}
                headerBg={preset.headerBg}
                isSelected={stylePreset === preset.value}
                onClick={() => handleStyleChange(preset.value)}
              />
            ))}
          </div>
        </div>

        {/* Layout */}
        <div className="pt-2 border-t border-ss-border">
          <Label className="mb-2 block text-caption font-semibold uppercase tracking-wide text-ss-text-secondary">
            Layout
          </Label>

          <div className="space-y-3">
            <div>
              <Label htmlFor="slicer-columns" className="mb-1.5 text-body-sm">
                Columns
              </Label>
              <Select
                id="slicer-columns"
                value={String(columnCount)}
                onChange={(value) => handleColumnCountChange(value)}
                options={COLUMN_COUNT_OPTIONS}
              />
            </div>

            <div>
              <Label htmlFor="slicer-button-height" className="mb-1.5 text-body-sm">
                Button Height (px)
              </Label>
              <Input
                id="slicer-button-height"
                type="number"
                min={16}
                max={48}
                value={buttonHeight}
                onChange={handleButtonHeightChange}
                onBlur={handleButtonHeightBlur}
              />
            </div>
          </div>
        </div>

        {/* Display Options */}
        <div className="pt-2 border-t border-ss-border">
          <Label className="mb-2 block text-caption font-semibold uppercase tracking-wide text-ss-text-secondary">
            Display
          </Label>

          <div className="space-y-2">
            <Checkbox checked={showHeader} onChange={handleShowHeaderChange} label="Show header" />
            <Checkbox
              checked={showSelectionIndicator}
              onChange={handleShowSelectionIndicatorChange}
              label="Show selection checkmarks"
            />
            <Checkbox
              checked={crossFilter === 'showItemsWithNoData'}
              onChange={handleShowNoDataChange}
              label="Show items with no data"
            />
          </div>
        </div>

        {/* Sorting */}
        <div className="pt-2 border-t border-ss-border">
          <Label htmlFor="slicer-sort" className="mb-1.5">
            Sort Order
          </Label>
          <Select
            id="slicer-sort"
            value={sortOrder}
            onChange={(value) => handleSortOrderChange(value)}
            options={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-ss-border">
        <Button variant="secondary" className="w-full" onClick={handleClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

export default SlicerSettingsPanel;
