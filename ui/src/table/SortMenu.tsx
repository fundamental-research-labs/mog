/**
 * SortMenu Component
 *
 * Sort configuration menu for data views.
 * Kernel-agnostic version.
 */

import * as React from 'react';
import type { SortConfig, SortDirection, SortMenuProps } from './types';

/**
 * SortMenu component.
 */
export function SortMenu({
  columns,
  sorts,
  onChange,
  className = '',
}: SortMenuProps): React.ReactElement {
  const [isAddingSort, setIsAddingSort] = React.useState(false);
  const [newSortField, setNewSortField] = React.useState<string>('');
  const [newSortDirection, setNewSortDirection] = React.useState<SortDirection>('asc');

  // Add a new sort field
  const handleAddSort = React.useCallback(() => {
    if (!newSortField) return;

    const newSort: SortConfig = {
      field: newSortField,
      direction: newSortDirection,
    };

    onChange([...sorts, newSort]);

    // Reset form
    setIsAddingSort(false);
    setNewSortField('');
    setNewSortDirection('asc');
  }, [sorts, newSortField, newSortDirection, onChange]);

  // Remove a sort field
  const handleRemoveSort = React.useCallback(
    (index: number) => {
      const newSorts = sorts.filter((_, i) => i !== index);
      onChange(newSorts);
    },
    [sorts, onChange],
  );

  // Toggle sort direction
  const handleToggleDirection = React.useCallback(
    (index: number) => {
      const newSorts = [...sorts];
      newSorts[index] = {
        ...newSorts[index],
        direction: newSorts[index].direction === 'asc' ? 'desc' : 'asc',
      };
      onChange(newSorts);
    },
    [sorts, onChange],
  );

  // Get column name for a field
  const getColumnName = (field: string) => {
    const column = columns.find((col) => col.id === field || col.name === field);
    return column?.name || field;
  };

  // Get available columns for new sort (exclude already sorted)
  const availableColumns = React.useMemo(() => {
    const sortedFields = new Set(sorts.map((s) => s.field));
    return columns.filter((col) => !sortedFields.has(col.id) && !sortedFields.has(col.name));
  }, [columns, sorts]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Active sorts */}
      {sorts.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-ss-text-secondary font-medium">Sort by:</div>
          {sorts.map((sort, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 bg-ss-bg-secondary border border-ss-border rounded-ss-sm text-sm"
            >
              <span className="font-medium">{getColumnName(sort.field)}</span>
              <button
                onClick={() => handleToggleDirection(index)}
                className="px-2 py-0.5 text-xs bg-white border border-ss-border rounded hover:bg-ss-bg-secondary"
                aria-label={`Change sort direction (currently ${sort.direction})`}
              >
                {sort.direction === 'asc' ? '↑ A-Z' : '↓ Z-A'}
              </button>
              <button
                onClick={() => handleRemoveSort(index)}
                className="ml-auto text-ss-text-secondary hover:text-ss-text-primary"
                aria-label="Remove sort"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add sort UI */}
      {isAddingSort ? (
        <div className="flex items-center gap-2 p-2 bg-ss-bg-secondary border border-ss-border rounded-ss-sm">
          <select
            value={newSortField}
            onChange={(e) => setNewSortField(e.target.value)}
            className="px-2 py-1 text-sm border border-ss-border rounded bg-white"
          >
            <option value="">Select column...</option>
            {availableColumns.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name}
              </option>
            ))}
          </select>

          {newSortField && (
            <select
              value={newSortDirection}
              onChange={(e) => setNewSortDirection(e.target.value as SortDirection)}
              className="px-2 py-1 text-sm border border-ss-border rounded bg-white"
            >
              <option value="asc">↑ A-Z</option>
              <option value="desc">↓ Z-A</option>
            </select>
          )}

          <button
            onClick={handleAddSort}
            disabled={!newSortField}
            className="px-3 py-1 text-sm bg-ss-primary text-white rounded hover:bg-ss-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
          <button
            onClick={() => {
              setIsAddingSort(false);
              setNewSortField('');
              setNewSortDirection('asc');
            }}
            className="px-3 py-1 text-sm bg-ss-bg-secondary text-ss-text-primary border border-ss-border rounded hover:bg-ss-bg-tertiary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingSort(true)}
          disabled={availableColumns.length === 0}
          className="self-start px-3 py-1.5 text-sm bg-ss-bg-secondary text-ss-text-primary border border-ss-border rounded-ss-sm hover:bg-ss-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add sort
        </button>
      )}
    </div>
  );
}
