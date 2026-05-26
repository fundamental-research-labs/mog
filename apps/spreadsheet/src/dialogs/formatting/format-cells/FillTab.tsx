/**
 * FillTab Component
 *
 * Fill tab for the Format Cells dialog.
 * Allows users to set:
 * - Background color (solid fill)
 * - Pattern type and color
 * - Gradient fills (preset gallery + custom gradients)
 *
 * Uses the "Draft + Apply" pattern with forwardRef:
 * - Changes accumulate in local state
 * - Exposes getChanges() ref method for parent dialog to call on Apply/OK
 * - Parent dialog dispatches APPLY_FILL_FORMAT action
 *
 */

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { Button, Label, SectionLabel, Select, type SelectOption } from '@mog/shell';
import type { CellFormat, GradientFill, PatternType } from '@mog-sdk/contracts/core';
import { ColorPicker } from '../../../components/pickers/ColorPicker';
// =============================================================================
// Pattern Type Options
// =============================================================================

/**
 * Pattern types with display labels matching Excel.
 * Order follows Excel's pattern dropdown.
 */
const PATTERN_OPTIONS: Array<{ value: PatternType; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'darkGray', label: 'Dark Gray (75%)' },
  { value: 'mediumGray', label: 'Medium Gray (50%)' },
  { value: 'lightGray', label: 'Light Gray (25%)' },
  { value: 'gray125', label: 'Gray 12.5%' },
  { value: 'gray0625', label: 'Gray 6.25%' },
  { value: 'darkHorizontal', label: 'Dark Horizontal' },
  { value: 'lightHorizontal', label: 'Light Horizontal' },
  { value: 'darkVertical', label: 'Dark Vertical' },
  { value: 'lightVertical', label: 'Light Vertical' },
  { value: 'darkDown', label: 'Dark Diagonal Down' },
  { value: 'lightDown', label: 'Light Diagonal Down' },
  { value: 'darkUp', label: 'Dark Diagonal Up' },
  { value: 'lightUp', label: 'Light Diagonal Up' },
  { value: 'darkGrid', label: 'Dark Grid' },
  { value: 'lightGrid', label: 'Light Grid' },
  { value: 'darkTrellis', label: 'Dark Trellis' },
  { value: 'lightTrellis', label: 'Light Trellis' },
];

// =============================================================================
// Preset Gradients
// =============================================================================

/**
 * Preset gradient definitions for the Fill Effects gallery.
 * Matches Excel's built-in gradient presets.
 */
interface PresetGradient {
  /** Unique identifier for the gradient */
  id: string;
  /** Display name for the gradient */
  name: string;
  /** The gradient fill configuration */
  gradient: GradientFill;
}

/**
 * Excel-like preset gradients organized by category.
 * These are commonly used gradients that provide one-click application.
 */
