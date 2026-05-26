/**
 * Protect Sheet Dialog
 *
 * Excel-parity dialog for configuring sheet protection with granular options.
 * Allows users to:
 * - Set an optional password
 * - Configure which operations are allowed when protected
 *
 * Excel Parity: Protect Sheet Configuration Dialog
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore, useWorkbook } from '../../internal-api';

import type { ProtectionConfig } from '@mog-sdk/contracts/api';

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
import type { SheetProtectionOptions } from '@mog-sdk/contracts/protection';

// =============================================================================
// Component
// =============================================================================

export function ProtectSheetDialog() {
  const wb = useWorkbook();
  const deps = useActionDependencies();

  // UIStore state
  const dialogState = useUIStore((s) => s.protectSheetDialog);
  const setPassword = useUIStore((s) => s.setProtectSheetPassword);
  const setConfirmPassword = useUIStore((s) => s.setProtectSheetConfirmPassword);
  const setOption = useUIStore((s) => s.setProtectSheetOption);

  // Get current sheet info via unified Workbook/Worksheet API
  const activeSheetId = useUIStore((s) => s.activeSheetId);
  const [protectionConfig, setProtectionConfig] = useState<ProtectionConfig>({
    isProtected: false,
    hasPasswordSet: false,
  });
  useEffect(() => {
    if (!activeSheetId) return;
    const ws = wb.getSheetById(activeSheetId);
    void ws.protection.getConfig().then(setProtectionConfig);
  }, [wb, activeSheetId]);

  // Local validation state
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Ref for auto-focus on dialog open
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Reset form when dialog opens and focus password field
  useEffect(() => {
    if (dialogState.isOpen) {
      setPasswordError(null);
      // Auto-focus the password field for accessibility
      setTimeout(() => passwordInputRef.current?.focus(), 0);
    }
  }, [dialogState.isOpen]);

  // Validate passwords match
  const validatePasswords = useCallback((): boolean => {
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
  }, [dialogState]);

  // Handle OK button click - dispatch PROTECT_SHEET action
  const handleOk = useCallback(() => {
    if (!activeSheetId) {
      dispatch('CLOSE_PROTECT_SHEET_DIALOG', deps);
      return;
    }

    // Validate passwords
    if (!validatePasswords()) {
      return;
    }

    const { password, options } = dialogState;

    // Dispatch PROTECT_SHEET action - handler will apply protection and close dialog
    dispatch('PROTECT_SHEET', deps, {
      sheetId: activeSheetId,
      password: password || undefined,
      options,
    });
  }, [activeSheetId, deps, dialogState, validatePasswords]);

  // Handle Cancel button click - dispatch close action
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_PROTECT_SHEET_DIALOG', deps);
  }, [deps]);

  // Handle option checkbox change
  const handleOptionChange = useCallback(
    (option: keyof SheetProtectionOptions) => (checked: boolean) => {
      setOption(option, checked);
    },
    [setOption],
  );

  if (!dialogState.isOpen) return null;

  const isProtected = protectionConfig.isProtected;
  const hasPassword = !!protectionConfig.hasPasswordSet;

  return (
    <Dialog
      open={dialogState.isOpen}
      onClose={handleCancel}
      dialogId="protect-sheet-dialog"
      width={450}
      onEnterKeyDown={() => {
        if (!passwordError) handleOk();
      }}
    >
      <DialogHeader onClose={handleCancel}>
        {isProtected ? 'Modify Sheet Protection' : 'Protect Sheet'}
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Password Section */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="protect-password" className="font-semibold">
              Password to unprotect sheet (optional):
            </Label>
            <Input
              id="protect-password"
              ref={passwordInputRef}
              type="password"
              value={dialogState.password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={validatePasswords}
              placeholder="Enter password"
              className="w-full"
            />
            <Input
              id="protect-confirm-password"
              type="password"
              value={dialogState.confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={validatePasswords}
              placeholder="Confirm password"
              className="w-full"
            />
            {passwordError && <p className="text-body-sm text-ss-error m-0">{passwordError}</p>}
            {isProtected && hasPassword && (
              <p className="text-body-sm text-ss-text-secondary m-0">
                Note: Sheet currently has a password. Set a new password to change it, or leave
                blank to remove password protection.
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-ss-surface-tertiary" />

          {/* Protection Options */}
          <div className="flex flex-col gap-2">
            <Label className="font-semibold">Allow all users of this sheet to:</Label>

            <div className="flex flex-col gap-2 ml-2">
              {/* Selection options (default: checked) */}
              <Checkbox
                checked={dialogState.options.selectLockedCells}
                onChange={handleOptionChange('selectLockedCells')}
                label="Select locked cells"
              />
              <Checkbox
                checked={dialogState.options.selectUnlockedCells}
                onChange={handleOptionChange('selectUnlockedCells')}
                label="Select unlocked cells"
              />

              {/* Formatting options */}
              <Checkbox
                checked={dialogState.options.formatCells}
                onChange={handleOptionChange('formatCells')}
                label="Format cells"
              />
              <Checkbox
                checked={dialogState.options.formatColumns}
                onChange={handleOptionChange('formatColumns')}
                label="Format columns"
              />
              <Checkbox
                checked={dialogState.options.formatRows}
                onChange={handleOptionChange('formatRows')}
                label="Format rows"
              />

              {/* Structure options */}
              <Checkbox
                checked={dialogState.options.insertColumns}
                onChange={handleOptionChange('insertColumns')}
                label="Insert columns"
              />
              <Checkbox
                checked={dialogState.options.insertRows}
                onChange={handleOptionChange('insertRows')}
                label="Insert rows"
              />
              <Checkbox
                checked={dialogState.options.insertHyperlinks}
                onChange={handleOptionChange('insertHyperlinks')}
                label="Insert hyperlinks"
              />
              <Checkbox
                checked={dialogState.options.deleteColumns}
                onChange={handleOptionChange('deleteColumns')}
                label="Delete columns"
              />
              <Checkbox
                checked={dialogState.options.deleteRows}
                onChange={handleOptionChange('deleteRows')}
                label="Delete rows"
              />

              {/* Data operations */}
              <Checkbox
                checked={dialogState.options.sort}
                onChange={handleOptionChange('sort')}
                label="Sort"
              />
              <Checkbox
                checked={dialogState.options.useAutoFilter}
                onChange={handleOptionChange('useAutoFilter')}
                label="Use AutoFilter"
              />
              <Checkbox
                checked={dialogState.options.usePivotTableReports}
                onChange={handleOptionChange('usePivotTableReports')}
                label="Use PivotTable reports"
              />

              {/* Objects and scenarios */}
              <Checkbox
                checked={dialogState.options.editObjects}
                onChange={handleOptionChange('editObjects')}
                label="Edit objects"
              />
              <Checkbox
                checked={dialogState.options.editScenarios}
                onChange={handleOptionChange('editScenarios')}
                label="Edit scenarios"
              />
            </div>
          </div>
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
