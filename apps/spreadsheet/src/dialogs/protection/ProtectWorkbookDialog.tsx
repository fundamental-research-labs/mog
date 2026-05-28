/**
 * Protect Workbook Dialog
 *
 * Excel-parity dialog for configuring workbook structure protection.
 * Allows users to:
 * - Set an optional password
 * - Configure structure protection (prevents sheet add/delete/move/rename/hide/unhide)
 *
 * Excel Parity: Protect Workbook Dialog
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore, useWorkbook } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
} from '@mog/shell';
import type { WorkbookProtectionOptions } from '../../ui-store/slices/dialogs/protect-workbook-dialog';

// =============================================================================
// Component
// =============================================================================

export function ProtectWorkbookDialog() {
  const deps = useActionDependencies();
  const wb = useWorkbook();

  // UIStore state
  const dialogState = useUIStore((s) => s.protectWorkbookDialog);
  const setPassword = useUIStore((s) => s.setProtectWorkbookPassword);
  const setConfirmPassword = useUIStore((s) => s.setProtectWorkbookConfirmPassword);
  const setOption = useUIStore((s) => s.setProtectWorkbookOption);

  // Local validation state
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Ref for auto-focus on dialog open
  const passwordInputRef = useRef<HTMLInputElement>(null);

  const isUnprotectMode = dialogState.mode === 'unprotect';

  // Reset form when dialog opens and focus password field
  useEffect(() => {
    if (dialogState.isOpen) {
      setPasswordError(null);
      // Auto-focus the password field for accessibility
      setTimeout(() => passwordInputRef.current?.focus(), 0);
    }
  }, [dialogState.isOpen, dialogState.mode]);

  // Validate passwords match
  const validatePasswords = useCallback((): boolean => {
    if (isUnprotectMode) {
      setPasswordError(null);
      return true;
    }

    const { password, confirmPassword } = dialogState;

    // Password is optional - if both are empty, that's valid
    if (password === '' && confirmPassword === '') {
      setPasswordError(null);
      return true;
    }

    // If password is set, confirm must match
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return false;
    }

    setPasswordError(null);
    return true;
  }, [dialogState, isUnprotectMode]);

  // Handle OK button click
  const handleOk = useCallback(() => {
    const { password, options } = dialogState;

    if (isUnprotectMode) {
      dispatch('UNPROTECT_WORKBOOK', deps, {
        password: password || undefined,
      });
      return;
    }

    // Validate passwords
    if (!validatePasswords()) {
      return;
    }

    // Dispatch PROTECT_WORKBOOK action - handler will apply protection and close dialog
    dispatch('PROTECT_WORKBOOK', deps, {
      password: password || undefined,
      options,
    });
  }, [dialogState, isUnprotectMode, deps, validatePasswords]);

  // Handle Cancel button click - dispatch close action
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_PROTECT_WORKBOOK_DIALOG', deps);
  }, [deps]);

  // Handle option checkbox change
  const handleOptionChange = useCallback(
    (option: keyof WorkbookProtectionOptions) => (checked: boolean) => {
      setOption(option, checked);
    },
    [setOption],
  );

  const [hasPassword, setHasPassword] = useState(false);
  useEffect(() => {
    setHasPassword(!!wb.mirror.getWorkbookSettings().workbookProtectionPasswordHash);

    const unsubscribe = wb.on('workbook:settings-changed', (event) => {
      if (
        event.changedKey === 'workbookProtectionPasswordHash' ||
        event.changedKey === 'isWorkbookProtected'
      ) {
        setHasPassword(!!event.settings.workbookProtectionPasswordHash);
      }
    });
    return unsubscribe;
  }, [wb]);

  if (!dialogState.isOpen) return null;

  return (
    <Dialog
      open={dialogState.isOpen}
      onClose={handleCancel}
      dialogId="protect-workbook-dialog"
      width={450}
      onEnterKeyDown={() => {
        if (!passwordError) handleOk();
      }}
    >
      <DialogHeader onClose={handleCancel}>
        {isUnprotectMode ? 'Unprotect Workbook' : 'Protect Workbook'}
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Password Section */}
          <div className="flex flex-col gap-2">
            {(hasPassword || !isUnprotectMode) && (
              <>
                <Label htmlFor="protect-workbook-password" className="font-semibold">
                  {isUnprotectMode ? 'Password:' : 'Password (optional):'}
                </Label>
                <Input
                  id="protect-workbook-password"
                  ref={passwordInputRef}
                  type="password"
                  value={dialogState.password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={validatePasswords}
                  placeholder="Enter password"
                  className="w-full"
                />
              </>
            )}
            {!isUnprotectMode && (
              <Input
                id="protect-workbook-confirm-password"
                type="password"
                value={dialogState.confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={validatePasswords}
                placeholder="Confirm password"
                className="w-full"
              />
            )}
            {passwordError && <p className="text-body-sm text-ss-error m-0">{passwordError}</p>}
            {isUnprotectMode && !hasPassword && (
              <p className="text-body-sm text-ss-text-secondary m-0">
                This workbook does not require a password to unprotect its structure.
              </p>
            )}
            {!isUnprotectMode && (
              <p className="text-body-sm text-ss-text-secondary m-0">
                Caution: If you lose or forget the password, it cannot be recovered. It is advisable
                to keep a list of passwords and their corresponding workbook names in a safe place.
              </p>
            )}
          </div>

          {!isUnprotectMode && (
            <>
              {/* Divider */}
              <div className="h-px bg-ss-surface-tertiary" />

              {/* Protection Options */}
              <div className="flex flex-col gap-2">
                <Label className="font-semibold">Protect workbook for:</Label>

                <div className="flex flex-col gap-2 ml-2">
                  <Checkbox
                    checked={dialogState.options.structure}
                    onChange={handleOptionChange('structure')}
                    label="Structure"
                  />
                  <p className="text-body-sm text-ss-text-secondary m-0 ml-6">
                    Prevents users from adding, deleting, moving, renaming, hiding, or unhiding
                    sheets.
                  </p>

                  {/* Future option placeholder */}
                  {/* <Checkbox
 checked={false}
 disabled
 label="Windows (not yet supported)"
 />
 <p className="text-body-sm text-ss-text-secondary m-0 ml-6">
 Prevents users from moving, resizing, or closing the workbook window.
 </p> */}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!!passwordError}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
