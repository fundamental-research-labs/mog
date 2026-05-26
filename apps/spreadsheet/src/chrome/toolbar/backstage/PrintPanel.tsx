/**
 * PrintPanel Component
 *
 * File menu panel for print settings and preview.
 * Displays a sidebar with print options and a live preview of how the
 * spreadsheet will look when printed.
 *
 * Architecture:
 * - Uses Unified Action System via dispatch() for print setting updates
 * - Print preview is canvas-based (like main grid)
 * - Page navigation state is local React state (not UIStore)
 * - Settings sidebar uses usePrintSettings hook for reactive updates
 *
 */

import { useCallback } from 'react';

import { dispatch, useActionDependencies, useUIStore } from '../../../internal-api';

import { Button } from '@mog/shell';
import type { PageMargins, PrintSettings } from '@mog-sdk/contracts/core';
import { usePrintSettings } from '../../../hooks/file-io/use-sheet-print-settings';
import { useWorkbook } from '../../../infra/context';
import { PrintPreview } from './PrintPreview';

// =============================================================================
// Types
// =============================================================================

interface PrintSettingsSidebarProps {
  settings: PrintSettings;
  onSettingChange: <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => void;
  onPrint: () => void;
}

// =============================================================================
// PrintSettingsSidebar Component
// =============================================================================

