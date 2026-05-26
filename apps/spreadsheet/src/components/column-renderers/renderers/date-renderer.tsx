/**
 * Date Column Renderer
 *
 * Renders date values with support for:
 * - Date formatting
 * - Date picker editor
 * - Optional time display
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format a date value for display.
 * Handles both ISO strings and Excel serial numbers.
 */
function formatDate(value: string | number | null, column: ColumnSchema): string {
  if (value === null || value === undefined) {
    return '';
  }

  let date: Date;

  if (typeof value === 'number') {
    // Excel serial number - convert to JS Date
    // Excel uses days since 1900-01-01 (with a bug for leap year 1900)
    const excelEpoch = new Date(1899, 11, 30);
    date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    return '';
  }

  if (isNaN(date.getTime())) {
    return String(value);
  }

  const includeTime = column.includeTime ?? false;

  if (includeTime) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format date for input[type="date"] value (YYYY-MM-DD).
 */
function toInputDateValue(value: string | number | null): string {
  if (value === null || value === undefined) {
    return '';
  }

  let date: Date;

  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
  } else {
    date = new Date(value);
  }

  if (isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().split('T')[0];
}

/**
 * Parse input date string to ISO format.
 */
function parseInputDate(input: string): string | null {
  if (!input) {
    return null;
  }

  const date = new Date(input);
  if (isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderDate(value: string | number | null, column: ColumnSchema): React.ReactNode {
  if (value === null || value === undefined) {
    return null;
  }

  const formatted = formatDate(value, column);

  if (!formatted) {
    return null;
  }

  return <span className="date-renderer">{formatted}</span>;
}

// =============================================================================
// Editor Component
// =============================================================================

const DateEditor: React.FC<ColumnEditorProps<'date'>> = ({
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
  const includeTime = column.includeTime ?? false;

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseInputDate(e.target.value);
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
      type={includeTime ? 'datetime-local' : 'date'}
      value={toInputDateValue(value)}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      className={`date-editor ${className}`}
    />
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const DateCardField: React.FC<CardFieldProps<'date'>> = ({
  value,
  column,
  compact = false,
  className = '',
}) => {
  if (value === null || value === undefined) {
    return null;
  }

  // For compact mode, show shorter date format
  let displayValue: string;
  if (compact) {
    let date: Date;
    if (typeof value === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    } else {
      date = new Date(value);
    }

    if (isNaN(date.getTime())) {
      displayValue = String(value);
    } else {
      displayValue = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
  } else {
    displayValue = formatDate(value, column);
  }

  if (!displayValue) {
    return null;
  }

  return (
    <span className={`date-card-field ${compact ? 'compact' : ''} ${className}`}>
      {displayValue}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const DateFormField: React.FC<FormFieldProps<'date'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const includeTime = column.includeTime ?? false;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseInputDate(e.target.value);
      onChange(parsed);
    },
    [onChange],
  );

  const inputId = `form-field-${column.id}`;

  return (
    <div className={`date-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <input
        id={inputId}
        type={includeTime ? 'datetime-local' : 'date'}
        value={toInputDateValue(value)}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const DateRenderer: ColumnRenderer<'date'> = {
  render: renderDate,
  editor: DateEditor,
  cardField: DateCardField,
  formField: DateFormField,
};
