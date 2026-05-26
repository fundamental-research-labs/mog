/**
 * BorderTab Component
 *
 * Border tab for Format Cells dialog with comprehensive border controls:
 * - Line style picker (13 Excel styles mapped to 7 supported types)
 * - Color picker for border color
 * - 3 preset buttons: None, Outline, Inside
 * - 8 border position buttons: top, bottom, left, right, horizontal, vertical, diagonal up/down
 * - Visual preview panel (3x3 grid showing border configuration)
 *
 * Architecture: Draft + Apply Pattern with forwardRef
 * - User interactions update local draft state
 * - Exposes getChanges() ref method for parent dialog to call on Apply/OK
 * - Parent dialog owns ALL dispatch calls - this tab never calls dispatch directly
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';

import {
  BorderAllSvg,
  BorderBottomSvg,
  BorderHorizontalSvg,
  BorderLeftSvg,
  BorderNoneSvg,
  BorderOutsideSvg,
  BorderRightSvg,
  BorderTopSvg,
  BorderVerticalSvg,
} from '@mog/icons';
import { isLightColor, SectionLabel, Select } from '@mog/shell';
import type { BorderPresetMode, BorderStyle, CellBorders } from '@mog-sdk/contracts/core';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
// =============================================================================
// Types
// =============================================================================

/**
 * Ref handle exposed by BorderTab for parent dialog to call.
 */
export interface BorderTabRef {
  /** Get the pending border changes to apply */
  getChanges: () => { borders: CellBorders | null; preset: BorderPresetMode };
  /** Check if there are any changes to apply */
  hasChanges: () => boolean;
}

export interface BorderTabProps {
  /** Initial border values (from selected cells) */
  initialBorders?: CellBorders;
  /** Recent colors for color picker (D5) */
  recentColors?: string[];
  /** Called when a color is selected (for tracking recent colors - D5) */
  onColorSelect?: (color: string) => void;
}

// Re-export so existing import paths (`from './BorderTab'`) keep working.
export type { BorderPresetMode };

// Border style type from contracts
type BorderStyleType = BorderStyle['style'];

// Commonly used styles for the UI (subset of all supported)
type CommonBorderStyle = 'none' | 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';

// =============================================================================
// Constants
// =============================================================================

// Line styles - common subset for the UI
const LINE_STYLES: Array<{ value: CommonBorderStyle; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'thick', label: 'Thick' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'double', label: 'Double' },
];

const DEFAULT_BORDER_COLOR = '#000000';

type BorderPosition = 'top' | 'bottom' | 'left' | 'right' | 'horizontal' | 'vertical';
type DiagonalPosition = 'diagonalUp' | 'diagonalDown';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a BorderStyle object from style and color
 */
function createBorderStyle(style: CommonBorderStyle, color: string): BorderStyle {
  return { style, color };
}

/**
 * Map any border style to a common display style for UI rendering
 */
function toCommonStyle(style: BorderStyleType): CommonBorderStyle {
  switch (style) {
    case 'hair':
      return 'thin';
    case 'mediumDashed':
      return 'dashed';
    case 'dashDot':
    case 'dashDotDot':
    case 'mediumDashDot':
    case 'mediumDashDotDot':
    case 'slantDashDot':
      return 'dashed';
    default:
      return style as CommonBorderStyle;
  }
}

// =============================================================================
// PresetButton Component
// =============================================================================

interface PresetButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}

