/**
 * RecordDetail Component
 *
 * Slide-out panel for viewing/editing a record.
 * Kernel-agnostic version.
 */

import * as React from 'react';
import { CheckboxField } from '../fields/CheckboxField';
import { DateField } from '../fields/DateField';
import { NumberField } from '../fields/NumberField';
import { PersonField } from '../fields/PersonField';
import { SelectField } from '../fields/SelectField';
import { TextField } from '../fields/TextField';
import type { CellValueOrError, ColumnTypeKind, UiCellValue } from '../types';
import type { RecordDetailProps } from './types';

/**
 * Convert CellValueOrError to UiCellValue, converting errors to null.
 */
function toCellValue(value: CellValueOrError): UiCellValue {
  if (value && typeof value === 'object' && 'type' in value && value.type === 'error') {
    return null;
  }
  return value as UiCellValue;
}

/**
 * Render appropriate field component based on column type.
 */
function renderField(
  columnId: string,
  columnName: string,
  columnType: ColumnTypeKind,
  value: CellValueOrError,
  onChange: (value: UiCellValue) => void,
  options?: Array<{ id: string; name: string; color?: string }>,
): React.ReactElement {
  const cellValue = toCellValue(value);
  const baseProps = {
    fieldId: columnId,
    label: columnName,
    value: cellValue,
    onChange,
  };

  switch (columnType) {
    case 'number':
    case 'rating':
    case 'progress':
    case 'autoNumber':
      return <NumberField {...baseProps} />;

    case 'date':
    case 'createdTime':
    case 'modifiedTime':
      return <DateField {...baseProps} />;

    case 'checkbox':
      return <CheckboxField {...baseProps} />;

    case 'select':
    case 'multiselect':
      return (
        <SelectField
          {...baseProps}
          options={
            options?.map((opt) => ({
              value: opt.id,
              label: opt.name,
              color: opt.color,
            })) || []
          }
          placeholder="Select an option..."
        />
      );

    case 'person':
      return (
        <PersonField
          {...baseProps}
          options={
            options?.map((opt) => ({
              id: opt.id,
              name: opt.name,
              avatarUrl: undefined,
              email: undefined,
            })) || []
          }
          placeholder="Select a person..."
        />
      );

    case 'email':
      return <TextField {...baseProps} type="email" />;

    case 'url':
      return <TextField {...baseProps} type="url" />;

    case 'phone':
      return <TextField {...baseProps} type="tel" />;

    case 'text':
    case 'formula':
    case 'relation':
    case 'lookup':
    case 'rollup':
    case 'file':
    default:
      return <TextField {...baseProps} />;
  }
}

/**
 * RecordDetail component.
 */
export function RecordDetail({
  record,
  columns,
  isOpen,
  onClose,
  onFieldChange,
  className = '',
}: RecordDetailProps): React.ReactElement {
  // Get value for a column
  const getValue = React.useCallback(
    (columnId: string) => {
      // Try by column ID first
      if (record.valuesByColumnId?.[columnId] !== undefined) {
        return record.valuesByColumnId[columnId];
      }
      // Then try by column name
      const column = columns.find((col) => col.id === columnId);
      if (column && record.values[column.name] !== undefined) {
        return record.values[column.name];
      }
      return null;
    },
    [record, columns],
  );

  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return <></>;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-25 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-[480px] bg-white shadow-xl z-50 flex flex-col ${className}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ss-border">
          <h2 className="text-lg font-semibold">Record Details</h2>
          <button
            onClick={onClose}
            className="text-ss-text-secondary hover:text-ss-text-primary text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {columns.map((column) => {
              const value = getValue(column.id);
              return (
                <div key={column.id} className="space-y-2">
                  <label className="block text-sm font-medium text-ss-text-primary">
                    {column.name}
                    {column.required && <span className="text-ss-error ml-1">*</span>}
                  </label>
                  {renderField(
                    column.id,
                    column.name,
                    column.type,
                    value,
                    (newValue) => onFieldChange(column.id, newValue),
                    column.options,
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-ss-border">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-ss-primary text-white rounded-ss-sm hover:bg-ss-primary-dark"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
