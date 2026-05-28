/**
 * Number Format Panel
 *
 * Excel-like number format selection panel with categories, options, and preview.
 * Follows the coordinator pattern - all state updates go through the store.
 *
 * @module components/dialogs/NumberFormatPanel
 */

import { Button, Checkbox, Input, Label, Listbox, Select } from '@mog/shell';
import type { ListboxItem } from '@mog/shell';
import type { NumberFormatType } from '@mog-sdk/contracts/core';
import type { FormatPreset } from '@mog/spreadsheet-utils/number-formats';
import {
  buildFormatCode,
  CURRENCY_SYMBOLS,
  DATE_FORMATS,
  detectFormatType,
  FRACTION_FORMATS,
  SPECIAL_FORMATS,
  TIME_FORMATS,
} from '@mog/spreadsheet-utils/number-formats';
import { useCallback, useEffect, useMemo, useState, type Ref } from 'react';
// =============================================================================
// TYPES
// =============================================================================

interface NumberFormatPanelProps {
  /** Standalone toolbar dropdown or embedded Format Cells content. */
  variant?: 'standalone' | 'embedded';
  /** Current format code */
  currentFormat?: string;
  /** Current format type */
  currentType?: NumberFormatType;
  /** Sample value for preview (from selected cell) */
  sampleValue?: number | string;
  /** Recently used format codes (for quick access) */
  recentFormats?: string[];
  /** Callback when format is applied */
  onApply: (formatCode: string, formatType: NumberFormatType) => void;
  /** Callback whenever the draft format changes without committing it. */
  onDraftChange?: (formatCode: string, formatType: NumberFormatType) => void;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Async format preview function using Rust compute bridge */
  formatPreviewFn?: (formatCode: string, value: number) => Promise<string>;
  /**
   * Optional ref to the category listbox container. Parent dialogs
   * forward this to `<Dialog initialFocusRef>` so opening the dialog
   * lands focus on the selected category instead of the close button.
   */
  categoryListboxRef?: Ref<HTMLDivElement | null>;
}

interface CategoryState {
  // Number options
  decimalPlaces: number;
  useThousandsSeparator: boolean;
  negativeFormat: 'minus' | 'parentheses' | 'minusRed' | 'parenthesesRed';
  // Currency options - use ISO code as identifier, not symbol (symbols aren't unique)
  currencyCode: string;
  // Date/Time options
  dateFormat: string;
  timeFormat: string;
  // Fraction options
  fractionType: string;
  customDenominator: number;
  // Special format options
  specialType: string;
  // Custom format
  customFormat: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CATEGORIES: { id: NumberFormatType; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'number', label: 'Number' },
  { id: 'currency', label: 'Currency' },
  { id: 'accounting', label: 'Accounting' },
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'percentage', label: 'Percentage' },
  { id: 'fraction', label: 'Fraction' },
  { id: 'scientific', label: 'Scientific' },
  { id: 'text', label: 'Text' },
  { id: 'special', label: 'Special' },
  { id: 'custom', label: 'Custom' },
];

const DEFAULT_STATE: CategoryState = {
  decimalPlaces: 2,
  useThousandsSeparator: true,
  negativeFormat: 'minus',
  currencyCode: 'USD', // ISO code, not symbol (symbols aren't unique: ¥ = JPY/CNY, kr = SEK/NOK/DKK)
  dateFormat: 'M/D/YYYY',
  timeFormat: 'h:mm AM/PM',
  fractionType: 'halves',
  customDenominator: 2,
  specialType: 'zipCode',
  customFormat: '',
};

