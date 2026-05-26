/**
 * Checkbox Field Component
 *
 * Boolean checkbox field for forms. Kernel-agnostic version.
 */

import * as React from 'react';
import type { CheckboxFieldProps } from './types';

/**
 * Checkbox input field.
 */
export function CheckboxField({
  fieldId,
  label,
  value,
  error,
  disabled,
  onChange,
}: CheckboxFieldProps): React.ReactElement {
  // Convert value to boolean
  const checked = React.useMemo(() => {
    if (value === true || value === 'true' || value === 1 || value === 'TRUE') {
      return true;
    }
    return false;
  }, [value]);

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked);
    },
    [onChange],
  );

  const id = fieldId || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-invalid={!!error}
        onChange={handleChange}
        className={`w-[18px] h-[18px] cursor-pointer ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
      />
      <label
        htmlFor={id}
        className={`cursor-pointer ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        {label}
      </label>
    </div>
  );
}
