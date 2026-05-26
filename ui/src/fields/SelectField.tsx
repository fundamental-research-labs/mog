/**
 * Select Field Component
 *
 * Dropdown select field for forms. Kernel-agnostic version.
 */

import * as React from 'react';
import type { SelectFieldProps } from './types';

/**
 * Select dropdown field.
 */
export function SelectField({
  fieldId,
  label,
  value,
  error,
  placeholder,
  required,
  disabled,
  options,
  onChange,
}: SelectFieldProps): React.ReactElement {
  const stringValue = value === null || value === undefined ? '' : String(value);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = e.target.value;
      onChange(newValue === '' ? null : newValue);
    },
    [onChange],
  );

  const selectClasses = `w-full px-3 py-2 text-body border rounded-ss-sm outline-none transition-colors focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary-light bg-white cursor-pointer ${
    error ? 'border-ss-error' : 'border-ss-border'
  } ${disabled ? 'bg-ss-bg-disabled text-ss-text-disabled cursor-not-allowed' : ''}`;

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <select
      id={id}
      value={stringValue}
      required={required}
      disabled={disabled}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={selectClasses}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
