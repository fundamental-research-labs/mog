/**
 * Paste Size Mismatch Dialog
 *
 * Excel-parity warning dialog shown when pasting data that doesn't match
 * the target selection size. User can choose to paste anyway or cancel.
 *
 * This dialog appears when:
 * - User has selected a multi-cell range (e.g., 2x2)
 * - User pastes data of a different size (e.g., 3x3)
 * - The paste would overwrite adjacent cells
 *
 * Paste Size Mismatch Warning Dialog
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * PasteSizeMismatchDialog - Warning dialog for paste size mismatches.
 *
 * Shows when user attempts to paste clipboard data into a selection of
 * different size, giving them the option to proceed or cancel.
 */
export function PasteSizeMismatchDialog() {
  const deps = useActionDependencies();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.pasteMismatchDialog.isOpen);
  const sourceSize = useUIStore((s) => s.pasteMismatchDialog.sourceSize);
  const targetSize = useUIStore((s) => s.pasteMismatchDialog.targetSize);

  // Handle OK button - confirm paste
  const handleConfirm = useCallback(() => {
    dispatch('CONFIRM_PASTE_SIZE_MISMATCH', deps);
  }, [deps]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CANCEL_PASTE_SIZE_MISMATCH', deps);
  }, [deps]);

  // Format size for display
  const formatSize = (rows: number, cols: number): string => {
    if (rows === 1 && cols === 1) return '1 cell';
    if (rows === 1) return `1 row x ${cols} columns`;
    if (cols === 1) return `${rows} rows x 1 column`;
    return `${rows} rows x ${cols} columns`;
  };

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="paste-size-mismatch-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Paste size mismatch</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          The data you&apos;re pasting isn&apos;t the same size as your selection.
        </p>
        {sourceSize && targetSize && (
          <p className="text-body text-ss-text-secondary mt-2 mb-0">
            Clipboard: {formatSize(sourceSize.rows, sourceSize.cols)}
            <br />
            Selection: {formatSize(targetSize.rows, targetSize.cols)}
          </p>
        )}
        <p className="text-body text-ss-text-secondary mt-4 mb-0">Do you want to paste anyway?</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
