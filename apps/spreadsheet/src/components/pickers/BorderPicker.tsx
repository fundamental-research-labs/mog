/**
 * BorderPicker Component
 *
 * Excel-like border picker with:
 * - Border presets (none, all, outside, etc.)
 * - Line pattern options (none/solid, dashed, dotted, double)
 * - Line width options (thin, medium, thick) - used for solid lines
 * - Line color integration
 * - Keyboard navigation
 *
 * Note: Conforms to contracts BorderStyle type where 'style' can be:
 * - Width values: 'thin' | 'medium' | 'thick' (for solid lines)
 * - Pattern values: 'dashed' | 'dotted' | 'double' (patterned lines)
 * - Special: 'none' (no border)
 */

import { useCallback, useState } from 'react';

import {
  BorderAllSvg,
  BorderBottomSvg,
  BorderHorizontalSvg,
  BorderLeftSvg,
  BorderNoneSvg,
  BorderOutsideSvg,
  BorderRightSvg,
  BorderThickOutsideSvg,
  BorderTopSvg,
  BorderVerticalSvg,
} from '@mog/icons';

import { isLightColor, SectionLabel, Select } from '@mog/shell/components/ui';
import { ColorPicker } from './ColorPicker';

// =============================================================================
// Types
// =============================================================================

export type BorderPreset =
  | 'none'
  | 'all'
  | 'outside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'horizontal'
  | 'vertical'
  | 'thick-outside';

// Re-export BorderSelection from internal-api to avoid duplicate types
import type { BorderSelection } from '../../internal-api';
import type { BorderPresetMode } from '@mog-sdk/contracts/core';
export type { BorderSelection };

/**
 * Map the picker's UI preset (10 entries) to the handler's
 * `BorderPresetMode` (4 entries) used by `APPLY_BORDERS`.
 *
 * - `'outside'` and `'thick-outside'` → `'outline'` (handler decomposes
 * into 4 edge ranges, producing the perimeter — not 4 sides on every
 * cell, which is what happens when the preset is dropped).
 * - `'none'` → `'none'` (handler clears every cell).
 * - All other picker presets → `null` (per-cell apply, position-independent).
 *
 * The picker has no entry mapping to handler `'inside'` today — that
 * Excel preset is exposed only by the Format Cells dialog, which writes
 * `pendingBorderPreset` directly. If a future "Inside Borders" toolbar
 * preset is added, it extends this table naturally.
 */
function pickerPresetToHandlerMode(preset: BorderPreset): BorderPresetMode {
  switch (preset) {
    case 'none':
      return 'none';
    case 'outside':
    case 'thick-outside':
      return 'outline';
    default:
      return null;
  }
}

// =============================================================================
// Constants
// =============================================================================

// All 13 Excel-compatible border styles
// Note: This replaces the previous pattern+width model with a single style value
import type { BorderStyleType } from '../../internal-api';

const LINE_STYLES: Array<{ value: BorderStyleType; label: string }> = [
  // Solid styles (vary by thickness)
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'thick', label: 'Thick' },
  { value: 'hair', label: 'Hair (Very Thin)' },
  // Patterned styles
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'mediumDashed', label: 'Medium Dashed' },
  { value: 'dashDot', label: 'Dash Dot' },
  { value: 'dashDotDot', label: 'Dash Dot Dot' },
  { value: 'mediumDashDot', label: 'Medium Dash Dot' },
  { value: 'mediumDashDotDot', label: 'Medium Dash Dot Dot' },
  { value: 'slantDashDot', label: 'Slant Dash Dot' },
  // Double line
  { value: 'double', label: 'Double' },
];

const DEFAULT_BORDER_COLOR = '#000000';

// Border style type (matches internal-api BorderSelection with all 13 styles)
type InternalBorderStyle = {
  width: number;
  style: BorderStyleType;
  color: string;
};

/**
 * Get the pixel width for a border style.
 * Maps style names to appropriate rendering widths.
 */
function getWidthForStyle(style: BorderStyleType): number {
  switch (style) {
    case 'none':
      return 0;
    case 'hair':
      return 1; // Very thin, rendered as 1px
    case 'thin':
    case 'dashed':
    case 'dotted':
    case 'dashDot':
    case 'dashDotDot':
      return 1;
    case 'medium':
    case 'mediumDashed':
    case 'mediumDashDot':
    case 'mediumDashDotDot':
    case 'slantDashDot':
      return 2;
    case 'thick':
    case 'double':
      return 3;
    default:
      return 1;
  }
}

