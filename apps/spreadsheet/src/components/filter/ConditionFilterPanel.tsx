/**
 * ConditionFilterPanel Component
 *
 *
 * Operator dropdown and value inputs for condition-based filtering.
 * Supports one or two conditions with AND/OR logic.
 *
 * ARCHITECTURE:
 * This component builds ColumnFilterCriteria with type: 'condition'.
 * The criteria is passed to Layer 0's setColumnFilter() which handles
 * all the Cell Identity Model concerns.
 *
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ColumnFilterCriteria,
  FilterCondition,
  FilterOperator,
} from '@mog-sdk/contracts/filter';
export interface ConditionFilterPanelProps {
  /** Current criteria if editing existing filter */
  currentCriteria?: Pick<ColumnFilterCriteria, 'conditions' | 'conditionLogic'>;
  /** Operator selected from a type-specific submenu before opening the panel */
  initialOperator?: FilterOperator | null;
  /** Called when user applies the condition filter */
  onApply: (criteria: ColumnFilterCriteria) => void;
  /** Called to cancel without applying */
  onCancel?: () => void;
}

/**
 * Available filter operators with display labels.
 */
const TEXT_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'startsWith', label: 'Begins with' },
  { value: 'endsWith', label: 'Ends with' },
];

const NUMBER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Does not equal' },
  { value: 'greaterThan', label: 'Is greater than' },
  { value: 'greaterThanOrEqual', label: 'Is greater than or equal to' },
  { value: 'lessThan', label: 'Is less than' },
  { value: 'lessThanOrEqual', label: 'Is less than or equal to' },
  { value: 'between', label: 'Is between' },
  { value: 'notBetween', label: 'Is not between' },
];

const BLANK_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'isBlank', label: 'Is blank' },
  { value: 'isNotBlank', label: 'Is not blank' },
];

// All operators combined
const ALL_OPERATORS = [...TEXT_OPERATORS, ...NUMBER_OPERATORS, ...BLANK_OPERATORS].filter(
  (op, index, self) => self.findIndex((o) => o.value === op.value) === index,
);

/**
 * Check if an operator needs a value input.
 */
function needsValue(operator: FilterOperator): boolean {
  return operator !== 'isBlank' && operator !== 'isNotBlank';
}

/**
 * Check if an operator needs a second value input (for "between").
 */
function needsSecondValue(operator: FilterOperator): boolean {
  return operator === 'between' || operator === 'notBetween';
}

/**
 * Parse user input to appropriate value type.
 * Returns number if input is numeric, otherwise string.
 */
function parseInputValue(input: string): string | number {
  const trimmed = input.trim();
  if (trimmed === '') return '';

  // Try to parse as number
  const num = Number(trimmed);
  if (!isNaN(num)) {
    return num;
  }

  return trimmed;
}

/**
 * Condition filter panel with operator selection and value inputs.
 */
