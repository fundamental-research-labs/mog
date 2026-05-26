/**
 * Fill Merge Conflict Dialog
 *
 * Error dialog shown when a fill operation would split a merged cell region.
 * This is a blocking error - the fill cannot proceed until the user acknowledges.
 *
 * This dialog appears when:
 * - User attempts to fill into a range that partially overlaps a merged cell region
 * - The fill range does not fully contain the merged region
 *
 */

import { useCallback } from 'react';
import { useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * FillMergeConflictDialog - Error dialog for fill/merge conflicts.
 *
 * Shows when user attempts to fill into a range that would split a merged
 * cell region. Provides Excel-parity message and OK button to dismiss.
 */
export function FillMergeConflictDialog() {
  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.fillMergeConflictDialog?.isOpen ?? false);
  const closeFillMergeConflictDialog = useUIStore((s) => s.closeFillMergeConflictDialog);

  // Handle OK button - dismiss the dialog
  const handleOk = useCallback(() => {
    closeFillMergeConflictDialog?.();
  }, [closeFillMergeConflictDialog]);

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleOk}
      dialogId="fill-merge-conflict-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleOk}>Cannot fill merged cells</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          This operation requires the merged cells to be identically sized.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
