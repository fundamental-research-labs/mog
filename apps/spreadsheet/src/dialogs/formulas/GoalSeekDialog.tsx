/**
 * Goal Seek Dialog
 *
 * A dialog that allows users to find the input value needed to produce
 * a desired result in a formula. Goal Seek iteratively adjusts a "changing cell"
 * until the formula in the "set cell" produces the target value.
 *
 * Spreadsheet compatibility: Data > Scenarios > Goal Seek
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CollapsibleRangeInput,
  MinimizableDialog,
  useDispatch,
  useUIStore,
} from '../../internal-api';

import { Button, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';
import type { GoalSeekStatus } from '../../ui-store/slices/dialogs/goal-seek-dialog';

// =============================================================================
// Component
// =============================================================================

export function GoalSeekDialog() {
  // Get state from UIStore
  const isOpen = useUIStore((s) => s.goalSeekDialog.isOpen);
  const setCell = useUIStore((s) => s.goalSeekDialog.setCell);
  const toValue = useUIStore((s) => s.goalSeekDialog.toValue);
  const byChangingCell = useUIStore((s) => s.goalSeekDialog.byChangingCell);
  const status = useUIStore((s) => s.goalSeekDialog.status);
  const result = useUIStore((s) => s.goalSeekDialog.result);

  // Get actions from UIStore
  const setGoalSeekSetCell = useUIStore((s) => s.setGoalSeekSetCell);
  const setGoalSeekToValue = useUIStore((s) => s.setGoalSeekToValue);
  const setGoalSeekByChangingCell = useUIStore((s) => s.setGoalSeekByChangingCell);
  const closeGoalSeekDialog = useUIStore((s) => s.closeGoalSeekDialog);
  const resetGoalSeekState = useUIStore((s) => s.resetGoalSeekState);

  // Get dispatch function for action handlers
  const dispatch = useDispatch();

  // Local validation state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Clear validation error when inputs change
  useEffect(() => {
    setValidationError(null);
  }, [setCell, toValue, byChangingCell]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeGoalSeekDialog();
    setValidationError(null);
  }, [closeGoalSeekDialog]);

  // Validate inputs
  const validateInputs = useCallback((): boolean => {
    if (!setCell.trim()) {
      setValidationError('Set cell is required. Enter a cell reference containing a formula.');
      return false;
    }
    if (!toValue.trim()) {
      setValidationError('To value is required. Enter the target value you want to achieve.');
      return false;
    }
    if (isNaN(parseFloat(toValue))) {
      setValidationError('To value must be a number.');
      return false;
    }
    if (!byChangingCell.trim()) {
      setValidationError('By changing cell is required. Enter a cell reference to adjust.');
      return false;
    }
    if (setCell.toUpperCase() === byChangingCell.toUpperCase()) {
      setValidationError('Set cell and changing cell cannot be the same.');
      return false;
    }
    return true;
  }, [setCell, toValue, byChangingCell]);

  // Handle OK - run Goal Seek via action dispatcher
  const handleOk = useCallback(() => {
    if (!validateInputs()) {
      return;
    }

    // Dispatch the EXECUTE_GOAL_SEEK action to run the algorithm
    dispatch('EXECUTE_GOAL_SEEK');
  }, [dispatch, validateInputs]);

  // Handle Apply - apply the solution to the changing cell
  const handleApply = useCallback(() => {
    if (result?.found) {
      dispatch('APPLY_GOAL_SEEK_RESULT');
    }
  }, [dispatch, result]);

  // Confirm handler — only run handleOk while inputs form is shown (idle).
  // When results are visible, Enter closes the dialog.
  const handleConfirm = useCallback(() => {
    if (status === 'idle') {
      handleOk();
    } else if (status !== 'running') {
      handleClose();
    }
  }, [status, handleOk, handleClose]);

  // Reset for a new calculation
  const handleReset = useCallback(() => {
    resetGoalSeekState();
    setValidationError(null);
  }, [resetGoalSeekState]);

  if (!isOpen) return null;

  // Determine which view to show based on status
  const showResults = status === 'completed' || status === 'failed';

  return (
    <MinimizableDialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleClose}
      dialogId="goal-seek-dialog"
      title="Goal Seek"
      width="sm"
    >
      <DialogHeader onClose={handleClose}>Goal Seek</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {!showResults ? (
            // Input form
            <>
              {/* Set cell */}
              <div className="flex flex-col gap-1">
                <label htmlFor="goal-seek-set-cell" className="text-body-sm text-ss-text-secondary">
                  Set cell:
                </label>
                <CollapsibleRangeInput
                  value={setCell}
                  onChange={setGoalSeekSetCell}
                  dialogId="goal-seek-dialog"
                  inputId="goal-seek-set-cell"
                  placeholder="e.g., B4"
                  label="Set cell"
                  rangePickerMode="single-cell"
                />
                <span className="text-caption text-ss-text-tertiary">
                  The cell containing the formula you want to equal a specific value
                </span>
              </div>

              {/* To value */}
              <div className="flex flex-col gap-1">
                <label htmlFor="goal-seek-to-value" className="text-body-sm text-ss-text-secondary">
                  To value:
                </label>
                <Input
                  id="goal-seek-to-value"
                  type="text"
                  value={toValue}
                  onChange={(e) => setGoalSeekToValue(e.target.value)}
                  placeholder="e.g., 100"
                  size="sm"
                  autoComplete="off"
                />
                <span className="text-caption text-ss-text-tertiary">
                  The value you want the Set cell to equal
                </span>
              </div>

              {/* By changing cell */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="goal-seek-by-changing"
                  className="text-body-sm text-ss-text-secondary"
                >
                  By changing cell:
                </label>
                <CollapsibleRangeInput
                  value={byChangingCell}
                  onChange={setGoalSeekByChangingCell}
                  dialogId="goal-seek-dialog"
                  inputId="goal-seek-by-changing"
                  placeholder="e.g., B1"
                  label="By changing cell"
                  rangePickerMode="single-cell"
                />
                <span className="text-caption text-ss-text-tertiary">
                  The cell whose value Goal Seek will change to reach the target
                </span>
              </div>

              {/* Loading indicator */}
              {status === 'running' && (
                <div className="flex items-center gap-2 text-body-sm text-ss-text-secondary">
                  <div className="w-4 h-4 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
                  <span>Calculating...</span>
                </div>
              )}

              {/* Validation error */}
              {validationError && (
                <div
                  className="text-body-sm text-ss-error bg-ss-error/10 px-3 py-2 rounded"
                  role="alert"
                >
                  {validationError}
                </div>
              )}
            </>
          ) : (
            // Results view
            <GoalSeekResults
              status={status}
              result={result}
              setCell={setCell}
              toValue={toValue}
              byChangingCell={byChangingCell}
            />
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        {!showResults ? (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleOk} disabled={status === 'running'}>
              OK
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={handleReset}>
              New Search
            </Button>
            {result?.found && (
              <Button variant="primary" onClick={handleApply}>
                Apply
              </Button>
            )}
            <Button variant={result?.found ? 'secondary' : 'primary'} onClick={handleClose}>
              {result?.found ? 'Cancel' : 'OK'}
            </Button>
          </>
        )}
      </DialogFooter>
    </MinimizableDialog>
  );
}

