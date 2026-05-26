/**
 * Icon Set Options Component
 *
 * Advanced configuration options for icon set conditional formatting.
 * Uses canvas-based preview for crisp icon rendering.
 */

import { useEffect, useRef, useState } from 'react';

import { renderIcon } from '@mog/grid-renderer';
import { Checkbox, Input, Label, SectionLabel, Select } from '@mog/shell';
import {
  type CFIconSetName,
  type CFValueType,
  ICON_SET_REGISTRY,
} from '@mog-sdk/contracts/conditional-format';

/**
 * All available icon sets for the icon picker dropdown.
 * Used for mixing icons from different sets per threshold.
 */
const ALL_ICON_SETS: CFIconSetName[] = [
  '3Arrows',
  '3ArrowsGray',
  '3TrafficLights1',
  '3TrafficLights2',
  '3Signs',
  '3Symbols',
  '3Symbols2',
  '3Stars',
  '3Triangles',
  '3Flags',
  '4Arrows',
  '4ArrowsGray',
  '4Rating',
  '4RedToBlack',
  '4TrafficLights',
  '5Arrows',
  '5ArrowsGray',
  '5Rating',
  '5Quarters',
  '5Boxes',
];

// =============================================================================
// Types
// =============================================================================

/**
 * Enhancement: Custom icon configuration per threshold.
 * Allows mixing icons from different sets and hiding icons.
 */
export interface CustomIconConfig {
  /** If true, hide the icon for this threshold (No Cell Icon option) */
  hideIcon?: boolean;
  /** Override icon set for this threshold (mix icons from different sets) */
  customSetName?: CFIconSetName;
  /** Override icon index within the custom set */
  customIconIndex?: number;
}

export interface IconSetFormState {
  iconSetName: CFIconSetName;
  reverseOrder: boolean;
  showIconOnly: boolean;
  useCustomThresholds: boolean;
  thresholds: Array<{
    type: CFValueType;
    value: number;
    /** When true the threshold comparison is >=, when false it is >. */
    gte: boolean;
    /** Enhancement: Custom icon configuration */
    customIcon?: CustomIconConfig;
  }>;
}

interface IconSetOptionsProps {
  value: IconSetFormState;
  onChange: (value: IconSetFormState) => void;
}

// =============================================================================
// Icon Set Categories
// =============================================================================

const ICON_SET_CATEGORIES: { label: string; sets: CFIconSetName[] }[] = [
  {
    label: '3 Icons',
    sets: [
      '3Arrows',
      '3ArrowsGray',
      '3TrafficLights1',
      '3TrafficLights2',
      '3Signs',
      '3Symbols',
      '3Symbols2',
      '3Stars',
      '3Triangles',
      '3Flags',
    ],
  },
  {
    label: '4 Icons',
    sets: ['4Arrows', '4ArrowsGray', '4Rating', '4RedToBlack', '4TrafficLights'],
  },
  {
    label: '5 Icons',
    sets: ['5Arrows', '5ArrowsGray', '5Rating', '5Quarters', '5Boxes'],
  },
];

// =============================================================================
// Default Values
// =============================================================================

export function getDefaultIconSetState(): IconSetFormState {
  return {
    iconSetName: '3Arrows',
    reverseOrder: false,
    showIconOnly: false,
    useCustomThresholds: false,
    thresholds: getDefaultThresholds('3Arrows'),
  };
}

function getDefaultThresholds(setName: CFIconSetName): IconSetFormState['thresholds'] {
  const meta = ICON_SET_REGISTRY[setName];
  const thresholds: IconSetFormState['thresholds'] = [];

  // Create N-1 thresholds for N icons
  for (let i = 1; i < meta.iconCount; i++) {
    thresholds.push({
      type: 'percent',
      value: meta.defaultThresholds[i],
      gte: true,
    });
  }

  return thresholds;
}

// =============================================================================
// Icon Preview Component (Canvas-based)
// =============================================================================

interface IconPreviewProps {
  setName: CFIconSetName;
  iconIndex: number;
  size?: number;
}

function IconPreview({ setName, iconIndex, size = 16 }: IconPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with DPR
    const dpr = window.devicePixelRatio;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Render icon
    renderIcon(
      ctx,
      { setName, iconIndex, iconOnly: true },
      {
        x: 0,
        y: 0,
        width: size,
        height: size,
        padding: 0,
        size,
      },
    );
  }, [setName, iconIndex, size]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} />;
}

// =============================================================================
// Icon Set Preview (shows all icons in a set)
// =============================================================================

interface IconSetPreviewProps {
  setName: CFIconSetName;
}

