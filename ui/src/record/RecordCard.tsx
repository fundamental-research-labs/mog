/**
 * RecordCard Component
 *
 * Compact card representation of a record.
 * Kernel-agnostic version.
 */

import * as React from 'react';
import type { CellError, UiCellValue } from '../types';
import type { RecordCardProps } from './types';

/**
 * Format a cell value for display.
 */
function formatValue(value: UiCellValue | CellError): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Check if it's an error
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return value.code;
  }

  if (typeof value === 'boolean') {
    return value ? '✓' : '';
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  if (typeof value === 'number') {
    return value.toLocaleString();
  }

  return String(value);
}

/**
 * RecordCard component.
 */
export function RecordCard({
  record,
  columns,
  displayColumns,
  isSelected = false,
  onClick,
  className = '',
}: RecordCardProps): React.ReactElement {
  // Determine which columns to display
  const columnsToDisplay = React.useMemo(() => {
    if (displayColumns) {
      return columns.filter((col) => displayColumns.includes(col.id));
    }
    // Default: show first 3 columns
    return columns.slice(0, 3);
  }, [columns, displayColumns]);

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

  // Get title (first non-empty value or "Untitled")
  const title = React.useMemo(() => {
    for (const col of columnsToDisplay) {
      const value = getValue(col.id);
      const formatted = formatValue(value);
      if (formatted) return formatted;
    }
    return 'Untitled';
  }, [columnsToDisplay, getValue]);

  const handleClick = React.useCallback(() => {
    onClick?.(record.id);
  }, [onClick, record.id]);

  const cardClasses = `
    p-4 bg-white border rounded-ss-sm cursor-pointer transition-colors
    ${isSelected ? 'border-ss-primary ring-2 ring-ss-primary-light' : 'border-ss-border hover:border-ss-border-hover'}
    ${className}
  `.trim();

  return (
    <div className={cardClasses} onClick={handleClick}>
      {/* Title */}
      <div className="font-medium text-ss-text-primary mb-2 truncate">{title}</div>

      {/* Key fields */}
      <div className="space-y-1">
        {columnsToDisplay.slice(1).map((column) => {
          const value = getValue(column.id);
          const formatted = formatValue(value);
          if (!formatted) return null;

          return (
            <div key={column.id} className="text-sm">
              <span className="text-ss-text-secondary">{column.name}: </span>
              <span className="text-ss-text-primary">{formatted}</span>
            </div>
          );
        })}
      </div>

      {/* Optional color indicator */}
      {record.color && (
        <div
          className="absolute top-0 left-0 w-1 h-full rounded-l-ss-sm"
          style={{ backgroundColor: record.color }}
        />
      )}
    </div>
  );
}
