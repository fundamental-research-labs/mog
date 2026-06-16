/**
 * Data Table Dialog
 *
 * of Scenarios: Data Tables
 *
 * A dialog that allows users to explore multiple scenarios by evaluating a formula
 * with different combinations of input values. Supports one-variable (row OR column)
 * and two-variable (row AND column) data tables.
 *
 * Spreadsheet compatibility: Data > Scenarios > Data Table
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { CollapsibleRangeInput, useDispatch, useUIStore } from '../../internal-api';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import type { DataTableStatus } from '../../ui-store/slices/dialogs/data-table-dialog';

// =============================================================================
// Component
// =============================================================================

export function DataTableDialog() {
  const dispatch = useDispatch();

  // Get state from UIStore
  const isOpen = useUIStore((s) => s.dataTableDialog.isOpen);
  const rowInputCellRef = useUIStore((s) => s.dataTableDialog.rowInputCellRef);
  const colInputCellRef = useUIStore((s) => s.dataTableDialog.colInputCellRef);
  const status = useUIStore((s) => s.dataTableDialog.status);
  const progress = useUIStore((s) => s.dataTableDialog.progress);
  const result = useUIStore((s) => s.dataTableDialog.result);

  // Get actions from UIStore
  const setDataTableRowInputCell = useUIStore((s) => s.setDataTableRowInputCell);
  const setDataTableColInputCell = useUIStore((s) => s.setDataTableColInputCell);
  const closeDataTableDialog = useUIStore((s) => s.closeDataTableDialog);
  const resetDataTableState = useUIStore((s) => s.resetDataTableState);

  // Local validation state
  const [validationError, setValidationError] = useState<string | null>(null);

  // Clear validation error when inputs change
  useEffect(() => {
    setValidationError(null);
  }, [rowInputCellRef, colInputCellRef]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeDataTableDialog();
    setValidationError(null);
  }, [closeDataTableDialog]);

  // Validate inputs
  const validateInputs = useCallback((): boolean => {
    // At least one input cell must be specified
    if (!rowInputCellRef.trim() && !colInputCellRef.trim()) {
      setValidationError(
        'At least one input cell is required. Enter a row input cell, column input cell, or both.',
      );
      return false;
    }

    // If both are specified and they're the same, that's an error
    if (
      rowInputCellRef.trim() &&
      colInputCellRef.trim() &&
      rowInputCellRef.toUpperCase() === colInputCellRef.toUpperCase()
    ) {
      setValidationError('Row input cell and column input cell cannot be the same.');
      return false;
    }

    return true;
  }, [rowInputCellRef, colInputCellRef]);

  // Handle OK - create the Data Table through the action system.
  const handleOk = useCallback(() => {
    if (!validateInputs()) {
      return;
    }

    dispatch('EXECUTE_DATA_TABLE');
  }, [dispatch, validateInputs]);

  // Confirm handler — only run handleOk while inputs form is shown (idle).
  // When results are visible, Enter should close the dialog (matches OK button).
  const handleConfirm = useCallback(() => {
    if (status === 'idle') {
      handleOk();
    } else {
      handleClose();
    }
  }, [status, handleOk, handleClose]);

  // Reset for a new calculation
  const handleReset = useCallback(() => {
    resetDataTableState();
    setValidationError(null);
  }, [resetDataTableState]);

  const guardedEnter = useRangeSelectionEnterGuard(handleConfirm);

  if (!isOpen) return null;

  // Determine which view to show based on status
  const showResults = status === 'completed' || status === 'failed' || status === 'cancelled';
  const isCalculating = status === 'running';

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={isOpen}
      onClose={handleClose}
      dialogId="data-table-dialog"
      width="sm"
      // / app-eval instrumentation: tag the
      // dialog content with `data-testid="overlay-data-table"` so
      // `__dt.getOverlayBounds('data-table')` resolves to the dialog
      // DOM. The dialog-sizing scenario asserts the bounding box isn't
      // accidentally rendered full-screen.
      dataAttributes={{ 'data-testid': 'overlay-data-table' }}
    >
      <DialogHeader onClose={handleClose}>Data Table</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {!showResults ? (
            // Input form
            <>
              {/* Description */}
              <p className="text-body-sm text-ss-text-secondary">
                Create a data table to evaluate a formula with different input values. Select a
                range where the top-left cell contains a formula, the first row contains row input
                values, and the first column contains column input values.
              </p>

              {/* Row input cell */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="data-table-row-input"
                  className="text-body-sm text-ss-text-secondary"
                >
                  Row input cell:
                </label>
                <CollapsibleRangeInput
                  value={rowInputCellRef}
                  onChange={setDataTableRowInputCell}
                  dialogId="data-table-dialog"
                  inputId="data-table-row-input"
                  placeholder="e.g., B1"
                  label="Row input cell"
                />
                <span className="text-caption text-ss-text-tertiary">
                  The cell to substitute with values from the first row of the selection
                </span>
              </div>

              {/* Column input cell */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="data-table-col-input"
                  className="text-body-sm text-ss-text-secondary"
                >
                  Column input cell:
                </label>
                <CollapsibleRangeInput
                  value={colInputCellRef}
                  onChange={setDataTableColInputCell}
                  dialogId="data-table-dialog"
                  inputId="data-table-col-input"
                  placeholder="e.g., C1"
                  label="Column input cell"
                />
                <span className="text-caption text-ss-text-tertiary">
                  The cell to substitute with values from the first column of the selection
                </span>
              </div>

              {/* Loading indicator with progress */}
              {isCalculating && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-body-sm text-ss-text-secondary">
                    <div className="w-4 h-4 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
                    <span>Calculating... {progress}%</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full bg-ss-surface-secondary rounded-full h-2">
                    <div
                      className="bg-ss-primary h-2 rounded-full transition-all duration-ss"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
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
            <DataTableResults status={status} result={result} />
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        {!showResults ? (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleOk} disabled={isCalculating}>
              OK
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={handleReset}>
              New Table
            </Button>
            <Button variant="primary" onClick={handleClose}>
              OK
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Results Component
// =============================================================================

interface DataTableResultsProps {
  status: DataTableStatus;
  result: {
    cellCount: number;
    elapsedMs: number;
    cancelled: boolean;
    errorMessage?: string;
  } | null;
}

function DataTableResults({ status, result }: DataTableResultsProps) {
  if (status === 'cancelled') {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-body font-medium text-ss-warning">
          Data Table calculation cancelled.
        </div>
        {result && (
          <div className="text-body-sm text-ss-text-secondary">
            Computed {result.cellCount} cells before cancellation.
          </div>
        )}
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-body font-medium text-ss-error">Data Table calculation failed.</div>
        {result?.errorMessage && (
          <div className="text-body-sm text-ss-text-secondary">{result.errorMessage}</div>
        )}
        <div className="text-body-sm text-ss-text-secondary">
          <p>Please ensure:</p>
          <ul className="list-disc ml-5 mt-1 space-y-1">
            <li>The selection range is correct</li>
            <li>The top-left cell contains a formula</li>
            <li>The input cell references are valid</li>
          </ul>
        </div>
      </div>
    );
  }

  // Success
  return (
    <div className="flex flex-col gap-3">
      <div className="text-body font-medium text-ss-success">
        Data Table calculated successfully.
      </div>

      {result && (
        <div className="bg-ss-surface-secondary rounded p-3 space-y-2">
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Cells computed:</span>
            <span className="text-text font-medium">{result.cellCount}</span>
          </div>
          <div className="flex justify-between text-body-sm">
            <span className="text-ss-text-secondary">Time elapsed:</span>
            <span className="text-text font-medium">{result.elapsedMs.toFixed(1)}ms</span>
          </div>
        </div>
      )}
    </div>
  );
}
