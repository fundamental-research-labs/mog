/**
 * Protection Alert Dialog
 *
 * Excel-parity modal shown when user tries to edit a protected cell.
 * Single "OK" button dismisses the dialog - this is informational only.
 *
 * Excel message: "The cell or chart you're trying to change is on a protected sheet.
 * To make a change, unprotect the sheet. You might be requested to enter a password."
 *
 *
 * @see STREAM-H-EDITOR-PROTECTION.md
 */

import { useCallback, useRef, useState } from 'react';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

export interface ProtectionAlertState {
  /** Whether the dialog is open */
  open: boolean;
  /** Custom message (optional - defaults to Excel-style message) */
  message?: string;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to manage protection alert dialog state.
 *
 * @example
 * ```tsx
 * const { state, showAlert, dismiss } = useProtectionAlertDialog();
 *
 * // When edit is blocked
 * const result = editor.startEditing(cell, sheetId, value);
 * if (!result.success) {
 * showAlert(result.reason);
 * }
 *
 * // Render dialog
 * <ProtectionAlertDialog state={state} onDismiss={dismiss} />
 * ```
 */
export function useProtectionAlertDialog() {
  const [state, setState] = useState<ProtectionAlertState>({
    open: false,
  });

  const showAlert = useCallback((message?: string) => {
    setState({
      open: true,
      message,
    });
  }, []);

  const dismiss = useCallback(() => {
    setState({ open: false });
  }, []);

  return {
    state,
    showAlert,
    dismiss,
  };
}

// =============================================================================
// Component
// =============================================================================

interface ProtectionAlertDialogProps {
  state: ProtectionAlertState;
  onDismiss: () => void;
}

/**
 * ProtectionAlertDialog - Modal dialog for protection warnings.
 *
 * Follows Excel behavior: shows when user tries to edit a protected cell.
 * Single "OK" button to dismiss.
 */
export function ProtectionAlertDialog({ state, onDismiss }: ProtectionAlertDialogProps) {
  const messageRef = useRef<HTMLParagraphElement>(null);
  const defaultMessage =
    'The cell or chart you are trying to change is on a protected sheet. ' +
    'To make a change, unprotect the sheet. You might be requested to enter a password.';

  return (
    <Dialog
      open={state.open}
      onClose={onDismiss}
      dialogId="protection-alert-dialog"
      initialFocusRef={messageRef}
      width="sm"
    >
      <DialogHeader>Protected Sheet</DialogHeader>
      <DialogBody>
        <p ref={messageRef} tabIndex={-1} className="text-body text-ss-text-secondary m-0">
          {state.message || defaultMessage}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onDismiss}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
