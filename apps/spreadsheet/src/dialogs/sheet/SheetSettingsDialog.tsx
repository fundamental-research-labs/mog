/**
 * SheetSettingsDialog
 *
 * Per-sheet settings dialog for configuring gridlines, headers, zero values,
 * protection, and other sheet-specific preferences.
 *
 * Settings & Toggles
 *
 * Architecture:
 * - Reads settings via ws.settings.get() Worksheet API
 * - Writes settings via ws.settings.set(key, value) Worksheet API
 * - Outline config via ws.outline.getSettings() and ws.outline.setSettings()
 * - Does NOT access coordinator/renderer directly
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Select,
} from '@mog/shell';
import type { OutlineSettings, SheetSettingsInfo } from '@mog-sdk/contracts/api';

// =============================================================================
// Constants
// =============================================================================

/** Preset gridline colors for quick selection */
const GRIDLINE_COLOR_OPTIONS = [
  { value: '#e2e2e2', label: 'Default' },
  { value: '#d0d0d0', label: 'Light Gray' },
  { value: '#a0a0a0', label: 'Gray' },
  { value: '#c6dafc', label: 'Light Blue' },
  { value: '#c6f0c6', label: 'Light Green' },
  { value: '#ffffff', label: 'None (White)' },
];

// =============================================================================
// Component
// =============================================================================

