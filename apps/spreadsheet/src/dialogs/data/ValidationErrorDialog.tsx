/**
 * Validation Error Dialog
 *
 * Dialog shown when a cell edit fails validation with 'strict' enforcement.
 * Follows Excel's "Stop" style:
 * - Red stop icon
 * - Error message
 * - Retry (return to edit mode) and Cancel (discard edit) buttons
 *
 */

import { useCallback } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

/**
 * Stop icon (red) - for strict validation that blocks invalid input
 */
function StopIcon() {
  return (
    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ss-error-100 flex items-center justify-center">
      <svg
        className="w-6 h-6 text-ss-error-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
        />
      </svg>
    </div>
  );
}

/**
 * ValidationErrorDialog - Modal dialog for strict validation errors.
 *
 * Shows when a cell edit fails validation with 'strict' enforcement.
 * User can choose:
 * - "Retry": Return to edit mode to correct the value
 * - "Cancel": Cancel the edit entirely and revert to original value
 */
export function ValidationErrorDialog() {
  const state = useUIStore((s) => s.validationErrorDialog);
  const closeDialog = useUIStore((s) => s.closeValidationError);
  const getCallbacks = useUIStore((s) => s.getValidationErrorCallbacks);

  const handleRetry = useCallback(() => {
    const { onRetry } = getCallbacks();
    closeDialog();
    onRetry();
  }, [closeDialog, getCallbacks]);

  const handleCancel = useCallback(() => {
    const { onCancel } = getCallbacks();
    closeDialog();
    onCancel();
  }, [closeDialog, getCallbacks]);

  if (!state.isOpen) return null;

  // Parse message to separate error from rule
  // Format: "Error message\n\nRule: Rule description"
  const messageParts = state.message?.split('\n\nRule: ') || [];
  const errorText = messageParts[0] || 'The value you entered is not valid.';
  const ruleText = messageParts[1];

  return (
    <Dialog
      // Enter = Retry. This dialog renders the "stop" layout exclusively
      // (Retry / Cancel) — `alertStyle` in state is plumbed through for
      // app-eval instrumentation only, and the CoordinatorProvider routes
      // 'warning' / 'information' to the separate ValidationWarningDialog.
      // So binding Enter to handleRetry is unconditionally correct here:
      // there is no code path where this component shows a Yes/No/OK button
      // set, so Enter cannot accidentally accept invalid input. Excel parity:
      // Enter on the Stop alert reopens the editor for correction.
      onEnterKeyDown={handleRetry}
      open={state.isOpen}
      onClose={handleCancel}
      dialogId="validation-error-dialog"
      width="sm"
      // Expose the alert style on the root [role="dialog"] element so app-eval
      // scenarios (dv-error-stop, dv-number-whole-between, etc.) can assert the
      // enforcement shape. Values mirror the public ValidationRule.errorStyle
      // vocabulary: "stop" | "warning" | "information".
      //
      // `data-testid` lets the metadata-roundtrip harness target this dialog
      // unambiguously (other [role="dialog"] surfaces — InsertHyperlinkDialog
      // etc. — share the role).
      //
      // NOTE: The "warning" (Yes/No/Cancel) and "information" (OK/Cancel)
      // variants are handled by ValidationWarningDialog, not this component.
      // Even though `state.alertStyle` can carry those values, this dialog's
      // button set never changes — the field is for instrumentation only.
      dataAttributes={{
        'data-dv-alert-style': state.alertStyle,
        'data-testid': 'dv-error-dialog',
      }}
    >
      <DialogHeader onClose={handleCancel}>{state.title || 'Data Validation Error'}</DialogHeader>
      <DialogBody>
        <div className="flex items-start gap-3">
          <StopIcon />
          <div className="flex flex-col gap-3">
            <p className="text-body text-ss-text-primary m-0">{errorText}</p>
            {ruleText && (
              <div className="px-3 py-2 bg-ss-surface-secondary rounded border border-ss-border-primary">
                <p className="text-body-sm text-ss-text-secondary m-0">
                  <span className="font-semibold">Rule:</span> {ruleText}
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleRetry}>
          Retry
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
