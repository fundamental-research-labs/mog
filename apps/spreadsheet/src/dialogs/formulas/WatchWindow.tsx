/**
 * Watch Window
 *
 * A modeless window that allows users to monitor specific cells as they work
 * on other parts of the workbook. The Watch Window displays cell references,
 * their values, and formulas, updating in real-time when cells change.
 *
 * Excel Parity: Formulas > Formula Auditing > Watch Window
 *
 * Features:
 * - Add/remove watches from current selection
 * - Display cell reference, value, and formula
 * - Auto-updates when watched cells change
 * - Modeless operation (stays open while editing)
 * - Multi-select for batch delete
 */

import { useCallback } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTable,
  DialogTableRow,
} from '@mog/shell';
import type { CellValue, ErrorVariant } from '@mog-sdk/contracts/core';
import { errorDisplayString, isCellError } from '@mog/spreadsheet-utils/errors';
import type { WatchEntry } from '../../ui-store/slices/formulas/watch-window';

// =============================================================================
// Constants
// =============================================================================

const COLUMN_HEADERS = ['Book', 'Sheet', 'Name', 'Cell', 'Value', 'Formula'];
const COLUMN_WIDTHS = '80px 100px 80px 60px 120px 1fr';

// =============================================================================
// Component
// =============================================================================