function formatCodeForCategory(category: NumberFormatType, state: CategoryState): string {
  switch (category) {
    case 'general':
      return 'General';
    case 'number':
      return buildFormatCode({
        type: 'number',
        decimalPlaces: state.decimalPlaces,
        useThousandsSeparator: state.useThousandsSeparator,
        negativeFormat: state.negativeFormat,
      });
    case 'currency':
      return buildFormatCode({
        type: 'currency',
        decimalPlaces: state.decimalPlaces,
        currencySymbol: getCurrencySymbol(state.currencyCode),
        negativeFormat: state.negativeFormat,
      });
    case 'accounting':
      return buildFormatCode({
        type: 'accounting',
        decimalPlaces: state.decimalPlaces,
        currencySymbol: getCurrencySymbol(state.currencyCode),
      });
    case 'date':
      return state.dateFormat;
    case 'time':
      return state.timeFormat;
    case 'percentage':
      return buildFormatCode({
        type: 'percentage',
        decimalPlaces: state.decimalPlaces,
      });
    case 'fraction':
      return FRACTION_FORMATS[state.fractionType]?.code || '# ?/?';
    case 'scientific':
      return buildFormatCode({
        type: 'scientific',
        decimalPlaces: state.decimalPlaces,
      });
    case 'text':
      return '@';
    case 'special':
      return SPECIAL_FORMATS[state.specialType]?.code || '00000';
    case 'custom':
      return state.customFormat || 'General';
    default:
      return 'General';
  }
}

/** Look up currency symbol from ISO code */
function getCurrencySymbol(code: string): string {
  return (
    CURRENCY_SYMBOLS.find((c: { symbol: string; name: string; code: string }) => c.code === code)
      ?.symbol ?? '$'
  );
}

// State stores `dateFormat`/`timeFormat` as the format CODE (carry-over
// from the legacy click handler), but the listbox keys options by the
// stable preset KEY. These helpers resolve one to the other.
function dateFormatKey(code: string): string {
  return Object.entries(DATE_FORMATS).find(([, fmt]) => fmt.code === code)?.[0] ?? '';
}
function timeFormatKey(code: string): string {
  return Object.entries(TIME_FORMATS).find(([, fmt]) => fmt.code === code)?.[0] ?? '';
}

interface FormatPresetListboxProps {
  idPrefix: string;
  ariaLabel: string;
  entries: ReadonlyArray<[string, FormatPreset]>;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  /**
   * Which preset field to render on the left ('example' shows the
   * formatted sample; 'description' shows the human description for
   * presets where the example string is keyed off arithmetic shape).
   */
  primaryField?: 'example' | 'description';
}