// =============================================================================
// Results Component
// =============================================================================

interface GoalSeekResultsProps {
  status: GoalSeekStatus;
  result: {
    found: boolean;
    solutionValue?: number;
    achievedValue?: number;
    iterations: number;
    errorMessage?: string;
  } | null;
  setCell: string;
  toValue: string;
  byChangingCell: string;
}

function GoalSeekResults({
  status,
  result,
  setCell,
  toValue,
  byChangingCell,
}: GoalSeekResultsProps) {
  if (status === 'failed' || !result?.found) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-body font-medium text-ss-error">
          Goal Seek did not find a solution.
        </div>
        {result?.errorMessage && (
          <div className="text-body-sm text-ss-text-secondary">{result.errorMessage}</div>
        )}
        <div className="bg-ss-surface-secondary rounded p-3 space-y-2">
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Target cell:</span>
            <span className="text-text font-medium">{setCell}</span>
          </div>
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Target value:</span>
            <span className="text-text font-medium">{toValue}</span>
          </div>
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Changing cell:</span>
            <span className="text-text font-medium">{byChangingCell}</span>
          </div>
        </div>
        <div className="text-body-sm text-ss-text-secondary">
          <p>This can happen when:</p>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li>The target value is not achievable</li>
            <li>The formula does not depend on the changing cell</li>
            <li>The function is not continuous or has multiple solutions</li>
          </ul>
        </div>
        {result && (
          <div className="text-caption text-ss-text-tertiary">
            Iterations performed: {result.iterations}
          </div>
        )}
      </div>
    );
  }

  // Success
  const targetValue = parseFloat(toValue);
  const difference =
    result.achievedValue !== undefined ? Math.abs(result.achievedValue - targetValue) : 0;
  const isExact = difference < 0.000001;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-body font-medium text-ss-success">Goal Seek found a solution.</div>

      <div className="bg-ss-surface-secondary rounded p-3 space-y-2">
        <div className="flex justify-between text-body-sm">
          <span className="text-ss-text-secondary">Target value:</span>
          <span className="text-text font-medium">{targetValue}</span>
        </div>
        {result.achievedValue !== undefined && (
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Current value ({setCell}):</span>
            <span className="text-text font-medium">
              {result.achievedValue.toFixed(6).replace(/\.?0+$/, '')}
            </span>
          </div>
        )}
        {result.solutionValue !== undefined && (
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Solution ({byChangingCell}):</span>
            <span className="text-text font-medium">
              {result.solutionValue.toFixed(6).replace(/\.?0+$/, '')}
            </span>
          </div>
        )}
      </div>

      {!isExact && (
        <div className="text-caption text-ss-text-tertiary">
          Note: The achieved value differs from the target by {difference.toExponential(2)}. This is
          the closest solution found.
        </div>
      )}

      <div className="text-caption text-ss-text-tertiary">
        Iterations performed: {result.iterations}
      </div>
    </div>
  );
}