// =============================================================================
// Preset Icons - wrapper functions for consistent sizing
// =============================================================================

const iconStyle = { width: 20, height: 20 };

function BorderNoneIcon() {
  return <BorderNoneSvg style={iconStyle} />;
}

function BorderAllIcon() {
  return <BorderAllSvg style={iconStyle} />;
}

function BorderOutsideIcon() {
  return <BorderOutsideSvg style={iconStyle} />;
}

function BorderTopIcon() {
  return <BorderTopSvg style={iconStyle} />;
}

function BorderBottomIcon() {
  return <BorderBottomSvg style={iconStyle} />;
}

function BorderLeftIcon() {
  return <BorderLeftSvg style={iconStyle} />;
}

function BorderRightIcon() {
  return <BorderRightSvg style={iconStyle} />;
}

function BorderHorizontalIcon() {
  return <BorderHorizontalSvg style={iconStyle} />;
}

function BorderVerticalIcon() {
  return <BorderVerticalSvg style={iconStyle} />;
}

function BorderThickOutsideIcon() {
  return <BorderThickOutsideSvg style={iconStyle} />;
}

// =============================================================================
// PresetButton Component
// =============================================================================

interface PresetButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  /** Preset key rendered as `data-value` for the chrome-symmetry harness. */
  preset: BorderPreset;
}

