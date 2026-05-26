/**
 * Delete Sheet Confirm Dialog
 *
 * Excel-parity confirmation dialog shown when the user attempts to delete a
 * sheet that contains data. Empty sheets are deleted silently and never
 * trigger this dialog.
 *
 * Behaviour:
 * - Confirm (Delete button) → CONFIRM_DELETE_SHEET removes the sheet, switches
 * active sheet if needed, and closes the dialog.
 * - Cancel (Cancel button / Escape) → CLOSE_DELETE_SHEET_CONFIRM_DIALOG closes
 * the dialog with no mutation.
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

export function DeleteSheetConfirmDialog() {
  const deps = useActionDependencies();
  const isOpen = useUIStore((s) => s.deleteSheetConfirmDialog.isOpen);
  const sheetName = useUIStore((s) => s.deleteSheetConfirmDialog.sheetName);

  const handleConfirm = useCallback(() => {
    dispatch('CONFIRM_DELETE_SHEET', deps);
  }, [deps]);

  const handleCancel = useCallback(() => {
    dispatch('CLOSE_DELETE_SHEET_CONFIRM_DIALOG', deps);
  }, [deps]);

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="delete-sheet-confirm-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Delete Sheet?</DialogHeader>
      <DialogBody>
        <p className="text-body text-text m-0">
          {sheetName ? (
            <>
              Sheet <span className="font-semibold">{sheetName}</span> contains data. You can&apos;t
              undo deleting a sheet. Delete it anyway?
            </>
          ) : (
            <>This sheet contains data. You can&apos;t undo deleting a sheet. Delete it anyway?</>
          )}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="danger" onClick={handleConfirm} data-confirm-button="true">
          Delete
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
