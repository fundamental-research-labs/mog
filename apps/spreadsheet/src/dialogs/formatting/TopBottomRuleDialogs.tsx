/**
 * TopBottomRuleDialogs
 *
 * Quick-access dialogs for top/bottom rules:
 * - Top N Items, Bottom N Items
 * - Top N Percent, Bottom N Percent
 * - Above Average, Below Average (handled as instant-apply in menu)
 *
 * Top/Bottom Rules
 */

import { useCallback, useState, type ChangeEvent } from 'react';
import { useQuickRuleDialog, useUIStore } from '../../internal-api';

import {
  Button,
  ColorInput,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  Label,
  Select,
} from '@mog/shell';
import type { CFStyle } from '@mog-sdk/contracts/conditional-format';
import {
  DEFAULT_HIGHLIGHT_STYLES,
  useConditionalFormatting,
} from '../../hooks/data/use-conditional-formatting';

// =============================================================================
// Types
// =============================================================================

type HighlightStylePreset =
  | 'lightRedFillDarkRedText'
  | 'yellowFillDarkYellowText'
  | 'greenFillDarkGreenText'
  | 'lightRedFill'
  | 'redText'
  | 'redBorder'
  | 'custom';

/**
 * Standard deviation options for above/below average rules.
 * Enhancement: Excel supports 1, 2, or 3 standard deviations from the mean.
 */
type StdDevOption = 'none' | '1' | '2' | '3';

// =============================================================================
// Style Preset Options
// =============================================================================

const STYLE_PRESET_OPTIONS = [
  { value: 'lightRedFillDarkRedText', label: 'Light Red Fill with Dark Red Text' },
  { value: 'yellowFillDarkYellowText', label: 'Yellow Fill with Dark Yellow Text' },
  { value: 'greenFillDarkGreenText', label: 'Green Fill with Dark Green Text' },
  { value: 'lightRedFill', label: 'Light Red Fill' },
  { value: 'redText', label: 'Red Text' },
  { value: 'redBorder', label: 'Red Border' },
  { value: 'custom', label: 'Custom Format...' },
];

/**
 * Standard deviation dropdown options.
 * Enhancement: Allow users to select 1, 2, or 3 standard deviations from the mean.
 */
const STD_DEV_OPTIONS: Array<{ value: StdDevOption; label: string }> = [
  { value: 'none', label: 'Average only' },
  { value: '1', label: '1 standard deviation' },
  { value: '2', label: '2 standard deviations' },
  { value: '3', label: '3 standard deviations' },
];

const STYLE_PRESETS: Record<HighlightStylePreset, CFStyle> = {
  lightRedFillDarkRedText: DEFAULT_HIGHLIGHT_STYLES.lightRedFillDarkRedText,
  yellowFillDarkYellowText: DEFAULT_HIGHLIGHT_STYLES.yellowFillDarkYellowText,
  greenFillDarkGreenText: DEFAULT_HIGHLIGHT_STYLES.greenFillDarkGreenText,
  lightRedFill: DEFAULT_HIGHLIGHT_STYLES.lightRedFill,
  redText: DEFAULT_HIGHLIGHT_STYLES.redText,
  redBorder: DEFAULT_HIGHLIGHT_STYLES.redBorder,
  custom: {},
};

// =============================================================================
// Style Preset Picker Component
// =============================================================================

interface StylePresetPickerProps {
  selectedPreset: HighlightStylePreset;
  customBgColor: string;
  customFontColor: string;
  onPresetChange: (preset: HighlightStylePreset) => void;
  onCustomBgChange: (color: string) => void;
  onCustomFontChange: (color: string) => void;
}

