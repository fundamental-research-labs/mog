/**
 * Select Field Component
 *
 * Dropdown select field for form view.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface SelectOption {
  /** Option value */
  value: string;
  /** Display label */
  label: string;
  /** Optional color for the option */
  color?: string;
}

export interface SelectFieldProps {
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
  /** Available options */
  options: SelectOption[];
  /** Change handler */
  onChange: (value: CellValue) => void;
}

/**
 * Select dropdown field.
 */
export function SelectField({
  colId,
  label,
  value,
  error,
  placeholder,
  required,
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

  const selectClassName = `w-full px-3 py-2 text-body-sm border rounded-ss-sm outline-none transition-colors duration-ss-fast cursor-pointer bg-ss-surface ${
    error ? 'border-ss-error' : 'border-ss-border'
  }`;

  return (
    <select
      id={`field-${colId}`}
      name={colId}
      value={stringValue}
      required={required}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={selectClassName}
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