export function ConditionFilterPanel({
  currentCriteria,
  initialOperator,
  onApply,
  onCancel,
}: ConditionFilterPanelProps): React.ReactElement {
  // First condition state
  const [operator1, setOperator1] = useState<FilterOperator>(
    currentCriteria?.conditions?.[0]?.operator ?? initialOperator ?? 'equals',
  );
  const [value1, setValue1] = useState<string>(
    currentCriteria?.conditions?.[0]?.value != null
      ? String(currentCriteria.conditions[0].value)
      : '',
  );
  const [value1b, setValue1b] = useState<string>(
    currentCriteria?.conditions?.[0]?.value2 != null
      ? String(currentCriteria.conditions[0].value2)
      : '',
  );

  // AND/OR logic
  const [logic, setLogic] = useState<'and' | 'or'>(currentCriteria?.conditionLogic ?? 'and');

  // Second condition state
  const [hasSecondCondition, setHasSecondCondition] = useState(
    (currentCriteria?.conditions?.length ?? 0) > 1,
  );
  const [operator2, setOperator2] = useState<FilterOperator>(
    currentCriteria?.conditions?.[1]?.operator ?? 'equals',
  );
  const [value2, setValue2] = useState<string>(
    currentCriteria?.conditions?.[1]?.value != null
      ? String(currentCriteria.conditions[1].value)
      : '',
  );

  useEffect(() => {
    if (!initialOperator) return;
    setOperator1(initialOperator);
    if (!needsSecondValue(initialOperator)) {
      setValue1b('');
    }
  }, [initialOperator]);

  // Validation
  const isValid = useMemo(() => {
    // First condition must be valid
    if (needsValue(operator1) && value1.trim() === '') return false;
    if (needsSecondValue(operator1) && value1b.trim() === '') return false;

    // If second condition exists, it must be valid too
    if (hasSecondCondition) {
      if (needsValue(operator2) && value2.trim() === '') return false;
    }

    return true;
  }, [operator1, value1, value1b, hasSecondCondition, operator2, value2]);

  // Handle apply
  const handleApply = useCallback(() => {
    const conditions: FilterCondition[] = [];

    // Build first condition
    const cond1: FilterCondition = { operator: operator1 };
    if (needsValue(operator1)) {
      cond1.value = parseInputValue(value1);
      if (needsSecondValue(operator1)) {
        cond1.value2 = parseInputValue(value1b);
      }
    }
    conditions.push(cond1);

    // Build second condition if enabled
    if (hasSecondCondition) {
      const cond2: FilterCondition = { operator: operator2 };
      if (needsValue(operator2)) {
        cond2.value = parseInputValue(value2);
      }
      conditions.push(cond2);
    }

    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions,
      conditionLogic: logic,
    };

    onApply(criteria);
  }, [operator1, value1, value1b, logic, hasSecondCondition, operator2, value2, onApply]);

  return (
    <div className="condition-filter-panel flex flex-col gap-3">
      {/* First condition */}
      <div className="flex flex-col gap-2">
        <label className="text-caption text-ss-text-secondary font-medium">
          Show rows where value:
        </label>

        <select
          value={operator1}
          onChange={(e) => setOperator1(e.target.value as FilterOperator)}
          className="w-full px-2 py-1.5 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
          data-testid="filter-condition-operator"
        >
          {ALL_OPERATORS.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>

        {needsValue(operator1) && (
          <input
            type="text"
            value={value1}
            onChange={(e) => setValue1(e.target.value)}
            placeholder="Enter value..."
            className="w-full px-2 py-1.5 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
            data-testid="filter-condition-value"
          />
        )}

        {needsSecondValue(operator1) && (
          <>
            <span className="text-caption text-ss-text-secondary text-center">and</span>
            <input
              type="text"
              value={value1b}
              onChange={(e) => setValue1b(e.target.value)}
              placeholder="Enter second value..."
              className="w-full px-2 py-1.5 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
              data-testid="filter-condition-value2"
            />
          </>
        )}
      </div>

      {/* AND/OR logic selector */}
      <div className="flex items-center gap-4 py-1">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="logic"
            checked={logic === 'and'}
            onChange={() => setLogic('and')}
            className="w-3.5 h-3.5 accent-primary"
          />
          <span className="text-body-sm">And</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name="logic"
            checked={logic === 'or'}
            onChange={() => setLogic('or')}
            className="w-3.5 h-3.5 accent-primary"
          />
          <span className="text-body-sm">Or</span>
        </label>
      </div>

      {/* Second condition toggle */}
      <label className="flex items-center gap-2 cursor-pointer py-1">
        <input
          type="checkbox"
          checked={hasSecondCondition}
          onChange={(e) => setHasSecondCondition(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        <span className="text-body-sm">Add another condition</span>
      </label>

      {/* Second condition (if enabled) */}
      {hasSecondCondition && (
        <div className="flex flex-col gap-2 pl-4 border-l-2 border-ss-border">
          <select
            value={operator2}
            onChange={(e) => setOperator2(e.target.value as FilterOperator)}
            className="w-full px-2 py-1.5 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
          >
            {ALL_OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>

          {needsValue(operator2) && (
            <input
              type="text"
              value={value2}
              onChange={(e) => setValue2(e.target.value)}
              placeholder="Enter value..."
              className="w-full px-2 py-1.5 border border-ss-border rounded text-body-sm focus:outline-none focus:ring-1 focus:ring-ss-primary"
            />
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2 border-t border-ss-border">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 border border-ss-border rounded text-body-sm hover:bg-ss-surface-hover"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={handleApply}
          disabled={!isValid}
          className="flex-1 px-3 py-1.5 bg-ss-primary text-ss-text-inverse rounded text-body-sm hover:bg-ss-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="filter-condition-apply"
        >
          OK
        </button>
      </div>
    </div>
  );
}

export default ConditionFilterPanel;
