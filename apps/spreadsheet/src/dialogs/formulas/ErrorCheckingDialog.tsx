/**
 * Error Checking Dialog
 *
 * A dialog that helps users navigate through and fix formula errors
 * in the workbook. It displays error explanations and suggested fixes.
 *
 * Excel Parity: Formulas > Formula Auditing > Error Checking
 *
 * Features:
 * - Navigate through errors in sheet
 * - Display error explanation
 * - Show suggested fixes
 * - Options to ignore, edit, or trace errors
 */

import { useCallback, useMemo } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { errorDisplayString } from '@mog/spreadsheet-utils/errors';
import type { ErrorVariant } from '@mog-sdk/contracts/core';
import type { FormulaErrorType } from '../../ui-store/slices/dialogs/error-checking-dialog';

/** List of variant names that are ErrorVariant (not non-error FormulaErrorType like 'inconsistent_formula'). */
const ERROR_VARIANTS = new Set<string>([
  'Value',
  'Ref',
  'Name',
  'Div0',
  'Na',
  'Null',
  'Num',
  'Spill',
  'Calc',
  'Circ',
]);

/** Format a FormulaErrorType for user display. Converts variant names to display strings. */
function formatErrorType(errorType: string): string {
  if (ERROR_VARIANTS.has(errorType)) return errorDisplayString(errorType as ErrorVariant);
  return errorType;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Human-readable descriptions for each error type
 */
const ERROR_DESCRIPTIONS: Record<FormulaErrorType, string> = {
  Value: 'A value used in the formula is of the wrong data type.',
  Ref: 'A cell reference is not valid. The referenced cell may have been deleted.',
  Name: 'The formula contains a name that is not recognized. Check for typos in function names.',
  Div0: 'The formula is trying to divide by zero or an empty cell.',
  Na: 'A value is not available to the formula. Often occurs with lookup functions.',
  Null: 'The formula contains an invalid range reference. Check that ranges are specified correctly.',
  Num: 'The formula produces a number that is too large or small, or uses invalid numeric arguments.',
  Spill: 'A formula that returns multiple values cannot spill into the available range.',
  Calc: 'The calculation engine encountered an error while evaluating this formula.',
  inconsistent_formula:
    'This formula is different from others in the surrounding cells. It may contain an error.',
  number_stored_as_text:
    'This cell contains a number stored as text. This may affect calculations that reference it.',
  empty_cell_reference:
    'This formula references empty cells, which may produce unexpected results.',
  unlocked_formula_cell:
    'This formula cell is unlocked. Consider locking it to prevent accidental changes.',
  formula_omits_cells:
    'This formula omits adjacent cells that contain data. You may want to expand the range.',
};

/**
 * Icons for different error types
 */
const ERROR_ICONS: Record<string, string> = {
  Value: '\u26a0',
  Ref: '\u26a0',
  Name: '\u26a0',
  Div0: '\u26a0',
  Na: '\u2139',
  Null: '\u26a0',
  Num: '\u26a0',
  Spill: '\u26a0',
  Calc: '\u26a0',
  inconsistent_formula: '\u2139',
  number_stored_as_text: '\u2139',
  empty_cell_reference: '\u2139',
  unlocked_formula_cell: '\u2139',
  formula_omits_cells: '\u2139',
};

// =============================================================================
// Component
// =============================================================================

export function ErrorCheckingDialog() {
  // Get state from UIStore
  const isOpen = useUIStore((s) => s.errorCheckingDialog.isOpen);
  const status = useUIStore((s) => s.errorCheckingDialog.status);
  const currentError = useUIStore((s) => s.errorCheckingDialog.currentError);
  const currentErrorIndex = useUIStore((s) => s.errorCheckingDialog.currentErrorIndex);
  const errors = useUIStore((s) => s.errorCheckingDialog.errors);

  // Get actions from UIStore
  const closeErrorCheckingDialog = useUIStore((s) => s.closeErrorCheckingDialog);
  const nextFormulaError = useUIStore((s) => s.nextFormulaError);
  const previousFormulaError = useUIStore((s) => s.previousFormulaError);
  const ignoreCurrentError = useUIStore((s) => s.ignoreCurrentError);
  const clearIgnoredErrors = useUIStore((s) => s.clearIgnoredErrors);

  // Get description for current error
  const errorDescription = useMemo(() => {
    if (!currentError) return '';
    return (
      currentError.explanation ||
      ERROR_DESCRIPTIONS[currentError.errorType as FormulaErrorType] ||
      'An error was detected in this formula.'
    );
  }, [currentError]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeErrorCheckingDialog();
  }, [closeErrorCheckingDialog]);

  // Navigate to the error cell
  // Note: Navigation requires NAVIGATE_TO_REFERENCE action integration
  const handleShowInCell = useCallback(() => {
    if (!currentError) return;

    // TODO: Dispatch NAVIGATE_TO_REFERENCE to navigate to the error cell
    console.log('Show in cell:', currentError.cellRef);
  }, [currentError]);

  // Edit the cell with the error
  // Note: This requires navigation + start editing actions
  const handleEditInCell = useCallback(() => {
    if (!currentError) return;

    // TODO: Dispatch NAVIGATE_TO_REFERENCE then START_EDITING
    console.log('Edit in cell:', currentError.cellRef);
  }, [currentError]);

  // Trace precedents of the error cell
  // Note: Formula auditing features require TRACE_PRECEDENTS action
  const handleTracePrecedents = useCallback(() => {
    if (!currentError) return;

    // TODO: Dispatch TRACE_PRECEDENTS action
    console.log('Trace precedents:', currentError.cellRef);
  }, [currentError]);

  // Handle ignore current error
  const handleIgnore = useCallback(() => {
    ignoreCurrentError();
  }, [ignoreCurrentError]);

  // Handle reset ignored errors
  const handleResetIgnored = useCallback(() => {
    clearIgnoredErrors();
    // TODO: Trigger a re-check via ERROR_CHECK action
  }, [clearIgnoredErrors]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextFormulaError();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        previousFormulaError();
      }
    },
    [handleClose, nextFormulaError, previousFormulaError],
  );

  if (!isOpen) return null;

  // Show completion view
  if (status === 'completed' || status === 'no-errors') {
    return (
      <Dialog open={isOpen} onClose={handleClose} dialogId="error-checking-dialog" width="sm">
        <DialogHeader onClose={handleClose}>Error Checking</DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="text-4xl text-ss-success">&#10003;</div>
            <div className="text-body font-medium">
              {status === 'no-errors'
                ? 'No errors found in this worksheet.'
                : 'Error checking complete.'}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={handleResetIgnored}>
            Reset Ignored Errors
          </Button>
          <Button variant="primary" onClick={handleClose}>
            OK
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // Show checking view
  if (status === 'checking' && !currentError) {
    return (
      <Dialog open={isOpen} onClose={handleClose} dialogId="error-checking-dialog" width="sm">
        <DialogHeader onClose={handleClose}>Error Checking</DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="w-6 h-6 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
            <div className="text-body text-ss-text-secondary">Checking for errors...</div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }

  // Main error view
  const errorIcon = currentError ? ERROR_ICONS[currentError.errorType] || '\u26a0' : '\u26a0';
  const errorCount = errors.length;
  const currentPosition = currentErrorIndex + 1;

  return (
    <Dialog open={isOpen} onClose={handleClose} dialogId="error-checking-dialog" width="md">
      <DialogHeader onClose={handleClose}>Error Checking</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4" onKeyDown={handleKeyDown} tabIndex={0}>
          {/* Error header with icon */}
          <div className="flex items-start gap-3">
            <div className="text-3xl text-ss-warning">{errorIcon}</div>
            <div className="flex-1">
              <div className="text-body font-medium text-text">
                Error in {currentError?.cellRef ?? 'cell'}
              </div>
              <div className="text-body-sm text-ss-text-secondary">
                {currentError?.sheetName ?? 'Sheet'}
              </div>
            </div>
            <div className="text-body-sm text-ss-text-tertiary">
              {currentPosition} of {errorCount}
            </div>
          </div>

          {/* Error type badge */}
          <div className="inline-flex self-start">
            <span className="px-2 py-1 bg-ss-error/10 text-ss-error text-body-sm font-ss-mono rounded">
              {currentError ? formatErrorType(currentError.errorType) : 'Error'}
            </span>
          </div>

          {/* Formula display */}
          {currentError?.formula && (
            <div className="bg-ss-surface-secondary rounded p-3">
              <div className="text-caption text-ss-text-secondary mb-1">Formula:</div>
              <div className="text-body-sm font-ss-mono text-text break-all">
                {currentError.formula}
              </div>
            </div>
          )}

          {/* Error description */}
          <div className="text-body-sm text-ss-text-secondary">{errorDescription}</div>

          {/* Suggested fixes */}
          {currentError?.suggestedFixes && currentError.suggestedFixes.length > 0 && (
            <div className="border border-ss-border rounded p-3">
              <div className="text-body-sm font-medium text-text mb-2">Suggestions:</div>
              <ul className="list-disc ml-5 space-y-1">
                {currentError.suggestedFixes.map((fix: string, index: number) => (
                  <li key={index} className="text-body-sm text-ss-text-secondary">
                    {fix}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleShowInCell}>
              Show in Cell
            </Button>
            <Button variant="secondary" size="sm" onClick={handleEditInCell}>
              Edit in Cell
            </Button>
            <Button variant="secondary" size="sm" onClick={handleTracePrecedents}>
              Trace Precedents
            </Button>
            <Button variant="secondary" size="sm" onClick={handleIgnore}>
              Ignore Error
            </Button>
          </div>
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={previousFormulaError} disabled={errorCount <= 1}>
            Previous
          </Button>
          <Button variant="secondary" onClick={nextFormulaError} disabled={errorCount <= 1}>
            Next
          </Button>
        </div>
        <Button variant="primary" onClick={handleClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