function IconSetPreview({ setName }: IconSetPreviewProps) {
  const meta = ICON_SET_REGISTRY[setName];
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const iconSize = 14;
    const gap = 2;
    const totalWidth = meta.iconCount * iconSize + (meta.iconCount - 1) * gap;
    const height = iconSize;

    // Set canvas size with DPR
    const dpr = window.devicePixelRatio;
    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, totalWidth, height);

    // Render all icons
    for (let i = 0; i < meta.iconCount; i++) {
      const x = i * (iconSize + gap);
      renderIcon(
        ctx,
        { setName, iconIndex: i, iconOnly: true },
        {
          x,
          y: 0,
          width: iconSize,
          height: iconSize,
          padding: 0,
          size: iconSize,
        },
      );
    }
  }, [setName, meta.iconCount]);

  return <canvas ref={canvasRef} />;
}

// =============================================================================
// Icon Picker Dropdown ( Enhancement: Mix icons from different sets)
// =============================================================================

interface IconPickerProps {
  /** Current icon configuration */
  config: CustomIconConfig | undefined;
  /** Default set name (when no custom selection) */
  defaultSetName: CFIconSetName;
  /** Default icon index (when no custom selection) */
  defaultIconIndex: number;
  /** Callback when icon configuration changes */
  onChange: (config: CustomIconConfig | undefined) => void;
}

/**
 * IconPicker allows users to:
 * 1. Use the default icon for this threshold
 * 2. Hide the icon completely ("No Cell Icon")
 * 3. Pick a custom icon from any icon set
 */
