/**
 * SpreadSettingsDialog
 *
 * Workbook-level settings dialog for configuring scrollbars, tab strip,
 * formula bar visibility, and other workbook-wide preferences.
 *
 * Settings & Toggles
 *
 * Architecture:
 * - Reads settings via useWorkbookSettings() (kernel mirror + EventBus updates)
 * - Writes settings via useWorkbookSettings setters
 * - Does NOT access coordinator/renderer directly (Store → EventBus pattern)
 *
 */

import { useCallback } from 'react';
import { useUIStore, useWorkbookSettings } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Select, Switch } from '@mog/shell';
import type {
  AutomaticConversionPolicy,
  EnterKeyDirection,
  WorkbookSettings,
} from '@mog-sdk/contracts/core';

// =============================================================================
// Constants
// =============================================================================

const ENTER_KEY_DIRECTION_OPTIONS = [
  { value: 'down', label: 'Down' },
  { value: 'right', label: 'Right' },
  { value: 'up', label: 'Up' },
  { value: 'left', label: 'Left' },
  { value: 'none', label: 'None (stay in cell)' },
] as const;

const AUTOMATIC_CONVERSION_GROUPS: Array<{
  title: string;
  items: Array<{ field: keyof AutomaticConversionPolicy; label: string }>;
}> = [
  {
    title: 'Dates and times',
    items: [
      { field: 'convertDateLikeText', label: 'Convert date-like text' },
      { field: 'convertTimeLikeText', label: 'Convert time-like text' },
    ],
  },
  {
    title: 'Risky numeric text',
    items: [
      { field: 'convertFractionLikeText', label: 'Convert fractions' },
      { field: 'convertScientificNotation', label: 'Convert scientific notation' },
      { field: 'convertLeadingZeroNumbers', label: 'Convert leading-zero numbers' },
      { field: 'convertLongDigitNumbers', label: 'Convert long digit numbers' },
    ],
  },
  {
    title: 'Symbols and suffixes',
    items: [
      { field: 'convertPercentSuffix', label: 'Convert percent suffixes' },
      { field: 'convertCurrencySymbol', label: 'Convert currency symbols' },
      { field: 'convertFormattedNumbers', label: 'Convert formatted numbers' },
    ],
  },
];

function isEnterKeyDirection(value: string): value is EnterKeyDirection {
  return ENTER_KEY_DIRECTION_OPTIONS.some((option) => option.value === value);
}

// =============================================================================
// Component
// =============================================================================

export function SpreadSettingsDialog() {
  const isOpen = useUIStore((s) => s.spreadSettingsDialogOpen);
  const closeDialog = useUIStore((s) => s.closeSpreadSettingsDialog);
  const {
    settings,
    setSetting,
    toggleSetting,
    setAutomaticConversionPolicyField,
    restoreAutomaticConversionDefaults,
  } = useWorkbookSettings();

  // Handle toggle for boolean settings (fire-and-forget write to compute core)
  const handleToggle = useCallback(
    (key: keyof WorkbookSettings) => {
      toggleSetting(key);
    },
    [toggleSetting],
  );

  // Handle enter key direction change (fire-and-forget write to compute core)
  const handleEnterKeyDirectionChange = useCallback(
    (value: string) => {
      if (isEnterKeyDirection(value)) {
        setSetting('enterKeyDirection', value);
      }
    },
    [setSetting],
  );

  if (!isOpen) return null;

  const policy = settings.automaticConversionPolicy;

  return (
    <Dialog
      onEnterKeyDown={closeDialog}
      open={isOpen}
      onClose={closeDialog}
      dialogId="spread-settings-dialog"
      width={520}
    >
      <DialogHeader onClose={closeDialog}>Workbook Settings</DialogHeader>

      <DialogBody className="max-h-[60vh] overflow-y-auto">
        {/* Display Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Display
          </h3>

          <Switch
            checked={settings.showHorizontalScrollbar}
            onChange={() => handleToggle('showHorizontalScrollbar')}
            label="Show horizontal scrollbar"
            className="mb-2"
          />

          <Switch
            checked={settings.showVerticalScrollbar}
            onChange={() => handleToggle('showVerticalScrollbar')}
            label="Show vertical scrollbar"
            className="mb-2"
          />

          <Switch
            checked={settings.showTabStrip}
            onChange={() => handleToggle('showTabStrip')}
            label="Show tab strip"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-11 mb-2">
            Toggle visibility of sheet tabs at the bottom
          </div>

          <Switch
            checked={settings.showFormulaBar}
            onChange={() => handleToggle('showFormulaBar')}
            label="Show formula bar"
            className="mb-2"
          />
        </div>

        {/* Behavior Section */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Behavior
          </h3>

          <Switch
            checked={settings.allowSheetReorder}
            onChange={() => handleToggle('allowSheetReorder')}
            label="Allow sheet reorder by dragging"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-11 mb-2">
            Enable drag-and-drop to reorder sheet tabs
          </div>

          <Switch
            checked={settings.autoFitOnDoubleClick}
            onChange={() => handleToggle('autoFitOnDoubleClick')}
            label="Auto-fit column width on double-click"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-11 mb-2">
            Double-click column border to fit content width
          </div>
        </div>

        {/* Editing Section - Issue 8: Settings Panel */}
        <div className="mb-5">
          <h3 className="m-0 mb-3 text-body-sm font-semibold text-text uppercase tracking-wide">
            Editing
          </h3>

          <Switch
            checked={settings.showCutCopyIndicator}
            onChange={() => handleToggle('showCutCopyIndicator')}
            label="Show cut/copy indicator"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-11 mb-2">
            Display marching ants around cut/copied cells
          </div>

          <Switch
            checked={settings.allowDragFill}
            onChange={() => handleToggle('allowDragFill')}
            label="Enable fill handle"
            className="mb-1"
          />
          <div className="text-caption text-ss-text-secondary ml-11 mb-2">
            Drag the fill handle to copy or extend values
          </div>

          <div className="mb-2">
            <label className="block text-body-sm text-text mb-1.5">
              After pressing Enter, move selection:
            </label>
            <Select
              options={[...ENTER_KEY_DIRECTION_OPTIONS]}
              value={settings.enterKeyDirection}
              onChange={handleEnterKeyDirectionChange}
              size="sm"
              className="w-48"
            />
          </div>
        </div>

        {/* Automatic Conversion Section */}
        <div className="mb-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 text-body-sm font-semibold text-text uppercase tracking-wide">
              Automatic conversion
            </h3>
            <Button variant="secondary" size="sm" onClick={restoreAutomaticConversionDefaults}>
              Restore defaults
            </Button>
          </div>
          <div className="text-caption text-ss-text-secondary mb-3">
            Changes affect future entries only.
          </div>

          {AUTOMATIC_CONVERSION_GROUPS.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="text-caption font-semibold text-text mb-2">{group.title}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {group.items.map((item) => (
                  <Switch
                    key={item.field}
                    checked={policy[item.field]}
                    onChange={() =>
                      setAutomaticConversionPolicyField(item.field, !policy[item.field])
                    }
                    label={item.label}
                    className="mb-2"
                  />
                ))}
              </div>
            </div>
          ))}
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