export function WatchWindow() {
  const deps = useActionDependencies();

  // Get state from UIStore
  const isOpen = useUIStore((s) => s.watchWindow.isOpen);
  const watches = useUIStore((s) => s.watchWindow.watches);
  const selectedWatchIds = useUIStore((s) => s.watchWindow.selectedWatchIds);

  // Get actions from UIStore
  const closeWatchWindow = useUIStore((s) => s.closeWatchWindow);
  const removeWatch = useUIStore((s) => s.removeWatch);
  const removeWatches = useUIStore((s) => s.removeWatches);
  const selectWatch = useUIStore((s) => s.selectWatch);
  const toggleWatchSelection = useUIStore((s) => s.toggleWatchSelection);
  const deselectAllWatches = useUIStore((s) => s.deselectAllWatches);
  const clearAllWatches = useUIStore((s) => s.clearAllWatches);

  const handleAddWatch = useCallback(() => {
    void dispatch('ADD_WATCH', deps);
  }, [deps]);

  // Handle deleting selected watches
  const handleDeleteWatch = useCallback(() => {
    if (selectedWatchIds.size === 0) return;

    if (selectedWatchIds.size === 1) {
      const [id] = selectedWatchIds;
      removeWatch(id);
    } else {
      removeWatches([...selectedWatchIds]);
    }
  }, [selectedWatchIds, removeWatch, removeWatches]);

  // Handle deleting all watches
  const handleDeleteAll = useCallback(() => {
    clearAllWatches();
  }, [clearAllWatches]);

  // Handle row click - select/deselect
  const handleRowClick = useCallback(
    (id: string, event: React.MouseEvent) => {
      if (event.ctrlKey || event.metaKey) {
        // Toggle selection with Ctrl/Cmd
        toggleWatchSelection(id);
      } else if (event.shiftKey && selectedWatchIds.size > 0) {
        // Range selection with Shift - for now just add to selection
        selectWatch(id, true);
      } else {
        // Single selection
        selectWatch(id, false);
      }
    },
    [selectWatch, toggleWatchSelection, selectedWatchIds.size],
  );

  // Handle double-click - navigate to cell
  // Note: Navigation will be handled by the parent component or via action
  const handleRowDoubleClick = useCallback((_watch: WatchEntry) => {
    // TODO: Navigate to the cell via NAVIGATE_TO_REFERENCE action
    // This requires integration with the coordinator/selection system
    console.log('Navigate to cell - requires integration');
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteWatch();
      } else if (e.key === 'Escape') {
        deselectAllWatches();
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Select all
        watches.forEach((w: WatchEntry) => selectWatch(w.id, true));
      }
    },
    [handleDeleteWatch, deselectAllWatches, watches, selectWatch],
  );

  if (!isOpen) return null;

  const hasSelection = selectedWatchIds.size > 0;
  const hasWatches = watches.length > 0;

  return (
    <Dialog
      open={isOpen}
      onClose={closeWatchWindow}
      dialogId="watch-window"
      width="lg"
      closeOnOverlayClick={false}
    >
      <DialogHeader onClose={closeWatchWindow}>Watch Window</DialogHeader>

      <DialogBody noPadding>
        <div className="flex flex-col h-[300px]" onKeyDown={handleKeyDown} tabIndex={0}>
          {hasWatches ? (
            <DialogTable columns={COLUMN_HEADERS} columnWidths={COLUMN_WIDTHS} minHeight={250}>
              {watches.map((watch: WatchEntry) => (
                <WatchRow
                  key={watch.id}
                  watch={watch}
                  isSelected={selectedWatchIds.has(watch.id)}
                  onClick={(e) => handleRowClick(watch.id, e)}
                  onDoubleClick={() => handleRowDoubleClick(watch)}
                />
              ))}
            </DialogTable>
          ) : (
            <div className="flex-1 flex items-center justify-center text-ss-text-secondary">
              <div className="text-center">
                <p className="text-body mb-2">No watches</p>
                <p className="text-body-sm">
                  Select a cell and click "Add Watch" to monitor its value
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter layout="between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleAddWatch}>
            Add Watch
          </Button>
          <Button variant="secondary" onClick={handleDeleteWatch} disabled={!hasSelection}>
            Delete Watch
          </Button>
          <Button variant="secondary" onClick={handleDeleteAll} disabled={!hasWatches}>
            Delete All
          </Button>
        </div>
        <Button variant="primary" onClick={closeWatchWindow}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// =============================================================================
// Watch Row Component
// =============================================================================

interface WatchRowProps {
  watch: WatchEntry;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

function WatchRow({ watch, isSelected, onClick, onDoubleClick }: WatchRowProps) {
  // Format the value for display
  const displayValue = formatDisplayValue(watch.value);

  // Wrap row with click handler to capture mouse event for modifier keys
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onClick(e);
    },
    [onClick],
  );

  return (
    <div onClick={handleClick} onDoubleClick={onDoubleClick}>
      <DialogTableRow columnWidths={COLUMN_WIDTHS} isSelected={isSelected}>
        {/* Book - assuming single workbook for now */}
        <span className="text-body-sm text-text truncate" title="Workbook">
          Book1
        </span>

        {/* Sheet */}
        <span className="text-body-sm text-text truncate" title={watch.sheetName}>
          {watch.sheetName}
        </span>

        {/* Name - named range if applicable */}
        <span className="text-body-sm text-ss-text-secondary truncate">
          {/* Named ranges not implemented yet */}-
        </span>

        {/* Cell Reference */}
        <span className="text-body-sm text-text font-ss-mono" title={watch.cellRef}>
          {watch.cellRef}
        </span>

        {/* Value */}
        <span className="text-body-sm text-text truncate font-ss-mono" title={String(watch.value)}>
          {displayValue}
        </span>

        {/* Formula */}
        <span
          className="text-body-sm text-ss-text-secondary truncate font-ss-mono"
          title={watch.formula ?? ''}
        >
          {watch.formula ?? ''}
        </span>
      </DialogTableRow>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a cell value for display in the Watch Window
 */
function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    // Format numbers nicely
    if (Number.isNaN(value)) return '#NUM!';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    // Use fixed notation for reasonable numbers, exponential for very large/small
    if (Math.abs(value) > 1e10 || (Math.abs(value) < 1e-6 && value !== 0)) {
      return value.toExponential(4);
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '');
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (isCellError(value as CellValue)) {
    return errorDisplayString((value as { value: ErrorVariant }).value);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return `{Array: ${value.length}}`;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}
