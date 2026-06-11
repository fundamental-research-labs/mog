/**
 * Insert/Delete Cells Dialog
 *
 * UI Micro-Polish
 *
 * Excel shows this dialog when inserting or deleting cells (not entire rows/cols)
 * to ask the user whether to shift existing cells in a specific direction.
 *
 * Insert: Shift cells right, Shift cells down, Entire row, Entire column
 * Delete: Shift cells left, Shift cells up, Entire row, Entire column
 *
 * Architecture: This dialog is self-contained and dispatches actions directly
 * using useActionDependencies(). It must be rendered inside SpreadsheetCoordinatorProvider.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, RadioGroup } from '@mog/shell';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { scheduleDialogAction } from './dialog-action-scheduler';

// =============================================================================
// Options Data
// =============================================================================

interface ShiftOption {
  value: string;
  label: string;
}

const INSERT_OPTIONS: ShiftOption[] = [
  { value: 'right', label: 'Shift cells right' },
  { value: 'down', label: 'Shift cells down' },
  { value: 'row', label: 'Entire row' },
  { value: 'column', label: 'Entire column' },
];

const DELETE_OPTIONS: ShiftOption[] = [
  { value: 'left', label: 'Shift cells left' },
  { value: 'up', label: 'Shift cells up' },
  { value: 'row', label: 'Entire row' },
  { value: 'column', label: 'Entire column' },
];

// =============================================================================
// Component
// =============================================================================

/**
 * Insert/Delete Cells Dialog.
 *
 * Self-contained dialog that dispatches actions directly.
 * Must be rendered inside SpreadsheetCoordinatorProvider.
 */
export function InsertCellsDialog() {
  const deps = useActionDependencies();
  const dialog = useUIStore((s) => s.insertCellsDialog);
  const closeDialog = useUIStore((s) => s.closeInsertCellsDialog);
  const okButtonRef = useRef<HTMLButtonElement>(null);

  const { isOpen, mode, direction, range } = dialog;

  // Local state for selected option
  const [selectedOption, setSelectedOption] = useState<string>(direction);

  // Update local state when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Default to appropriate direction based on mode
      setSelectedOption(mode === 'insert' ? 'down' : 'up');
    }
  }, [isOpen, mode]);

  // Handle OK button click
  const handleOk = useCallback(() => {
    if (!range) {
      closeDialog();
      return;
    }

    const action = () => {
      // If user selected entire row/column, delegate to row/column actions
      if (selectedOption === 'row') {
        if (mode === 'insert') {
          return dispatch('INSERT_ROW_ABOVE', deps);
        } else {
          return dispatch('DELETE_ROWS', deps);
        }
      } else if (selectedOption === 'column') {
        if (mode === 'insert') {
          return dispatch('INSERT_COLUMN_LEFT', deps);
        } else {
          return dispatch('DELETE_COLUMNS', deps);
        }
      } else {
        // Shift cells in specified direction
        if (mode === 'insert') {
          if (deps.accessors.clipboard.hasCut()) {
            const direction = selectedOption === 'right' ? 'right' : 'down';
            return dispatch('INSERT_CUT_CELLS', deps, { range, direction });
          }

          // Insert cells - shift existing cells right or down
          const direction = selectedOption === 'right' ? 'right' : 'down';
          return dispatch('INSERT_CELLS', deps, { range, direction });
        } else {
          // Delete cells - shift remaining cells left or up
          const direction = selectedOption === 'left' ? 'left' : 'up';
          return dispatch('DELETE_CELLS', deps, { range, direction });
        }
      }
    };

    closeDialog();
    // Structural mutations can synchronously monopolize the main thread; let the
    // click/close sequence complete before starting the apply work.
    scheduleDialogAction(action);
  }, [selectedOption, mode, range, deps, closeDialog]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  if (!isOpen) return null;

  const options = mode === 'insert' ? INSERT_OPTIONS : DELETE_OPTIONS;
  const title = mode === 'insert' ? 'Insert' : 'Delete';
  const dialogId = mode === 'insert' ? 'insert-cells-dialog' : 'delete-cells-dialog';

  return (
    <Dialog
      open={isOpen}
      onClose={closeDialog}
      dialogId={dialogId}
      width={280}
      initialFocusRef={okButtonRef}
      onEnterKeyDown={handleOk}
    >
      <DialogHeader onClose={handleCancel}>{title}</DialogHeader>

      <DialogBody>
        <RadioGroup
          name="shift-direction"
          value={selectedOption}
          onChange={setSelectedOption}
          options={options}
          orientation="vertical"
          aria-label={`${title} cells options`}
        />
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button ref={okButtonRef} variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default InsertCellsDialog;