function StylePresetPicker({
  selectedPreset,
  customBgColor,
  customFontColor,
  onPresetChange,
  onCustomBgChange,
  onCustomFontChange,
}: StylePresetPickerProps) {
  return (
    <>
      <FormField label="with">
        <Select
          options={STYLE_PRESET_OPTIONS}
          value={selectedPreset}
          onChange={(value) => onPresetChange(value as HighlightStylePreset)}
          data-testid="cf-style-preset"
        />
      </FormField>

      {selectedPreset === 'custom' && (
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <Label className="mb-1">Fill Color</Label>
            <ColorInput
              value={customBgColor}
              onChange={(e) => onCustomBgChange(e.target.value)}
              data-testid="cf-style-fill-color"
            />
          </div>
          <div className="flex-1">
            <Label className="mb-1">Text Color</Label>
            <ColorInput
              value={customFontColor}
              onChange={(e) => onCustomFontChange(e.target.value)}
              data-testid="cf-style-font-color"
            />
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================================
// Preview Component
// =============================================================================

interface StylePreviewProps {
  style: CFStyle;
  value: string;
}

function StylePreview({ style, value }: StylePreviewProps) {
  // Build border style if present
  const borderStyle: React.CSSProperties = {};
  if (style.borderColor) {
    const borderWidth = style.borderStyle === 'thick' ? '2px' : '1px';
    const borderLine =
      style.borderStyle === 'dashed'
        ? 'dashed'
        : style.borderStyle === 'dotted'
          ? 'dotted'
          : 'solid';
    borderStyle.border = `${borderWidth} ${borderLine} ${style.borderColor}`;
  }

  return (
    <div className="mb-4 p-3 border border-ss-border rounded bg-ss-surface-secondary">
      <div className="text-hint text-ss-text-secondary mb-2">Preview</div>
      <div
        className="px-3 py-2 rounded text-body"
        style={{
          backgroundColor: style.backgroundColor ?? 'transparent',
          color: style.fontColor ?? '#202124',
          ...borderStyle,
        }}
      >
        {value || 'Sample Value'}
      </div>
    </div>
  );
}

// =============================================================================
// Helper: Get Style from Preset
// =============================================================================

function getStyleFromPreset(
  preset: HighlightStylePreset,
  customBgColor: string,
  customFontColor: string,
): CFStyle {
  if (preset === 'custom') {
    return {
      backgroundColor: customBgColor,
      fontColor: customFontColor,
    };
  }
  return STYLE_PRESETS[preset] ?? DEFAULT_HIGHLIGHT_STYLES.greenFillDarkGreenText;
}

// =============================================================================
// Top Items Dialog
// =============================================================================

function TopItemsDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState('10');
  const [preset, setPreset] = useState<HighlightStylePreset>('greenFillDarkGreenText');
  const [customBg, setCustomBg] = useState('#C6EFCE');
  const [customFont, setCustomFont] = useState('#006100');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const n = parseInt(count, 10);
    if (isNaN(n) || n <= 0) return;

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyTopN(n, style);
    onClose();
  }, [count, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="top-items-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Top 10 Items</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that rank in the TOP:">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-20 px-2 py-2 text-center text-body border border-ss-border rounded outline-none focus:border-ss-border-focus"
              value={count}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCount(e.target.value)}
              min="1"
              max="1000"
              autoFocus
            />
            <span className="text-ss-text-secondary text-body">items</span>
          </div>
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value="Top Value" />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Bottom Items Dialog
// =============================================================================

function BottomItemsDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState('10');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const n = parseInt(count, 10);
    if (isNaN(n) || n <= 0) return;

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyBottomN(n, style);
    onClose();
  }, [count, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="bottom-items-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Bottom 10 Items</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that rank in the BOTTOM:">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-20 px-2 py-2 text-center text-body border border-ss-border rounded outline-none focus:border-ss-border-focus"
              value={count}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCount(e.target.value)}
              min="1"
              max="1000"
              autoFocus
            />
            <span className="text-ss-text-secondary text-body">items</span>
          </div>
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value="Bottom Value" />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Top Percent Dialog
// =============================================================================

function TopPercentDialog({ onClose }: { onClose: () => void }) {
  const [percent, setPercent] = useState('10');
  const [preset, setPreset] = useState<HighlightStylePreset>('greenFillDarkGreenText');
  const [customBg, setCustomBg] = useState('#C6EFCE');
  const [customFont, setCustomFont] = useState('#006100');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const p = parseFloat(percent);
    if (isNaN(p) || p <= 0 || p > 100) return;

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyTopPercent(p, style);
    onClose();
  }, [percent, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="top-percent-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Top 10%</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that rank in the TOP:">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-20 px-2 py-2 text-center text-body border border-ss-border rounded outline-none focus:border-ss-border-focus"
              value={percent}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPercent(e.target.value)}
              min="0.1"
              max="100"
              step="0.1"
              autoFocus
            />
            <span className="text-ss-text-secondary text-body">%</span>
          </div>
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value="Top 10%" />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Bottom Percent Dialog
// =============================================================================

function BottomPercentDialog({ onClose }: { onClose: () => void }) {
  const [percent, setPercent] = useState('10');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const p = parseFloat(percent);
    if (isNaN(p) || p <= 0 || p > 100) return;

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyBottomPercent(p, style);
    onClose();
  }, [percent, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="bottom-percent-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Bottom 10%</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that rank in the BOTTOM:">
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-20 px-2 py-2 text-center text-body border border-ss-border rounded outline-none focus:border-ss-border-focus"
              value={percent}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPercent(e.target.value)}
              min="0.1"
              max="100"
              step="0.1"
              autoFocus
            />
            <span className="text-ss-text-secondary text-body">%</span>
          </div>
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value="Bottom 10%" />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Above Average Dialog ( Enhancement: Standard Deviation)
// =============================================================================

function AboveAverageDialog({ onClose }: { onClose: () => void }) {
  const [stdDev, setStdDev] = useState<StdDevOption>('none');
  const [preset, setPreset] = useState<HighlightStylePreset>('greenFillDarkGreenText');
  const [customBg, setCustomBg] = useState('#C6EFCE');
  const [customFont, setCustomFont] = useState('#006100');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const style = getStyleFromPreset(preset, customBg, customFont);
    const stdDevNum = stdDev === 'none' ? undefined : parseInt(stdDev, 10);
    cf.applyAboveAverage(style, stdDevNum);
    onClose();
  }, [stdDev, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  // Generate dynamic label based on stdDev selection
  const getPreviewLabel = () => {
    if (stdDev === 'none') return 'Above Average';
    return `${stdDev} Std Dev Above Average`;
  };

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="above-average-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Above Average</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that are above average:">
          <Select
            options={STD_DEV_OPTIONS}
            value={stdDev}
            onChange={(value) => setStdDev(value as StdDevOption)}
          />
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value={getPreviewLabel()} />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Below Average Dialog ( Enhancement: Standard Deviation)
// =============================================================================

function BelowAverageDialog({ onClose }: { onClose: () => void }) {
  const [stdDev, setStdDev] = useState<StdDevOption>('none');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const style = getStyleFromPreset(preset, customBg, customFont);
    const stdDevNum = stdDev === 'none' ? undefined : parseInt(stdDev, 10);
    cf.applyBelowAverage(style, stdDevNum);
    onClose();
  }, [stdDev, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  // Generate dynamic label based on stdDev selection
  const getPreviewLabel = () => {
    if (stdDev === 'none') return 'Below Average';
    return `${stdDev} Std Dev Below Average`;
  };

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="below-average-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Below Average</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that are below average:">
          <Select
            options={STD_DEV_OPTIONS}
            value={stdDev}
            onChange={(value) => setStdDev(value as StdDevOption)}
          />
        </FormField>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value={getPreviewLabel()} />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Main Router Component
// =============================================================================

/**
 * TopBottomRuleDialogs
 *
 * Renders the appropriate top/bottom rule dialog based on the current quickRuleDialog state.
 * Should be rendered once near the root of the application.
 *
 * Enhancement: Above Average and Below Average now have dialogs supporting
 * standard deviation options (1, 2, or 3 standard deviations from the mean).
 */
export function TopBottomRuleDialogs() {
  const quickRuleDialog = useQuickRuleDialog();
  const closeQuickRuleDialog = useUIStore((s) => s.closeQuickRuleDialog);

  // Only handle top/bottom rule types in this component
  const topBottomTypes = [
    'topItems',
    'bottomItems',
    'topPercent',
    'bottomPercent',
    'aboveAverage',
    'belowAverage',
  ];

  if (!quickRuleDialog || !topBottomTypes.includes(quickRuleDialog)) {
    return null;
  }

  const handleClose = () => {
    closeQuickRuleDialog();
  };

  switch (quickRuleDialog) {
    case 'topItems':
      return <TopItemsDialog onClose={handleClose} />;
    case 'bottomItems':
      return <BottomItemsDialog onClose={handleClose} />;
    case 'topPercent':
      return <TopPercentDialog onClose={handleClose} />;
    case 'bottomPercent':
      return <BottomPercentDialog onClose={handleClose} />;
    case 'aboveAverage':
      return <AboveAverageDialog onClose={handleClose} />;
    case 'belowAverage':
      return <BelowAverageDialog onClose={handleClose} />;
    default:
      return null;
  }
}
