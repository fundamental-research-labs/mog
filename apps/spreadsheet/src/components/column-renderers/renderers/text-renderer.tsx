/**
 * Text Column Renderer
 *
 * Renders text/string values with support for:
 * - Single line text
 * - Multi-line text (when column is configured for it)
 * - Rich text display
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Display Renderer
// =============================================================================

function renderText(value: string | null, _column: ColumnSchema): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return <span className="text-renderer">{String(value)}</span>;
}

// =============================================================================
// Editor Component
// =============================================================================

const TextEditor: React.FC<ColumnEditorProps<'text'>> = ({
  value,
  column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const isMultiline = false; // Could be derived from column config

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isMultiline) {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCommit, onCancel, isMultiline],
  );

  const handleBlur = useCallback(() => {
    onCommit();
  }, [onCommit]);

  const commonProps = {
    value: value ?? '',
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    disabled,
    className: `text-editor ${className}`,
    placeholder: column.name,
  };

  if (isMultiline) {
    return (
      <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} {...commonProps} rows={3} />
    );
  }

  return <input ref={inputRef as React.RefObject<HTMLInputElement>} type="text" {...commonProps} />;
};

// =============================================================================
// Card Field Component
// =============================================================================

const TextCardField: React.FC<CardFieldProps<'text'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const displayValue = String(value);
  const truncated =
    compact && displayValue.length > 50 ? displayValue.slice(0, 47) + '...' : displayValue;

  return (
    <span
      className={`text-card-field ${compact ? 'compact' : ''} ${className}`}
      title={displayValue}
    >
      {truncated}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const TextFormField: React.FC<FormFieldProps<'text'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const isMultiline = false; // Could be derived from column config
  const inputId = `form-field-${column.id}`;

  return (
    <div className={`text-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      {isMultiline ? (
        <textarea
          id={inputId}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? `Enter ${column.name.toLowerCase()}`}
          rows={4}
        />
      ) : (
        <input
          id={inputId}
          type="text"
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder ?? `Enter ${column.name.toLowerCase()}`}
        />
      )}

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const TextRenderer: ColumnRenderer<'text'> = {
  render: renderText,
  editor: TextEditor,
  cardField: TextCardField,
  formField: TextFormField,
};