function PresetButton({ icon, title, onClick }: PresetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center w-12 h-12 border border-ss-border rounded bg-transparent cursor-pointer p-0 outline-none transition-colors duration-ss-fast hover:bg-ss-surface-hover hover:border-ss-primary"
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

// =============================================================================
// BorderPositionButton Component
// =============================================================================

interface BorderPositionButtonProps {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  onClick: () => void;
}

function BorderPositionButton({ icon, title, active, onClick }: BorderPositionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center w-9 h-9 border rounded p-0 outline-none transition-colors duration-ss-fast ${
        active
          ? 'bg-ss-primary border-ss-primary text-text-ss-primary-contrast'
          : 'border-ss-border bg-transparent hover:bg-ss-surface-hover hover:border-ss-primary'
      }`}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {icon}
    </button>
  );
}

// =============================================================================
// BorderPreview Component
// =============================================================================

interface BorderPreviewProps {
  borders: CellBorders | null;
  lineColor: string;
}

/**
 * Visual preview of border configuration (3x3 grid)
 */
function BorderPreview({ borders, lineColor }: BorderPreviewProps) {
  const cellSize = 40;
  const gridGap = 2;

  // Helper to render a cell with borders
  const renderCell = (row: number, col: number) => {
    let borderTop = 'none';
    let borderBottom = 'none';
    let borderLeft = 'none';
    let borderRight = 'none';

    // Center cell shows the border configuration
    if (row === 1 && col === 1) {
      if (borders?.top) {
        const style = toCommonStyle(borders.top.style);
        borderTop = `${getBorderWidth(style)} ${getBorderPattern(style)} ${borders.top.color || lineColor}`;
      }
      if (borders?.bottom) {
        const style = toCommonStyle(borders.bottom.style);
        borderBottom = `${getBorderWidth(style)} ${getBorderPattern(style)} ${borders.bottom.color || lineColor}`;
      }
      if (borders?.left) {
        const style = toCommonStyle(borders.left.style);
        borderLeft = `${getBorderWidth(style)} ${getBorderPattern(style)} ${borders.left.color || lineColor}`;
      }
      if (borders?.right) {
        const style = toCommonStyle(borders.right.style);
        borderRight = `${getBorderWidth(style)} ${getBorderPattern(style)} ${borders.right.color || lineColor}`;
      }
    }

    return (
      <div
        key={`${row}-${col}`}
        style={{
          width: cellSize,
          height: cellSize,
          borderTop,
          borderBottom,
          borderLeft,
          borderRight,
          backgroundColor: row === 1 && col === 1 ? '#f9f9f9' : 'transparent',
        }}
      />
    );
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 border border-ss-border rounded bg-ss-surface">
      <SectionLabel>Preview</SectionLabel>
      <div
        className="grid grid-cols-3 grid-rows-3"
        style={{ gap: gridGap }}
        aria-label="Border preview"
      >
        {[0, 1, 2].map((row) => [0, 1, 2].map((col) => renderCell(row, col)))}
      </div>
    </div>
  );
}

/**
 * Convert BorderStyle.style to CSS border width
 */
function getBorderWidth(style: CommonBorderStyle): string {
  switch (style) {
    case 'none':
      return '0px';
    case 'thin':
    case 'dashed':
    case 'dotted':
      return '1px';
    case 'medium':
      return '2px';
    case 'thick':
      return '3px';
    case 'double':
      return '3px';
    default:
      return '1px';
  }
}

/**
 * Convert BorderStyle.style to CSS border pattern
 */
function getBorderPattern(style: CommonBorderStyle): string {
  switch (style) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'double':
      return 'double';
    default:
      return 'solid';
  }
}

// =============================================================================
// BorderTab Component
// =============================================================================

/**
 * BorderTab - Cell border settings.
 *
 * Architecture:
 * - Uses forwardRef to expose getChanges() method to parent
 * - Parent dialog (FormatCellsDialog) owns the dispatch call
 * - Tab does NOT call dispatch - only accumulates changes locally
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */
export const BorderTab = forwardRef<BorderTabRef, BorderTabProps>(function BorderTab(
  { initialBorders, recentColors, onColorSelect },
  ref,
) {
  // Local draft state
  const [lineStyle, setLineStyle] = useState<
    'none' | 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double'
  >('thin');
  const [lineColor, setLineColor] = useState<string>(DEFAULT_BORDER_COLOR);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [draftBorders, setDraftBorders] = useState<CellBorders | null>(initialBorders || null);
  // Track the active preset mode for the action handler
  const [activePreset, setActivePreset] = useState<BorderPresetMode>(null);

  // Track original borders for change detection
  const originalBorders = useMemo(() => initialBorders || null, [initialBorders]);

  // ===========================================================================
  // Expose ref methods for parent dialog
  // ===========================================================================

  useImperativeHandle(
    ref,
    () => ({
      getChanges: () => ({ borders: draftBorders, preset: activePreset }),
      hasChanges: () => {
        // Check if borders have changed from original
        return JSON.stringify(draftBorders) !== JSON.stringify(originalBorders);
      },
    }),
    [draftBorders, activePreset, originalBorders],
  );

  // Apply preset (None, Outline, Inside)
  const applyPreset = useCallback(
    (preset: 'none' | 'outline' | 'inside') => {
      const border = createBorderStyle(lineStyle, lineColor);
      setActivePreset(preset);

      switch (preset) {
        case 'none':
          // Remove all borders
          setDraftBorders({});
          break;
        case 'outline':
          // Outline: set all 4 outer borders
          // The action handler will apply these only to the outer edges of the selection
          setDraftBorders({
            top: border,
            right: border,
            bottom: border,
            left: border,
          });
          break;
        case 'inside':
          // Inside: set bottom and right borders
          // The action handler will apply these only to internal cell dividers:
          // - bottom border to all rows except the last row
          // - right border to all columns except the last column
          setDraftBorders({
            bottom: border,
            right: border,
          });
          break;
      }
    },
    [lineStyle, lineColor],
  );

  // Toggle border position
  const toggleBorderPosition = useCallback(
    (position: BorderPosition | DiagonalPosition) => {
      const border = createBorderStyle(lineStyle, lineColor);
      const newBorders = { ...draftBorders };

      // Clear preset mode when manually toggling borders
      // (user is now customizing, not using a preset)
      setActivePreset(null);

      switch (position) {
        case 'top':
          newBorders.top = draftBorders?.top ? undefined : border;
          break;
        case 'bottom':
          newBorders.bottom = draftBorders?.bottom ? undefined : border;
          break;
        case 'left':
          newBorders.left = draftBorders?.left ? undefined : border;
          break;
        case 'right':
          newBorders.right = draftBorders?.right ? undefined : border;
          break;
        case 'horizontal':
          // Toggle both top and bottom
          const hasHorizontal = draftBorders?.top || draftBorders?.bottom;
          newBorders.top = hasHorizontal ? undefined : border;
          newBorders.bottom = hasHorizontal ? undefined : border;
          break;
        case 'vertical':
          // Toggle both left and right
          const hasVertical = draftBorders?.left || draftBorders?.right;
          newBorders.left = hasVertical ? undefined : border;
          newBorders.right = hasVertical ? undefined : border;
          break;
        case 'diagonalUp':
          // Diagonal up: bottom-left to top-right
          newBorders.diagonal = draftBorders?.diagonal ? undefined : { ...border, direction: 'up' };
          break;
        case 'diagonalDown':
          // Diagonal down: top-left to bottom-right
          newBorders.diagonal = draftBorders?.diagonal
            ? undefined
            : { ...border, direction: 'down' };
          break;
      }

      setDraftBorders(newBorders);
    },
    [lineStyle, lineColor, draftBorders],
  );

  const iconStyle = { width: 20, height: 20 };

  return (
    <div className="flex gap-4">
      {/* Left column: Line style, color, and presets */}
      <div className="flex flex-col gap-4 w-64">
        {/* Line Style */}
        <div>
          <SectionLabel>Line Style</SectionLabel>
          <Select
            value={lineStyle}
            onChange={(value) =>
              setLineStyle(
                value as 'none' | 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double',
              )
            }
            options={LINE_STYLES}
            className="w-full h-8"
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
              className="flex items-center gap-2 h-8 px-3 w-full border border-ss-border rounded bg-transparent cursor-pointer text-body-sm text-ss-text-secondary hover:bg-ss-surface-hover"
              aria-label="Line color"
              aria-expanded={colorPickerOpen}
            >
              {/* Decorative swatch — see BorderPicker.tsx for the same fix.
 ColorSwatch renders a <button>, which here would nest under
 this Line Color trigger button and trip a hydration error.
 Luminance-aware border keeps the swatch distinguishable
 from the surface for both light and dark line colors. */}
              <span
                aria-hidden="true"
                className={`w-4 h-4 rounded-ss-sm border inline-block shrink-0 ${
                  isLightColor(lineColor) ? 'border-ss-border' : 'border-transparent'
                }`}
                style={{ backgroundColor: lineColor }}
              />
              <span className="flex-1 text-left">{lineColor}</span>
            </button>
            {colorPickerOpen && (
              <div className="absolute top-full left-0 mt-1 z-ss-modal">
                <ColorPicker
                  value={lineColor}
                  onChange={(color) => {
                    if (color) {
                      setLineColor(color);
                      // Track color selection for recent colors
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

        {/* Presets */}
        <div>
          <SectionLabel>Presets</SectionLabel>
          <div className="flex gap-2">
            <PresetButton
              icon={<BorderNoneSvg style={iconStyle} />}
              title="None - Remove all borders"
              onClick={() => applyPreset('none')}
            />
            <PresetButton
              icon={<BorderOutsideSvg style={iconStyle} />}
              title="Outline - Border around selection"
              onClick={() => applyPreset('outline')}
            />
            <PresetButton
              icon={<BorderAllSvg style={iconStyle} />}
              title="Inside - Borders between cells"
              onClick={() => applyPreset('inside')}
            />
          </div>
        </div>
      </div>

      {/* Center column: Border position buttons */}
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel>Border Positions</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            <BorderPositionButton
              icon={<BorderTopSvg style={iconStyle} />}
              title="Top border"
              active={!!draftBorders?.top}
              onClick={() => toggleBorderPosition('top')}
            />
            <BorderPositionButton
              icon={<BorderBottomSvg style={iconStyle} />}
              title="Bottom border"
              active={!!draftBorders?.bottom}
              onClick={() => toggleBorderPosition('bottom')}
            />
            <BorderPositionButton
              icon={<BorderLeftSvg style={iconStyle} />}
              title="Left border"
              active={!!draftBorders?.left}
              onClick={() => toggleBorderPosition('left')}
            />
            <BorderPositionButton
              icon={<BorderRightSvg style={iconStyle} />}
              title="Right border"
              active={!!draftBorders?.right}
              onClick={() => toggleBorderPosition('right')}
            />
            <BorderPositionButton
              icon={<BorderHorizontalSvg style={iconStyle} />}
              title="Horizontal borders"
              active={!!(draftBorders?.top || draftBorders?.bottom)}
              onClick={() => toggleBorderPosition('horizontal')}
            />
            <BorderPositionButton
              icon={<BorderVerticalSvg style={iconStyle} />}
              title="Vertical borders"
              active={!!(draftBorders?.left || draftBorders?.right)}
              onClick={() => toggleBorderPosition('vertical')}
            />
            {/* TODO: Add diagonal border icons when available
 <BorderPositionButton
 icon={<DiagonalUpIcon style={iconStyle} />}
 title="Diagonal up"
 active={!!draftBorders?.diagonal && draftBorders.diagonal.direction === 'up'}
 onClick={() => toggleBorderPosition('diagonalUp')}
 />
 <BorderPositionButton
 icon={<DiagonalDownIcon style={iconStyle} />}
 title="Diagonal down"
 active={!!draftBorders?.diagonal && draftBorders.diagonal.direction === 'down'}
 onClick={() => toggleBorderPosition('diagonalDown')}
 />
 */}
          </div>
        </div>
      </div>

      {/* Right column: Preview */}
      <div className="flex-1">
        <BorderPreview borders={draftBorders} lineColor={lineColor} />
      </div>
    </div>
  );
});
