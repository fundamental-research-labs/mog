/**
 * Large Fill Confirmation Dialog
 *
 * Warning dialog shown when a fill operation would affect more than 10,000 cells.
 * Gives user the option to continue or cancel the operation.
 *
 * This dialog appears when:
 * - User drags fill handle to create a range > LARGE_FILL_THRESHOLD cells
 * - User uses Fill Series dialog with a large target range
 *
 */

import { useCallback } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { formatDuration } from '../../domain/fill';

// =============================================================================
// Component
// =============================================================================

/**
 * Props for LargeFillConfirmationDialog.
 */
interface LargeFillConfirmationDialogProps {
  /**
   * Callback when user confirms the fill operation.
   * The dialog will close and the fill will be executed.
   */
  onConfirm?: () => void;
}

/**
 * LargeFillConfirmationDialog - Warning dialog for large fill operations.
 *
 * Shows when user attempts to fill a range with more than LARGE_FILL_THRESHOLD (10,000) cells.
 * Provides confirmation buttons to proceed or cancel.
 */
export function LargeFillConfirmationDialog({ onConfirm }: LargeFillConfirmationDialogProps) {
  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.largeFillDialog?.isOpen ?? false);
  const pendingFill = useUIStore((s) => s.largeFillDialog?.pendingFill ?? null);
  const closeLargeFillDialog = useUIStore((s) => s.closeLargeFillDialog);
  const confirmLargeFill = useUIStore((s) => s.confirmLargeFill);

  // Handle Cancel button - dismiss the dialog without filling
  const handleCancel = useCallback(() => {
    closeLargeFillDialog?.();
  }, [closeLargeFillDialog]);

  // Handle Continue button - confirm and execute the fill
  const handleContinue = useCallback(() => {
    const fillData = confirmLargeFill?.();
    if (fillData && onConfirm) {
      onConfirm();
    }
  }, [confirmLargeFill, onConfirm]);

  // Format the cell count for display
  const cellCountFormatted = pendingFill?.cellCount?.toLocaleString() ?? '0';

  // Format the estimated duration
  const estimatedDurationFormatted = pendingFill?.estimatedDuration
    ? formatDuration(pendingFill.estimatedDuration)
    : 'a few seconds';

  return (
    <Dialog
      onEnterKeyDown={handleContinue}
      open={isOpen}
      onClose={handleCancel}
      dialogId="large-fill-confirmation-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Fill Operation</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          This operation will affect <strong>{cellCountFormatted}</strong> cells.
        </p>
        <p className="text-body text-ss-text-secondary mt-2 mb-0">
          Estimated time: <strong>{estimatedDurationFormatted}</strong>
        </p>
        <p className="text-body text-ss-text-secondary mt-4 mb-0">Do you want to continue?</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleContinue}>
          Continue
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
