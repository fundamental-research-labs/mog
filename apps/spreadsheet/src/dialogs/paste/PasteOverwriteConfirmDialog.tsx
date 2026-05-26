/**
 * Paste Overwrite Confirm Dialog
 *
 * Excel/Sheets parity confirmation dialog shown when a CUT-paste's destination
 * contains existing non-empty cells. Asks the user whether to overwrite the
 * destination cells before any writes happen.
 *
 * Behaviour:
 * - Confirm (Enter / OK) → re-fires the paste with skipOverwriteCheck=true,
 * destination is overwritten, source is cleared.
 * - Cancel (Escape / Cancel) → closes the dialog AND clears the clipboard,
 * cancelling the cut entirely. Source/destination preserved.
 *
 * Plain copy-paste does NOT show this dialog (Excel parity — copy-paste always
 * overwrites silently). Paste-special variants are out of scope.
 *
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * PasteOverwriteConfirmDialog - Confirmation for cut-paste overwrite.
 *
 * Shown when a CUT-paste's destination contains existing non-empty cells.
 */
export function PasteOverwriteConfirmDialog() {
  const deps = useActionDependencies();

  // Subscribe to dialog state.
  const isOpen = useUIStore((s) => s.pasteOverwriteConfirmDialog.isOpen);

  const handleConfirm = useCallback(() => {
    dispatch('CONFIRM_PASTE_OVERWRITE', deps);
  }, [deps]);

  const handleCancel = useCallback(() => {
    dispatch('CANCEL_PASTE_OVERWRITE', deps);
  }, [deps]);

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="paste-overwrite-confirm-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Paste</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          Do you want to replace the contents of the destination cells?
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm} data-confirm-button="true">
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
