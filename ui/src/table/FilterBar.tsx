/**
 * FilterBar Component
 *
 * Filter bar for data views. Displays active filters and allows adding/removing filters.
 * Kernel-agnostic version.
 */

import * as React from 'react';
import type { ColumnTypeKind } from '../types';
import type { FilterBarProps, FilterCondition, FilterOperator } from './types';

/**
 * Get available operators for a column type.
 */
function getOperatorsForType(type: ColumnTypeKind): FilterOperator[] {
  switch (type) {
    case 'text':
    case 'email':
    case 'url':
    case 'phone':
      return [
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'startsWith',
        'endsWith',
        'isEmpty',
        'isNotEmpty',
      ];
    case 'number':
    case 'rating':
    case 'progress':
    case 'autoNumber':
      return [
        'equals',
        'notEquals',
        'greaterThan',
        'lessThan',
        'greaterThanOrEqual',
        'lessThanOrEqual',
        'isEmpty',
        'isNotEmpty',
      ];
    case 'date':
    case 'createdTime':
    case 'modifiedTime':
      return [
        'equals',
        'notEquals',
        'greaterThan',
        'lessThan',
        'greaterThanOrEqual',
        'lessThanOrEqual',
        'isEmpty',
        'isNotEmpty',
      ];
    case 'checkbox':
      return ['equals', 'isEmpty', 'isNotEmpty'];
    case 'select':
    case 'multiselect':
      return ['equals', 'notEquals', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'];
    case 'person':
      return ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];
    default:
      return ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];
  }
}

/**
 * Get display label for an operator.
 */
function getOperatorLabel(operator: FilterOperator): string {
  switch (operator) {
    case 'equals':
      return 'is';
    case 'notEquals':
      return 'is not';
    case 'contains':
      return 'contains';
    case 'notContains':
      return 'does not contain';
    case 'startsWith':
      return 'starts with';
    case 'endsWith':
      return 'ends with';
    case 'isEmpty':
      return 'is empty';
    case 'isNotEmpty':
      return 'is not empty';
    case 'greaterThan':
      return '>';
    case 'lessThan':
      return '<';
    case 'greaterThanOrEqual':
      return '>=';
    case 'lessThanOrEqual':
      return '<=';
    case 'isAnyOf':
      return 'is any of';
    case 'isNoneOf':
      return 'is none of';
    default:
      return operator;
  }
}

/**
 * Check if operator requires a value input.
 */
function operatorNeedsValue(operator: FilterOperator): boolean {
  return operator !== 'isEmpty' && operator !== 'isNotEmpty';
}

/**
 * FilterBar component.
 */
export function FilterBar({
  columns,
  filter,
  onChange,
  className = '',
}: FilterBarProps): React.ReactElement {
  const [isAddingFilter, setIsAddingFilter] = React.useState(false);
  const [newFilterField, setNewFilterField] = React.useState<string>('');
  const [newFilterOperator, setNewFilterOperator] = React.useState<FilterOperator>('equals');
  const [newFilterValue, setNewFilterValue] = React.useState<string>('');

  // Add a new filter condition
  const handleAddFilter = React.useCallback(() => {
    if (!newFilterField) return;

    const newCondition: FilterCondition = {
      field: newFilterField,
      operator: newFilterOperator,
      value: operatorNeedsValue(newFilterOperator) ? newFilterValue : undefined,
    };

    onChange({
      conditions: [...filter.conditions, newCondition],
    });

    // Reset form
    setIsAddingFilter(false);
    setNewFilterField('');
    setNewFilterOperator('equals');
    setNewFilterValue('');
  }, [filter, newFilterField, newFilterOperator, newFilterValue, onChange]);

  // Remove a filter condition
  const handleRemoveFilter = React.useCallback(
    (index: number) => {
      const newConditions = filter.conditions.filter((_, i) => i !== index);
      onChange({ conditions: newConditions });
    },
    [filter, onChange],
  );

  // Get column for a field
  const getColumn = (field: string) => {
    return columns.find((col) => col.id === field || col.name === field);
  };

  // Get available operators for new filter
  const availableOperators = React.useMemo(() => {
    if (!newFilterField) return [];
    const column = getColumn(newFilterField);
    return column ? getOperatorsForType(column.type) : [];
  }, [newFilterField, columns]);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Active filters */}
      {filter.conditions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filter.conditions.map((condition, index) => {
            const column = getColumn(condition.field);
            return (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-1.5 bg-ss-bg-secondary border border-ss-border rounded-ss-sm text-sm"
              >
                <span className="font-medium">{column?.name || condition.field}</span>
                <span className="text-ss-text-secondary">
                  {getOperatorLabel(condition.operator)}
                </span>
                {operatorNeedsValue(condition.operator) && (
                  <span className="font-medium">{String(condition.value || '')}</span>
                )}
                <button
                  onClick={() => handleRemoveFilter(index)}
                  className="ml-1 text-ss-text-secondary hover:text-ss-text-primary"
                  aria-label="Remove filter"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add filter UI */}
      {isAddingFilter ? (
        <div className="flex items-center gap-2 p-2 bg-ss-bg-secondary border border-ss-border rounded-ss-sm">
          <select
            value={newFilterField}
            onChange={(e) => {
              setNewFilterField(e.target.value);
              const column = getColumn(e.target.value);
              if (column) {
                const ops = getOperatorsForType(column.type);
                setNewFilterOperator(ops[0]);
              }
            }}
            className="px-2 py-1 text-sm border border-ss-border rounded bg-white"
          >
            <option value="">Select column...</option>
            {columns.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name}
              </option>
            ))}
          </select>

          {newFilterField && (
            <>
              <select
                value={newFilterOperator}
                onChange={(e) => setNewFilterOperator(e.target.value as FilterOperator)}
                className="px-2 py-1 text-sm border border-ss-border rounded bg-white"
              >
                {availableOperators.map((op) => (
                  <option key={op} value={op}>
                    {getOperatorLabel(op)}
                  </option>
                ))}
              </select>

              {operatorNeedsValue(newFilterOperator) && (
                <input
                  type="text"
                  value={newFilterValue}
                  onChange={(e) => setNewFilterValue(e.target.value)}
                  placeholder="Value..."
                  className="px-2 py-1 text-sm border border-ss-border rounded"
                />
              )}
            </>
          )}

          <button
            onClick={handleAddFilter}
            disabled={!newFilterField}
            className="px-3 py-1 text-sm bg-ss-primary text-white rounded hover:bg-ss-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
          <button
            onClick={() => {
              setIsAddingFilter(false);
              setNewFilterField('');
              setNewFilterOperator('equals');
              setNewFilterValue('');
            }}
            className="px-3 py-1 text-sm bg-ss-bg-secondary text-ss-text-primary border border-ss-border rounded hover:bg-ss-bg-tertiary"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingFilter(true)}
          className="self-start px-3 py-1.5 text-sm bg-ss-bg-secondary text-ss-text-primary border border-ss-border rounded-ss-sm hover:bg-ss-bg-tertiary"
        >
          + Add filter
        </button>
      )}
    </div>
  );
}