function PresetButton({ icon, title, onClick, preset }: PresetButtonProps) {
  return (
    <button
      type="button"
      data-value={preset}
      onClick={onClick}
      className="flex items-center justify-center w-9 h-9 border border-ss-border rounded bg-transparent cursor-pointer p-0 outline-none transition-colors duration-ss-fast hover:bg-ss-surface-hover hover:border-ss-primary"
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

// =============================================================================
// Component
// =============================================================================

export interface BorderPickerProps {
  /** Current border values */
  value?: BorderSelection;
  /**
   * Called when borders change. The `preset` is the picker preset mapped
   * to the handler's `BorderPresetMode` — callers must thread it through
   * to `APPLY_BORDERS` so compound presets like "Outside Borders" are
   * applied to the perimeter of multi-cell selections instead of
   * collapsing into per-cell apply (which paints all 4 sides on every
   * cell).
   */
  onChange: (borders: BorderSelection, preset: BorderPresetMode) => void;
  /** Called when the picker should close */
  onClose?: () => void;
  /** Called when a color is selected (for tracking recent colors) */
  onColorSelect?: (color: string) => void;
  /** Recent colors to display in color picker */
  recentColors?: string[];
}

export function BorderPicker({
  value: _value,
  onChange,
  onClose,
  onColorSelect,
  recentColors,
}: BorderPickerProps) {
  // Line style now includes all 13 Excel styles (width is derived from style)
  const [lineStyle, setLineStyle] = useState<BorderStyleType>('thin');
  const [lineColor, setLineColor] = useState<string>(DEFAULT_BORDER_COLOR);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // Build a border style object from current settings
  // Width is derived from the style type
  const buildBorderStyle = useCallback(
    (): InternalBorderStyle => ({
      width: getWidthForStyle(lineStyle),
      style: lineStyle,
      color: lineColor,
    }),
    [lineStyle, lineColor],
  );

  // Apply a preset
  const applyPreset = useCallback(
    (preset: BorderPreset) => {
      const border = buildBorderStyle();
      let selection: BorderSelection;

      switch (preset) {
        case 'none':
          selection = { top: null, right: null, bottom: null, left: null };
          break;
        case 'all':
          selection = { top: border, right: border, bottom: border, left: border };
          break;
        case 'outside':
          selection = { top: border, right: border, bottom: border, left: border };
          break;
        case 'top':
          selection = { top: border };
          break;
        case 'bottom':
          selection = { bottom: border };
          break;
        case 'left':
          selection = { left: border };
          break;
        case 'right':
          selection = { right: border };
          break;
        case 'horizontal':
          selection = { top: border, bottom: border };
          break;
        case 'vertical':
          selection = { left: border, right: border };
          break;
        case 'thick-outside':
          const thickBorder: InternalBorderStyle = { width: 3, style: 'thick', color: lineColor };
          selection = {
            top: thickBorder,
            right: thickBorder,
            bottom: thickBorder,
            left: thickBorder,
          };
          break;
        default:
          selection = {};
      }

      onChange(selection, pickerPresetToHandlerMode(preset));
      onClose?.();
    },
    [buildBorderStyle, onChange, onClose, lineColor],
  );

  // NOTE: Click-outside handling is now managed by the parent Popover/RibbonDropdownPanel.
  // This component is a pure content component and doesn't need its own dismiss logic.

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (colorPickerOpen) {
          setColorPickerOpen(false);
        } else {
          onClose?.();
        }
        e.preventDefault();
      }
    },
    [colorPickerOpen, onClose],
  );

  const presets: Array<{ preset: BorderPreset; icon: React.ReactNode; title: string }> = [
    { preset: 'none', icon: <BorderNoneIcon />, title: 'No Border' },
    { preset: 'all', icon: <BorderAllIcon />, title: 'All Borders' },
    { preset: 'outside', icon: <BorderOutsideIcon />, title: 'Outside Borders' },
    { preset: 'top', icon: <BorderTopIcon />, title: 'Top Border' },
    { preset: 'bottom', icon: <BorderBottomIcon />, title: 'Bottom Border' },
    { preset: 'left', icon: <BorderLeftIcon />, title: 'Left Border' },
    { preset: 'right', icon: <BorderRightIcon />, title: 'Right Border' },
    { preset: 'horizontal', icon: <BorderHorizontalIcon />, title: 'Top and Bottom Borders' },
    { preset: 'vertical', icon: <BorderVerticalIcon />, title: 'Left and Right Borders' },
    { preset: 'thick-outside', icon: <BorderThickOutsideIcon />, title: 'Thick Box Border' },
  ];

  return (
    <div
      className="w-[220px] p-2 bg-ss-surface rounded border border-ss-border shadow-ss-md"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Border picker"
    >
      {/* Presets */}
      <div className="mb-3">
        <SectionLabel>Border Presets</SectionLabel>
        <div className="grid grid-cols-5 gap-1">
          {presets.map(({ preset, icon, title }) => (
            <PresetButton
              key={preset}
              preset={preset}
              icon={icon}
              title={title}
              onClick={() => applyPreset(preset)}
            />
          ))}
        </div>
      </div>

      <div className="h-px bg-ss-surface-tertiary my-3" />

      {/* Line Style (all 13 Excel styles - width is derived from style) */}
      <div className="mb-2">
        <SectionLabel>Line Style</SectionLabel>
        <Select
          value={lineStyle}
          onChange={(value) => setLineStyle(value as BorderStyleType)}
          options={LINE_STYLES}
          className="w-full h-7"
          aria-label="Line style"
        />
      </div>

      {/* Line Color */}
      <div>
        <SectionLabel>Line Color</SectionLabel>
        <div className="relative">
          <button
            type="button"
            onClick={() => setColorPickerOpen(!colorPickerOpen)}
            className="flex items-center gap-1 h-7 px-2 border border-ss-border rounded bg-transparent cursor-pointer text-dropdown text-ss-text-secondary hover:bg-ss-surface-hover"
            aria-label="Line color"
            aria-expanded={colorPickerOpen}
          >
            {/* Decorative swatch — must be a non-interactive element. The
 previous <ColorSwatch /> rendered a <button>, which produced
 a `<button> cannot be a descendant of <button>` hydration
 error and broke the popover open path. The luminance-aware
 border (visible on light fills, transparent on dark fills)
 mirrors ColorSwatch so the swatch stays distinguishable from
 the surface for any line color. */}
            <span
              aria-hidden="true"
              className={`w-4 h-4 rounded-ss-sm border inline-block shrink-0 ${
                isLightColor(lineColor) ? 'border-ss-border' : 'border-transparent'
              }`}
              style={{ backgroundColor: lineColor }}
            />
            <span>{lineColor}</span>
          </button>
          {colorPickerOpen && (
            <div className="absolute top-full right-0 mt-1 z-ss-modal">
              <ColorPicker
                value={lineColor}
                onChange={(color) => {
                  if (color) {
                    setLineColor(color);
                    // Track border color selection for recent colors
                    onColorSelect?.(color);
                  }
                  setColorPickerOpen(false);
                }}
                onClose={() => setColorPickerOpen(false)}
                showNoColor={false}
                recentColors={recentColors}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
