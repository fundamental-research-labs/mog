/**
 * Number Field Component
 *
 * Numeric input field for forms. Kernel-agnostic version.
 */

import * as React from 'react';
import type { NumberFieldProps } from './types';

/**
 * Number input field.
 */
export function NumberField({
  fieldId,
  label,
  value,
  error,
  placeholder,
  required,
  disabled,
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

  const inputClasses = `w-full px-3 py-2 text-body border rounded-ss-sm outline-none transition-colors focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary-light ${
    error ? 'border-ss-error' : 'border-ss-border'
  } ${disabled ? 'bg-ss-bg-disabled text-ss-text-disabled cursor-not-allowed' : ''}`;

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <input
      type="number"
      id={id}
      value={stringValue}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={inputClasses}
    />
  );
}
