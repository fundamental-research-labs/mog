/**
 * Progress Column Renderer
 *
 * Renders progress/percentage values with support for:
 * - Progress bar display
 * - Percentage label
 * - Color customization
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize progress value to 0-100 range.
 * Handles both 0-1 and 0-100 inputs.
 */
function normalizeProgress(value: number | null): number {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  // If value is between 0 and 1, treat as percentage
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  // Clamp to 0-100
  return Math.max(0, Math.min(100, value));
}

/**
 * Get progress bar color based on value.
 */
function getProgressColor(percent: number): string {
  if (percent >= 100) {
    return '#4CAF50'; // Green
  }
  if (percent >= 75) {
    return '#8BC34A'; // Light green
  }
  if (percent >= 50) {
    return '#FFC107'; // Yellow
  }
  if (percent >= 25) {
    return '#FF9800'; // Orange
  }
  return '#F44336'; // Red
}

// =============================================================================
// Progress Bar Component
// =============================================================================

const ProgressBar: React.FC<{
  percent: number;
  height?: number;
  showLabel?: boolean;
  color?: string;
}> = ({ percent, height = 8, showLabel = true, color }) => {
  const barColor = color || getProgressColor(percent);

  return (
    <span className="progress-bar-container inline-flex items-center gap-2 w-full">
      <span
        className="progress-bar flex-1 bg-ss-surface-tertiary overflow-hidden"
        style={{ height, borderRadius: height / 2 }}
      >
        <span
          className="progress-bar-fill block h-full transition-[width] duration-ss ease-out"
          style={{
            width: `${percent}%`,
            backgroundColor: barColor,
            borderRadius: height / 2,
          }}
        />
      </span>
      {showLabel && (
        <span className="progress-label text-caption text-ss-text-secondary min-w-[36px] text-right">
          {Math.round(percent)}%
        </span>
      )}
    </span>
  );
};

// =============================================================================
// Display Renderer
// =============================================================================

function renderProgress(value: number | null, _column: ColumnSchema): React.ReactNode {
  const percent = normalizeProgress(value);

  return <ProgressBar percent={percent} height={6} showLabel />;
}

// =============================================================================
// Editor Component
// =============================================================================

const ProgressEditor: React.FC<ColumnEditorProps<'progress'>> = ({
  value,
  column: _column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const percent = normalizeProgress(value);
  const [inputValue, setInputValue] = useState(String(Math.round(percent)));

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newPercent = parseInt(e.target.value, 10);
      setInputValue(String(newPercent));
      onChange(newPercent);
    },
    [onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      const num = parseInt(val, 10);
      if (!isNaN(num)) {
        onChange(Math.max(0, Math.min(100, num)));
      }
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCommit, onCancel],
  );

  const handleBlur = useCallback(() => {
    onCommit();
  }, [onCommit]);

  return (
    <div
      className={`progress-editor flex flex-col gap-ss-2 ${className}`}
      style={{
        padding: '8px',
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-ss-2">
        <input
          type="range"
          min="0"
          max="100"
          value={percent}
          onChange={handleSliderChange}
          onBlur={handleBlur}
          disabled={disabled}
          style={{ flex: 1 }}
        />
        <input
          ref={inputRef}
          type="number"
          min="0"
          max="100"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          disabled={disabled}
          style={{
            width: '60px',
            padding: '4px',
            textAlign: 'right',
          }}
        />
        <span>%</span>
      </div>
      <ProgressBar percent={percent} height={8} showLabel={false} />
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const ProgressCardField: React.FC<CardFieldProps<'progress'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  const percent = normalizeProgress(value);

  if (compact) {
    // Show only percentage in compact mode
    return (
      <span
        className={`progress-card-field compact text-hint font-medium ${className}`}
        style={{ color: getProgressColor(percent) }}
      >
        {Math.round(percent)}%
      </span>
    );
  }

  return (
    <span className={`progress-card-field inline-block w-full max-w-[120px] ${className}`}>
      <ProgressBar percent={percent} height={4} showLabel />
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const ProgressFormField: React.FC<FormFieldProps<'progress'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;
  const percent = normalizeProgress(value);
  const [inputValue, setInputValue] = useState(String(Math.round(percent)));

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newPercent = parseInt(e.target.value, 10);
      setInputValue(String(newPercent));
      onChange(newPercent);
    },
    [onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setInputValue(val);
      const num = parseInt(val, 10);
      if (!isNaN(num)) {
        onChange(Math.max(0, Math.min(100, num)));
      }
    },
    [onChange],
  );

  return (
    <div className={`progress-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <div className="mt-ss-2">
        <ProgressBar percent={percent} height={12} showLabel />

        <div className="flex items-center gap-ss-2 mt-ss-2">
          <input
            id={inputId}
            type="range"
            min="0"
            max="100"
            value={percent}
            onChange={handleSliderChange}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min="0"
            max="100"
            value={inputValue}
            onChange={handleInputChange}
            disabled={disabled}
            style={{
              width: '60px',
              padding: '4px',
              textAlign: 'right',
            }}
          />
          <span>%</span>
        </div>
      </div>

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const ProgressRenderer: ColumnRenderer<'progress'> = {
  render: renderProgress,
  editor: ProgressEditor,
  cardField: ProgressCardField,
  formField: ProgressFormField,
};
