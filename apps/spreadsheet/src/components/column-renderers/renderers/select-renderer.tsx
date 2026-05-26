/**
 * Select Column Renderer
 *
 * Renders select/dropdown values with support for:
 * - Single select
 * - Multi-select (multiple values)
 * - Colored badges
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ColumnSchema, SelectOption } from '../../../domain/clipboard/types';
import type { CardFieldProps, ColumnEditorProps, ColumnRenderer, FormFieldProps } from '../types';

// =============================================================================
// Helpers
// =============================================================================

function getOptionById(options: SelectOption[] | undefined, id: string): SelectOption | undefined {
  return options?.find((opt) => opt.id === id);
}

function getSelectedOptions(
  value: string | string[] | null,
  options: SelectOption[] | undefined,
): SelectOption[] {
  if (!value || !options) {
    return [];
  }

  const ids = Array.isArray(value) ? value : [value];
  return ids
    .map((id) => getOptionById(options, id))
    .filter((opt): opt is SelectOption => opt !== undefined);
}

// Default colors for options
const DEFAULT_COLORS = [
  '#E8F5E9', // Light green
  '#E3F2FD', // Light blue
  '#FFF3E0', // Light orange
  '#F3E5F5', // Light purple
  '#FFEBEE', // Light red
  '#E0F7FA', // Light cyan
  '#FFF8E1', // Light yellow
  '#F5F5F5', // Light gray
];

function getOptionColor(option: SelectOption, index: number): string {
  return option.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

// =============================================================================
// Display Renderer
// =============================================================================

function renderSelect(value: string | string[] | null, column: ColumnSchema): React.ReactNode {
  const options = column.options;
  const selected = getSelectedOptions(value, options);

  if (selected.length === 0) {
    return null;
  }

  return (
    <span className="select-renderer inline-flex flex-wrap gap-1">
      {selected.map((opt, index) => (
        <span
          key={opt.id}
          className="select-badge px-2 py-0.5 rounded-full text-caption inline-block"
          style={{ backgroundColor: getOptionColor(opt, index) }}
        >
          {opt.label}
        </span>
      ))}
    </span>
  );
}

// =============================================================================
// Editor Component
// =============================================================================

const SelectEditor: React.FC<ColumnEditorProps<'select'>> = ({
  value,
  column,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = column.options ?? [];
  const isMulti = Array.isArray(value);

  useEffect(() => {
    if (autoFocus) {
      containerRef.current?.focus();
    }
  }, [autoFocus]);

  const handleSelect = useCallback(
    (optionId: string) => {
      if (isMulti) {
        const currentIds = (value as string[]) || [];
        const newIds = currentIds.includes(optionId)
          ? currentIds.filter((id) => id !== optionId)
          : [...currentIds, optionId];
        onChange(newIds.length > 0 ? newIds : null);
      } else {
        onChange(optionId);
        onCommit();
      }
    },
    [value, isMulti, onChange, onCommit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && isMulti) {
        e.preventDefault();
        onCommit();
      }
    },
    [onCommit, onCancel, isMulti],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // Check if focus moved outside the container
      if (!containerRef.current?.contains(e.relatedTarget as Node)) {
        setIsOpen(false);
        onCommit();
      }
    },
    [onCommit],
  );

  const selectedIds = isMulti ? (value as string[]) || [] : value ? [value as string] : [];

  return (
    <div
      ref={containerRef}
      className={`select-editor ${className}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      {isOpen && (
        <div className="select-dropdown absolute z-ss-modal bg-ss-surface border border-ss-border rounded-ss-sm shadow-ss-dropdown max-h-[200px] overflow-auto min-w-[150px]">
          {options.map((opt, index) => {
            const isSelected = selectedIds.includes(opt.id);
            return (
              <div
                key={opt.id}
                className={`select-option px-3 py-2 flex items-center gap-2 ${isSelected ? 'bg-ss-surface-hover' : 'bg-transparent'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-ss-surface-hover'}`}
                onClick={() => handleSelect(opt.id)}
              >
                {isMulti && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="pointer-events-none"
                  />
                )}
                <span
                  className="option-color w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: getOptionColor(opt, index) }}
                />
                <span>{opt.label}</span>
              </div>
            );
          })}
          {options.length === 0 && (
            <div className="px-3 py-2 text-ss-text-disabled">No options available</div>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Card Field Component
// =============================================================================

const SelectCardField: React.FC<CardFieldProps<'select'>> = ({
  value,
  column,
  compact = false,
  className = '',
}) => {
  const options = column.options;
  const selected = getSelectedOptions(value, options);

  if (selected.length === 0) {
    return null;
  }

  // In compact mode, show only first option or count
  if (compact && selected.length > 1) {
    return (
      <span className={`select-card-field compact inline-flex items-center ${className}`}>
        <span
          className="select-badge px-1.5 py-px rounded-full text-hint inline-block"
          style={{ backgroundColor: getOptionColor(selected[0], 0) }}
        >
          {selected[0].label}
        </span>
        <span className="text-hint text-ss-text-secondary ml-1">+{selected.length - 1}</span>
      </span>
    );
  }

  return (
    <span
      className={`select-card-field inline-flex flex-wrap gap-1 ${compact ? 'compact' : ''} ${className}`}
    >
      {selected.map((opt, index) => (
        <span
          key={opt.id}
          className={`select-badge inline-block ${compact ? 'px-1.5 py-px rounded-full text-hint' : 'px-2 py-0.5 rounded-full text-caption'}`}
          style={{ backgroundColor: getOptionColor(opt, index) }}
        >
          {opt.label}
        </span>
      ))}
    </span>
  );
};

// =============================================================================
// Form Field Component
// =============================================================================

const SelectFormField: React.FC<FormFieldProps<'select'>> = ({
  value,
  column,
  onChange,
  error,
  disabled = false,
  required = false,
  placeholder,
  className = '',
}) => {
  const options = column.options ?? [];
  const isMulti = Array.isArray(value);
  const inputId = `form-field-${column.id}`;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (isMulti) {
        const selectedOptions = Array.from(e.target.selectedOptions, (opt) => opt.value);
        onChange(selectedOptions.length > 0 ? selectedOptions : null);
      } else {
        onChange(e.target.value || null);
      }
    },
    [isMulti, onChange],
  );

  const selectedIds = isMulti ? (value as string[]) || [] : value ? [value as string] : [];

  return (
    <div className={`select-form-field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={inputId}>
        {column.name}
        {required && <span className="required-indicator">*</span>}
      </label>

      <select
        id={inputId}
        multiple={isMulti}
        value={isMulti ? selectedIds : (value as string) || ''}
        onChange={handleChange}
        disabled={disabled}
      >
        {!isMulti && (
          <option value="">{placeholder || `Select ${column.name.toLowerCase()}`}</option>
        )}
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {error && <span className="error-message">{error}</span>}
    </div>
  );
};

// =============================================================================
// Export Renderer
// =============================================================================

export const SelectRenderer: ColumnRenderer<'select'> = {
  render: renderSelect,
  editor: SelectEditor,
  cardField: SelectCardField,
  formField: SelectFormField,
};