function FormatPresetListbox({
  idPrefix,
  ariaLabel,
  entries,
  selectedKey,
  onSelectKey,
  primaryField = 'example',
}: FormatPresetListboxProps) {
  const items: ListboxItem<string>[] = entries.map(([key, fmt]) => ({
    key,
    label: (
      <span className="flex justify-between w-full">
        <span>{primaryField === 'example' ? fmt.example : fmt.description}</span>
        <span className="text-ss-text-disabled text-hint">
          {primaryField === 'example' ? fmt.code : fmt.example}
        </span>
      </span>
    ),
  }));

  return (
    <Listbox<string>
      idPrefix={idPrefix}
      aria-label={ariaLabel}
      items={items}
      selectedKey={selectedKey}
      onSelect={onSelectKey}
      className="max-h-[150px] overflow-y-auto border border-ss-border rounded flex flex-col"
      itemClassName={(_item, { isSelected }) =>
        `px-3 py-2 text-body-sm border-b border-ss-border-light text-left bg-transparent border-x-0 border-t-0 ${
          isSelected ? 'bg-ss-primary-light' : ''
        }`
      }
    />
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

export function NumberFormatPanel({
  variant = 'standalone',
  currentFormat,
  currentType,
  sampleValue = 1234.5,
  recentFormats = [],
  onApply,
  onDraftChange,
  onClose,
  formatPreviewFn,
  categoryListboxRef,
}: NumberFormatPanelProps) {
  const embedded = variant === 'embedded';
  // Determine initial category from current format
  const initialCategory =
    currentType || (currentFormat ? detectFormatType(currentFormat) : 'general');

  const [selectedCategory, setSelectedCategory] = useState<NumberFormatType>(initialCategory);
  const [state, setState] = useState<CategoryState>(() => ({
    ...DEFAULT_STATE,
    customFormat: currentFormat || '',
  }));

  // Build format code from current state
  const formatCode = useMemo(() => {
    return formatCodeForCategory(selectedCategory, state);
  }, [selectedCategory, state]);

  // Generate preview via async Rust compute bridge
  const [preview, setPreview] = useState('');

  useEffect(() => {
    const value = typeof sampleValue === 'number' ? sampleValue : 1234.5;
    if (!formatPreviewFn) {
      setPreview(String(value));
      return;
    }
    let cancelled = false;
    formatPreviewFn(formatCode, value).then((result) => {
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [formatCode, sampleValue, formatPreviewFn]);

  useEffect(() => {
    onDraftChange?.(formatCode, selectedCategory);
  }, [formatCode, onDraftChange, selectedCategory]);

  // Pre-compute formatted previews for recent formats
  const [customPreviews, setCustomPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!formatPreviewFn || !recentFormats?.length) return;
    let cancelled = false;
    const value = typeof sampleValue === 'number' ? sampleValue : 1234.5;
    Promise.all(recentFormats.map((f) => formatPreviewFn(f, value))).then((results) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      recentFormats.forEach((f, i) => {
        map[f] = results[i];
      });
      setCustomPreviews(map);
    });
    return () => {
      cancelled = true;
    };
  }, [recentFormats, sampleValue, formatPreviewFn]);

  // Handlers
  const emitDraft = useCallback(
    (category: NumberFormatType, nextState: CategoryState) => {
      onDraftChange?.(formatCodeForCategory(category, nextState), category);
    },
    [onDraftChange],
  );

  const handleCategoryChange = useCallback(
    (category: NumberFormatType) => {
      setSelectedCategory(category);
      emitDraft(category, state);
    },
    [emitDraft, state],
  );

  const handleApply = useCallback(() => {
    onApply(formatCode, selectedCategory);
    onClose();
  }, [formatCode, selectedCategory, onApply, onClose]);

  const updateState = useCallback(
    (updates: Partial<CategoryState>, category: NumberFormatType = selectedCategory) => {
      const next = { ...state, ...updates };
      setState(next);
      emitDraft(category, next);
    },
    [emitDraft, selectedCategory, state],
  );

  // Handler for selecting a recent format
  const handleRecentFormatClick = useCallback(
    (format: string) => {
      const type = detectFormatType(format);
      if (embedded) {
        setSelectedCategory(type);
        setState((prev) => ({ ...prev, customFormat: format }));
        onDraftChange?.(format, type);
      } else {
        onApply(format, type);
        onClose();
      }
    },
    [embedded, onApply, onClose, onDraftChange],
  );

  // Track hover state for recent format items
  const [hoveredFormat, setHoveredFormat] = useState<string | null>(null);

  // Render category-specific options
  const renderOptions = () => {
    switch (selectedCategory) {
      case 'general':
        return (
          <div className="text-ss-text-secondary text-body-sm">
            General format cells have no specific number format.
          </div>
        );

      case 'number':
        return (
          <>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Decimal places:</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={state.decimalPlaces}
                onChange={(e) =>
                  updateState({
                    decimalPlaces: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)),
                  })
                }
                className="w-20 h-8 px-2 py-0"
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Use 1000 separator:</Label>
              <Checkbox
                checked={state.useThousandsSeparator}
                onChange={(checked) => updateState({ useThousandsSeparator: checked })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Negative numbers:</Label>
              <Select
                value={state.negativeFormat}
                onChange={(value) =>
                  updateState({ negativeFormat: value as CategoryState['negativeFormat'] })
                }
                size="sm"
                className="flex-1 max-w-[180px]"
                options={[
                  { value: 'minus', label: '-1234.10' },
                  { value: 'minusRed', label: '-1234.10 (Red)' },
                  { value: 'parentheses', label: '(1234.10)' },
                  { value: 'parenthesesRed', label: '(1234.10) (Red)' },
                ]}
              />
            </div>
          </>
        );

      case 'currency':
        return (
          <>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Symbol:</Label>
              <Select
                value={state.currencyCode}
                onChange={(value) => updateState({ currencyCode: value })}
                size="sm"
                className="flex-1 max-w-[180px]"
                options={CURRENCY_SYMBOLS.map(
                  (sym: { symbol: string; name: string; code: string }) => ({
                    value: sym.code, // Use ISO code as unique key (symbols aren't unique)
                    label: `${sym.symbol} - ${sym.name}`,
                  }),
                )}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Decimal places:</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={state.decimalPlaces}
                onChange={(e) =>
                  updateState({
                    decimalPlaces: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)),
                  })
                }
                className="w-20 h-8 px-2 py-0"
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Negative numbers:</Label>
              <Select
                value={state.negativeFormat}
                onChange={(value) =>
                  updateState({ negativeFormat: value as CategoryState['negativeFormat'] })
                }
                size="sm"
                className="flex-1 max-w-[180px]"
                options={[
                  { value: 'minus', label: '-$1,234.10' },
                  { value: 'minusRed', label: '-$1,234.10 (Red)' },
                  { value: 'parentheses', label: '($1,234.10)' },
                  { value: 'parenthesesRed', label: '($1,234.10) (Red)' },
                ]}
              />
            </div>
          </>
        );

      case 'accounting':
        return (
          <>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Symbol:</Label>
              <Select
                value={state.currencyCode}
                onChange={(value) => updateState({ currencyCode: value })}
                size="sm"
                className="flex-1 max-w-[180px]"
                options={CURRENCY_SYMBOLS.map(
                  (sym: { symbol: string; name: string; code: string }) => ({
                    value: sym.code, // Use ISO code as unique key (symbols aren't unique)
                    label: `${sym.symbol} - ${sym.name}`,
                  }),
                )}
              />
            </div>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Decimal places:</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={state.decimalPlaces}
                onChange={(e) =>
                  updateState({
                    decimalPlaces: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)),
                  })
                }
                className="w-20 h-8 px-2 py-0"
              />
            </div>
            <div className="text-ss-text-secondary text-caption mt-2">
              Accounting format aligns currency symbols and decimal points in a column.
            </div>
          </>
        );

      case 'date':
        return (
          <FormatPresetListbox
            idPrefix="number-format-date"
            ariaLabel="Date formats"
            entries={Object.entries(DATE_FORMATS)}
            selectedKey={dateFormatKey(state.dateFormat)}
            onSelectKey={(key) => {
              const code = DATE_FORMATS[key]?.code;
              if (code) updateState({ dateFormat: code });
            }}
          />
        );

      case 'time':
        return (
          <FormatPresetListbox
            idPrefix="number-format-time"
            ariaLabel="Time formats"
            entries={Object.entries(TIME_FORMATS)}
            selectedKey={timeFormatKey(state.timeFormat)}
            onSelectKey={(key) => {
              const code = TIME_FORMATS[key]?.code;
              if (code) updateState({ timeFormat: code });
            }}
          />
        );

      case 'percentage':
        return (
          <div className="flex items-center gap-3">
            <Label className="min-w-[120px] mb-0">Decimal places:</Label>
            <Input
              type="number"
              min={0}
              max={30}
              value={state.decimalPlaces}
              onChange={(e) =>
                updateState({
                  decimalPlaces: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)),
                })
              }
              className="w-20 h-8 px-2 py-0"
            />
          </div>
        );

      case 'fraction':
        return (
          <FormatPresetListbox
            idPrefix="number-format-fraction"
            ariaLabel="Fraction formats"
            entries={Object.entries(FRACTION_FORMATS)}
            selectedKey={state.fractionType}
            onSelectKey={(key) => updateState({ fractionType: key })}
            primaryField="description"
          />
        );

      case 'scientific':
        return (
          <div className="flex items-center gap-3">
            <Label className="min-w-[120px] mb-0">Decimal places:</Label>
            <Input
              type="number"
              min={0}
              max={30}
              value={state.decimalPlaces}
              onChange={(e) =>
                updateState({
                  decimalPlaces: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)),
                })
              }
              className="w-20 h-8 px-2 py-0"
            />
          </div>
        );

      case 'text':
        return (
          <div className="text-ss-text-secondary text-body-sm">
            Text format treats the cell value as text and displays it exactly as entered.
          </div>
        );

      case 'special':
        return (
          <FormatPresetListbox
            idPrefix="number-format-special"
            ariaLabel="Special formats"
            entries={Object.entries(SPECIAL_FORMATS)}
            selectedKey={state.specialType}
            onSelectKey={(key) => updateState({ specialType: key })}
            primaryField="description"
          />
        );

      case 'custom':
        return (
          <>
            <div className="flex items-center gap-3">
              <Label className="min-w-[120px] mb-0">Format code:</Label>
              <Input
                type="text"
                value={state.customFormat}
                onChange={(e) => updateState({ customFormat: e.target.value })}
                placeholder="Enter format code"
                className="flex-1 h-8 px-2 py-0"
              />
            </div>
            <div className="text-ss-text-secondary text-caption">
              Enter an Excel-compatible format code (e.g., #,##0.00 or $#,##0.00;[Red]-$#,##0.00)
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={
        embedded
          ? 'flex flex-col w-full bg-ss-surface overflow-hidden'
          : 'flex flex-col w-[420px] bg-ss-surface rounded-ss-lg shadow-ss-lg overflow-hidden'
      }
    >
      {/* Header */}
      {!embedded && (
        <div className="flex justify-between items-center p-3 border-b border-ss-border bg-ss-surface-secondary">
          <span className="text-body-sm font-semibold text-text-ss-primary">Number Format</span>
          <button
            className="border-none bg-transparent text-body-lg cursor-pointer text-ss-text-secondary hover:text-text-ss-primary p-1 leading-none"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-[300px]">
        {/* Category List */}
        <Listbox<NumberFormatType>
          containerRef={categoryListboxRef}
          idPrefix="number-format-category"
          aria-label="Number format categories"
          autoFocus
          items={CATEGORIES.map((cat) => ({ key: cat.id, label: cat.label }))}
          selectedKey={selectedCategory}
          onSelect={handleCategoryChange}
          className="w-[120px] border-r border-ss-border bg-ss-surface-secondary py-2 overflow-y-auto flex flex-col"
          itemClassName={(_item, { isSelected }) =>
            `px-4 py-2 text-caption border-none bg-transparent w-full text-left transition-colors ${
              isSelected
                ? 'bg-ss-primary-light text-ss-primary font-medium'
                : 'text-ss-text-secondary hover:bg-ss-surface-secondary'
            }`
          }
        />

        {/* Options Area */}
        <div className="flex-1 p-4 flex flex-col gap-4">
          {/* Recent Formats (if any) */}
          {recentFormats.length > 0 && (
            <div className="mb-3 py-2 border-b border-ss-border">
              <div className="text-hint text-ss-text-disabled mb-1.5 uppercase tracking-wide">
                Recent
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentFormats.slice(0, 6).map((format) => (
                  <button
                    key={format}
                    className={`px-2 py-1 text-caption font-ss-mono border rounded cursor-pointer transition-all ${
                      hoveredFormat === format
                        ? 'bg-ss-primary-light border-ss-primary text-ss-primary'
                        : 'bg-ss-surface-secondary border-ss-border text-ss-text-secondary'
                    }`}
                    onClick={() => handleRecentFormatClick(format)}
                    onMouseEnter={() => setHoveredFormat(format)}
                    onMouseLeave={() => setHoveredFormat(null)}
                    title={`Apply format: ${format}`}
                  >
                    {customPreviews[format] ?? format}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="p-3 bg-ss-surface-secondary rounded text-center">
            <div className="text-hint text-ss-text-secondary mb-1">Sample</div>
            <div className="text-body font-medium text-text-ss-primary font-ss-mono">{preview}</div>
          </div>

          {/* Category-specific options */}
          {renderOptions()}

          {/* Format code display */}
          <div className="px-3 py-2 bg-ss-surface-secondary border border-ss-border rounded text-caption font-ss-mono text-ss-text-secondary">
            Format code: {formatCode}
          </div>
        </div>
      </div>

      {/* Footer */}
      {!embedded && (
        <div className="flex justify-end gap-2 p-3 border-t border-ss-border bg-ss-surface-secondary">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