export function SheetSettingsDialog() {
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const isOpen = useUIStore((s) => s.sheetSettingsDialogOpen);
  const closeDialog = useUIStore((s) => s.closeSheetSettingsDialog);

  const ws = useMemo(() => wb.getSheetById(activeSheetId), [wb, activeSheetId]);

  // Get sheet name for display via Worksheet API.
  const [sheetName, setSheetName] = useState('Sheet');
  useEffect(() => {
    let cancelled = false;
    setSheetName(ws.name || 'Sheet');
    void Promise.resolve(ws.getName())
      .then((name) => {
        if (!cancelled) setSheetName(name || 'Sheet');
      })
      .catch(() => {
        if (!cancelled) setSheetName(ws.name || 'Sheet');
      });
    return () => {
      cancelled = true;
    };
  }, [ws]);

  // Get current settings from Worksheet API (async)
  const [settings, setSettings] = useState<SheetSettingsInfo>({
    defaultRowHeight: 20,
    defaultColWidth: 64,
    showGridlines: true,
    showRowHeaders: true,
    showColumnHeaders: true,
    showZeroValues: true,
    gridlineColor: '#e2e2e2',
    isProtected: false,
    rightToLeft: false,
  });

  // Get outline settings for grouping config
  const [outlineSettings, setOutlineSettings] = useState<OutlineSettings | null>(null);
  const settingsRef = useRef(settings);
  const outlineSettingsRef = useRef(outlineSettings);
  settingsRef.current = settings;
  outlineSettingsRef.current = outlineSettings;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void Promise.all([ws.settings.get(), ws.outline.getSettings()]).then(
      ([nextSettings, nextOutlineSettings]) => {
        if (cancelled) return;
        setSettings(nextSettings);
        setOutlineSettings(nextOutlineSettings);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ws, isOpen]);

  // Local state for number inputs (to avoid rerendering on every keystroke)
  const [rowHeight, setRowHeight] = useState(String(settings.defaultRowHeight));
  const [colWidth, setColWidth] = useState(String(settings.defaultColWidth));

  // Sync local number inputs when settings change
  useEffect(() => {
    setRowHeight(String(settings.defaultRowHeight));
    setColWidth(String(settings.defaultColWidth));
  }, [settings.defaultRowHeight, settings.defaultColWidth]);

  // Handle toggle for boolean settings
  const handleToggle = useCallback(
    (key: keyof SheetSettingsInfo) => {
      const currentValue = settingsRef.current[key];
      if (typeof currentValue === 'boolean') {
        void ws.settings.set(key, !currentValue);
        setSettings((prev) => ({ ...prev, [key]: !currentValue }));
      }
    },
    [ws],
  );

  // Handle toggle for outline settings
  type OutlineBooleanKey = keyof OutlineSettings;
  const handleGroupingToggle = useCallback(
    (key: OutlineBooleanKey) => {
      const defaults: OutlineSettings = {
        showOutlineSymbols: true,
        showOutlineLevelButtons: true,
        summaryRowsBelow: true,
        summaryColumnsRight: true,
      };
      const currentOutlineSettings = outlineSettingsRef.current;
      const currentValue = currentOutlineSettings ? currentOutlineSettings[key] : defaults[key];
      void ws.outline.setSettings({ [key]: !currentValue });
      setOutlineSettings((prev) => {
        if (!prev)
          return {
            ...defaults,
            [key]: !currentValue,
          };
        return { ...prev, [key]: !currentValue };
      });
    },
    [ws],
  );

  // Handle gridline color change
  const handleGridlineColorChange = useCallback(
    (value: string) => {
      void ws.settings.set('gridlineColor', value);
      setSettings((prev) => ({ ...prev, gridlineColor: value }));
    },
    [ws],
  );

  // Handle default row height change
  const handleRowHeightBlur = useCallback(() => {
    const value = parseInt(rowHeight, 10);
    if (!isNaN(value) && value >= 10 && value <= 500) {
      void ws.settings.set('defaultRowHeight', value);
    } else {
      // Reset to current value
      setRowHeight(String(settingsRef.current.defaultRowHeight));
    }
  }, [ws, rowHeight]);

  // Handle default column width change
  const handleColWidthBlur = useCallback(() => {
    const value = parseInt(colWidth, 10);
    if (!isNaN(value) && value >= 20 && value <= 500) {
      void ws.settings.set('defaultColWidth', value);
    } else {
      // Reset to current value
      setColWidth(String(settingsRef.current.defaultColWidth));
    }
  }, [ws, colWidth]);

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={closeDialog}
      open={isOpen}
      onClose={closeDialog}
      dialogId="sheet-settings-dialog"
      width={420}
    >
      <DialogHeader onClose={closeDialog}>
        Sheet Settings
        <span className="text-body-sm text-ss-text-secondary font-normal ml-2">({sheetName})</span>
      </DialogHeader>

      <DialogBody className="max-h-[60vh] overflow-y-auto">
        {/* Display Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Display
          </h3>

          <Checkbox
            checked={settings.showGridlines}
            onChange={() => handleToggle('showGridlines')}
            label="Show gridlines"
            className="mb-2"
          />

          <Checkbox
            checked={settings.showRowHeaders}
            onChange={() => handleToggle('showRowHeaders')}
            label="Show row headers (1, 2, 3...)"
            className="mb-2"
          />

          <Checkbox
            checked={settings.showColumnHeaders}
            onChange={() => handleToggle('showColumnHeaders')}
            label="Show column headers (A, B, C...)"
            className="mb-2"
          />

          <Checkbox
            checked={settings.showZeroValues}
            onChange={() => handleToggle('showZeroValues')}
            label="Show zero values"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-3">
            When unchecked, cells with value 0 display as blank
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="text-body-sm text-text min-w-[140px]">Gridline color</span>
            <Select
              options={GRIDLINE_COLOR_OPTIONS}
              value={settings.gridlineColor}
              onChange={handleGridlineColorChange}
              className="min-w-[120px]"
            />
            <span
              className="w-5 h-5 border border-ss-border rounded inline-block"
              style={{ backgroundColor: settings.gridlineColor }}
            />
          </div>
        </div>

        {/* Defaults Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Defaults
          </h3>

          <div className="flex items-center gap-3 py-1 mb-3">
            <span className="text-body-sm text-text min-w-[140px]">Default row height</span>
            <input
              type="number"
              value={rowHeight}
              onChange={(e) => setRowHeight(e.target.value)}
              onBlur={handleRowHeightBlur}
              min={10}
              max={500}
              className="w-20 px-2 py-1.5 border border-ss-border rounded text-body-sm text-right outline-none focus:border-ss-border-focus"
            />
            <span className="text-body-sm text-ss-text-secondary">pixels</span>
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="text-body-sm text-text min-w-[140px]">Default column width</span>
            <input
              type="number"
              value={colWidth}
              onChange={(e) => setColWidth(e.target.value)}
              onBlur={handleColWidthBlur}
              min={20}
              max={500}
              className="w-20 px-2 py-1.5 border border-ss-border rounded text-body-sm text-right outline-none focus:border-ss-border-focus"
            />
            <span className="text-body-sm text-ss-text-secondary">pixels</span>
          </div>
        </div>

        {/* Protection Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Protection
          </h3>

          <Checkbox
            checked={settings.isProtected}
            onChange={() => handleToggle('isProtected')}
            label="Protect sheet"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Prevent changes to locked cells when enabled
          </div>
        </div>

        {/* Layout Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Layout
          </h3>

          <Checkbox
            checked={settings.rightToLeft}
            onChange={() => handleToggle('rightToLeft')}
            label="Right-to-left layout"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Display columns from right to left (for RTL languages)
          </div>
        </div>

        {/* Outline Section (Grouping) */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Outline (Grouping)
          </h3>

          <Checkbox
            checked={outlineSettings?.showOutlineSymbols ?? true}
            onChange={() => handleGroupingToggle('showOutlineSymbols')}
            label="Show outline symbols (+/-)"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Show expand/collapse buttons for grouped rows and columns
          </div>

          <Checkbox
            checked={outlineSettings?.showOutlineLevelButtons ?? true}
            onChange={() => handleGroupingToggle('showOutlineLevelButtons')}
            label="Show level buttons (1, 2, 3...)"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Show level selector buttons in the outline gutter
          </div>

          <Checkbox
            checked={outlineSettings?.summaryRowsBelow ?? true}
            onChange={() => handleGroupingToggle('summaryRowsBelow')}
            label="Summary rows below detail"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Place summary/total rows below detail rows in groups
          </div>

          <Checkbox
            checked={outlineSettings?.summaryColumnsRight ?? true}
            onChange={() => handleGroupingToggle('summaryColumnsRight')}
            label="Summary columns right of detail"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-6 mb-2">
            Place summary/total columns to the right of detail columns in groups
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="primary" onClick={closeDialog}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
