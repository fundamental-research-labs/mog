/**
 * Fill Picker Component
 *
 * Panel for configuring TextEffect text fill.
 * Supports solid color, gradient, pattern, and no fill options.
 *
 * ARCHITECTURE:
 * - Uses dispatch() for all state mutations (render isolation pattern)
 * - Uses useSelectedTextEffectDebounced() for display (prevents re-renders during drag)
 * - Reads current selection on-demand via deps.accessors for actions
 *
 * Fill Picker Panel
 */

import type { ReactElement } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type {
  GradientFill,
  PatternFill,
  SolidFill,
  TextEffectFill,
  TextEffectFillType,
} from '@mog-sdk/contracts/text-effects';
import { dispatch } from '../../actions';
import { useSelectedTextEffectDebounced } from '../../hooks/objects/useSelectedTextEffects';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import {
  Button,
  ColorInput,
  ColorSwatch,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TabPanel,
  Tabs,
} from '@mog/shell/components/ui';
import { GradientEditor } from './GradientEditor';
import { PatternSelector } from './PatternSelector';

// =============================================================================
// Types
// =============================================================================

export interface FillPickerProps {
  /** Optional: Override the trigger button (for custom triggers) */
  trigger?: ReactElement;
  /** Optional: Whether the popover is controlled externally */
  open?: boolean;
  /** Optional: Callback when popover open state changes */
  onOpenChange?: (open: boolean) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Fill type tabs configuration */
const FILL_TYPE_TABS: { id: TextEffectFillType; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'pattern', label: 'Pattern' },
  { id: 'none', label: 'None' },
];

/** Default solid fill color */
const DEFAULT_SOLID_COLOR = '#4472C4';

/** Preset colors for quick selection (Excel-like palette) */
const PRESET_COLORS = [
  // Row 1: Theme colors
  '#4472C4',
  '#ED7D31',
  '#A5A5A5',
  '#FFC000',
  '#5B9BD5',
  '#70AD47',
  // Row 2: Light variants
  '#8FAADC',
  '#F4B183',
  '#C9C9C9',
  '#FFE699',
  '#9DC3E6',
  '#A9D18E',
  // Row 3: Dark variants
  '#2F5597',
  '#C55A11',
  '#7F7F7F',
  '#BF9000',
  '#2E75B6',
  '#548235',
  // Row 4: Basic colors
  '#000000',
  '#FFFFFF',
  '#FF0000',
  '#00B050',
  '#0070C0',
  '#7030A0',
];

// =============================================================================
// Sub-components
// =============================================================================

