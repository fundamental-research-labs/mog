/**
 * Text Field Component
 *
 * Text input field for forms. Kernel-agnostic version.
 */

import * as React from 'react';
import type { TextFieldProps } from './types';

/**
 * Text input field.
 */
export function TextField({
  fieldId,
  label,
  value,
  error,
  placeholder,
  required,
  disabled,
  onChange,
  multiline = false,
  rows = 3,
  type = 'text',
}: TextFieldProps): React.ReactElement {
  const stringValue = value === null || value === undefined ? '' : String(value);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue === '' ? null : newValue);
    },
    [onChange],
  );

  const inputClasses = `w-full px-3 py-2 text-body border rounded-ss-sm outline-none transition-colors focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary-light ${
    error ? 'border-ss-error' : 'border-ss-border'
  } ${disabled ? 'bg-ss-bg-disabled text-ss-text-disabled cursor-not-allowed' : ''}`;

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  if (multiline) {
    return (
      <textarea
        id={id}
        value={stringValue}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        rows={rows}
        aria-label={label}
        aria-invalid={!!error}
        onChange={handleChange}
        className={inputClasses}
      />
    );
  }

  return (
    <input
      type={type}
      id={id}
      value={stringValue}
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
