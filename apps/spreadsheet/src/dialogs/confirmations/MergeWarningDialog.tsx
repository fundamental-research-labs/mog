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

import { useCallback, useEffect, useRef } from 'react';
import { dispatch, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';

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
  const confirmScheduledRef = useRef(false);

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.mergeWarningDialog.isOpen);
  const cellsWithData = useUIStore((s) => s.mergeWarningDialog.cellsWithData);

  useEffect(() => {
    if (!isOpen) {
      confirmScheduledRef.current = false;
    }
  }, [isOpen]);

  // Handle OK button - confirm merge (data will be lost)
  const handleConfirm = useCallback(() => {
    if (confirmScheduledRef.current) return;
    confirmScheduledRef.current = true;

    window.setTimeout(() => {
      const result = dispatch('CONFIRM_MERGE_WITH_DATA_LOSS', deps);
      if (result && typeof (result as Promise<unknown>).finally === 'function') {
        void (result as Promise<unknown>).finally(() => {
          confirmScheduledRef.current = false;
        });
      } else {
        confirmScheduledRef.current = false;
      }
    }, 0);
  }, [deps]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CANCEL_MERGE', deps);
  }, [deps]);

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
