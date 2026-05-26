/**
 * Color Scale Options Component
 *
 * Advanced configuration options for color scale conditional formatting.
 * Supports 2/3 color scales, value types (percent, percentile, number), and preset schemes.
 *
 * Refactored to use semantic UI components (ColorInput, Select, RadioGroup, Label).
 */

import { ColorInput, Input, Label, RadioGroup, Select } from '@mog/shell';
import type { CFValueType } from '@mog-sdk/contracts/conditional-format';

// =============================================================================
// Types
// =============================================================================

export interface ColorScaleFormState {
  use3Color: boolean;
  minType: CFValueType;
  minValue?: number;
  minColor: string;
  midType?: CFValueType;
  midValue?: number;
  midColor?: string;
  maxType: CFValueType;
  maxValue?: number;
  maxColor: string;
}

interface ColorScaleOptionsProps {
  value: ColorScaleFormState;
  onChange: (value: ColorScaleFormState) => void;
}

// =============================================================================
// Preset Color Schemes
// =============================================================================

interface ColorSchemePreset {
  id: string;
  name: string;
  min: string;
  mid?: string;
  max: string;
  is3Color: boolean;
}

const COLOR_SCALE_PRESETS: ColorSchemePreset[] = [
  // 3-color scales
  {
    id: 'green-yellow-red',
    name: 'Green - Yellow - Red',
    min: '#63BE7B',
    mid: '#FFEB84',
    max: '#F8696B',
    is3Color: true,
  },
  {
    id: 'red-yellow-green',
    name: 'Red - Yellow - Green',
    min: '#F8696B',
    mid: '#FFEB84',
    max: '#63BE7B',
    is3Color: true,
  },
  {
    id: 'green-white-red',
    name: 'Green - White - Red',
    min: '#63BE7B',
    mid: '#FFFFFF',
    max: '#F8696B',
    is3Color: true,
  },
  {
    id: 'red-white-green',
    name: 'Red - White - Green',
    min: '#F8696B',
    mid: '#FFFFFF',
    max: '#63BE7B',
    is3Color: true,
  },
  {
    id: 'blue-white-red',
    name: 'Blue - White - Red',
    min: '#5A8AC6',
    mid: '#FFFFFF',
    max: '#F8696B',
    is3Color: true,
  },
  {
    id: 'red-white-blue',
    name: 'Red - White - Blue',
    min: '#F8696B',
    mid: '#FFFFFF',
    max: '#5A8AC6',
    is3Color: true,
  },
  // 2-color scales
  { id: 'white-red', name: 'White - Red', min: '#FFFFFF', max: '#F8696B', is3Color: false },
  { id: 'red-white', name: 'Red - White', min: '#F8696B', max: '#FFFFFF', is3Color: false },
  { id: 'white-green', name: 'White - Green', min: '#FFFFFF', max: '#63BE7B', is3Color: false },
  { id: 'green-white', name: 'Green - White', min: '#63BE7B', max: '#FFFFFF', is3Color: false },
  { id: 'white-blue', name: 'White - Blue', min: '#FFFFFF', max: '#5A8AC6', is3Color: false },
  { id: 'blue-white', name: 'Blue - White', min: '#5A8AC6', max: '#FFFFFF', is3Color: false },
];

// =============================================================================
// Value Type Options
// =============================================================================

const VALUE_TYPE_OPTIONS: { value: CFValueType; label: string }[] = [
  { value: 'min', label: 'Lowest Value' },
  { value: 'max', label: 'Highest Value' },
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent' },
  { value: 'percentile', label: 'Percentile' },
];

// Filter for min/max points
const MIN_TYPE_OPTIONS = VALUE_TYPE_OPTIONS.filter((o) => o.value !== 'max');
const MAX_TYPE_OPTIONS = VALUE_TYPE_OPTIONS.filter((o) => o.value !== 'min');
const MID_TYPE_OPTIONS: { value: CFValueType; label: string }[] = [
  { value: 'percent', label: 'Percent' },
  { value: 'percentile', label: 'Percentile' },
  { value: 'number', label: 'Number' },
];

// =============================================================================
// Default Values
// =============================================================================

export function getDefaultColorScaleState(): ColorScaleFormState {
  return {
    use3Color: true,
    minType: 'min',
    minValue: undefined,
    minColor: '#F8696B',
    midType: 'percent',
    midValue: 50,
    midColor: '#FFEB84',
    maxType: 'max',
    maxValue: undefined,
    maxColor: '#63BE7B',
  };
}

// =============================================================================
// Component
// =============================================================================

