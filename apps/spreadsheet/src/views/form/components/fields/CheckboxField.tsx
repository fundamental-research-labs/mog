/**
 * Checkbox Field Component
 *
 * Boolean checkbox field for form view.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import * as React from 'react';
export interface CheckboxFieldProps {
  /** Column ID */
  colId: string;
  /** Field label (for accessibility) */
  label: string;
  /** Current value */
  value: CellValue;
  /** Error message */
  error?: string | null;
  /** Change handler */
  onChange: (value: CellValue) => void;
}

/**
 * Checkbox input field.
 */
export function CheckboxField({
  colId,
  label,
  value,
  error,
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

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={`field-${colId}`}
        name={colId}
        checked={checked}
        aria-label={label}
        aria-invalid={!!error}
        onChange={handleChange}
        className="size-[18px] cursor-pointer"
      />
      <label htmlFor={`field-${colId}`} className="cursor-pointer">
        {label}
      </label>
    </div>
  );
}
