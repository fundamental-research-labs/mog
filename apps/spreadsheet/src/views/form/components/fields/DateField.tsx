/**
 * Date Field Component
 *
 * Date picker input field for form view.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface DateFieldProps {
  /** Column ID */
  colId: string;
  /** Field label (for accessibility) */
  label: string;
  /** Current value (as date string or serial number) */
  value: CellValue;
  /** Error message */
  error?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Whether field is required */
  required?: boolean;
  /** Whether to include time input */
  includeTime?: boolean;
  /** Change handler */
  onChange: (value: CellValue) => void;
}

/**
 * Convert value to date string for input[type="date"].
 */
function toDateString(value: CellValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    // Try to parse as ISO date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return value;
  }

  if (typeof value === 'number') {
    // Excel serial date number
    // Excel dates start from 1900-01-01 (serial 1)
    // We need to convert to JS Date
    const excelEpoch = new Date(1899, 11, 30); // Excel epoch
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().split('T')[0];
  }

  return '';
}

/**
 * Convert value to datetime-local string.
 */
function toDateTimeString(value: CellValue): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().slice(0, 16);
    }
    return '';
  }

  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().slice(0, 16);
  }

  return '';
}

/**
 * Date input field.
 */
export function DateField({
  colId,
  label,
  value,
  error,
  placeholder,
  required,
  includeTime = false,
  onChange,
}: DateFieldProps): React.ReactElement {
  const inputValue = includeTime ? toDateTimeString(value) : toDateString(value);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      if (newValue === '') {
        onChange(null);
      } else {
        // Store as ISO string
        onChange(newValue);
      }
    },
    [onChange],
  );

  const inputClassName = `w-full px-3 py-2 text-body-sm border rounded-ss-sm outline-none transition-colors duration-ss-fast ${
    error ? 'border-ss-error' : 'border-ss-border'
  }`;

  return (
    <input
      type={includeTime ? 'datetime-local' : 'date'}
      id={`field-${colId}`}
      name={colId}
      value={inputValue}
      placeholder={placeholder}
      required={required}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={inputClassName}
    />
  );
}