export function ColorScaleOptions({ value, onChange }: ColorScaleOptionsProps) {
  // Update a single field
  const updateField = <K extends keyof ColorScaleFormState>(
    field: K,
    newValue: ColorScaleFormState[K],
  ) => {
    onChange({ ...value, [field]: newValue });
  };

  // Apply a preset
  const applyPreset = (preset: ColorSchemePreset) => {
    onChange({
      ...value,
      use3Color: preset.is3Color,
      minColor: preset.min,
      midColor: preset.mid || '#FFEB84',
      maxColor: preset.max,
      // Reset value types when applying preset
      minType: 'min',
      midType: 'percent',
      midValue: 50,
      maxType: 'max',
    });
  };

  // Check if a preset is selected
  const isPresetSelected = (preset: ColorSchemePreset): boolean => {
    if (preset.is3Color !== value.use3Color) return false;
    if (preset.min.toUpperCase() !== value.minColor.toUpperCase()) return false;
    if (preset.max.toUpperCase() !== value.maxColor.toUpperCase()) return false;
    if (preset.is3Color && preset.mid?.toUpperCase() !== value.midColor?.toUpperCase())
      return false;
    return true;
  };

  // Get preview gradient
  const previewGradient = value.use3Color
    ? `linear-gradient(to right, ${value.minColor}, ${value.midColor}, ${value.maxColor})`
    : `linear-gradient(to right, ${value.minColor}, ${value.maxColor})`;

  // Filter presets based on current mode
  const filteredPresets = COLOR_SCALE_PRESETS.filter((p) => p.is3Color === value.use3Color);

  return (
    <div>
      {/* Scale Type */}
      <div className="mb-4">
        <Label>Scale Type</Label>
        <RadioGroup
          name="colorScaleType"
          value={value.use3Color ? '3color' : '2color'}
          onChange={(v) => updateField('use3Color', v === '3color')}
          orientation="horizontal"
          options={[
            { value: '2color', label: '2-Color Scale' },
            { value: '3color', label: '3-Color Scale' },
          ]}
        />
      </div>

      {/* Preset Schemes */}
      <div className="mb-4">
        <Label>Preset Schemes</Label>
        <div className="grid grid-cols-4 gap-2">
          {filteredPresets.map((preset) => (
            <div
              key={preset.id}
              className={`h-6 rounded cursor-pointer border-2 transition-colors ${
                isPresetSelected(preset) ? 'border-ss-primary' : 'border-transparent'
              }`}
              style={{
                background: preset.is3Color
                  ? `linear-gradient(to right, ${preset.min}, ${preset.mid}, ${preset.max})`
                  : `linear-gradient(to right, ${preset.min}, ${preset.max})`,
              }}
              onClick={() => applyPreset(preset)}
              title={preset.name}
            />
          ))}
        </div>
      </div>

      {/* Custom Colors */}
      <div className="mb-4">
        <Label>Custom Colors &amp; Values</Label>

        {/* Minimum */}
        <div className="flex items-center gap-2 py-2 border-b border-ss-border">
          <span className="w-[70px] text-body-sm font-medium text-text">Minimum</span>
          <ColorInput
            size="sm"
            value={value.minColor}
            onChange={(e) => updateField('minColor', e.target.value)}
          />
          <Select
            size="sm"
            className="min-w-[100px]"
            value={value.minType}
            onChange={(next) => updateField('minType', next as CFValueType)}
            options={MIN_TYPE_OPTIONS}
          />
          {(value.minType === 'number' ||
            value.minType === 'percent' ||
            value.minType === 'percentile') && (
            <Input
              type="number"
              size="sm"
              className="w-[80px]"
              value={value.minValue ?? ''}
              placeholder={value.minType === 'number' ? 'Value' : '%'}
              onChange={(e) =>
                updateField('minValue', e.target.value ? parseFloat(e.target.value) : undefined)
              }
            />
          )}
        </div>

        {/* Midpoint (3-color only) */}
        {value.use3Color && (
          <div className="flex items-center gap-2 py-2 border-b border-ss-border">
            <span className="w-[70px] text-body-sm font-medium text-text">Midpoint</span>
            <ColorInput
              size="sm"
              value={value.midColor || '#FFEB84'}
              onChange={(e) => updateField('midColor', e.target.value)}
            />
            <Select
              size="sm"
              className="min-w-[100px]"
              value={value.midType || 'percent'}
              onChange={(next) => updateField('midType', next as CFValueType)}
              options={MID_TYPE_OPTIONS}
            />
            <Input
              type="number"
              size="sm"
              className="w-[80px]"
              value={value.midValue ?? 50}
              placeholder="%"
              onChange={(e) =>
                updateField('midValue', e.target.value ? parseFloat(e.target.value) : 50)
              }
            />
          </div>
        )}

        {/* Maximum */}
        <div className="flex items-center gap-2 py-2">
          <span className="w-[70px] text-body-sm font-medium text-text">Maximum</span>
          <ColorInput
            size="sm"
            value={value.maxColor}
            onChange={(e) => updateField('maxColor', e.target.value)}
          />
          <Select
            size="sm"
            className="min-w-[100px]"
            value={value.maxType}
            onChange={(next) => updateField('maxType', next as CFValueType)}
            options={MAX_TYPE_OPTIONS}
          />
          {(value.maxType === 'number' ||
            value.maxType === 'percent' ||
            value.maxType === 'percentile') && (
            <Input
              type="number"
              size="sm"
              className="w-[80px]"
              value={value.maxValue ?? ''}
              placeholder={value.maxType === 'number' ? 'Value' : '%'}
              onChange={(e) =>
                updateField('maxValue', e.target.value ? parseFloat(e.target.value) : undefined)
              }
            />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="mb-4">
        <Label>Preview</Label>
        <div
          className="p-3 rounded text-body-sm min-h-[40px] flex items-center justify-center text-ss-text-inverse shadow-text"
          style={{ background: previewGradient }}
        >
          Low → {value.use3Color && 'Mid → '} High
        </div>
      </div>
    </div>
  );
}
