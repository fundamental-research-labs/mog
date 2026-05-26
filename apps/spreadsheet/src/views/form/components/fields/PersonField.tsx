/**
 * Person Field Component
 *
 * User/person selector field for form view.
 * Simplified implementation - can be enhanced with user search/autocomplete.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface PersonOption {
  /** User ID */
  id: string;
  /** Display name */
  name: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Email address */
  email?: string;
}

export interface PersonFieldProps {
  /** Column ID */
  colId: string;
  /** Field label (for accessibility) */
  label: string;
  /** Current value (user ID or name) */
  value: CellValue;
  /** Error message */
  error?: string | null;
  /** Placeholder text */
  placeholder?: string;
  /** Whether field is required */
  required?: boolean;
  /** Available person options */
  options?: PersonOption[];
  /** Whether multiple selections are allowed */
  multi?: boolean;
  /** Change handler */
  onChange: (value: CellValue) => void;
}

/**
 * Person/user selector field.
 * Currently implemented as a simple dropdown - could be enhanced with
 * avatar display, search/autocomplete, etc.
 */
export function PersonField({
  colId,
  label,
  value,
  error,
  placeholder = 'Select a person...',
  required,
  options = [],
  onChange,
}: PersonFieldProps): React.ReactElement {
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

  // If no options provided, render as text input (for manual entry)
  if (options.length === 0) {
    return (
      <input
        type="text"
        id={`field-${colId}`}
        name={colId}
        value={stringValue}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value || null)}
        className={selectClassName}
      />
    );
  }

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
      <option value="">{placeholder}</option>
      {options.map((person) => (
        <option key={person.id} value={person.id}>
          {person.name} {person.email ? `(${person.email})` : ''}
        </option>
      ))}
    </select>
  );
}
