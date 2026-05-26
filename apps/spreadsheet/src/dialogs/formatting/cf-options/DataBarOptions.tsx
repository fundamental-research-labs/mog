/**
 * Data Bar Options Component
 *
 * Advanced configuration options for data bar conditional formatting.
 * Supports negative colors, borders, gradients, axis positioning, and custom min/max values.
 */

import { useEffect, useRef } from 'react';

import { Checkbox, ColorInput, Input, Label, RadioGroup, Select } from '@mog/shell';
import type { CFDataBarAxisPosition, CFValueType } from '@mog-sdk/contracts/conditional-format';

// =============================================================================
// Types
// =============================================================================

export interface DataBarFormState {
  positiveColor: string;
  negativeColor: string;
  showBorder: boolean;
  borderColor: string;
  /** Enhancement: Negative bar border color (separate from positive) */
  negativeBorderColor: string;
  gradient: boolean;
  axisPosition: CFDataBarAxisPosition;
  /** Enhancement: Axis color (the vertical line at zero point) */
  axisColor: string;
  showValue: boolean;
  minType: CFValueType;
  minValue?: number;
  maxType: CFValueType;
  maxValue?: number;
}

interface DataBarOptionsProps {
  value: DataBarFormState;
  onChange: (value: DataBarFormState) => void;
}

// =============================================================================
// Value Type Options
// =============================================================================

const VALUE_TYPE_OPTIONS: { value: CFValueType; label: string }[] = [
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent' },
  { value: 'percentile', label: 'Percentile' },
];

const AXIS_POSITION_OPTIONS: { value: CFDataBarAxisPosition; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'midpoint', label: 'Cell Midpoint' },
  { value: 'none', label: 'None' },
];

// =============================================================================
// Default Values
// =============================================================================

export function getDefaultDataBarState(): DataBarFormState {
  return {
    positiveColor: '#638ec6',
    negativeColor: '#ff555a',
    showBorder: false,
    borderColor: '#638ec6',
    negativeBorderColor: '#ff555a',
    gradient: true,
    axisPosition: 'automatic',
    axisColor: '#000000',
    showValue: true,
    minType: 'min',
    minValue: undefined,
    maxType: 'max',
    maxValue: undefined,
  };
}

// =============================================================================
// Component
// =============================================================================

