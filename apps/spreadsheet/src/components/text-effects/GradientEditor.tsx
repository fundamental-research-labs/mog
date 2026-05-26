/**
 * Gradient Editor Component
 *
 * Panel for configuring TextEffect gradient fills.
 * Provides controls for gradient type, angle, and color stops.
 *
 * Fill Picker Panel (supporting component)
 */

import type { ReactElement } from 'react';
import { useCallback } from 'react';

import { ColorInput } from '@mog/shell';
import type { GradientFill, GradientStop, GradientType } from '@mog-sdk/contracts/text-effects';
// =============================================================================
// Types
// =============================================================================

export interface GradientEditorProps {
  /** Current gradient configuration (undefined = use defaults) */
  gradient?: GradientFill;
  /** Callback when gradient changes */
  onChange: (gradient: Omit<GradientFill, 'type'>) => void;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_GRADIENT: Omit<GradientFill, 'type'> = {
  gradientType: 'linear',
  angle: 90,
  stops: [
    { position: 0, color: 'var(--color-ss-accent-1)', opacity: 1 },
    { position: 100, color: '#1E3A5F', opacity: 1 },
  ],
};

const GRADIENT_TYPES: { id: GradientType; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
];

const PRESET_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

// =============================================================================
// GradientEditor Component
// =============================================================================

/**
 * Gradient Editor for TextEffect fills.
 *
 * Provides controls for:
 * - Gradient type (linear/radial)
 * - Angle (for linear gradients)
 * - Color stops (start and end colors)
 */
export function GradientEditor({ gradient, onChange }: GradientEditorProps): ReactElement {
  // Use current gradient or defaults
  const currentGradient = gradient ?? DEFAULT_GRADIENT;

  // Handle gradient type change
  const handleTypeChange = useCallback(
    (gradientType: GradientType) => {
      onChange({
        ...currentGradient,
        gradientType,
      });
    },
    [currentGradient, onChange],
  );

  // Handle angle change
  const handleAngleChange = useCallback(
    (angle: number) => {
      onChange({
        ...currentGradient,
        angle,
      });
    },
    [currentGradient, onChange],
  );

  // Handle color stop change
  const handleStopChange = useCallback(
    (index: number, stop: Partial<GradientStop>) => {
      const newStops = [...currentGradient.stops];
      newStops[index] = { ...newStops[index], ...stop };
      onChange({
        ...currentGradient,
        stops: newStops,
      });
    },
    [currentGradient, onChange],
  );

  return (
    <div className="space-y-4">
      {/* Gradient Type */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-1">Type</label>
        <div className="flex gap-2">
          {GRADIENT_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              className={`
 px-3 py-1.5 text-body-sm rounded border transition-colors
 ${
   currentGradient.gradientType === type.id
     ? 'bg-ss-primary text-ss-text-inverse border-ss-primary'
     : 'bg-ss-surface border-ss-border text-ss-text hover:bg-ss-surface-hover'
 }
 `}
              onClick={() => handleTypeChange(type.id)}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Angle (for linear gradients) */}
      {currentGradient.gradientType === 'linear' && (
        <div>
          <label className="text-caption text-ss-text-secondary block mb-1">
            Angle: {currentGradient.angle ?? 90}deg
          </label>
          <div className="flex flex-wrap gap-1">
            {PRESET_ANGLES.map((angle) => (
              <button
                key={angle}
                type="button"
                className={`
 w-8 h-8 text-caption rounded border transition-colors
 flex items-center justify-center
 ${
   currentGradient.angle === angle
     ? 'bg-ss-primary text-ss-text-inverse border-ss-primary'
     : 'bg-ss-surface border-ss-border text-ss-text-secondary hover:bg-ss-surface-hover'
 }
 `}
                onClick={() => handleAngleChange(angle)}
                title={`${angle} degrees`}
              >
                {angle}
              </button>
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="360"
            value={currentGradient.angle ?? 90}
            onChange={(e) => handleAngleChange(Number(e.target.value))}
            className="w-full mt-2"
          />
        </div>
      )}

      {/* Color Stops */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-2">Colors</label>
        <div className="space-y-2">
          {currentGradient.stops.map((stop: GradientStop, index: number) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-caption text-ss-text-secondary w-12">
                {index === 0
                  ? 'Start'
                  : index === currentGradient.stops.length - 1
                    ? 'End'
                    : `${stop.position}%`}
              </span>
              <ColorInput
                value={stop.color}
                onChange={(e) => handleStopChange(index, { color: e.target.value })}
                size="sm"
              />
              <span className="text-caption text-ss-text-secondary font-mono">{stop.color}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div>
        <label className="text-caption text-ss-text-secondary block mb-1">Preview</label>
        <div
          className="h-8 rounded border border-ss-border"
          style={{
            background:
              currentGradient.gradientType === 'linear'
                ? `linear-gradient(${currentGradient.angle ?? 90}deg, ${currentGradient.stops.map((s: GradientStop) => `${s.color} ${s.position}%`).join(', ')})`
                : `radial-gradient(circle, ${currentGradient.stops.map((s: GradientStop) => `${s.color} ${s.position}%`).join(', ')})`,
          }}
        />
      </div>
    </div>
  );
}
