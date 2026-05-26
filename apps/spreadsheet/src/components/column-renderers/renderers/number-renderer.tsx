/**
 * Number Column Renderer
 *
 * Renders numeric values with support for:
 * - Decimal formatting
 * - Currency display
 * - Percentage display
 * - Thousands separators
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatNumber(value: number | null, column: ColumnSchema): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const format = column.numberFormat;
  const decimals = format?.decimals ?? 2;
  const prefix = format?.prefix ?? '';
  const suffix = format?.suffix ?? '';

  // Format the number
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${prefix}${formatted}${suffix}`;
}

function parseNumber(input: string): number | null {
  if (!input || input.trim() === '') {
    return null;
  }

  // Remove currency symbols and whitespace
  const cleaned = input
    .replace(/[$\u20AC\u00A3\u00A5]/g, '') // Remove $, EUR, GBP, JPY
    .replace(/,/g, '') // Remove thousands separators
    .replace(/%$/, '') // Remove trailing %
    .trim();

  const num = parseFloat(cleaned);

  // Handle percentage
  if (input.trim().endsWith('%') && !isNaN(num)) {
    return num / 100;
  }

  return isNaN(num) ? null : num;
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderNumber(value: number | null, column: ColumnSchema): React.ReactNode {
  if (value === null || value === undefined || isNaN(value)) {
    return null;
  }

  const formatted = formatNumber(value, column);

  return (
    <span className="number-renderer" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatted}
    </span>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const NumberEditor: React.FC<ColumnEditorProps<'number'>> = ({
  value,
  column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = React.useState(() => (value !== null ? String(value) : ''));

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      const parsed = parseNumber(e.target.value);
      onChange(parsed);
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
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={inputValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      className={`number-editor ${className}`}
      placeholder={column.name}
      style={{ textAlign: 'right' }}
    />
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const NumberCardField: React.FC<CardFieldProps<'number'>> = ({
  value,
  column,
  compact = false,
  className = '',
}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return null;
  }

  const formatted = formatNumber(value, column);

  return (
    <span
      className={`number-card-field ${compact ? 'compact' : ''} ${className}`}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {formatted}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const NumberFormField: React.FC<FormFieldProps<'number'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const [inputValue, setInputValue] = React.useState(() => (value !== null ? String(value) : ''));

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
      const parsed = parseNumber(e.target.value);
      onChange(parsed);
    },
    [onChange],
  );

  const inputId = `form-field-${column.id}`;
  const format = column.numberFormat;
  const prefix = format?.prefix ?? '';
  const suffix = format?.suffix ?? '';

  return (
    <div className={`number-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <div className="number-input-wrapper">
        {prefix && <span className="prefix">{prefix}</span>}
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? '0'}
          style={{ textAlign: 'right' }}
        />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const NumberRenderer: ColumnRenderer<'number'> = {
  render: renderNumber,
  editor: NumberEditor,
  cardField: NumberCardField,
  formField: NumberFormField,
};