function IconPicker({ config, defaultSetName, defaultIconIndex, onChange }: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSet, setSelectedSet] = useState<CFIconSetName>(
    config?.customSetName ?? defaultSetName,
  );

  // Determine current display state
  const isHidden = config?.hideIcon ?? false;
  const currentSetName = config?.customSetName ?? defaultSetName;
  const currentIconIndex = config?.customIconIndex ?? defaultIconIndex;

  const handleToggleHide = () => {
    if (isHidden) {
      // Show icon again (restore to default or last custom)
      onChange(undefined);
    } else {
      // Hide icon
      onChange({ hideIcon: true });
    }
    setIsOpen(false);
  };

  const handleSelectIcon = (setName: CFIconSetName, iconIndex: number) => {
    // If same as default, clear custom config
    if (setName === defaultSetName && iconIndex === defaultIconIndex) {
      onChange(undefined);
    } else {
      onChange({
        hideIcon: false,
        customSetName: setName,
        customIconIndex: iconIndex,
      });
    }
    setIsOpen(false);
  };

  const handleResetToDefault = () => {
    onChange(undefined);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded border border-ss-border hover:border-ss-border-focus"
        onClick={() => setIsOpen(!isOpen)}
        title={isHidden ? 'No Cell Icon (click to change)' : 'Click to change icon'}
      >
        {isHidden ? (
          <span className="text-ss-text-secondary text-caption">-</span>
        ) : (
          <IconPreview setName={currentSetName} iconIndex={currentIconIndex} size={14} />
        )}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-ss-popover mt-1 w-64 rounded border border-ss-border bg-ss-surface p-2 shadow-ss-lg">
          {/* No Cell Icon option */}
          <button
            type="button"
            className={`mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-body-sm hover:bg-ss-surface-secondary ${
              isHidden ? 'bg-ss-primary-light' : ''
            }`}
            onClick={handleToggleHide}
          >
            <span className="flex h-4 w-4 items-center justify-center border border-ss-border text-caption">
              -
            </span>
            <span>No Cell Icon</span>
          </button>

          {/* Reset to Default option */}
          {(config?.customSetName || config?.customIconIndex !== undefined) && (
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 text-body-sm hover:bg-ss-surface-secondary"
              onClick={handleResetToDefault}
            >
              <IconPreview setName={defaultSetName} iconIndex={defaultIconIndex} size={14} />
              <span>Reset to Default</span>
            </button>
          )}

          {/* Icon Set Selector */}
          <div className="mb-2">
            <Label className="mb-1 text-hint">Icon Set</Label>
            <Select
              size="sm"
              className="w-full"
              value={selectedSet}
              onChange={(value) => setSelectedSet(value as CFIconSetName)}
              options={ALL_ICON_SETS.map((set) => ({
                value: set,
                label: set.replace(/^\d/, ''),
              }))}
            />
          </div>

          {/* Icon Grid */}
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: ICON_SET_REGISTRY[selectedSet].iconCount }).map((_, idx) => {
              const isSelected =
                !isHidden && currentSetName === selectedSet && currentIconIndex === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`flex h-6 w-6 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-ss-primary bg-ss-primary-light'
                      : 'border-ss-border hover:border-ss-border-focus'
                  }`}
                  onClick={() => handleSelectIcon(selectedSet, idx)}
                >
                  <IconPreview setName={selectedSet} iconIndex={idx} size={14} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

export function IconSetOptions({ value, onChange }: IconSetOptionsProps) {
  // Update a single field
  const updateField = <K extends keyof IconSetFormState>(
    field: K,
    newValue: IconSetFormState[K],
  ) => {
    onChange({ ...value, [field]: newValue });
  };

  // Change icon set and reset thresholds
  const handleIconSetChange = (setName: CFIconSetName) => {
    onChange({
      ...value,
      iconSetName: setName,
      thresholds: value.useCustomThresholds ? getDefaultThresholds(setName) : value.thresholds,
    });
  };

  // Update threshold
  const updateThreshold = (index: number, updates: Partial<IconSetFormState['thresholds'][0]>) => {
    const newThresholds = [...value.thresholds];
    newThresholds[index] = { ...newThresholds[index], ...updates };
    updateField('thresholds', newThresholds);
  };

  // Toggle custom thresholds
  const toggleCustomThresholds = (enabled: boolean) => {
    onChange({
      ...value,
      useCustomThresholds: enabled,
      thresholds: enabled ? getDefaultThresholds(value.iconSetName) : value.thresholds,
    });
  };

  const meta = ICON_SET_REGISTRY[value.iconSetName];
  const iconIndices = Array.from({ length: meta.iconCount }, (_, i) =>
    value.reverseOrder ? meta.iconCount - 1 - i : i,
  );

  return (
    <div>
      {/* Icon Set Selection */}
      <div className="mb-4">
        <Label>Icon Set</Label>
        {ICON_SET_CATEGORIES.map((category) => (
          <div key={category.label} className="mb-4">
            <SectionLabel size="sm" className="uppercase tracking-wide">
              {category.label}
            </SectionLabel>
            <div className="grid grid-cols-4 gap-2">
              {category.sets.map((setName) => {
                const isSelected = value.iconSetName === setName;
                return (
                  <div
                    key={setName}
                    className={`flex min-h-[56px] cursor-pointer flex-col items-center gap-1 rounded-ss-md border p-2 text-center text-body-sm transition-all ${
                      isSelected
                        ? 'border-ss-primary bg-ss-primary-light'
                        : 'border-ss-border hover:border-ss-border-focus'
                    }`}
                    onClick={() => handleIconSetChange(setName)}
                  >
                    <IconSetPreview setName={setName} />
                    <span>{setName.replace(/^\d/, '')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Options */}
      <div className="mb-4 flex flex-col gap-2">
        <Checkbox
          checked={value.reverseOrder}
          onChange={(checked) => updateField('reverseOrder', checked)}
          label="Reverse icon order"
        />
        <Checkbox
          checked={value.showIconOnly}
          onChange={(checked) => updateField('showIconOnly', checked)}
          label="Show icon only (hide cell value)"
        />
      </div>

      {/* Custom Thresholds */}
      <div className="mb-4">
        <Checkbox
          checked={value.useCustomThresholds}
          onChange={(checked) => toggleCustomThresholds(checked)}
          label="Use custom thresholds"
        />

        {value.useCustomThresholds && (
          <div className="mt-3 rounded border border-ss-border p-3">
            {value.thresholds.map((threshold, index) => {
              const defaultIconIndex = value.reverseOrder ? index : meta.iconCount - 2 - index;
              return (
                <div key={index} className="mb-2 flex items-center gap-2 text-body">
                  {/* Enhancement: Icon Picker for custom icons */}
                  <IconPicker
                    config={threshold.customIcon}
                    defaultSetName={value.iconSetName}
                    defaultIconIndex={defaultIconIndex + 1}
                    onChange={(customIcon) => updateThreshold(index, { customIcon })}
                  />
                  <span>when value is</span>
                  <Select
                    className="min-w-[80px]"
                    size="sm"
                    value={threshold.gte ? 'gte' : 'gt'}
                    onChange={(next) =>
                      updateThreshold(index, {
                        gte: next === 'gte',
                      })
                    }
                    options={[
                      { value: 'gte', label: '>=' },
                      { value: 'gt', label: '>' },
                    ]}
                  />
                  <Input
                    type="number"
                    size="sm"
                    className="w-[70px]"
                    value={threshold.value}
                    onChange={(e) =>
                      updateThreshold(index, { value: parseFloat(e.target.value) || 0 })
                    }
                  />
                  <Select
                    className="min-w-[80px]"
                    size="sm"
                    value={threshold.type}
                    onChange={(next) => updateThreshold(index, { type: next as CFValueType })}
                    options={[
                      { value: 'percent', label: 'Percent' },
                      { value: 'percentile', label: 'Percentile' },
                      { value: 'number', label: 'Number' },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="mb-4">
        <Label>Preview</Label>
        <div className="flex items-center justify-center gap-6 rounded border border-ss-border px-3 py-4">
          {iconIndices.map((iconIndex, i) => (
            <div
              key={i}
              className="flex h-7 min-w-[60px] items-center gap-2 rounded border border-ss-border bg-ss-surface px-3 py-1"
            >
              <IconPreview setName={value.iconSetName} iconIndex={iconIndex} size={16} />
              {!value.showIconOnly && (
                <span className="text-body text-text">
                  {Math.round(100 - (i * 100) / meta.iconCount)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
