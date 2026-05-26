/**
 * Validation Warning Dialog
 *
 * Shown when a cell edit fails validation with 'warning' or 'info' enforcement.
 * Reads state from the UI store (ValidationWarningDialogSlice) so the coordinator
 * (which lives above the component tree) can show it via showValidationWarning().
 *
 * G.4: Data Validation Error Style Differentiation
 * - 'warning': Yellow icon, allows override, Yes / No / Cancel buttons
 * - 'information' (info): Blue icon, always allows, OK / Cancel buttons
 *
 * The 'stop' (strict) enforcement uses ValidationErrorDialog, not this dialog.
 *
 */

import { useCallback } from 'react';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import type { EnforcementLevel } from '@mog-sdk/contracts/schema';

import { useUIStore } from '../../internal-api';
import type { ValidationWarningErrorStyle } from '../../ui-store/slices/dialogs/validation-warning-dialog';

// =============================================================================
// Types
// =============================================================================

/**
 * G.4: Public-facing error style. Excludes 'stop' (which is handled by
 * ValidationErrorDialog). Re-exported for callers that need to map enforcement.
 */
export type ValidationErrorStyle = ValidationWarningErrorStyle;

// =============================================================================
// Utilities
// =============================================================================

/**
 * G.4: Convert EnforcementLevel to ValidationErrorStyle.
 * 'strict' is not handled here — it's routed to ValidationErrorDialog.
 */
export function enforcementToErrorStyle(enforcement: EnforcementLevel): ValidationErrorStyle {
  switch (enforcement) {
    case 'warning':
      return 'warning';
    case 'info':
    case 'none':
    case 'strict':
    default:
      return 'information';
  }
}

// =============================================================================
// Icons
// =============================================================================

function WarningIcon() {
  return (
    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ss-warning-100 flex items-center justify-center">
      <svg
        className="w-6 h-6 text-ss-warning-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    </div>
  );
}

function InformationIcon() {
  return (
    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-ss-info-100 flex items-center justify-center">
      <svg className="w-6 h-6 text-info-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * ValidationWarningDialog — propless connector to the UI store.
 *
 * - 'warning': Yes / No / Cancel
 * - Yes: accept invalid value
 * - No: return to edit mode (retry)
 * - Cancel: discard edit, revert to original
 * - 'information': OK / Cancel
 * - OK: accept value
 * - Cancel: discard edit, revert to original
 */
export function ValidationWarningDialog() {
  const state = useUIStore((s) => s.validationWarningDialog);
  const closeDialog = useUIStore((s) => s.closeValidationWarning);
  const getCallbacks = useUIStore((s) => s.getValidationWarningCallbacks);

  const handleProceed = useCallback(() => {
    const { onProceed } = getCallbacks();
    closeDialog();
    onProceed();
  }, [closeDialog, getCallbacks]);

  const handleCancel = useCallback(() => {
    const { onCancel } = getCallbacks();
    closeDialog();
    onCancel();
  }, [closeDialog, getCallbacks]);

  const handleRetry = useCallback(() => {
    const { onRetry } = getCallbacks();
    closeDialog();
    onRetry();
  }, [closeDialog, getCallbacks]);

  if (!state.isOpen) return null;

  const renderButtons = () => {
    switch (state.errorStyle) {
      case 'warning':
        return (
          <>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleRetry}>
              No
            </Button>
            <Button variant="primary" onClick={handleProceed}>
              Yes
            </Button>
          </>
        );
      case 'information':
      default:
        return (
          <>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleProceed}>
              OK
            </Button>
          </>
        );
    }
  };

  const message = state.message || 'The value you entered is not valid.';
  const prompt = state.errorStyle === 'warning' ? 'Do you want to continue?' : null;
  const icon = state.errorStyle === 'warning' ? <WarningIcon /> : <InformationIcon />;

  // Excel parity: warning-style default button is "No" (return to edit) — the
  // safer choice if the user presses Enter without reading. Information-style
  // accepts the value, so Enter routes to OK / Proceed.
  const onEnterKeyDown = state.errorStyle === 'warning' ? handleRetry : handleProceed;

  return (
    <Dialog
      onEnterKeyDown={onEnterKeyDown}
      open={state.isOpen}
      onClose={handleCancel}
      dialogId="validation-warning-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>{state.title}</DialogHeader>
      <DialogBody>
        <div className="flex items-start gap-3">
          {icon}
          <div>
            <p className="text-body text-ss-text-primary m-0">{message}</p>
            {prompt && <p className="text-body text-ss-text-secondary mt-3 mb-0">{prompt}</p>}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>{renderButtons()}</DialogFooter>
    </Dialog>
  );
}
