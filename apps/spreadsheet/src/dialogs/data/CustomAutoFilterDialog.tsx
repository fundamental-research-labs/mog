/**
 * Custom AutoFilter Dialog
 *
 * Dialog for creating custom filter conditions with two criteria
 * combined with AND/OR logic. Supports wildcards (* and ?).
 *
 * Excel parity 14.3: Custom AutoFilter Dialog
 */

import type { ChangeEvent } from 'react';
import { useCallback, useMemo } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import type { SelectOption } from '@mog/shell';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  RadioGroup,
  Select,
} from '@mog/shell';
import type { CustomFilterOperator } from '../../ui-store/slices/dialogs/custom-autofilter-dialog';

// =============================================================================
// Constants
// =============================================================================

/**
 * Filter operator options for the dropdown.
 */
const OPERATOR_OPTIONS: SelectOption[] = [
  { value: 'equals', label: 'equals' },
  { value: 'notEquals', label: 'does not equal' },
  { value: 'greaterThan', label: 'is greater than' },
  { value: 'lessThan', label: 'is less than' },
  { value: 'greaterOrEqual', label: 'is greater than or equal to' },
  { value: 'lessOrEqual', label: 'is less than or equal to' },
  { value: 'beginsWith', label: 'begins with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'contains', label: 'contains' },
  { value: 'notContains', label: 'does not contain' },
];

/**
 * Logical operator options (AND/OR).
 */
const LOGICAL_OPERATOR_OPTIONS = [
  { value: 'and', label: 'And' },
  { value: 'or', label: 'Or' },
];

// =============================================================================
// Component
// =============================================================================

export function CustomAutoFilterDialog() {
  const deps = useActionDependencies();
  const dialog = useUIStore((s) => s.customAutoFilterDialog);
  const setCondition1 = useUIStore((s) => s.setCondition1);
  const setCondition2 = useUIStore((s) => s.setCondition2);
  const setLogicalOperator = useUIStore((s) => s.setLogicalOperator);
  const setCustomAutoFilterError = useUIStore((s) => s.setCustomAutoFilterError);

  // Generate dialog title
  const dialogTitle = useMemo(() => {
    if (dialog.columnName) {
      return `Custom AutoFilter - ${dialog.columnName}`;
    }
    return 'Custom AutoFilter';
  }, [dialog.columnName]);

  // Handler for condition 1 operator change
  const handleOperator1Change = useCallback(
    (value: string) => {
      setCondition1({ operator: value as CustomFilterOperator });
    },
    [setCondition1],
  );

  // Handler for condition 1 value change
  const handleValue1Change = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setCondition1({ value: e.target.value });
    },
    [setCondition1],
  );

  // Handler for condition 2 operator change
  const handleOperator2Change = useCallback(
    (value: string) => {
      setCondition2({ operator: value as CustomFilterOperator });
    },
    [setCondition2],
  );

  // Handler for condition 2 value change
  const handleValue2Change = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setCondition2({ value: e.target.value });
    },
    [setCondition2],
  );

  // Handler for logical operator change
  const handleLogicalOperatorChange = useCallback(
    (value: string) => {
      setLogicalOperator(value as 'and' | 'or');
    },
    [setLogicalOperator],
  );

  // Validate and apply the filter
  const handleOk = useCallback(() => {
    // Validate: at least one condition must have a value
    const hasCondition1 = dialog.condition1.value.trim() !== '';
    const hasCondition2 = dialog.condition2.value.trim() !== '';

    if (!hasCondition1 && !hasCondition2) {
      setCustomAutoFilterError('Please enter at least one filter value.');
      return;
    }

    // Dispatch the apply action
    dispatch('APPLY_CUSTOM_AUTOFILTER', deps, {
      filterId: dialog.filterId,
      columnIndex: dialog.columnIndex,
      conditions: {
        condition1: hasCondition1 ? dialog.condition1 : null,
        condition2: hasCondition2 ? dialog.condition2 : null,
        logicalOperator: dialog.logicalOperator,
      },
    });

    // Close dialog via unified action system
    dispatch('CLOSE_CUSTOM_AUTOFILTER_DIALOG', deps);
  }, [
    dialog.filterId,
    dialog.columnIndex,
    dialog.condition1,
    dialog.condition2,
    dialog.logicalOperator,
    deps,
    setCustomAutoFilterError,
  ]);

  // Handle Cancel - use dispatch for unified action system
  const handleClose = useCallback(() => {
    dispatch('CLOSE_CUSTOM_AUTOFILTER_DIALOG', deps);
  }, [deps]);

  if (!dialog.isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={dialog.isOpen}
      onClose={handleClose}
      dialogId="custom-autofilter-dialog"
      width="md"
    >
      <DialogHeader onClose={handleClose}>{dialogTitle}</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Instructions */}
          <div className="text-body-sm text-ss-text-secondary">Show rows where:</div>

          {/* Help text for wildcards */}
          <div className="text-body-xs text-ss-text-tertiary bg-ss-surface-secondary px-3 py-2 rounded">
            Use ? to represent any single character. Use * to represent any series of characters.
          </div>

          {/* Condition 1 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Select
                value={dialog.condition1.operator}
                onChange={handleOperator1Change}
                options={OPERATOR_OPTIONS}
                className="w-48"
                aria-label="First condition operator"
              />
              <Input
                type="text"
                value={dialog.condition1.value}
                onChange={handleValue1Change}
                placeholder="Enter value..."
                className="flex-1"
                aria-label="First condition value"
              />
            </div>
          </div>

          {/* Logical operator (AND/OR) */}
          <div className="flex items-center gap-4">
            <RadioGroup
              name="logicalOperator"
              options={LOGICAL_OPERATOR_OPTIONS}
              value={dialog.logicalOperator}
              onChange={handleLogicalOperatorChange}
              orientation="horizontal"
              size="sm"
            />
          </div>

          {/* Condition 2 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Select
                value={dialog.condition2.operator}
                onChange={handleOperator2Change}
                options={OPERATOR_OPTIONS}
                className="w-48"
                aria-label="Second condition operator"
              />
              <Input
                type="text"
                value={dialog.condition2.value}
                onChange={handleValue2Change}
                placeholder="Enter value..."
                className="flex-1"
                aria-label="Second condition value"
              />
            </div>
          </div>

          {/* Error message */}
          {dialog.errorMessage && (
            <div
              className="text-body-sm text-ss-error bg-ss-error/10 px-3 py-2 rounded"
              role="alert"
            >
              {dialog.errorMessage}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
