/**
 * CellEditor Component
 *
 * Generic cell editor wrapper that uses the registry to render
 * the appropriate editor based on column type.
 */

import type { CellValue } from '@mog-sdk/contracts/core';
import React, { useCallback } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import { getRenderer } from '../registry';
// =============================================================================
// Props
// =============================================================================

export interface CellEditorProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines editor) */
  column: ColumnSchema;
  /** Called when value changes */
  onChange: (value: CellValue) => void;
  /** Called when editing is complete */
  onCommit: () => void;
  /** Called when editing is cancelled */
  onCancel: () => void;
  /** Whether to auto-focus */
  autoFocus?: boolean;
  /** Whether disabled */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
}

// =============================================================================
// Component
// =============================================================================

/**
 * CellEditor - Generic cell editor wrapper.
 *
 * Uses the column renderer registry to display the appropriate
 * editor based on the column type.
 *
 * Usage:
 * ```tsx
 * <CellEditor
 * value={cell.value}
 * column={columnSchema}
 * onChange={(newValue) => setCellValue(newValue)}
 * onCommit={ => saveCell}
 * onCancel={ => cancelEdit}
 * />
 * ```
 */
export const CellEditor: React.FC<CellEditorProps> = ({
  value,
  column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
  style,
}) => {
  const renderer = getRenderer(column.kind);
  const Editor = renderer.editor;

  // Type-safe onChange that casts back to CellValue
  const handleChange = useCallback(
    (newValue: unknown) => {
      onChange(newValue as CellValue);
    },
    [onChange],
  );

  return (
    <div className={`cell-editor-wrapper cell-editor-${column.kind} ${className}`} style={style}>
      <Editor
        value={value}
        column={column}
        onChange={handleChange}
        onCommit={onCommit}
        onCancel={onCancel}
        autoFocus={autoFocus}
        disabled={disabled}
      />
    </div>
  );
};

// =============================================================================
// Form Field Wrapper
// =============================================================================

export interface FormFieldEditorProps {
  /** Cell value */
  value: CellValue;
  /** Column schema (determines editor) */
  column: ColumnSchema;
  /** Called when value changes */
  onChange: (value: CellValue) => void;
  /** Validation error message */
  error?: string;
  /** Whether disabled */
  disabled?: boolean;
  /** Whether required */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Additional class name */
  className?: string;
}

/**
 * FormFieldEditor - Wrapper for form field editor.
 *
 * Uses the formField renderer if available, falls back to editor.
 */
export const FormFieldEditor: React.FC<FormFieldEditorProps> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const renderer = getRenderer(column.kind);

  // Type-safe onChange
  const handleChange = useCallback(
    (newValue: unknown) => {
      onChange(newValue as CellValue);
    },
    [onChange],
  );

  // Use formField if available
  if (renderer.formField) {
    const FormField = renderer.formField;
    return (
      <FormField
        value={value}
        column={column}
        onChange={handleChange}
        error={error}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        className={className}
      />
    );
  }

  // Fall back to editor wrapped in form field structure
  const Editor = renderer.editor;

  return (
    <div
      className={`form-field form-field-${column.kind} ${error ? 'has-error' : ''} ${className}`}
    >
      <label htmlFor={`form-field-${column.id}`}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <Editor
        value={value}
        column={column}
        onChange={handleChange}
        onCommit={() => {}}
        onCancel={() => {}}
        autoFocus={false}
        disabled={disabled}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

export default CellEditor;