export function DataBarOptions({ value, onChange }: DataBarOptionsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Update a single field
  const updateField = <K extends keyof DataBarFormState>(
    field: K,
    newValue: DataBarFormState[K],
  ) => {
    onChange({ ...value, [field]: newValue });
  };

  // Draw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw data bar preview
    const padding = 4;
    const barHeight = height * 0.6;
    const barY = (height - barHeight) / 2;
    const barWidth = (width - padding * 2) * 0.7; // 70% fill for preview
    const barX = padding;

    // Create fill style
    if (value.gradient) {
      const gradientFill = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
      gradientFill.addColorStop(0, adjustAlpha(value.positiveColor, 0.3));
      gradientFill.addColorStop(1, value.positiveColor);
      ctx.fillStyle = gradientFill;
    } else {
      ctx.fillStyle = adjustAlpha(value.positiveColor, 0.7);
    }

    // Draw rounded rect
    const cornerRadius = Math.min(3, barHeight / 4);
    drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
    ctx.fill();

    // Draw border if enabled
    if (value.showBorder) {
      ctx.strokeStyle = value.borderColor;
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
      ctx.stroke();
    } else {
      // Subtle default border
      ctx.strokeStyle = adjustAlpha(value.positiveColor, 0.9);
      ctx.lineWidth = 0.5;
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, cornerRadius);
      ctx.stroke();
    }
  }, [value]);

  return (
    <div>
      {/* Color Section */}
      <div className="mb-4">
        <Label>Bar Colors</Label>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <ColorInput
              size="md"
              value={value.positiveColor}
              onChange={(e) => updateField('positiveColor', e.target.value)}
            />
            <span className="text-body-sm text-ss-text-secondary">Positive</span>
          </div>
          <div className="flex items-center gap-2">
            <ColorInput
              size="md"
              value={value.negativeColor}
              onChange={(e) => updateField('negativeColor', e.target.value)}
            />
            <span className="text-body-sm text-ss-text-secondary">Negative</span>
          </div>
        </div>
      </div>

      {/* Border Section */}
      <div className="mb-4">
        <Checkbox
          checked={value.showBorder}
          onChange={(checked) => updateField('showBorder', checked)}
          label="Show bar border"
        />
        {value.showBorder && (
          <div className="mt-2 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <ColorInput
                size="md"
                value={value.borderColor}
                onChange={(e) => updateField('borderColor', e.target.value)}
              />
              <span className="text-body-sm text-ss-text-secondary">Positive border</span>
            </div>
            {/* Enhancement: Negative bar border color picker */}
            <div className="flex items-center gap-2">
              <ColorInput
                size="md"
                value={value.negativeBorderColor}
                onChange={(e) => updateField('negativeBorderColor', e.target.value)}
              />
              <span className="text-body-sm text-ss-text-secondary">Negative border</span>
            </div>
          </div>
        )}
      </div>

      {/* Fill Style Section */}
      <div className="mb-4">
        <Label>Bar Fill</Label>
        <RadioGroup
          name="barFill"
          value={value.gradient ? 'gradient' : 'solid'}
          onChange={(v) => updateField('gradient', v === 'gradient')}
          orientation="horizontal"
          options={[
            { value: 'gradient', label: 'Gradient fill' },
            { value: 'solid', label: 'Solid fill' },
          ]}
        />
      </div>

      {/* Axis Position */}
      <div className="mb-4">
        <Label>Bar Direction</Label>
        <div className="flex items-center gap-4">
          <Select
            className="min-w-[120px]"
            size="sm"
            value={value.axisPosition}
            onChange={(next) => updateField('axisPosition', next as CFDataBarAxisPosition)}
            options={AXIS_POSITION_OPTIONS}
          />
          {/* Enhancement: Axis color picker (visible when axis is not 'none') */}
          {value.axisPosition !== 'none' && (
            <div className="flex items-center gap-2">
              <ColorInput
                size="md"
                value={value.axisColor}
                onChange={(e) => updateField('axisColor', e.target.value)}
              />
              <span className="text-body-sm text-ss-text-secondary">Axis color</span>
            </div>
          )}
        </div>
      </div>

      {/* Show Value */}
      <div className="mb-4">
        <Checkbox
          checked={value.showValue}
          onChange={(checked) => updateField('showValue', checked)}
          label="Show cell value"
        />
      </div>

      {/* Min/Max Section */}
      <div className="mb-4 rounded border border-ss-border p-3">
        <div className="mb-2.5 text-body-sm font-medium text-text">Shortest &amp; Longest Bar</div>

        {/* Min */}
        <div className="mb-2.5 flex items-center gap-2">
          <span className="w-[70px] text-body-sm text-ss-text-secondary">Minimum:</span>
          <Select
            className="min-w-[110px]"
            size="sm"
            value={value.minType}
            onChange={(next) => updateField('minType', next as CFValueType)}
            options={VALUE_TYPE_OPTIONS}
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

        {/* Max */}
        <div className="flex items-center gap-2">
          <span className="w-[70px] text-body-sm text-ss-text-secondary">Maximum:</span>
          <Select
            className="min-w-[110px]"
            size="sm"
            value={value.maxType}
            onChange={(next) => updateField('maxType', next as CFValueType)}
            options={VALUE_TYPE_OPTIONS}
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
        <div className="flex items-center gap-2 rounded border border-ss-border bg-ss-surface p-2">
          <canvas ref={canvasRef} className="h-6 flex-1" />
          <div className="w-8 text-right text-body text-text">{value.showValue ? '75' : ''}</div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function adjustAlpha(color: string, alpha: number): string {
  let hex = color.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
