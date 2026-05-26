/**
 * Email Column Renderer
 *
 * Renders email values with support for:
 * - mailto: links
 * - Email validation
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

// =============================================================================
// Display Renderer
// =============================================================================

function renderEmail(value: string | null, _column: ColumnSchema): React.ReactNode {
  if (!value || !value.trim()) {
    return null;
  }

  return (
    <a
      href={`mailto:${value}`}
      className="email-renderer text-ss-primary inline-flex items-center gap-ss-1"
      style={{
        textDecoration: 'none',
      }}
      title={`Send email to ${value}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span>✉️</span>
      <span>{value}</span>
    </a>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const EmailEditor: React.FC<ColumnEditorProps<'email'>> = ({
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
      inputRef.current.select();
    }
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCommit, onCancel],
  );

  const handleBlur = useCallback(() => {
    onCommit();
  }, [onCommit]);

  return (
    <input
      ref={inputRef}
      type="email"
      value={value ?? ''}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      className={`email-editor ${className}`}
      placeholder="name@example.com"
    />
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const EmailCardField: React.FC<CardFieldProps<'email'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (!value || !value.trim()) {
    return null;
  }

  return (
    <a
      href={`mailto:${value}`}
      className={`email-card-field ${compact ? 'compact text-hint' : 'text-caption'} text-ss-primary inline-flex items-center gap-ss-0_5 ${className}`}
      style={{
        textDecoration: 'none',
      }}
      title={`Send email to ${value}`}
      onClick={(e) => e.stopPropagation()}
    >
      {!compact && <span className="text-caption">✉️</span>}
      <span
        style={{
          maxWidth: compact ? '120px' : '180px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </a>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const EmailFormField: React.FC<FormFieldProps<'email'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const inputId = `form-field-${column.id}`;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div className={`email-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <input
        id={inputId}
        type="email"
        value={value ?? ''}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder ?? 'name@example.com'}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const EmailRenderer: ColumnRenderer<'email'> = {
  render: renderEmail,
  editor: EmailEditor,
  cardField: EmailCardField,
  formField: EmailFormField,
};
