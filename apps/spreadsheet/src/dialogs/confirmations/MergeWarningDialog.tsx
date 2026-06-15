/**
 * Merge Warning Dialog
 *
 * Excel-parity warning dialog shown when merging cells that contain data
 * in non-top-left positions. User can choose to merge anyway (losing data) or cancel.
 *
 * This dialog appears when:
 * - User attempts to merge a range of cells
 * - One or more cells other than the top-left cell contain data
 * - The data in non-top-left cells will be lost if merge proceeds
 *
 * Merge Data Loss Warning Dialog
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { scheduleDialogAction } from '../dialog-action-scheduler';

// =============================================================================
// Component
// =============================================================================

/**
 * MergeWarningDialog - Warning dialog for merge data loss.
 *
 * Shows when user attempts to merge cells where non-top-left cells
 * contain data, giving them the option to proceed (losing data) or cancel.
 */
export function MergeWarningDialog() {
  const deps = useActionDependencies();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.mergeWarningDialog.isOpen);
  const cellsWithData = useUIStore((s) => s.mergeWarningDialog.cellsWithData);
  const pendingRange = useUIStore((s) => s.mergeWarningDialog.pendingRange);
  const sheetId = useUIStore((s) => s.mergeWarningDialog.sheetId);
  const mergeType = useUIStore((s) => s.mergeWarningDialog.mergeType);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsConfirming(false);
    }
  }, [isOpen]);

  // Handle OK button - confirm merge (data will be lost)
  const handleConfirm = useCallback(() => {
    if (isConfirming) return;
    setIsConfirming(true);
    scheduleDialogAction(async () => {
      try {
        const result = await dispatch('CONFIRM_MERGE_WITH_DATA_LOSS', deps, {
          pendingRange,
          sheetId,
          mergeType,
        });
        if (result && typeof result === 'object' && 'error' in result) {
          setIsConfirming(false);
        }
      } catch (error) {
        setIsConfirming(false);
        throw error;
      }
    });
  }, [deps, isConfirming, mergeType, pendingRange, sheetId]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    if (isConfirming) return;
    dispatch('CANCEL_MERGE', deps);
  }, [deps, isConfirming]);

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="merge-warning-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Merge cells</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          Merging cells only keeps the upper-left value and discards other values.
        </p>
        {cellsWithData.length > 0 && (
          <p className="text-body text-ss-text-secondary mt-2 mb-0">
            {cellsWithData.length === 1
              ? '1 cell with data will be cleared.'
              : `${cellsWithData.length} cells with data will be cleared.`}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={isConfirming}
          data-confirm-button="true"
        >
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
