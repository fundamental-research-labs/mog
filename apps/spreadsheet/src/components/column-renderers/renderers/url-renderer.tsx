/**
 * URL Column Renderer
 *
 * Renders URL values with support for:
 * - Clickable links
 * - Domain display
 * - External link icon
 */

import React, { useCallback, useEffect, useRef } from 'react';
import type { ColumnSchema } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract domain from URL.
 */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Normalize URL (add https:// if missing).
 */
function normalizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.match(/^https?:\/\//i)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/**
 * Validate URL format.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(normalizeUrl(url));
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderUrl(value: string | null, _column: ColumnSchema): React.ReactNode {
  if (!value || !value.trim()) {
    return null;
  }

  const url = normalizeUrl(value);
  const domain = getDomain(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="url-renderer text-ss-primary inline-flex items-center gap-ss-1"
      style={{
        textDecoration: 'none',
      }}
      title={url}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        style={{
          maxWidth: '200px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {domain}
      </span>
      <span className="text-ribbon-compact">↗</span>
    </a>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const UrlEditor: React.FC<ColumnEditorProps<'url'>> = ({
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
      type="url"
      value={value ?? ''}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      disabled={disabled}
      className={`url-editor ${className}`}
      placeholder="https://example.com"
    />
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const UrlCardField: React.FC<CardFieldProps<'url'>> = ({
  value,
  column: _column,
  compact = false,
  className = '',
}) => {
  if (!value || !value.trim()) {
    return null;
  }

  const url = normalizeUrl(value);
  const domain = getDomain(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`url-card-field ${compact ? 'compact text-hint' : 'text-caption'} text-ss-primary inline-flex items-center gap-ss-0_5 ${className}`}
      style={{
        textDecoration: 'none',
      }}
      title={url}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        style={{
          maxWidth: compact ? '100px' : '150px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {domain}
      </span>
      {!compact && <span className="text-ribbon-group">↗</span>}
    </a>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const UrlFormField: React.FC<FormFieldProps<'url'>> = ({
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

  const handleBlur = useCallback(() => {
    // Normalize URL on blur
    if (value && value.trim() && isValidUrl(value)) {
      onChange(normalizeUrl(value));
    }
  }, [value, onChange]);

  return (
    <div className={`url-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <input
        id={inputId}
        type="url"
        value={value ?? ''}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder ?? 'https://example.com'}
      />

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const UrlRenderer: ColumnRenderer<'url'> = {
  render: renderUrl,
  editor: UrlEditor,
  cardField: UrlCardField,
  formField: UrlFormField,
};
