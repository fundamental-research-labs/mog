/**
 * TabColorPicker Component
 *
 * A color picker for sheet tab colors.
 * Shows standard Excel-like colors with a "No Color" option.
 *
 * NOTE: This is a pure content component. When used with Popover or
 * RibbonDropdownPanel, positioning and dismiss logic are handled by the parent.
 *
 * Tab Strip Enhancement
 */

import { useCallback } from 'react';

import { ColorSwatch, SectionLabel } from '@mog/shell';

// =============================================================================
// Constants
// =============================================================================

/**
 * Standard tab colors (Excel-compatible palette).
 */
export const STANDARD_TAB_COLORS = [
  // Row 1: Basic colors
  '#c00000',
  '#ff0000',
  '#ffc000',
  '#ffff00',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  // Row 2: More colors
  '#002060',
  '#7030a0',
  '#000000',
  '#808080',
];

/**
 * Extended palette for more options.
 */
export const EXTENDED_TAB_COLORS = [
  // Row 3: Pastels
  '#f4cccc',
  '#fce5cd',
  '#fff2cc',
  '#d9ead3',
  '#d0e0e3',
  '#c9daf8',
  '#d9d2e9',
  '#ead1dc',
];

// =============================================================================
// Types
// =============================================================================

export interface TabColorPickerProps {
  /** Currently selected color (null = no color) */
  currentColor?: string | null;
  /** Callback when color is selected */
  onColorSelect: (color: string | null) => void;
  /** Callback to close the picker */
  onClose: () => void;
  /** Callback to open More Colors dialog (optional) */
  onMoreColors?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function TabColorPicker({
  currentColor,
  onColorSelect,
  onClose,
  onMoreColors,
}: TabColorPickerProps) {
  const handleColorClick = useCallback(
    (color: string | null) => {
      onColorSelect(color);
      onClose();
    },
    [onColorSelect, onClose],
  );

  const isSelected = (color: string | null) => {
    if (color === null && !currentColor) return true;
    return color === currentColor;
  };

  return (
    <div
      className="p-2 bg-ss-surface border border-ss-border rounded shadow-ss-md min-w-[180px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* No Color Option */}
      <button
        type="button"
        onClick={() => handleColorClick(null)}
        className={`
 flex items-center w-full px-2 py-1.5 border-none rounded text-body-sm text-text text-left cursor-pointer mb-2
 ${isSelected(null) ? 'bg-ss-primary-light' : 'bg-transparent hover:bg-ss-surface-hover'}
 `}
        aria-label="No color"
        data-testid="tab-color-no-color"
      >
        <span className="w-4 h-4 border border-ss-border rounded-ss-sm mr-2 flex items-center justify-center text-hint text-ss-text-tertiary">
          -
        </span>
        No Color
      </button>

      <div className="h-px bg-ss-border-light my-2" />

      {/* Standard Colors */}
      <SectionLabel>Standard Colors</SectionLabel>
      <div className="grid grid-cols-4 gap-1 mb-2">
        {STANDARD_TAB_COLORS.map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            size="lg"
            selected={isSelected(color)}
            onClick={() => handleColorClick(color)}
            data-testid={`color-swatch-${color}`}
            data-color={color}
          />
        ))}
      </div>

      {/* Extended Colors */}
      <SectionLabel>Theme Colors</SectionLabel>
      <div className="grid grid-cols-4 gap-1">
        {EXTENDED_TAB_COLORS.map((color) => (
          <ColorSwatch
            key={color}
            color={color}
            size="lg"
            selected={isSelected(color)}
            onClick={() => handleColorClick(color)}
            data-testid={`color-swatch-${color}`}
            data-color={color}
          />
        ))}
      </div>

      {/* More Colors option */}
      {onMoreColors && (
        <>
          <div className="h-px bg-ss-border-light my-2" />
          <button
            type="button"
            onClick={() => {
              onMoreColors();
              onClose();
            }}
            className="flex items-center w-full px-2 py-1.5 border-none rounded text-body-sm text-text text-left cursor-pointer bg-transparent hover:bg-ss-surface-hover"
            aria-label="More colors"
          >
            More Colors...
          </button>
        </>
      )}
    </div>
  );
}
