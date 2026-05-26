/**
 * Confirm Convert to Range Dialog
 *
 * Confirmation dialog shown when user chooses to convert a table back to
 * a regular range. Warns user about what will happen:
 * - Table will be removed
 * - Cell data and formatting will be kept
 * - Structured references will be converted to A1 references
 * - SUBTOTAL formulas in total row will be converted
 *
 *
 * Architecture Compliance:
 * - All user interactions use dispatch()
 * - UIStore slice for dialog state (table-dialogs.ts)
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * ConfirmConvertToRangeDialog - Confirmation dialog for converting table to range.
 *
 * Shows when user clicks "Convert to Range" in Table Design tab,
 * explaining what will happen and asking for confirmation.
 */
export function ConfirmConvertToRangeDialog() {
  const deps = useActionDependencies();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.convertToRangeDialog.isOpen);
  const tableId = useUIStore((s) => s.convertToRangeDialog.tableId);

  // Handle OK button - confirm conversion
  const handleConfirm = useCallback(() => {
    if (tableId) {
      dispatch('CONVERT_TO_RANGE', deps, { tableId });
    }
  }, [deps, tableId]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_CONVERT_TO_RANGE_DIALOG', deps);
  }, [deps]);

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="confirm-convert-to-range-dialog"
      width="md"
    >
      <DialogHeader onClose={handleCancel}>Convert to Range</DialogHeader>
      <DialogBody>
        <p className="text-body text-text m-0 mb-3">
          Do you want to convert the table to a normal range?
        </p>
        <div className="text-body-sm text-ss-text-secondary space-y-2">
          <p className="m-0">Converting to a range will:</p>
          <ul className="list-disc pl-5 m-0 space-y-1">
            <li>Remove the table functionality (filtering, structured references)</li>
            <li>Keep all cell data and formatting</li>
            <li>Convert any structured references (e.g., [Column1]) to regular A1 references</li>
            <li>Convert SUBTOTAL formulas in the total row to regular formulas</li>
          </ul>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          No
        </Button>
        <Button variant="primary" onClick={handleConfirm}>
          Yes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
