/**
 * Phone Column Renderer
 *
 * Renders phone number values with support for:
 * - tel: links
 * - Phone formatting
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format phone number for display (basic US format).
 */
function formatPhone(phone: string): string {
  // Remove non-numeric characters
  const digits = phone.replace(/\D/g, '');

  // US format: (XXX) XXX-XXXX
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // US format with country code: +1 (XXX) XXX-XXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // Return as-is if not standard format
  return phone;
}

/**
 * Get clean phone number for tel: link.
 */
function getCleanPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderPhone(value: string | null, _column: ColumnSchema): React.ReactNode {
  if (!value || !value.trim()) {
    return null;
  }

  const formatted = formatPhone(value);
  const clean = getCleanPhone(value);

  return (
    <a
      href={`tel:${clean}`}
      className="phone-renderer text-ss-primary inline-flex items-center gap-ss-1"
      style={{
        textDecoration: 'none',
      }}
      title={`Call ${formatted}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span>📞</span>
      <span>{formatted}</span>
    </a>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const PhoneEditor: React.FC<ColumnEditorProps<'phone'>> = ({
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
      type="tel"
      value={value ?? ''}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      className={`phone-editor ${className}`}
      placeholder="(555) 123-4567"
    />
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const PhoneCardField: React.FC<CardFieldProps<'phone'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (!value || !value.trim()) {
    return null;
  }

  const formatted = formatPhone(value);
  const clean = getCleanPhone(value);

  return (
    <a
      href={`tel:${clean}`}
      className={`phone-card-field ${compact ? 'compact text-hint' : 'text-caption'} text-ss-primary inline-flex items-center gap-ss-0_5 ${className}`}
      style={{
        textDecoration: 'none',
      }}
      title={`Call ${formatted}`}
      onClick={(e) => e.stopPropagation()}
    >
      {!compact && <span className="text-caption">📞</span>}
      <span>{formatted}</span>
    </a>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const PhoneFormField: React.FC<FormFieldProps<'phone'>> = ({
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
    <div className={`phone-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <input
        id={inputId}
        type="tel"
        value={value ?? ''}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder ?? '(555) 123-4567'}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const PhoneRenderer: ColumnRenderer<'phone'> = {
  render: renderPhone,
  editor: PhoneEditor,
  cardField: PhoneCardField,
  formField: PhoneFormField,
};
