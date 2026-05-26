/**
 * Date Field Component
 *
 * Date picker input field for forms. Kernel-agnostic version.
 */

import * as React from 'react';
import type { UiCellValue } from '../types';
import type { DateFieldProps } from './types';

/**
 * Convert value to date string for input[type="date"].
 */
function toDateString(value: UiCellValue): string {
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

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  return '';
}

/**
 * Convert value to datetime-local string.
 */
function toDateTimeString(value: UiCellValue): string {
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

  if (value instanceof Date) {
    return value.toISOString().slice(0, 16);
  }

  return '';
}

/**
 * Date input field.
 */
export function DateField({
  fieldId,
  label,
  value,
  error,
  placeholder,
  required,
  disabled,
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

  const inputClasses = `w-full px-3 py-2 text-body border rounded-ss-sm outline-none transition-colors focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary-light ${
    error ? 'border-ss-error' : 'border-ss-border'
  } ${disabled ? 'bg-ss-bg-disabled text-ss-text-disabled cursor-not-allowed' : ''}`;

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <input
      type={includeTime ? 'datetime-local' : 'date'}
      id={id}
      value={inputValue}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={inputClasses}
    />
  );
}
