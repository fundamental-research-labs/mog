/**
 * Person Field Component
 *
 * User/person selector field for forms. Simplified kernel-agnostic version.
 */

import * as React from 'react';
import type { PersonFieldProps } from './types';

/**
 * Person/user selector field.
 * Simplified version that shows name/avatar.
 */
export function PersonField({
  fieldId,
  label,
  value,
  error,
  placeholder = 'Select a person...',
  required,
  disabled,
  options = [],
  onChange,
}: PersonFieldProps): React.ReactElement {
  const stringValue = value === null || value === undefined ? '' : String(value);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue === '' ? null : newValue);
    },
    [onChange],
  );

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  const inputClasses = `w-full px-3 py-2 text-body border rounded-ss-sm outline-none transition-colors focus:border-ss-border-focus focus:ring-1 focus:ring-ss-primary-light ${
    error ? 'border-ss-error' : 'border-ss-border'
  } ${disabled ? 'bg-ss-bg-disabled text-ss-text-disabled cursor-not-allowed' : ''}`;

  // If no options provided, render as text input (for manual entry)
  if (options.length === 0) {
    return (
      <input
        type="text"
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

  // Render as select with options
  return (
    <select
      id={id}
      value={stringValue}
      required={required}
      disabled={disabled}
      aria-label={label}
      aria-invalid={!!error}
      onChange={handleChange}
      className={`${inputClasses} bg-white cursor-pointer`}
    >
      <option value="">{placeholder}</option>
      {options.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name} {person.email ? `(${person.email})` : ''}
        </option>
      ))}
    </select>
  );
}
