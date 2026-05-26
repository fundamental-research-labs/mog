/**
 * Drag-Drop Overwrite Warning Dialog
 *
 * Excel-parity warning dialog shown when drag-dropping cells onto a target
 * range that already contains data. User can choose to replace (overwrite)
 * or cancel the operation.
 *
 * This dialog appears when:
 * - User drags a selection of cells to a new location
 * - The target range contains one or more cells with data
 * - The existing data will be overwritten if the drop proceeds
 *
 * Includes a "Don't ask again" checkbox to persist user preference.
 *
 */

import { useCallback, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Switch } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

/**
 * DragDropOverwriteDialog - Warning dialog for drag-drop data overwrite.
 *
 * Shows when user drags cells onto a range that already contains data,
 * giving them the option to replace the existing data or cancel.
 * Includes a "Don't ask again" checkbox to persist user preference.
 */
export function DragDropOverwriteDialog() {
  const deps = useActionDependencies();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.dragDropOverwriteDialog.isOpen);
  const pendingData = useUIStore((s) => s.dragDropOverwriteDialog.pendingDropData);
  const setDontAskAgain = useUIStore((s) => s.setDragDropDontAskAgain);

  // Local state for checkbox (committed on confirm)
  const [dontAskAgainChecked, setDontAskAgainChecked] = useState(false);

  // Handle Replace button - confirm overwrite
  const handleConfirm = useCallback(() => {
    // Save the "Don't ask again" preference if checked
    if (dontAskAgainChecked) {
      setDontAskAgain(true);
    }
    dispatch('CONFIRM_DRAG_DROP_OVERWRITE', deps);
    // Reset checkbox for next time
    setDontAskAgainChecked(false);
  }, [deps, dontAskAgainChecked, setDontAskAgain]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CANCEL_DRAG_DROP_OVERWRITE', deps);
    // Reset checkbox for next time
    setDontAskAgainChecked(false);
  }, [deps]);

  // Handle checkbox change
  const handleDontAskAgainChange = useCallback((checked: boolean) => {
    setDontAskAgainChecked(checked);
  }, []);

  // Determine operation text based on mode
  const operationText = pendingData?.mode === 'copy' ? 'copying' : 'moving';

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="drag-drop-overwrite-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Confirm replace</DialogHeader>
      <DialogBody>
        <p className="text-body text-ss-text-secondary m-0">
          There's already data here. Do you want to replace it?
        </p>
        {pendingData && (
          <p className="text-body text-text-muted mt-2 mb-0 text-body-sm">
            You are {operationText} cells to a location that contains existing data.
          </p>
        )}
        <div className="mt-4">
          <Switch
            checked={dontAskAgainChecked}
            onChange={handleDontAskAgainChange}
            label="Don't ask me again"
            id="drag-drop-dont-ask-again"
          />
        </div>
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