interface SolidFillPanelProps {
  fill: SolidFill | undefined;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

/**
 * Panel for solid fill configuration.
 * Provides color picker and transparency slider.
 */
function SolidFillPanel({
  fill,
  onColorChange,
  onOpacityChange,
}: SolidFillPanelProps): ReactElement {
  const currentColor = fill?.color ?? DEFAULT_SOLID_COLOR;
  const currentOpacity = fill?.opacity ?? 1;

  return (
    <div className="space-y-4 pt-3">
      {/* Color Swatches */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-2">Theme Colors</label>
        <div className="grid grid-cols-6 gap-1">
          {PRESET_COLORS.map((color) => (
            <ColorSwatch
              key={color}
              color={color}
              selected={currentColor.toUpperCase() === color.toUpperCase()}
              onClick={() => onColorChange(color)}
              size="md"
            />
          ))}
        </div>
      </div>

      {/* Custom Color */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-1">Custom Color</label>
        <div className="flex items-center gap-2">
          <ColorInput
            value={currentColor}
            onChange={(e) => onColorChange(e.target.value)}
            size="md"
            showValue
          />
        </div>
      </div>

      {/* Transparency */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-1">
          Transparency: {Math.round((1 - currentOpacity) * 100)}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((1 - currentOpacity) * 100)}
          onChange={(e) => onOpacityChange(1 - Number(e.target.value) / 100)}
          className="w-full"
        />
      </div>
    </div>
  );
}

interface NoFillPanelProps {
  onApply: () => void;
}

/**
 * Panel for no fill option.
 * Shows explanation and apply button.
 */
function NoFillPanel({ onApply }: NoFillPanelProps): ReactElement {
  return (
    <div className="text-center py-6 pt-6">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full border-2 border-dashed border-ss-border flex items-center justify-center">
        <svg
          className="w-6 h-6 text-ss-text-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <p className="text-ss-text-secondary text-body-sm mb-4">
        Text will be rendered without any fill color
      </p>
      <Button variant="secondary" size="sm" onClick={onApply}>
        Apply No Fill
      </Button>
    </div>
  );
}

// =============================================================================
// FillPicker Component
// =============================================================================

/**
 * Fill Picker for TextEffect text fill.
 *
 * Features:
 * - Tab-based interface for fill types (Solid, Gradient, Pattern, None)
 * - Color swatch palette for quick solid color selection
 * - Custom color picker for precise color selection
 * - Gradient editor with type, angle, and stop controls
 * - Pattern selector with foreground/background colors
 * - Transparency control for solid fills
 *
 * Uses dispatch pattern for state updates:
 * - useSelectedTextEffectDebounced() for display (prevents re-renders)
 * - deps.accessors.getSelectedTextEffect() for reading current state in handlers
 * - dispatch('UPDATE_TEXT_EFFECT_FILL', deps, payload) for updates
 */
export function FillPicker({ trigger, open, onOpenChange }: FillPickerProps): ReactElement {
  const deps = useActionDependencies();

  // Use debounced selection for display (prevents re-renders during drag)
  const selectedTextEffect = useSelectedTextEffectDebounced();

  // Get current fill from selected TextEffect
  const currentFill = selectedTextEffect?.textEffects?.fill;

  // Local state for active tab
  const [activeTab, setActiveTab] = useState<TextEffectFillType>(currentFill?.type ?? 'solid');

  // Internal popover state (for uncontrolled mode)
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  // Memoize tab configuration
  const tabs = useMemo(() => FILL_TYPE_TABS, []);

  /**
   * Dispatch fill change action.
   * Reads current selection on-demand via deps.accessors (not from debounced state).
   */
  const handleFillChange = useCallback(
    (fill: TextEffectFill) => {
      // Read current selection on-demand via deps.accessors (not from debounced hook)
      const objectId = deps.accessors.object.getFirstSelectedId();
      if (!objectId) return;

      dispatch('UPDATE_TEXT_EFFECT_FILL', deps, {
        objectId,
        fill,
      });
    },
    [deps],
  );

  // Solid fill handlers
  const handleSolidColorChange = useCallback(
    (color: string) => {
      const solidFill = currentFill?.type === 'solid' ? currentFill : undefined;
      handleFillChange({
        type: 'solid',
        color,
        opacity: solidFill?.opacity ?? 1,
      });
    },
    [currentFill, handleFillChange],
  );

  const handleSolidOpacityChange = useCallback(
    (opacity: number) => {
      const solidFill = currentFill?.type === 'solid' ? currentFill : undefined;
      handleFillChange({
        type: 'solid',
        color: solidFill?.color ?? DEFAULT_SOLID_COLOR,
        opacity,
      });
    },
    [currentFill, handleFillChange],
  );

  // Gradient fill handler
  const handleGradientChange = useCallback(
    (gradient: Omit<GradientFill, 'type'>) => {
      handleFillChange({
        ...gradient,
        type: 'gradient',
      } as GradientFill);
    },
    [handleFillChange],
  );

  // Pattern fill handler
  const handlePatternChange = useCallback(
    (pattern: Omit<PatternFill, 'type'>) => {
      handleFillChange({
        ...pattern,
        type: 'pattern',
      } as PatternFill);
    },
    [handleFillChange],
  );

  // No fill handler
  const handleNoFill = useCallback(() => {
    handleFillChange({ type: 'none' });
  }, [handleFillChange]);

  // Get fill color for trigger display
  const triggerColor = useMemo(() => {
    if (!currentFill || currentFill.type === 'none') {
      return 'transparent';
    }
    if (currentFill.type === 'solid') {
      return currentFill.color;
    }
    if (currentFill.type === 'gradient' && currentFill.stops.length > 0) {
      return currentFill.stops[0].color;
    }
    if (currentFill.type === 'pattern') {
      return currentFill.fgColor;
    }
    return DEFAULT_SOLID_COLOR;
  }, [currentFill]);

  // Default trigger button
  const defaultTrigger = (
    <Button variant="ghost" size="sm" className="flex items-center gap-2">
      <div
        className="w-4 h-4 rounded border border-ss-border"
        style={{ backgroundColor: triggerColor }}
      />
      <span className="text-caption">Fill</span>
      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
        <path d="M3 5l3 3 3-3H3z" />
      </svg>
    </Button>
  );

  // Cast gradient fill to the correct type for the editor
  const gradientFillForEditor: GradientFill | undefined =
    currentFill?.type === 'gradient' ? (currentFill as GradientFill) : undefined;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={4} className="p-0" width={280}>
        <div className="p-3">
          <h3 className="text-body-sm font-medium text-ss-text mb-3">Text Fill</h3>

          <Tabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as TextEffectFillType)}
            size="sm"
          >
            {/* Solid Fill Panel */}
            <TabPanel tabId="solid">
              <SolidFillPanel
                fill={currentFill?.type === 'solid' ? currentFill : undefined}
                onColorChange={handleSolidColorChange}
                onOpacityChange={handleSolidOpacityChange}
              />
            </TabPanel>

            {/* Gradient Fill Panel */}
            <TabPanel tabId="gradient">
              <div className="pt-3">
                <GradientEditor gradient={gradientFillForEditor} onChange={handleGradientChange} />
              </div>
            </TabPanel>

            {/* Pattern Fill Panel */}
            <TabPanel tabId="pattern">
              <div className="pt-3">
                <PatternSelector
                  pattern={currentFill?.type === 'pattern' ? currentFill : undefined}
                  onChange={handlePatternChange}
                />
              </div>
            </TabPanel>

            {/* No Fill Panel */}
            <TabPanel tabId="none">
              <NoFillPanel onApply={handleNoFill} />
            </TabPanel>
          </Tabs>
        </div>
      </PopoverContent>
    </Popover>
  );
}
