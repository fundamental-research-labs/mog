/**
 * Create Names from Selection Dialog
 *
 * Dialog for creating named ranges from row/column labels in a selection.
 * Follows Excel's "Create Names from Selection" functionality (Ctrl+Shift+F3):
 * - Top row: Use first row as names for columns below
 * - Left column: Use first column as names for rows to the right
 * - Bottom row: Use last row as names for columns above
 * - Right column: Use last column as names for rows to the left
 *
 * Architecture:
 * - Dialog state managed by Zustand slice (create-names-dialog.ts)
 * - Dispatches CREATE_NAMES_EXECUTE action on submit
 * - Handler performs actual name creation via domain function
 *
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActiveSheetId, useDispatch, useSelectionRanges, useUIStore } from '../../internal-api';

import { Button, Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

// =============================================================================
// Types
// =============================================================================

interface CreateNamesOptions {
  topRow: boolean;
  leftColumn: boolean;
  bottomRow: boolean;
  rightColumn: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function CreateNamesFromSelectionDialog() {
  const activeSheetId = useActiveSheetId();
  const ranges = useSelectionRanges();
  const dispatch = useDispatch();

  // UI Store state
  const isOpen = useUIStore((s) => s.createNamesDialogOpen);
  const closeDialog = useUIStore((s) => s.closeCreateNamesDialog);

  // Form state
  const [options, setOptions] = useState<CreateNamesOptions>({
    topRow: false,
    leftColumn: false,
    bottomRow: false,
    rightColumn: false,
  });

  // Calculate selection dimensions for determining which options make sense
  const selectionInfo = useMemo(() => {
    const range = ranges[0];
    if (!range) {
      return { rows: 0, cols: 0, isSingleCell: true, isSingleRow: true, isSingleCol: true };
    }

    const rows = range.endRow - range.startRow + 1;
    const cols = range.endCol - range.startCol + 1;

    return {
      rows,
      cols,
      isSingleCell: rows === 1 && cols === 1,
      isSingleRow: rows === 1,
      isSingleCol: cols === 1,
    };
  }, [ranges]);

  // Determine which checkboxes should be disabled
  const disabledOptions = useMemo(() => {
    const { isSingleCell, rows, cols } = selectionInfo;

    // Single cell: all disabled
    if (isSingleCell) {
      return { topRow: true, leftColumn: true, bottomRow: true, rightColumn: true };
    }

    // Need at least 2 rows for top/bottom options
    // Need at least 2 cols for left/right options
    return {
      topRow: rows < 2,
      leftColumn: cols < 2,
      bottomRow: rows < 2,
      rightColumn: cols < 2,
    };
  }, [selectionInfo]);

  // Auto-detect sensible defaults based on selection
  useEffect(() => {
    if (isOpen) {
      const { isSingleCell, isSingleRow, isSingleCol, rows, cols } = selectionInfo;

      // Reset options with sensible defaults
      if (isSingleCell) {
        // All disabled, no defaults
        setOptions({ topRow: false, leftColumn: false, bottomRow: false, rightColumn: false });
      } else if (isSingleRow) {
        // Only left/right make sense for single row
        setOptions({ topRow: false, leftColumn: cols >= 2, bottomRow: false, rightColumn: false });
      } else if (isSingleCol) {
        // Only top/bottom make sense for single column
        setOptions({ topRow: rows >= 2, leftColumn: false, bottomRow: false, rightColumn: false });
      } else {
        // Multi-row, multi-col: default to top row (most common use case)
        setOptions({ topRow: true, leftColumn: false, bottomRow: false, rightColumn: false });
      }
    }
  }, [isOpen, selectionInfo]);

  // Handle checkbox changes
  const handleOptionChange = useCallback((key: keyof CreateNamesOptions, checked: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: checked }));
  }, []);

  // Handle submit
  const handleSubmit = useCallback(() => {
    const range = ranges[0];
    if (!range) {
      closeDialog();
      return;
    }

    // Dispatch action with options
    dispatch('CREATE_NAMES_EXECUTE', {
      sheetId: activeSheetId,
      range,
      options,
    });

    closeDialog();
  }, [dispatch, activeSheetId, ranges, options, closeDialog]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Check if any option is selected (for enabling OK button)
  const hasSelection =
    options.topRow || options.leftColumn || options.bottomRow || options.rightColumn;
  const canSubmit = hasSelection && !selectionInfo.isSingleCell;

  return (
    <Dialog
      onEnterKeyDown={handleSubmit}
      open={isOpen}
      onClose={handleCancel}
      dialogId="create-names-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleCancel}>Create Names from Selection</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {selectionInfo.isSingleCell ? (
            <p className="text-body text-ss-text-secondary">
              Selection must include both labels and data cells. Please select a range with at least
              2 rows or 2 columns.
            </p>
          ) : (
            <>
              <p className="text-body text-ss-text-secondary mb-2">Create names from values in:</p>

              <div className="flex flex-col gap-3">
                <Checkbox
                  checked={options.topRow}
                  onChange={(checked) => handleOptionChange('topRow', checked)}
                  disabled={disabledOptions.topRow}
                  label="Top row"
                  id="create-names-top-row"
                  aria-label="Create names from top row labels"
                />

                <Checkbox
                  checked={options.leftColumn}
                  onChange={(checked) => handleOptionChange('leftColumn', checked)}
                  disabled={disabledOptions.leftColumn}
                  label="Left column"
                  id="create-names-left-column"
                  aria-label="Create names from left column labels"
                />

                <Checkbox
                  checked={options.bottomRow}
                  onChange={(checked) => handleOptionChange('bottomRow', checked)}
                  disabled={disabledOptions.bottomRow}
                  label="Bottom row"
                  id="create-names-bottom-row"
                  aria-label="Create names from bottom row labels"
                />

                <Checkbox
                  checked={options.rightColumn}
                  onChange={(checked) => handleOptionChange('rightColumn', checked)}
                  disabled={disabledOptions.rightColumn}
                  label="Right column"
                  id="create-names-right-column"
                  aria-label="Create names from right column labels"
                />
              </div>
            </>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Wrapper Component for Conditional Mounting
// =============================================================================

/**
 * Wrapper that only mounts CreateNamesFromSelectionDialog when it's open.
 * This eliminates unnecessary re-renders when the dialog is closed.
 */
export function CreateNamesFromSelectionDialogWrapper() {
  const isOpen = useUIStore((s) => s.createNamesDialogOpen);
  if (!isOpen) return null;
  return <CreateNamesFromSelectionDialog />;
}