const PRESET_GRADIENTS: PresetGradient[] = [
  // Horizontal Linear Gradients
  {
    id: 'horizontal-light-dark',
    name: 'Horizontal Light to Dark',
    gradient: {
      type: 'linear',
      degree: 0,
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'horizontal-dark-light',
    name: 'Horizontal Dark to Light',
    gradient: {
      type: 'linear',
      degree: 0,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 1, color: '#FFFFFF' },
      ],
    },
  },
  // Vertical Linear Gradients
  {
    id: 'vertical-light-dark',
    name: 'Vertical Light to Dark',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'vertical-dark-light',
    name: 'Vertical Dark to Light',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 1, color: '#FFFFFF' },
      ],
    },
  },
  // Diagonal Linear Gradients
  {
    id: 'diagonal-down-light-dark',
    name: 'Diagonal Down (Light to Dark)',
    gradient: {
      type: 'linear',
      degree: 45,
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'diagonal-up-light-dark',
    name: 'Diagonal Up (Light to Dark)',
    gradient: {
      type: 'linear',
      degree: 135,
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  // Path (Radial) Gradients
  {
    id: 'center-light',
    name: 'From Center (Light)',
    gradient: {
      type: 'path',
      center: { left: 0.5, top: 0.5 },
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'center-dark',
    name: 'From Center (Dark)',
    gradient: {
      type: 'path',
      center: { left: 0.5, top: 0.5 },
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 1, color: '#FFFFFF' },
      ],
    },
  },
  // Corner Path Gradients
  {
    id: 'corner-top-left',
    name: 'From Top-Left Corner',
    gradient: {
      type: 'path',
      center: { left: 0, top: 0 },
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'corner-bottom-right',
    name: 'From Bottom-Right Corner',
    gradient: {
      type: 'path',
      center: { left: 1, top: 1 },
      stops: [
        { position: 0, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  // Multi-Stop Gradients
  {
    id: 'three-color-horizontal',
    name: 'Three-Color Horizontal',
    gradient: {
      type: 'linear',
      degree: 0,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 0.5, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
  {
    id: 'three-color-vertical',
    name: 'Three-Color Vertical',
    gradient: {
      type: 'linear',
      degree: 90,
      stops: [
        { position: 0, color: '#4472C4' },
        { position: 0.5, color: '#FFFFFF' },
        { position: 1, color: '#4472C4' },
      ],
    },
  },
];

/**
 * Convert a GradientFill to a CSS gradient string for preview.
 */
function gradientToCss(gradient: GradientFill): string {
  const colorStops = gradient.stops.map((s) => `${s.color} ${s.position * 100}%`).join(', ');

  if (gradient.type === 'linear') {
    // CSS linear-gradient uses different angle convention:
    // CSS 0deg = bottom-to-top, Excel 0deg = left-to-right
    // CSS 90deg = left-to-right, Excel 90deg = bottom-to-top
    // Convert: CSS angle = 90 - Excel angle
    const cssAngle = 90 - (gradient.degree ?? 0);
    return `linear-gradient(${cssAngle}deg, ${colorStops})`;
  } else {
    // Path gradient - use radial-gradient
    const centerX = (gradient.center?.left ?? 0.5) * 100;
    const centerY = (gradient.center?.top ?? 0.5) * 100;
    return `radial-gradient(ellipse at ${centerX}% ${centerY}%, ${colorStops})`;
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Ref handle exposed by FillTab for parent dialog to call.
 */
export interface FillTabRef {
  /** Get the pending format changes to apply */
  getChanges: () => Partial<CellFormat>;
  /** Check if there are any changes to apply */
  hasChanges: () => boolean;
}

export interface FillTabProps {
  /** Current cell format (for initializing draft state) */
  initialFormat?: Partial<CellFormat>;
  /** Recent colors for color picker */
  recentColors?: string[];
  /** Called when a color is selected (for tracking recent colors - D5) */
  onColorSelect?: (color: string) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * FillTab - Cell fill settings (background color and patterns).
 *
 * Architecture:
 * - Uses forwardRef to expose getChanges() method to parent
 * - Parent dialog (FormatCellsDialog) owns the dispatch call
 * - Tab does NOT call dispatch - only accumulates changes locally
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */
export const FillTab = forwardRef<FillTabRef, FillTabProps>(function FillTab(
  { initialFormat, recentColors, onColorSelect },
  ref,
) {
  // Draft state - accumulates changes locally
  const [backgroundColor, setBackgroundColor] = useState<string | undefined>(
    initialFormat?.backgroundColor,
  );
  const [patternType, setPatternType] = useState<PatternType | undefined>(
    initialFormat?.patternType,
  );
  const [patternColor, setPatternColor] = useState<string | undefined>(
    initialFormat?.patternForegroundColor,
  );
  // Gradient fill state
  const [gradientFill, setGradientFill] = useState<GradientFill | undefined>(
    initialFormat?.gradientFill,
  );

  // Show/hide color pickers and dialogs
  const [showBackgroundPicker, setShowBackgroundPicker] = useState(false);
  const [showPatternPicker, setShowPatternPicker] = useState(false);
  const [showFillEffectsDialog, setShowFillEffectsDialog] = useState(false);

  const dirtyRef = useRef(new Set<keyof CellFormat>());
  const markDirty = useCallback((key: keyof CellFormat) => {
    dirtyRef.current.add(key);
  }, []);

  // Build draft format for preview only
  const draftFormat = useMemo<Partial<CellFormat>>(() => {
    const format: Partial<CellFormat> = {};

    // Gradient takes precedence over solid color/pattern
    if (gradientFill) {
      format.gradientFill = gradientFill;
      // Clear solid fill when gradient is set (Excel behavior)
      format.backgroundColor = undefined;
      format.patternType = undefined;
      format.patternForegroundColor = undefined;
    } else {
      if (backgroundColor) {
        format.backgroundColor = backgroundColor;
      }

      if (patternType && patternType !== 'none') {
        format.patternType = patternType;
        if (patternColor) {
          format.patternForegroundColor = patternColor;
        }
      }
    }

    return format;
  }, [backgroundColor, patternType, patternColor, gradientFill]);

  // Expose getChanges() and hasChanges() for parent dialog to call on Apply/OK
  useImperativeHandle(ref, () => ({
    getChanges: (): Partial<CellFormat> => {
      const changes: Partial<CellFormat> = {};
      if (dirtyRef.current.has('backgroundColor')) {
        changes.backgroundColor = backgroundColor;
      }
      if (dirtyRef.current.has('patternType')) {
        changes.patternType = patternType;
      }
      if (dirtyRef.current.has('patternForegroundColor')) {
        changes.patternForegroundColor = patternColor;
      }
      if (dirtyRef.current.has('gradientFill')) {
        changes.gradientFill = gradientFill;
      }
      return changes;
    },
    hasChanges: (): boolean => dirtyRef.current.size > 0,
  }));

  // Handlers
  const handleBackgroundColorChange = useCallback(
    (color: string | null) => {
      setBackgroundColor(color || undefined);
      markDirty('backgroundColor');
      setShowBackgroundPicker(false);
      // Clear gradient when selecting solid color (Excel behavior)
      setGradientFill(undefined);
      markDirty('gradientFill');
      // Track color selection for recent colors
      if (color) {
        onColorSelect?.(color);
      }
    },
    [markDirty, onColorSelect],
  );

  // Handle gradient selection from preset gallery
  const handleGradientSelect = useCallback(
    (gradient: GradientFill) => {
      setGradientFill(gradient);
      markDirty('gradientFill');
      // Clear solid fill when gradient is set (Excel behavior)
      setBackgroundColor(undefined);
      markDirty('backgroundColor');
      setPatternType('none');
      markDirty('patternType');
      setPatternColor(undefined);
      markDirty('patternForegroundColor');
      setShowFillEffectsDialog(false);
    },
    [markDirty],
  );

  // Clear gradient (back to solid fill)
  const handleClearGradient = useCallback(() => {
    setGradientFill(undefined);
    markDirty('gradientFill');
  }, [markDirty]);

  const handlePatternColorChange = useCallback(
    (color: string | null) => {
      setPatternColor(color || undefined);
      markDirty('patternForegroundColor');
      setShowPatternPicker(false);
      // Track color selection for recent colors
      if (color) {
        onColorSelect?.(color);
      }
    },
    [markDirty, onColorSelect],
  );

  const handlePatternTypeChange = useCallback(
    (value: string) => {
      setPatternType(value as PatternType);
      markDirty('patternType');
    },
    [markDirty],
  );

  // Pattern dropdown options
  const patternSelectOptions: SelectOption[] = PATTERN_OPTIONS.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Background Color Section */}
      <div>
        <SectionLabel>Background Color</SectionLabel>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowBackgroundPicker(!showBackgroundPicker)}
            className="w-full justify-start gap-2"
          >
            {backgroundColor ? (
              <>
                <div
                  className="h-4 w-4 rounded border border-ss-border"
                  style={{ backgroundColor }}
                />
                <span>{backgroundColor}</span>
              </>
            ) : (
              <span>No Color</span>
            )}
          </Button>

          {showBackgroundPicker && (
            <div className="mt-2 border border-ss-border rounded-ss-md p-2 bg-ss-surface">
              <ColorPicker
                value={backgroundColor}
                onChange={handleBackgroundColorChange}
                onClose={() => setShowBackgroundPicker(false)}
                showNoColor
                noColorLabel="No Fill"
                recentColors={recentColors}
              />
            </div>
          )}
        </div>
      </div>

      {/* Pattern Color Section */}
      <div>
        <SectionLabel>Pattern Color</SectionLabel>
        <div className="mt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPatternPicker(!showPatternPicker)}
            className="w-full justify-start gap-2"
            disabled={!patternType || patternType === 'none' || patternType === 'solid'}
          >
            {patternColor ? (
              <>
                <div
                  className="h-4 w-4 rounded border border-ss-border"
                  style={{ backgroundColor: patternColor }}
                />
                <span>{patternColor}</span>
              </>
            ) : (
              <span>No Color</span>
            )}
          </Button>

          {showPatternPicker && (
            <div className="mt-2 border border-ss-border rounded-ss-md p-2 bg-ss-surface">
              <ColorPicker
                value={patternColor}
                onChange={handlePatternColorChange}
                onClose={() => setShowPatternPicker(false)}
                showNoColor
                noColorLabel="Automatic"
                recentColors={recentColors}
              />
            </div>
          )}
        </div>
      </div>

      {/* Pattern Style Section */}
      <div>
        <Label htmlFor="pattern-style">Pattern Style</Label>
        <Select
          id="pattern-style"
          options={patternSelectOptions}
          value={patternType}
          onChange={handlePatternTypeChange}
          placeholder=" "
          className="w-full mt-1"
        />
      </div>

      {/* Sample Preview Section */}
      <div>
        <SectionLabel>Sample</SectionLabel>
        <div className="mt-2 border border-ss-border rounded-ss-md p-4 bg-ss-surface">
          <div
            className="h-16 w-full rounded border border-ss-border"
            style={{
              // Gradient preview takes precedence
              background: gradientFill ? gradientToCss(gradientFill) : backgroundColor || '#ffffff',
              backgroundImage:
                !gradientFill && patternType && patternType !== 'none' && patternType !== 'solid'
                  ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Ctext%3EPattern%3C/text%3E%3C/svg%3E")`
                  : undefined,
            }}
          />
          <p className="text-body-sm text-ss-text-secondary mt-2 text-center">
            {gradientFill
              ? `Gradient: ${gradientFill.type === 'linear' ? 'Linear' : 'Radial'}`
              : backgroundColor || patternType !== 'none'
                ? 'Preview of fill settings'
                : 'No fill applied'}
          </p>
        </div>
      </div>

      {/* Fill Effects / Gradient Section */}
      <div>
        <SectionLabel>Fill Effects (Gradient)</SectionLabel>

        {/* Show current gradient if set */}
        {gradientFill && (
          <div className="mt-2 mb-2">
            <div className="flex items-center gap-2 p-2 border border-ss-border rounded-ss-md bg-ss-surface">
              <div
                className="h-8 w-12 rounded border border-ss-border"
                style={{ background: gradientToCss(gradientFill) }}
                title="Current gradient fill"
              />
              <span className="text-body-sm text-ss-text-secondary flex-1">
                {gradientFill.type === 'linear'
                  ? `Linear (${gradientFill.degree ?? 0}deg)`
                  : 'Radial'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearGradient}
                title="Remove gradient fill"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Fill Effects button to open gradient picker */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowFillEffectsDialog(!showFillEffectsDialog)}
          className="w-full"
        >
          Fill Effects...
        </Button>

        {/* Preset Gradients Gallery */}
        {showFillEffectsDialog && (
          <div className="mt-2 border border-ss-border rounded-ss-md p-3 bg-ss-surface">
            <div className="mb-2">
              <Label className="text-body-sm font-medium">Preset Gradients</Label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PRESET_GRADIENTS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleGradientSelect(preset.gradient)}
                  className={`
 h-10 w-full rounded border cursor-pointer
 transition-shadow duration-ss-fast outline-none
 ${
   gradientFill && JSON.stringify(gradientFill) === JSON.stringify(preset.gradient)
     ? 'ring-2 ring-ss-primary border-ss-primary'
     : 'border-ss-border hover:ring-2 hover:ring-ss-primary/50'
 }
 `}
                  style={{ background: gradientToCss(preset.gradient) }}
                  title={preset.name}
                  aria-label={`Apply ${preset.name} gradient`}
                />
              ))}
            </div>
            <p className="text-caption text-ss-text-secondary mt-2">
              Click a preset to apply, or customize in future updates
            </p>
          </div>
        )}
      </div>
    </div>
  );
});
