/**
 * ColorPicker Component
 *
 * Excel-like color picker with:
 * - Theme-aware color palette (derives from active workbook theme)
 * - Computed tints using applyTint() for consistency
 * - Standard colors (fixed across all themes)
 * - Recent colors
 * - Custom hex input + native color picker
 * - RGB numeric input fields (0-255)
 * - HSL numeric input fields (H: 0-360, S: 0-100, L: 0-100)
 * - Toggle between HEX/RGB/HSL input modes
 * - Keyboard navigation
 * - Full accessibility support
 *
 * Architecture:
 * - Theme colors derive from ThemeDefinition.colors (single source of truth)
 * - Tints computed via applyTint() from contracts/src/theme.ts
 * - Falls back to Office theme colors when no theme provided
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { ThemeDefinition } from '@mog-sdk/contracts/theme';
import { applyTint } from '@mog/spreadsheet-utils/formatting/theme';
import { OFFICE_THEME } from '../../infra/styles/built-in-themes';
import { Button, ColorSwatch, Input, SectionLabel, Tabs } from '@mog/shell/components/ui';

// =============================================================================
// Color Conversion Utilities
// =============================================================================

/** RGB color components */
interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL color components */
interface HSL {
  h: number;
  s: number;
  l: number;
}

/**
 * Convert hex color to RGB components.
 * Supports both 3-char (#RGB) and 6-char (#RRGGBB) hex formats.
 */
