/**
 * Checkbox Column Renderer
 *
 * Renders boolean checkbox values with support for:
 * - Checkbox display
 * - Toggle on click
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Display Renderer
// =============================================================================

function renderCheckbox(value: boolean | null, _column: ColumnSchema): React.ReactNode {
  const checked = value === true;

  return (
    <span className="checkbox-renderer flex justify-center">
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="w-4 h-4 cursor-default accent-ss-primary"
      />
    </span>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const CheckboxEditor: React.FC<ColumnEditorProps<'checkbox'>> = ({
  value,
  column: _column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked);
      // Commit immediately for checkbox
      onCommit();
    },
    [onChange, onCommit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onChange(!value);
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [value, onChange, onCommit, onCancel],
  );

  return (
    <div className={`checkbox-editor flex justify-center items-center ${className}`}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={value === true}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`w-[18px] h-[18px] accent-ss-primary ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      />
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const CheckboxCardField: React.FC<CardFieldProps<'checkbox'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  const checked = value === true;

  if (compact) {
    // In compact mode, show checkmark or nothing
    return checked ? (
      <span className={`checkbox-card-field compact text-ss-success ${className}`}>✓</span>
    ) : null;
  }

  return (
    <span className={`checkbox-card-field ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="w-3.5 h-3.5 cursor-default accent-ss-primary"
      />
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const CheckboxFormField: React.FC<FormFieldProps<'checkbox'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.checked);
    },
    [onChange],
  );

  return (
    <div className={`checkbox-form-field ${error ? 'has-error' : ''} ${className}`}>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="checkbox"
          checked={value === true}
          onChange={handleChange}
          disabled={disabled}
          className={`w-[18px] h-[18px] accent-ss-primary ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        />
        <label htmlFor={inputId} className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
          {column.name}
          {required && <span className="text-ss-error ml-0.5">*</span>}
        </label>
      </div>

      {error && <span className="text-caption text-ss-error">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const CheckboxRenderer: ColumnRenderer<'checkbox'> = {
  render: renderCheckbox,
  editor: CheckboxEditor,
  cardField: CheckboxCardField,
  formField: CheckboxFormField,
};
