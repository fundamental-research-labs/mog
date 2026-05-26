/**
 * Rating Column Renderer
 *
 * Renders star rating values with support for:
 * - 1-5 star display (configurable max)
 * - Click to rate
 * - Half-star support (optional)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

function getMaxRating(column: ColumnSchema): number {
  return column.maxRating ?? 5;
}

// =============================================================================
// Star Component
// =============================================================================

const Star: React.FC<{
  filled: boolean;
  half?: boolean;
  size?: number;
  onClick?: () => void;
  onMouseEnter?: () => void;
  interactive?: boolean;
}> = ({ filled, half = false, size = 16, onClick, onMouseEnter, interactive = false }) => {
  const color = filled ? 'var(--color-ss-warning)' : 'var(--color-ss-border)';

  return (
    <span
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        fontSize: size,
        color: color,
        cursor: interactive ? 'pointer' : 'default',
        display: 'inline-block',
        position: 'relative',
      }}
    >
      {half ? (
        <span style={{ position: 'relative' }}>
          <span style={{ color: 'var(--color-ss-border)' }}>★</span>
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: '50%',
              overflow: 'hidden',
              color: 'var(--color-ss-warning)',
            }}
          >
            ★
          </span>
        </span>
      ) : (
        '★'
      )}
    </span>
  );
};

// =============================================================================
// Stars Display Component
// =============================================================================

const StarsDisplay: React.FC<{
  value: number | null;
  max: number;
  size?: number;
  interactive?: boolean;
  onChange?: (value: number) => void;
}> = ({ value, max, size = 16, interactive = false, onChange }) => {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value ?? 0;

  const handleClick = useCallback(
    (index: number) => {
      if (interactive && onChange) {
        onChange(index + 1);
      }
    },
    [interactive, onChange],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverValue(null);
  }, []);

  return (
    <span className="stars-display inline-flex gap-ss-0_5" onMouseLeave={handleMouseLeave}>
      {Array.from({ length: max }, (_, index) => (
        <Star
          key={index}
          filled={index < displayValue}
          half={false}
          size={size}
          onClick={() => handleClick(index)}
          onMouseEnter={() => interactive && setHoverValue(index + 1)}
          interactive={interactive}
        />
      ))}
    </span>
  );
};

// =============================================================================
// Display Renderer
// =============================================================================

function renderRating(value: number | null, column: ColumnSchema): React.ReactNode {
  const max = getMaxRating(column);

  return <StarsDisplay value={value} max={max} size={14} />;
}

// =============================================================================
// Editor Component
// =============================================================================

const RatingEditor: React.FC<ColumnEditorProps<'rating'>> = ({
  value,
  column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const max = getMaxRating(column);

  useEffect(() => {
    if (autoFocus && containerRef.current) {
      containerRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (newValue: number) => {
      // Toggle off if clicking same value
      onChange(value === newValue ? null : newValue);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onChange(Math.max(0, (value ?? 0) - 1) || null);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onChange(Math.min(max, (value ?? 0) + 1));
      }
    },
    [value, max, onChange, onCommit, onCancel],
  );

  const handleBlur = useCallback(() => {
    onCommit();
  }, [onCommit]);

  return (
    <div
      ref={containerRef}
      className={`rating-editor ${className}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '4px',
        outline: 'none',
      }}
    >
      <StarsDisplay
        value={value}
        max={max}
        size={20}
        interactive={!disabled}
        onChange={handleChange}
      />
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const RatingCardField: React.FC<CardFieldProps<'rating'>> = ({
  value,
  column,
  compact = false,
  className = '',
}) => {
  const max = getMaxRating(column);

  if (compact) {
    // Show numeric value instead of stars in compact mode
    if (value === null || value === undefined) {
      return null;
    }
    return (
      <span className={`rating-card-field compact ${className}`}>
        <span style={{ color: 'var(--color-ss-warning)' }}>★</span>
        <span className="text-hint ml-ss-0_5">
          {value}/{max}
        </span>
      </span>
    );
  }

  return (
    <span className={`rating-card-field ${className}`}>
      <StarsDisplay value={value} max={max} size={12} />
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const RatingFormField: React.FC<FormFieldProps<'rating'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;
  const max = getMaxRating(column);

  const handleChange = useCallback(
    (newValue: number) => {
      // Toggle off if clicking same value
      onChange(value === newValue ? null : newValue);
    },
    [value, onChange],
  );

  return (
    <div className={`rating-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <div className="mt-ss-1">
        <StarsDisplay
          value={value}
          max={max}
          size={24}
          interactive={!disabled}
          onChange={handleChange}
        />
        {value !== null && (
          <span className="ml-ss-2 text-ss-text-secondary">
            {value} of {max}
          </span>
        )}
      </div>

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const RatingRenderer: ColumnRenderer<'rating'> = {
  render: renderRating,
  editor: RatingEditor,
  cardField: RatingCardField,
  formField: RatingFormField,
};