function hexToRgb(hex: string): RGB {
  let cleanHex = hex.replace('#', '');

  // Expand shorthand form (e.g., "03F") to full form (e.g., "0033FF")
  if (cleanHex.length === 3) {
    cleanHex = cleanHex[0] + cleanHex[0] + cleanHex[1] + cleanHex[1] + cleanHex[2] + cleanHex[2];
  }

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(cleanHex);
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB components to hex color string.
 * Returns uppercase hex with # prefix (e.g., "#FF0000").
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const clamped = Math.max(0, Math.min(255, Math.round(n)));
    return clamped.toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Normalize a color for picker selection comparisons.
 * Returns uppercase six-digit hex with a leading #, or null for unsupported input.
 */
function normalizeHexColor(color: string | null | undefined): string | null {
  if (!color) return null;

  let hex = color.trim();
  if (!hex.startsWith('#')) {
    hex = `#${hex}`;
  }

  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toUpperCase() : null;
}

/**
 * Convert hex color to HSL components.
 * H: 0-360 (degrees), S: 0-100 (percent), L: 0-100 (percent)
 */
function hexToHsl(hex: string): HSL {
  const { r, g, b } = hexToRgb(hex);

  // Normalize RGB to 0-1 range
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rNorm:
        h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6;
        break;
      case gNorm:
        h = ((bNorm - rNorm) / d + 2) / 6;
        break;
      case bNorm:
        h = ((rNorm - gNorm) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL components to hex color string.
 * H: 0-360 (degrees), S: 0-100 (percent), L: 0-100 (percent)
 */
function hslToHex(h: number, s: number, l: number): string {
  // Normalize inputs
  const hNorm = ((h % 360) + 360) % 360; // Ensure positive
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const lNorm = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0,
    g = 0,
    b = 0;

  if (hNorm < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (hNorm < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (hNorm < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (hNorm < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (hNorm < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

// =============================================================================
// Theme Color Generation
// =============================================================================

/**
 * Excel tint values for the 5 shade/tint rows below theme colors.
 * Positive = lighter (toward white), Negative = darker (toward black)
 * These match Excel's OOXML tint values exactly.
 */
const EXCEL_TINT_VALUES = [0.8, 0.6, 0.4, -0.25, -0.5] as const;

/**
 * Generate theme colors row from a ThemeDefinition.
 * Order: light1, dark1, light2, dark2, accent1-6 (matches Excel)
 */
function getThemeColorsRow(theme: ThemeDefinition): string[] {
  return [
    theme.colors.light1,
    theme.colors.dark1,
    theme.colors.light2,
    theme.colors.dark2,
    theme.colors.accent1,
    theme.colors.accent2,
    theme.colors.accent3,
    theme.colors.accent4,
    theme.colors.accent5,
    theme.colors.accent6,
  ];
}

/**
 * Generate tint rows for theme colors using applyTint().
 * Returns 5 rows of 10 colors each.
 */
function getThemeTintRows(themeColors: string[]): string[][] {
  return EXCEL_TINT_VALUES.map((tint) => themeColors.map((color) => applyTint(color, tint)));
}

/** Standard colors (fixed - same across all Excel themes) */
const STANDARD_COLORS = [
  '#C00000', // Dark Red
  '#FF0000', // Red
  '#FFC000', // Orange
  '#FFFF00', // Yellow
  '#92D050', // Light Green
  '#00B050', // Green
  '#00B0F0', // Light Blue
  '#0070C0', // Blue
  '#002060', // Dark Blue
  '#7030A0', // Purple
];

// =============================================================================
// Color Input Mode
// =============================================================================

/** Available color input modes */
type ColorInputMode = 'hex' | 'rgb' | 'hsl';

/** Tab definitions for the color input mode selector */
const COLOR_INPUT_TABS = [
  { id: 'hex', label: 'HEX' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
] as const;

interface PickerSwatch {
  id: string;
  color: string;
}

// =============================================================================
// Component
// =============================================================================

export interface ColorPickerProps {
  /** Currently selected color */
  value?: string;
  /** Called when a color is selected */
  onChange: (color: string | null) => void;
  /** Called when the picker should close */
  onClose?: () => void;
  /** Show "No Color" option (for removing color) */
  showNoColor?: boolean;
  /** Label for no color option */
  noColorLabel?: string;
  /** Recent colors to show (stored externally) */
  recentColors?: string[];
  /**
   * Active workbook theme for deriving theme colors.
   * If not provided, defaults to Office theme.
   */
  theme?: ThemeDefinition;
}

export function ColorPicker({
  value,
  onChange,
  onClose,
  showNoColor = true,
  noColorLabel = 'No Color',
  recentColors = [],
  theme = OFFICE_THEME,
}: ColorPickerProps) {
  // Color input mode state
  const [inputMode, setInputMode] = useState<ColorInputMode>('hex');

  // Initialize color component states from current value
  const initialRgb = value ? hexToRgb(value) : { r: 0, g: 0, b: 0 };
  const initialHsl = value ? hexToHsl(value) : { h: 0, s: 0, l: 0 };

  const [hexInput, setHexInput] = useState(value?.replace('#', '') || '');
  const [rgbInput, setRgbInput] = useState<RGB>(initialRgb);
  const [hslInput, setHslInput] = useState<HSL>(initialHsl);

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const pickerRootRef = useRef<HTMLDivElement>(null);
  const nativeColorInputRef = useRef<HTMLInputElement>(null);

  // Live preview ref for screen reader announcements
  const liveRegionRef = useRef<HTMLDivElement>(null);

  // Derive theme colors from the provided theme (memoized for performance)
  const themeColors = useMemo(() => getThemeColorsRow(theme), [theme]);
  const themeTints = useMemo(() => getThemeTintRows(themeColors), [themeColors]);

  const paletteSwatches = useMemo<PickerSwatch[]>(
    () => [
      ...themeColors.map((color, i) => ({ id: `theme-${i}`, color })),
      ...themeTints.flatMap((row, rowIdx) =>
        row.map((color, colIdx) => ({ id: `tint-${rowIdx}-${colIdx}`, color })),
      ),
      ...STANDARD_COLORS.map((color, i) => ({ id: `standard-${i}`, color })),
    ],
    [themeColors, themeTints],
  );

  const recentSwatches = useMemo<PickerSwatch[]>(
    () => recentColors.slice(0, 10).map((color, i) => ({ id: `recent-${i}`, color })),
    [recentColors],
  );

  const selectedSwatchId = useMemo(() => {
    const selectedColor = normalizeHexColor(value);
    if (!selectedColor) return null;

    const selectedSwatch = [...paletteSwatches, ...recentSwatches].find(
      (swatch) => normalizeHexColor(swatch.color) === selectedColor,
    );
    return selectedSwatch?.id ?? null;
  }, [paletteSwatches, recentSwatches, value]);

  // Build flat array of all colors for keyboard navigation
  const allColors = useMemo(() => paletteSwatches.map((swatch) => swatch.color), [paletteSwatches]);

  const handleColorClick = useCallback(
    (color: string) => {
      onChange(color);
      onClose?.();
    },
    [onChange, onClose],
  );

  const handleNoColor = useCallback(() => {
    onChange(null);
    onClose?.();
  }, [onChange, onClose]);

  const handleHexSubmit = useCallback(() => {
    let hex = hexInput.trim();
    if (!hex.startsWith('#')) {
      hex = '#' + hex;
    }
    // Validate hex color
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(hex)) {
      // Normalize 3-char hex to 6-char
      if (hex.length === 4) {
        hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
      }
      onChange(hex.toUpperCase());
      onClose?.();
    }
  }, [hexInput, onChange, onClose]);

  /**
   * Handle RGB component change.
   * Updates RGB state and syncs hex/HSL inputs for live preview.
   */
  const handleRgbChange = useCallback(
    (component: keyof RGB, valueStr: string) => {
      // Parse and clamp value to 0-255
      const parsed = parseInt(valueStr, 10);
      const value = isNaN(parsed) ? 0 : Math.max(0, Math.min(255, parsed));

      const newRgb = { ...rgbInput, [component]: value };
      setRgbInput(newRgb);

      // Update hex and HSL to stay in sync
      const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
      setHexInput(newHex.replace('#', ''));
      setHslInput(hexToHsl(newHex));

      // Announce color change to screen readers
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `Color: RGB ${newRgb.r}, ${newRgb.g}, ${newRgb.b}`;
      }
    },
    [rgbInput],
  );

  /**
   * Handle HSL component change.
   * Updates HSL state and syncs hex/RGB inputs for live preview.
   */
  const handleHslChange = useCallback(
    (component: keyof HSL, valueStr: string) => {
      const parsed = parseInt(valueStr, 10);
      let value: number;

      // Clamp based on component (H: 0-360, S/L: 0-100)
      if (component === 'h') {
        value = isNaN(parsed) ? 0 : Math.max(0, Math.min(360, parsed));
      } else {
        value = isNaN(parsed) ? 0 : Math.max(0, Math.min(100, parsed));
      }

      const newHsl = { ...hslInput, [component]: value };
      setHslInput(newHsl);

      // Update hex and RGB to stay in sync
      const newHex = hslToHex(newHsl.h, newHsl.s, newHsl.l);
      setHexInput(newHex.replace('#', ''));
      setRgbInput(hexToRgb(newHex));

      // Announce color change to screen readers
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `Color: HSL ${newHsl.h} degrees, ${newHsl.s}% saturation, ${newHsl.l}% lightness`;
      }
    },
    [hslInput],
  );

  /**
   * Submit color from current input mode.
   */
  const handleColorSubmit = useCallback(() => {
    let hex: string;

    switch (inputMode) {
      case 'hex':
        handleHexSubmit();
        return;
      case 'rgb':
        hex = rgbToHex(rgbInput.r, rgbInput.g, rgbInput.b);
        break;
      case 'hsl':
        hex = hslToHex(hslInput.h, hslInput.s, hslInput.l);
        break;
    }

    onChange(hex);
    onClose?.();
  }, [inputMode, handleHexSubmit, rgbInput, hslInput, onChange, onClose]);

  const focusSwatch = useCallback((index: number) => {
    setFocusedIndex(index);
    window.requestAnimationFrame(() => {
      const swatches = pickerRootRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-testid="color-swatch"]',
      );
      swatches?.[index]?.focus();
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const cols = 10;
      const totalColors = allColors.length;

      if (focusedIndex === null) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
          focusSwatch(0);
          e.preventDefault();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowRight':
          focusSwatch((focusedIndex + 1) % totalColors);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          focusSwatch((focusedIndex - 1 + totalColors) % totalColors);
          e.preventDefault();
          break;
        case 'ArrowDown':
          focusSwatch(Math.min(focusedIndex + cols, totalColors - 1));
          e.preventDefault();
          break;
        case 'ArrowUp':
          focusSwatch(Math.max(focusedIndex - cols, 0));
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          handleColorClick(allColors[focusedIndex]);
          e.preventDefault();
          break;
        case 'Escape':
          onClose?.();
          e.preventDefault();
          break;
      }
    },
    [focusedIndex, allColors, focusSwatch, handleColorClick, onClose],
  );

  // NOTE: Click-outside handling is now managed by the parent Popover/RibbonDropdownPanel.
  // This component is a pure content component and doesn't need its own dismiss logic.

  // Handler for native color picker
  const handleMoreColors = useCallback(() => {
    nativeColorInputRef.current?.click();
  }, []);

  const handleNativeColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const color = e.target.value.toUpperCase();
      onChange(color);
      onClose?.();
    },
    [onChange, onClose],
  );

  let colorIndex = 0;

  return (
    <div
      ref={pickerRootRef}
      className="w-[196px] p-2 bg-ss-surface rounded-ss-md border border-ss-border shadow-ss-md"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Color picker"
    >
      {/* No Color Option */}
      {showNoColor && (
        <button
          type="button"
          data-testid="no-color"
          onClick={handleNoColor}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded bg-transparent cursor-pointer text-dropdown text-text mb-2 hover:bg-ss-surface-hover transition-colors duration-ss-fast"
        >
          {/* No color swatch with diagonal line */}
          <div className="w-5 h-5 border border-ss-border rounded bg-ss-surface relative overflow-hidden">
            <svg viewBox="0 0 20 20" className="absolute inset-0 w-full h-full" aria-hidden="true">
              <line x1="2" y1="18" x2="18" y2="2" stroke="var(--color-ss-error)" strokeWidth="2" />
            </svg>
          </div>
          <span>{noColorLabel}</span>
        </button>
      )}

      {/* Theme Colors */}
      <div className="mb-2">
        <SectionLabel>Theme Colors</SectionLabel>
        <div className="grid grid-cols-10 gap-0.5">
          {themeColors.map((color, i) => {
            const idx = colorIndex++;
            const swatchId = `theme-${i}`;
            return (
              <ColorSwatch
                key={`${swatchId}-${color}`}
                color={color}
                selected={selectedSwatchId === swatchId}
                focused={focusedIndex === idx}
                onClick={() => handleColorClick(color)}
                onFocus={() => setFocusedIndex(idx)}
                onMouseEnter={() => setFocusedIndex(idx)}
                tabIndex={
                  focusedIndex === null ? (idx === 0 ? 0 : -1) : focusedIndex === idx ? 0 : -1
                }
              />
            );
          })}
        </div>
      </div>

      {/* Theme Tints */}
      <div className="mb-2">
        {themeTints.map((row, rowIdx) => (
          <div key={rowIdx} className={`grid grid-cols-10 gap-0.5 ${rowIdx > 0 ? 'mt-0.5' : ''}`}>
            {row.map((color, colIdx) => {
              const idx = colorIndex++;
              const swatchId = `tint-${rowIdx}-${colIdx}`;
              return (
                <ColorSwatch
                  key={`${swatchId}-${color}`}
                  color={color}
                  selected={selectedSwatchId === swatchId}
                  focused={focusedIndex === idx}
                  onClick={() => handleColorClick(color)}
                  onFocus={() => setFocusedIndex(idx)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  tabIndex={
                    focusedIndex === null ? (idx === 0 ? 0 : -1) : focusedIndex === idx ? 0 : -1
                  }
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Standard Colors */}
      <div className="mb-2">
        <SectionLabel>Standard Colors</SectionLabel>
        <div className="grid grid-cols-10 gap-0.5">
          {STANDARD_COLORS.map((color, i) => {
            const idx = colorIndex++;
            const swatchId = `standard-${i}`;
            return (
              <ColorSwatch
                key={`${swatchId}-${color}`}
                color={color}
                selected={selectedSwatchId === swatchId}
                focused={focusedIndex === idx}
                onClick={() => handleColorClick(color)}
                onFocus={() => setFocusedIndex(idx)}
                onMouseEnter={() => setFocusedIndex(idx)}
                tabIndex={
                  focusedIndex === null ? (idx === 0 ? 0 : -1) : focusedIndex === idx ? 0 : -1
                }
              />
            );
          })}
        </div>
      </div>

      {/* Recent Colors */}
      {recentColors.length > 0 && (
        <div className="mb-2">
          <SectionLabel>Recent Colors</SectionLabel>
          <div className="flex gap-0.5 flex-wrap">
            {recentSwatches.map(({ id, color }) => (
              <ColorSwatch
                key={`${id}-${color}`}
                color={color}
                selected={selectedSwatchId === id}
                onClick={() => handleColorClick(color)}
              />
            ))}
          </div>
        </div>
      )}

      {/* More Colors Button - opens native color picker */}
      <button
        type="button"
        onClick={handleMoreColors}
        className="w-full px-2 py-1.5 text-dropdown text-ss-text-secondary hover:text-text hover:bg-ss-surface-hover rounded transition-colors duration-ss-fast text-left"
      >
        More Colors...
      </button>

      {/* Hidden native color input */}
      <input
        ref={nativeColorInputRef}
        type="color"
        value={value || '#000000'}
        onChange={handleNativeColorChange}
        className="sr-only"
        aria-label="Custom color picker"
      />

      {/* Custom Color Input with HEX/RGB/HSL modes */}
      <div className="mt-2 pt-2 border-t border-ss-border">
        {/* Color preview and mode tabs */}
        <div className="flex items-center gap-2 mb-2">
          {/* Live color preview swatch */}
          <div
            className="w-8 h-8 border border-ss-border rounded flex-shrink-0"
            style={{
              backgroundColor:
                inputMode === 'rgb'
                  ? rgbToHex(rgbInput.r, rgbInput.g, rgbInput.b)
                  : inputMode === 'hsl'
                    ? hslToHex(hslInput.h, hslInput.s, hslInput.l)
                    : hexInput
                      ? `#${hexInput.replace('#', '')}`
                      : '#000000',
            }}
            aria-hidden="true"
          />
          {/* Mode selector tabs */}
          <Tabs
            tabs={[...COLOR_INPUT_TABS]}
            activeTab={inputMode}
            onTabChange={(id) => setInputMode(id as ColorInputMode)}
            size="sm"
            className="flex-1"
          />
        </div>

        {/* HEX Input Mode */}
        {inputMode === 'hex' && (
          <div className="flex items-center gap-2" role="group" aria-label="Hex color input">
            <Input
              type="text"
              value={hexInput}
              onChange={(e) => {
                const val = e.target.value;
                setHexInput(val);
                // Sync RGB/HSL when hex changes (if valid)
                const cleanHex = val.replace('#', '');
                if (/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
                  const fullHex = `#${cleanHex}`;
                  setRgbInput(hexToRgb(fullHex));
                  setHslInput(hexToHsl(fullHex));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleHexSubmit();
                  e.stopPropagation();
                }
              }}
              placeholder="FF0000"
              className="flex-1 !px-2 !py-1 text-dropdown font-ss-mono"
              maxLength={7}
              aria-label="Hex color value"
              id="color-picker-hex-input"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleColorSubmit}
              aria-label="Apply hex color"
            >
              Apply
            </Button>
          </div>
        )}

        {/* RGB Input Mode */}
        {inputMode === 'rgb' && (
          <div className="flex items-center gap-2" role="group" aria-label="RGB color input">
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-r" className="text-caption text-ss-text-secondary w-4">
                R
              </label>
              <Input
                id="color-picker-r"
                type="number"
                min={0}
                max={255}
                value={rgbInput.r}
                onChange={(e) => handleRgbChange('r', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Red value (0-255)"
              />
            </div>
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-g" className="text-caption text-ss-text-secondary w-4">
                G
              </label>
              <Input
                id="color-picker-g"
                type="number"
                min={0}
                max={255}
                value={rgbInput.g}
                onChange={(e) => handleRgbChange('g', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Green value (0-255)"
              />
            </div>
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-b" className="text-caption text-ss-text-secondary w-4">
                B
              </label>
              <Input
                id="color-picker-b"
                type="number"
                min={0}
                max={255}
                value={rgbInput.b}
                onChange={(e) => handleRgbChange('b', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Blue value (0-255)"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleColorSubmit}
              aria-label="Apply RGB color"
            >
              Apply
            </Button>
          </div>
        )}

        {/* HSL Input Mode */}
        {inputMode === 'hsl' && (
          <div className="flex items-center gap-2" role="group" aria-label="HSL color input">
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-h" className="text-caption text-ss-text-secondary w-4">
                H
              </label>
              <Input
                id="color-picker-h"
                type="number"
                min={0}
                max={360}
                value={hslInput.h}
                onChange={(e) => handleHslChange('h', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Hue value (0-360 degrees)"
              />
            </div>
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-s" className="text-caption text-ss-text-secondary w-4">
                S
              </label>
              <Input
                id="color-picker-s"
                type="number"
                min={0}
                max={100}
                value={hslInput.s}
                onChange={(e) => handleHslChange('s', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Saturation value (0-100%)"
              />
            </div>
            <div className="flex items-center gap-1 flex-1">
              <label htmlFor="color-picker-l" className="text-caption text-ss-text-secondary w-4">
                L
              </label>
              <Input
                id="color-picker-l"
                type="number"
                min={0}
                max={100}
                value={hslInput.l}
                onChange={(e) => handleHslChange('l', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleColorSubmit();
                    e.stopPropagation();
                  }
                }}
                className="!px-1 !py-1 text-dropdown font-ss-mono text-center"
                aria-label="Lightness value (0-100%)"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleColorSubmit}
              aria-label="Apply HSL color"
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Screen reader live region for color change announcements */}
      <div
        ref={liveRegionRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    </div>
  );
}
