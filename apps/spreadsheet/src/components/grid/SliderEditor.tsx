/**
 * SliderEditor Component
 *
 * Inline slider editor for cells with bounded number schema (min/max constraints).
 * Renders directly in the cell editing area, not as a popup.
 *
 * Issue 2: Cell Dropdowns / In-Cell Pickers
 *
 * @module components/SliderEditor
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

// =============================================================================
// Types
// =============================================================================

export interface SliderEditorProps {
  /** Current value in the editor */
  currentValue: string;
  /** Minimum value from schema constraints */
  min: number;
  /** Maximum value from schema constraints */
  max: number;
  /** Step value (defaults to 1 for integers, 0.1 for decimals) */
  step?: number;
  /** Called when the value changes */
  onChange: (value: string) => void;
  /** Called when editing is committed (Enter/Tab) */
  onCommit: (direction: 'none' | 'down' | 'right') => void;
  /** Called when editing is cancelled (Escape) */
  onCancel: () => void;
  /** Position of the editor */
  position: { x: number; y: number };
  /** Width hint (matches cell width) */
  width: number;
  /** Height hint (matches cell height) */
  height: number;
  /** Whether the cell type is integer */
  isInteger?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function SliderEditor({
  currentValue,
  min,
  max,
  step: stepProp,
  onChange,
  onCommit,
  onCancel,
  position,
  width,
  height,
  isInteger = false,
}: SliderEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse current value to number, default to min if invalid
  const numericValue = (() => {
    const parsed = parseFloat(currentValue);
    if (isNaN(parsed)) return min;
    return Math.min(Math.max(parsed, min), max);
  })();

  // Local state for slider value (syncs with editor value)
  const [sliderValue, setSliderValue] = useState(numericValue);

  // Determine step: use prop, or infer from integer type or range
  const step = stepProp ?? (isInteger ? 1 : inferStep(min, max));

  // Update local state when currentValue changes
  useEffect(() => {
    const parsed = parseFloat(currentValue);
    if (!isNaN(parsed)) {
      setSliderValue(Math.min(Math.max(parsed, min), max));
    }
  }, [currentValue, min, max]);

  // Handle slider change
  const handleSliderChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = parseFloat(e.target.value);
      setSliderValue(value);
      // Format value: integer or decimal
      const formatted = isInteger ? String(Math.round(value)) : formatValue(value, step);
      onChange(formatted);
    },
    [onChange, isInteger, step],
  );

  // Handle direct input change
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      // Allow typing any value (validation on commit)
      onChange(value);

      // Update slider if valid number
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        setSliderValue(Math.min(Math.max(parsed, min), max));
      }
    },
    [onChange, min, max],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          onCommit('down');
          break;

        case 'Tab':
          e.preventDefault();
          onCommit(e.shiftKey ? 'none' : 'right');
          break;

        case 'Escape':
          e.preventDefault();
          onCancel();
          break;

        case 'ArrowUp':
        case 'ArrowDown': {
          // Only handle if not focused on the input field
          if (document.activeElement === inputRef.current) return;

          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? step : -step;
          const newValue = Math.min(Math.max(sliderValue + delta, min), max);
          setSliderValue(newValue);
          const formatted = isInteger ? String(Math.round(newValue)) : formatValue(newValue, step);
          onChange(formatted);
          break;
        }

        case 'PageUp':
        case 'PageDown': {
          e.preventDefault();
          // Larger jump: 10% of range or 10 * step
          const rangeJump = Math.max((max - min) * 0.1, step * 10);
          const delta = e.key === 'PageUp' ? rangeJump : -rangeJump;
          const newValue = Math.min(Math.max(sliderValue + delta, min), max);
          setSliderValue(newValue);
          const formatted = isInteger ? String(Math.round(newValue)) : formatValue(newValue, step);
          onChange(formatted);
          break;
        }

        case 'Home':
          e.preventDefault();
          setSliderValue(min);
          onChange(isInteger ? String(Math.round(min)) : formatValue(min, step));
          break;

        case 'End':
          e.preventDefault();
          setSliderValue(max);
          onChange(isInteger ? String(Math.round(max)) : formatValue(max, step));
          break;

        default:
          break;
      }
    },
    [sliderValue, min, max, step, isInteger, onChange, onCommit, onCancel],
  );

  // Focus container on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Calculate progress percentage for track fill
  const progress = ((sliderValue - min) / (max - min)) * 100;

  return (
    <div
      ref={containerRef}
      data-slider-editor
      className="absolute z-ss-modal bg-ss-surface border border-ss-primary rounded shadow-ss-sm flex items-center gap-2 px-2"
      style={{
        left: position.x,
        top: position.y,
        width: Math.max(width, 180),
        height: Math.max(height, 28),
        boxSizing: 'border-box',
      }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Value input (narrow, for direct editing) */}
      <input
        ref={inputRef}
        type="text"
        className="w-14 text-dropdown text-center border border-ss-border rounded px-1 py-0.5
 focus:border-ss-primary focus:outline-none"
        value={currentValue}
        onChange={handleInputChange}
        onKeyDown={(e) => {
          // Allow input to handle its own arrow keys for cursor movement
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.stopPropagation();
          }
        }}
        aria-label={`Value between ${min} and ${max}`}
      />

      {/* Slider track */}
      <div className="flex-1 relative h-5 flex items-center">
        {/* Background track */}
        <div className="absolute w-full h-1.5 bg-ss-surface-hover rounded-full" />
        {/* Filled portion */}
        <div
          className="absolute h-1.5 bg-ss-primary rounded-full"
          style={{ width: `${progress}%` }}
        />
        {/* Range input (overlay) */}
        <input
          type="range"
          className="absolute w-full h-5 opacity-0 cursor-pointer"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={handleSliderChange}
          aria-label={`Slider from ${min} to ${max}`}
        />
        {/* Thumb indicator */}
        <div
          className="absolute w-4 h-4 bg-ss-surface border-2 border-ss-primary rounded-full
 shadow-ss-sm pointer-events-none transform -translate-x-1/2"
          style={{ left: `${progress}%` }}
        />
      </div>

      {/* Min/Max labels (optional, compact view) */}
      <div className="text-hint text-ss-text-tertiary whitespace-nowrap">
        {formatCompact(min)}–{formatCompact(max)}
      </div>
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Infer a reasonable step value from the range.
 */
function inferStep(min: number, max: number): number {
  const range = max - min;
  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  if (range <= 100) return 1;
  if (range <= 1000) return 10;
  return 100;
}

/**
 * Format a value to appropriate decimal places based on step.
 */
function formatValue(value: number, step: number): string {
  // Determine decimal places from step
  const stepStr = step.toString();
  const decimalIndex = stepStr.indexOf('.');
  const decimalPlaces = decimalIndex === -1 ? 0 : stepStr.length - decimalIndex - 1;
  return value.toFixed(decimalPlaces);
}

/**
 * Format a number compactly for display.
 */
function formatCompact(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // Show up to 2 decimal places, trim trailing zeros
  return value.toFixed(2).replace(/\.?0+$/, '');
}
