/**
 * Formula Error Dialog
 *
 * Shown when a formula has a syntax error and cannot be parsed.
 * Provides Excel-like options to edit the formula, accept as text, or get help.
 *
 * This follows Excel's behavior where invalid formulas show a dialog with:
 * - "Edit" - Return to editing the formula (default)
 * - "OK" - Accept the formula as literal text (add leading apostrophe)
 * - "Help" - Open help documentation
 *
 * Backed by the UI store so the editor commit coordinator can show this
 * dialog from above the React subtree.
 *
 */

import { useCallback } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

export interface FormulaErrorState {
  open: boolean;
  formula: string;
  errorMessage: string;
}

export interface FormulaErrorCallbacks {
  /** Return to editing the formula (keep editor open) */
  onEdit: () => void;
  /** Accept as literal text (commit with apostrophe prefix) */
  onAcceptAsText: () => void;
  /** Cancel the edit and discard the invalid formula */
  onCancel: () => void;
  /** Open help documentation */
  onHelp: () => void;
}

function focusActiveFormulaEditor(): void {
  const editor = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '[data-testid="inline-cell-editor"], [data-testid="formula-bar"] input, [data-testid="formula-bar"] textarea',
  );
  editor?.focus();
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to read formula error dialog state and actions.
 *
 * Returns:
 * - state: Current dialog state (open, formula, errorMessage)
 * - showError: Function to show the error dialog
 * - handleEdit: Return to editing via the coordinator callback
 * - handleAcceptAsText: Accept formula as text via the coordinator callback
 * - handleHelp: Open formula help
 *
 * @example
 * ```tsx
 * const { state, showError, handleEdit, handleAcceptAsText, handleHelp } = useFormulaErrorDialog();
 *
 * // Wire to editor commit validation
 * if (formulaHasError) {
 * showError(formula, errorMessage);
 * }
 *
 * // Render dialog
 * <FormulaErrorDialog
 * state={state}
 * onEdit={handleEdit}
 * onAcceptAsText={handleAcceptAsText}
 * onHelp={handleHelp}
 * />
 * ```
 */
export function useFormulaErrorDialog() {
  const dialog = useUIStore((s) => s.formulaErrorDialog);
  const showFormulaError = useUIStore((s) => s.showFormulaError);
  const closeFormulaError = useUIStore((s) => s.closeFormulaError);
  const getCallbacks = useUIStore((s) => s.getFormulaErrorCallbacks);

  const state: FormulaErrorState = {
    open: dialog.isOpen,
    formula: dialog.formula,
    errorMessage: dialog.errorMessage,
  };

  const showError = useCallback(
    (formula: string, errorMessage: string) => {
      showFormulaError(
        formula,
        errorMessage,
        () => {},
        () => {},
      );
    },
    [showFormulaError],
  );

  const handleEdit = useCallback(() => {
    const { onEdit } = getCallbacks();
    closeFormulaError();
    onEdit();
    requestAnimationFrame(() => {
      requestAnimationFrame(focusActiveFormulaEditor);
    });
  }, [closeFormulaError, getCallbacks]);

  const handleAcceptAsText = useCallback(() => {
    const { onAcceptAsText } = getCallbacks();
    closeFormulaError();
    onAcceptAsText();
  }, [closeFormulaError, getCallbacks]);

  const handleCancel = useCallback(() => {
    const { onCancel } = getCallbacks();
    closeFormulaError();
    onCancel();
  }, [closeFormulaError, getCallbacks]);

  const handleHelp = useCallback(() => {
    window.open('https://support.microsoft.com/en-us/office/formula-errors', '_blank');
    // Don't close the dialog - user may want to come back
  }, []);

  return {
    state,
    showError,
    handleEdit,
    handleAcceptAsText,
    handleCancel,
    handleHelp,
  };
}

// =============================================================================
// Component
// =============================================================================

/**
 * FormulaErrorDialog - Modal dialog for formula syntax errors.
 *
 * Shows when a formula cannot be parsed due to syntax errors.
 * User can choose to:
 * - Edit: Return to editing the formula
 * - OK: Accept as literal text (prefixed with apostrophe internally)
 * - Help: Open help documentation
 *
 * Excel-like behavior:
 * - The formula is displayed with syntax highlighting if possible
 * - Error message describes what went wrong
 * - Default action is "Edit" to fix the formula
 */
export function FormulaErrorDialog() {
  const dialog = useUIStore((s) => s.formulaErrorDialog);
  const closeFormulaError = useUIStore((s) => s.closeFormulaError);
  const getCallbacks = useUIStore((s) => s.getFormulaErrorCallbacks);

  const handleEdit = useCallback(() => {
    const { onEdit } = getCallbacks();
    closeFormulaError();
    onEdit();
    requestAnimationFrame(() => {
      requestAnimationFrame(focusActiveFormulaEditor);
    });
  }, [closeFormulaError, getCallbacks]);

  const handleAcceptAsText = useCallback(() => {
    const { onAcceptAsText } = getCallbacks();
    closeFormulaError();
    onAcceptAsText();
  }, [closeFormulaError, getCallbacks]);

  const handleCancel = useCallback(() => {
    const { onCancel } = getCallbacks();
    closeFormulaError();
    onCancel();
  }, [closeFormulaError, getCallbacks]);

  const handleHelp = useCallback(() => {
    window.open('https://support.microsoft.com/en-us/office/formula-errors', '_blank');
  }, []);

  if (!dialog.isOpen) return null;

  return (
    <Dialog
      open={dialog.isOpen}
      onClose={handleCancel}
      dialogId="formula-error-dialog"
      width="md"
      dataAttributes={{ 'data-testid': 'formula-error-dialog' }}
    >
      <DialogHeader onClose={handleCancel}>Formula Error</DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <p className="text-body text-ss-text-secondary m-0">
            There is a problem with this formula:
          </p>

          {/* Display the problematic formula */}
          <div className="bg-ss-surface-secondary rounded-ss-md p-3 font-ss-mono text-body-sm overflow-x-auto">
            <code className="text-ss-error">{dialog.formula}</code>
          </div>

          {/* Error message */}
          <p className="text-body text-ss-text-secondary m-0">
            {dialog.errorMessage || 'Not a valid formula.'}
          </p>

          <p className="text-body text-text-muted m-0">
            Click Edit to correct the formula, or click OK to accept the formula as text.
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleHelp}>
          Help
        </Button>
        <div className="flex-1" />
        <Button variant="secondary" onClick={handleAcceptAsText}>
          OK
        </Button>
        <Button variant="primary" onClick={handleEdit} autoFocus>
          Edit
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