function PrintSettingsSidebar({ settings, onSettingChange, onPrint }: PrintSettingsSidebarProps) {
  return (
    <div className="w-80 flex-shrink-0 bg-ss-surface border-r border-ss-border overflow-auto">
      <div className="p-6 space-y-6">
        {/* Print button */}
        <div>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            data-testid="file-menu-item-print-action"
            onClick={onPrint}
          >
            Print
          </Button>
        </div>

        {/* Copies */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Copies</h3>
          <input
            type="number"
            min={1}
            max={999}
            defaultValue={1}
            className="w-full px-3 py-2 border border-ss-border rounded text-body focus:outline-none focus:ring-2 focus:ring-ss-border-focus"
          />
        </div>

        {/* Paper size (OOXML numeric codes: 1=Letter, 5=Legal, 9=A4, 8=A3) */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Paper Size</h3>
          <select
            value={settings.paperSize ?? 1}
            onChange={(e) => onSettingChange('paperSize', parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 border border-ss-border rounded text-body focus:outline-none focus:ring-2 focus:ring-ss-border-focus"
          >
            <option value={1}>Letter (8.5" x 11")</option>
            <option value={5}>Legal (8.5" x 14")</option>
            <option value={9}>A4 (210mm x 297mm)</option>
            <option value={8}>A3 (297mm x 420mm)</option>
          </select>
        </div>

        {/* Orientation */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Orientation</h3>
          <div className="flex gap-2">
            <button
              onClick={() => onSettingChange('orientation', 'portrait')}
              className={`flex-1 px-3 py-2 border rounded text-body ${
                (settings.orientation ?? 'portrait') === 'portrait'
                  ? 'border-ss-border-focus bg-ss-primary-light text-ss-primary'
                  : 'border-ss-border text-ss-text-secondary hover:bg-ss-surface-secondary'
              }`}
            >
              Portrait
            </button>
            <button
              onClick={() => onSettingChange('orientation', 'landscape')}
              className={`flex-1 px-3 py-2 border rounded text-body ${
                settings.orientation === 'landscape'
                  ? 'border-ss-border-focus bg-ss-primary-light text-ss-primary'
                  : 'border-ss-border text-ss-text-secondary hover:bg-ss-surface-secondary'
              }`}
            >
              Landscape
            </button>
          </div>
        </div>

        {/* Scaling */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Scaling</h3>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={400}
              value={settings.scale ?? 100}
              onChange={(e) => onSettingChange('scale', parseInt(e.target.value, 10))}
              className="flex-1"
            />
            <span className="text-body text-ss-text-secondary w-12 text-right">
              {settings.scale ?? 100}%
            </span>
          </div>
        </div>

        {/* Margins */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Margins</h3>
          <div className="grid grid-cols-2 gap-2 text-body">
            <div>
              <label className="text-ss-text-tertiary block mb-1">Top</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={5}
                value={settings.margins?.top ?? 0.75}
                onChange={(e) =>
                  onSettingChange('margins', {
                    top: parseFloat(e.target.value) || 0,
                    bottom: settings.margins?.bottom ?? 0.75,
                    left: settings.margins?.left ?? 0.7,
                    right: settings.margins?.right ?? 0.7,
                    header: settings.margins?.header ?? 0.3,
                    footer: settings.margins?.footer ?? 0.3,
                  })
                }
                className="w-full px-2 py-1 border border-ss-border rounded focus:outline-none focus:ring-1 focus:ring-ss-border-focus"
              />
            </div>
            <div>
              <label className="text-ss-text-tertiary block mb-1">Bottom</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={5}
                value={settings.margins?.bottom ?? 0.75}
                onChange={(e) =>
                  onSettingChange('margins', {
                    top: settings.margins?.top ?? 0.75,
                    bottom: parseFloat(e.target.value) || 0,
                    left: settings.margins?.left ?? 0.7,
                    right: settings.margins?.right ?? 0.7,
                    header: settings.margins?.header ?? 0.3,
                    footer: settings.margins?.footer ?? 0.3,
                  })
                }
                className="w-full px-2 py-1 border border-ss-border rounded focus:outline-none focus:ring-1 focus:ring-ss-border-focus"
              />
            </div>
            <div>
              <label className="text-ss-text-tertiary block mb-1">Left</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={5}
                value={settings.margins?.left ?? 0.7}
                onChange={(e) =>
                  onSettingChange('margins', {
                    top: settings.margins?.top ?? 0.75,
                    bottom: settings.margins?.bottom ?? 0.75,
                    left: parseFloat(e.target.value) || 0,
                    right: settings.margins?.right ?? 0.7,
                    header: settings.margins?.header ?? 0.3,
                    footer: settings.margins?.footer ?? 0.3,
                  })
                }
                className="w-full px-2 py-1 border border-ss-border rounded focus:outline-none focus:ring-1 focus:ring-ss-border-focus"
              />
            </div>
            <div>
              <label className="text-ss-text-tertiary block mb-1">Right</label>
              <input
                type="number"
                step={0.1}
                min={0}
                max={5}
                value={settings.margins?.right ?? 0.7}
                onChange={(e) =>
                  onSettingChange('margins', {
                    top: settings.margins?.top ?? 0.75,
                    bottom: settings.margins?.bottom ?? 0.75,
                    left: settings.margins?.left ?? 0.7,
                    right: parseFloat(e.target.value) || 0,
                    header: settings.margins?.header ?? 0.3,
                    footer: settings.margins?.footer ?? 0.3,
                  })
                }
                className="w-full px-2 py-1 border border-ss-border rounded focus:outline-none focus:ring-1 focus:ring-ss-border-focus"
              />
            </div>
          </div>
        </div>

        {/* Centering */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Center on Page</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={settings.hCentered}
                onChange={(e) => onSettingChange('hCentered', e.target.checked)}
                className="rounded border-ss-border text-ss-primary focus:ring-ss-border-focus"
              />
              Horizontally
            </label>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={settings.vCentered}
                onChange={(e) => onSettingChange('vCentered', e.target.checked)}
                className="rounded border-ss-border text-ss-primary focus:ring-ss-border-focus"
              />
              Vertically
            </label>
          </div>
        </div>

        {/* Print options */}
        <div>
          <h3 className="text-body font-medium text-ss-text-secondary mb-2">Print Options</h3>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={settings.gridlines}
                onChange={(e) => onSettingChange('gridlines', e.target.checked)}
                className="rounded border-ss-border text-ss-primary focus:ring-ss-border-focus"
              />
              Print gridlines
            </label>
            <label className="flex items-center gap-2 text-body">
              <input
                type="checkbox"
                checked={settings.headings}
                onChange={(e) => onSettingChange('headings', e.target.checked)}
                className="rounded border-ss-border text-ss-primary focus:ring-ss-border-focus"
              />
              Print row/column headings
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PrintPanel Component
// =============================================================================

export function PrintPanel() {
  const workbook = useWorkbook();
  const deps = useActionDependencies();
  const activeSheetId = useUIStore((s) => s.activeSheetId);

  // Get current print settings for the active sheet
  const { settings: printSettings } = usePrintSettings(activeSheetId ?? '');

  // Handle setting changes - dispatch to persist
  const handleSettingChange = useCallback(
    <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
      if (!activeSheetId) return;

      // Create updated settings
      const updatedSettings: PrintSettings = {
        ...printSettings,
        [key]: value,
      };

      // Dispatch action to persist the change
      dispatch('APPLY_PAGE_SETUP', deps, {
        sheetId: activeSheetId,
        settings: updatedSettings,
      });
    },
    [activeSheetId, printSettings, deps],
  );

  // Handle print action
  const handlePrint = useCallback(() => {
    const result = dispatch('QUICK_PRINT', deps);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      void result;
    }
  }, [deps]);

  // Handle page change from preview
  const handlePageChange = useCallback((_page: number, _totalPages: number) => {
    // Page info is tracked in preview component itself
    // Could be used for analytics or status updates
  }, []);

  // Handle zoom change from preview
  const handleZoomChange = useCallback((_zoom: number) => {
    // Zoom is tracked in preview component itself
    // Could be used for analytics or status updates
  }, []);

  // Handle margin change from preview (D4 integration)
  const handleMarginChange = useCallback(
    (margin: 'top' | 'right' | 'bottom' | 'left', value: number) => {
      if (!activeSheetId) return;

      // Update margins in print settings
      const DEFAULT_MARGINS: PageMargins = {
        top: 0.75,
        right: 0.7,
        bottom: 0.75,
        left: 0.7,
        header: 0.3,
        footer: 0.3,
      };
      const updatedSettings: PrintSettings = {
        ...printSettings,
        margins: {
          ...(printSettings.margins ?? DEFAULT_MARGINS),
          [margin]: value,
        },
      };

      // Dispatch action to persist the change
      dispatch('APPLY_PAGE_SETUP', deps, {
        sheetId: activeSheetId,
        settings: updatedSettings,
      });
    },
    [activeSheetId, printSettings, deps],
  );

  // No sheet selected
  if (!activeSheetId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-ss-surface-hover">
        <div className="text-ss-text-tertiary">No sheet selected</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Settings sidebar */}
      <PrintSettingsSidebar
        settings={printSettings}
        onSettingChange={handleSettingChange}
        onPrint={handlePrint}
      />

      {/* Preview area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <PrintPreview
          workbook={workbook}
          sheetId={activeSheetId}
          printSettings={printSettings}
          onPageChange={handlePageChange}
          onZoomChange={handleZoomChange}
          onMarginChange={handleMarginChange}
        />
      </div>
    </div>
  );
}
