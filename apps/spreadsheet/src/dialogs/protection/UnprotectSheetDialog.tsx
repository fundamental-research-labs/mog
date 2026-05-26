/**
 * Unprotect Sheet Dialog
 *
 * Prompts for the sheet protection password before dispatching the canonical
 * UNPROTECT_SHEET action.
 */

import { useCallback, useEffect, useRef } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input, Label } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

export function UnprotectSheetDialog() {
  const deps = useActionDependencies();

  const dialogState = useUIStore((s) => s.unprotectSheetDialog);
  const setPassword = useUIStore((s) => s.setUnprotectSheetPassword);

  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialogState.isOpen) {
      setTimeout(() => passwordInputRef.current?.focus(), 0);
    }
  }, [dialogState.isOpen]);

  const handleCancel = useCallback(() => {
    dispatch('CLOSE_UNPROTECT_SHEET_DIALOG', deps);
  }, [deps]);

  const handleOk = useCallback(() => {
    if (!dialogState.sheetId) {
      dispatch('CLOSE_UNPROTECT_SHEET_DIALOG', deps);
      return;
    }

    dispatch('UNPROTECT_SHEET', deps, {
      sheetId: dialogState.sheetId,
      password: dialogState.password || undefined,
    });
  }, [deps, dialogState.password, dialogState.sheetId]);

  if (!dialogState.isOpen) return null;

  return (
    <Dialog
      open={dialogState.isOpen}
      onClose={handleCancel}
      dialogId="unprotect-sheet-dialog"
      width={360}
      onEnterKeyDown={handleOk}
    >
      <DialogHeader onClose={handleCancel}>Unprotect Sheet</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-2">
          <Label htmlFor="unprotect-sheet-password" className="font-semibold">
            Password:
          </Label>
          <Input
            id="unprotect-sheet-password"
            ref={passwordInputRef}
            type="password"
            value={dialogState.password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={dialogState.error ? true : undefined}
            aria-describedby={dialogState.error ? 'unprotect-sheet-error' : undefined}
            className="w-full"
          />
          {dialogState.error && (
            <p id="unprotect-sheet-error" className="text-body-sm text-ss-error m-0">
              {dialogState.error}
            </p>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
