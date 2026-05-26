/**
 * Number Field Component
 *
 * Numeric input field for form view.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface NumberFieldProps {
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
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Change handler */
  onChange: (value: CellValue) => void;
}

/**
 * Number input field.
 */
export function NumberField({
  colId,
  label,
  value,
  error,
  placeholder,
  required,
  min,
  max,
  step,
  onChange,
}: NumberFieldProps): React.ReactElement {
  // Convert value to string for input
  const stringValue = React.useMemo(() => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    return '';
  }, [value]);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;
      if (inputValue === '') {
        onChange(null);
      } else {
        const numValue = parseFloat(inputValue);
        if (!isNaN(numValue)) {
          onChange(numValue);
        }
      }
    },
    [onChange],
  );

  const inputClassName = `w-full px-3 py-2 text-body-sm border rounded-ss-sm outline-none transition-colors duration-ss-fast ${
    error ? 'border-ss-error' : 'border-ss-border'
  }`;

  return (
    <input
      type="number"
      id={`field-${colId}`}
      name={colId}
      value={stringValue}
      placeholder={placeholder}
      required={required}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={inputClassName}
    />
  );
}
