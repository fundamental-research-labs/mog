/**
 * Text Field Component
 *
 * Text input field for form view.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface TextFieldProps {
  /** Column ID */
  colId: string;
  /** Field label (for accessibility) */
  label: string;
  /** Current value */
  value: CellValue;
  /** Error message */
  error?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Whether field is required */
  required?: boolean;
  /** Change handler */
  onChange: (value: CellValue) => void;
  /** Whether to render as multiline textarea */
  multiline?: boolean;
  /** Number of rows for multiline */
  rows?: number;
  /** Input type (text, email, url, tel) */
  type?: 'text' | 'email' | 'url' | 'tel';
}

/**
 * Text input field.
 */
export function TextField({
  colId,
  label,
  value,
  error,
  placeholder,
  required,
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
  }`;

  if (multiline) {
    return (
      <textarea
        id={`field-${colId}`}
        name={colId}
        value={stringValue}
        placeholder={placeholder}
        required={required}
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
      id={`field-${colId}`}
      name={colId}
      value={stringValue}
      placeholder={placeholder}
      required={required}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={inputClasses}
    />
  );
}
