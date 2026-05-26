/**
 * HighlightRuleDialogs
 *
 * Quick-access dialogs for highlight cell rules:
 * - Greater Than, Less Than, Between, Equal To
 * - Text Contains (contains, not contains, begins with, ends with)
 * - Duplicate Values (duplicates or unique)
 * - Date Occurring
 *
 * Highlight Cell Rules
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
  Input,
  Label,
  Select,
} from '@mog/shell';
import type { CFStyle, CFTextOperator, DatePeriod } from '@mog-sdk/contracts/conditional-format';
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

const STYLE_PRESETS: Record<HighlightStylePreset, CFStyle> = {
  lightRedFillDarkRedText: DEFAULT_HIGHLIGHT_STYLES.lightRedFillDarkRedText,
  yellowFillDarkYellowText: DEFAULT_HIGHLIGHT_STYLES.yellowFillDarkYellowText,
  greenFillDarkGreenText: DEFAULT_HIGHLIGHT_STYLES.greenFillDarkGreenText,
  lightRedFill: DEFAULT_HIGHLIGHT_STYLES.lightRedFill,
  redText: DEFAULT_HIGHLIGHT_STYLES.redText,
  redBorder: DEFAULT_HIGHLIGHT_STYLES.redBorder,
  custom: {},
};

const TEXT_OPERATOR_OPTIONS = [
  { value: 'contains', label: 'containing' },
  { value: 'notContains', label: 'not containing' },
  { value: 'beginsWith', label: 'beginning with' },
  { value: 'endsWith', label: 'ending with' },
];

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
  // Build border style if present ( Enhancement: Red Border preset)
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
  return STYLE_PRESETS[preset] ?? DEFAULT_HIGHLIGHT_STYLES.lightRedFillDarkRedText;
}

// =============================================================================
// Helper: Detect and parse cell references
// =============================================================================

/**
 * Detect if value is a cell reference (e.g., =A1, =$B$1)
 * Returns the formula string if it's a reference, or null otherwise
 */
function parseCellReference(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('=')) {
    // It's a formula/cell reference
    return trimmed.substring(1); // Remove the leading '='
  }
  return null;
}

/**
 * Parse value that can be either a number or a cell reference
 * Returns either a number or a formula string
 */
function parseNumericOrReference(value: string): number | string {
  const cellRef = parseCellReference(value);
  if (cellRef) {
    // Return as formula string for CFCellValueRule
    return cellRef;
  }
  // Parse as number
  const num = parseFloat(value);
  return isNaN(num) ? value : num;
}

// =============================================================================
// Greater Than Dialog
// =============================================================================

function GreaterThanDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    if (!value.trim()) return;

    // Parse as number or cell reference
    const parsedValue = parseNumericOrReference(value);
    if (typeof parsedValue === 'string') {
      // Cell reference - parsedValue is a formula string
      // We need to pass it to applyGreaterThan which expects number
      // Since the value1 in CFCellValueRule can be number | string, we cast
      const style = getStyleFromPreset(preset, customBg, customFont);
      cf.applyGreaterThan(parsedValue, style);
    } else {
      // Regular number
      const style = getStyleFromPreset(preset, customBg, customFont);
      cf.applyGreaterThan(parsedValue, style);
    }
    onClose();
  }, [value, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="greater-than-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Greater Than</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that are GREATER THAN:">
          <Input
            type="text"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder="Enter a value or cell reference (e.g., 100 or =A1)"
            autoFocus
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

        <StylePreview style={currentStyle} value={value || '100'} />
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
// Less Than Dialog
// =============================================================================

function LessThanDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  const [preset, setPreset] = useState<HighlightStylePreset>('yellowFillDarkYellowText');
  const [customBg, setCustomBg] = useState('#FFEB9C');
  const [customFont, setCustomFont] = useState('#9C6500');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    if (!value.trim()) return;

    // Parse as number or cell reference
    const parsedValue = parseNumericOrReference(value);
    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyLessThan(parsedValue, style);
    onClose();
  }, [value, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="less-than-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Less Than</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that are LESS THAN:">
          <Input
            type="text"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder="Enter a value or cell reference (e.g., 50 or =$B$1)"
            autoFocus
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

        <StylePreview style={currentStyle} value={value || '50'} />
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
// Between Dialog
// =============================================================================

function BetweenDialog({ onClose }: { onClose: () => void }) {
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [preset, setPreset] = useState<HighlightStylePreset>('greenFillDarkGreenText');
  const [customBg, setCustomBg] = useState('#C6EFCE');
  const [customFont, setCustomFont] = useState('#006100');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    if (!minValue.trim() || !maxValue.trim()) return;

    // Parse as numbers or cell references
    const min = parseNumericOrReference(minValue);
    const max = parseNumericOrReference(maxValue);

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyBetween(min, max, style);
    onClose();
  }, [minValue, maxValue, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="between-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Between</DialogHeader>

      <DialogBody>
        <Label className="mb-2">Format cells that are BETWEEN:</Label>
        <div className="flex gap-3 items-center mb-4">
          <div className="flex-1">
            <Input
              type="text"
              value={minValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMinValue(e.target.value)}
              placeholder="Min value or =A1"
              autoFocus
            />
          </div>
          <span className="text-ss-text-secondary">and</span>
          <div className="flex-1">
            <Input
              type="text"
              value={maxValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxValue(e.target.value)}
              placeholder="Max value or =B1"
            />
          </div>
        </div>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value="75" />
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
// Equal To Dialog
// =============================================================================

function EqualToDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    if (!value.trim()) return;

    // Check if it's a cell reference first (e.g., =A1, =$B$1)
    const cellRef = parseCellReference(value);
    if (cellRef) {
      // Cell reference - use as formula string
      const style = getStyleFromPreset(preset, customBg, customFont);
      cf.applyEqualTo(cellRef, style);
    } else {
      // Try to parse as number, otherwise use as string
      const numValue = parseFloat(value);
      const finalValue = isNaN(numValue) ? value : numValue;

      const style = getStyleFromPreset(preset, customBg, customFont);
      cf.applyEqualTo(finalValue, style);
    }
    onClose();
  }, [value, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="equal-to-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Equal To</DialogHeader>

      <DialogBody>
        <FormField label="Format cells that are EQUAL TO:">
          <Input
            type="text"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
            placeholder="Enter a value, text, or cell reference (e.g., 100 or =A1)"
            autoFocus
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

        <StylePreview style={currentStyle} value={value || 'Value'} />
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
// Text Contains Dialog
// =============================================================================

function TextContainsDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [operator, setOperator] = useState<CFTextOperator>('contains');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    if (!text.trim()) return;

    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyTextContains(text, operator, style);
    onClose();
  }, [text, operator, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="text-contains-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Text That Contains</DialogHeader>

      <DialogBody>
        <FormField label="Format cells with text">
          <Select
            options={TEXT_OPERATOR_OPTIONS}
            value={operator}
            onChange={(value) => setOperator(value as CFTextOperator)}
          />
        </FormField>

        <div className="mb-4">
          <Input
            type="text"
            value={text}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
            placeholder="Enter text"
            autoFocus
          />
        </div>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview style={currentStyle} value={text || 'Sample text'} />
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
// Duplicate Values Dialog
// =============================================================================

function DuplicateValuesDialog({ onClose }: { onClose: () => void }) {
  const [highlightUnique, setHighlightUnique] = useState(false);
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyDuplicates(highlightUnique, style);
    onClose();
  }, [highlightUnique, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="duplicate-values-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Duplicate Values</DialogHeader>

      <DialogBody>
        <div className="mb-4">
          <Label className="mb-2">Format cells containing:</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-body text-text">
              <input
                type="radio"
                name="duplicateType"
                checked={!highlightUnique}
                onChange={() => setHighlightUnique(false)}
              />
              Duplicate values
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-body text-text">
              <input
                type="radio"
                name="duplicateType"
                checked={highlightUnique}
                onChange={() => setHighlightUnique(true)}
              />
              Unique values
            </label>
          </div>
        </div>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview
          style={currentStyle}
          value={highlightUnique ? 'Unique value' : 'Duplicate value'}
        />
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
// Blanks Dialog
// =============================================================================

/**
 * Blanks Dialog — quick rule for "containsBlanks" CF rule type.
 *
 * Mirrors Excel's "Format only cells that contain > Blanks/No Blanks" path.
 * The user picks whether to highlight blank cells or non-blank cells, plus
 * a fill / text style preset.
 */
function BlanksDialog({ onClose }: { onClose: () => void }) {
  const [highlightNonBlanks, setHighlightNonBlanks] = useState(false);
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyBlanks(highlightNonBlanks, style);
    onClose();
  }, [highlightNonBlanks, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="blanks-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>Blanks</DialogHeader>

      <DialogBody>
        <div className="mb-4" data-testid="cf-blanks-dialog">
          <Label className="mb-2">Format cells containing:</Label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-body text-text">
              <input
                type="radio"
                name="blanksType"
                checked={!highlightNonBlanks}
                onChange={() => setHighlightNonBlanks(false)}
                data-testid="cf-blanks-radio-blanks"
              />
              Blanks
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-body text-text">
              <input
                type="radio"
                name="blanksType"
                checked={highlightNonBlanks}
                onChange={() => setHighlightNonBlanks(true)}
                data-testid="cf-blanks-radio-non-blanks"
              />
              No Blanks (non-empty cells)
            </label>
          </div>
        </div>

        <StylePresetPicker
          selectedPreset={preset}
          customBgColor={customBg}
          customFontColor={customFont}
          onPresetChange={setPreset}
          onCustomBgChange={setCustomBg}
          onCustomFontChange={setCustomFont}
        />

        <StylePreview
          style={currentStyle}
          value={highlightNonBlanks ? 'Non-blank value' : '(blank)'}
        />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} data-testid="cf-blanks-ok">
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Date Occurring Dialog
// =============================================================================

/**
 * Date period options for the Date Occurring dialog.
 * Labels match Excel's "A Date Occurring" submenu.
 */
const DATE_PERIOD_OPTIONS: Array<{ value: DatePeriod; label: string }> = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'last7Days', label: 'In the last 7 days' },
  { value: 'lastWeek', label: 'Last week' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'nextWeek', label: 'Next week' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'nextMonth', label: 'Next month' },
  { value: 'lastQuarter', label: 'Last quarter' },
  { value: 'thisQuarter', label: 'This quarter' },
  { value: 'nextQuarter', label: 'Next quarter' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'thisYear', label: 'This year' },
  { value: 'nextYear', label: 'Next year' },
];

function DateOccurringDialog({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<DatePeriod>('today');
  const [preset, setPreset] = useState<HighlightStylePreset>('lightRedFillDarkRedText');
  const [customBg, setCustomBg] = useState('#FFC7CE');
  const [customFont, setCustomFont] = useState('#9C0006');

  const cf = useConditionalFormatting();

  const handleApply = useCallback(() => {
    const style = getStyleFromPreset(preset, customBg, customFont);
    cf.applyDateOccurring(period, style);
    onClose();
  }, [period, preset, customBg, customFont, cf, onClose]);

  const currentStyle = getStyleFromPreset(preset, customBg, customFont);

  // Get display label for the selected period
  const selectedPeriodLabel =
    DATE_PERIOD_OPTIONS.find((opt) => opt.value === period)?.label ?? 'Today';

  return (
    <Dialog
      onEnterKeyDown={handleApply}
      open={true}
      onClose={onClose}
      dialogId="date-occurring-dialog"
      width={380}
    >
      <DialogHeader onClose={onClose}>A Date Occurring</DialogHeader>

      <DialogBody>
        <FormField label="Format cells with dates occurring:">
          <Select
            options={DATE_PERIOD_OPTIONS}
            value={period}
            onChange={(value) => setPeriod(value as DatePeriod)}
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

        <StylePreview style={currentStyle} value={selectedPeriodLabel} />
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
 * HighlightRuleDialogs
 *
 * Renders the appropriate quick rule dialog based on the current quickRuleDialog state.
 * Should be rendered once near the root of the application.
 */
export function HighlightRuleDialogs() {
  const quickRuleDialog = useQuickRuleDialog();
  const closeQuickRuleDialog = useUIStore((s) => s.closeQuickRuleDialog);

  // Only handle highlight rule types in this component
  // Top/Bottom rules are handled by TopBottomRuleDialogs
  const highlightTypes = [
    'greaterThan',
    'lessThan',
    'between',
    'equalTo',
    'textContains',
    'duplicates',
    'dateOccurring',
    'blanks',
  ];

  if (!quickRuleDialog || !highlightTypes.includes(quickRuleDialog)) {
    return null;
  }

  const handleClose = () => {
    closeQuickRuleDialog();
  };

  switch (quickRuleDialog) {
    case 'greaterThan':
      return <GreaterThanDialog onClose={handleClose} />;
    case 'lessThan':
      return <LessThanDialog onClose={handleClose} />;
    case 'between':
      return <BetweenDialog onClose={handleClose} />;
    case 'equalTo':
      return <EqualToDialog onClose={handleClose} />;
    case 'textContains':
      return <TextContainsDialog onClose={handleClose} />;
    case 'duplicates':
      return <DuplicateValuesDialog onClose={handleClose} />;
    case 'dateOccurring':
      return <DateOccurringDialog onClose={handleClose} />;
    case 'blanks':
      return <BlanksDialog onClose={handleClose} />;
    default:
      return null;
  }
}
