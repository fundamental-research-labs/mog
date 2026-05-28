/**
 * Minimizable Dialog Component
 *
 * Create MinimizableDialog component
 *
 * A dialog wrapper that can minimize to a small bar when range selection mode
 * is active. This implements Excel's pattern where dialogs collapse to allow
 * users to select ranges from the sheet.
 *
 * Features:
 * - Composes with existing Dialog component
 * - Subscribes to rangeSelectionMode from UIStore
 * - Minimizes when range selection mode is active for this dialog
 * - Shows minimized bar at bottom-left with title and restore button
 * - Allows grid interaction when minimized (pointer-events-none on overlay)
 *
 */

import { type ReactNode, useEffect } from 'react';

import { ExpandSvg } from '@mog/icons';

import { Dialog, type DialogProps } from '@mog/shell';

import { useUIStore } from '../../../infra/context';
import { useRangeSelectionEnterGuard } from '../../../hooks/dialogs/use-range-selection-enter-guard';
import { useDispatch } from '../../../hooks/toolbar/use-action-dependencies';

// =============================================================================
// Types
// =============================================================================

export interface MinimizableDialogProps extends Omit<DialogProps, 'dialogId'> {
  /** Required unique ID for the dialog (used to match with range selection mode) */
  dialogId: string;
  /** Optional parent dialog ID (for nested dialogs in the dialog stack) */
  parentDialogId?: string;
  /** Dialog title shown in the minimized bar */
  title: string;
  /** Dialog content */
  children: ReactNode;
}

// =============================================================================
// Icons
// =============================================================================

function RestoreIcon() {
  return <ExpandSvg style={{ width: 16, height: 16 }} />;
}

// =============================================================================
// MinimizedDialogBar Component
// =============================================================================

interface MinimizedDialogBarProps {
  /** Dialog id mirrored for semantic readback while minimized */
  dialogId: string;
  /** Dialog title to display */
  title: string;
  /** Live range value selected while the dialog is minimized */
  range: string;
  /** Called when the restore/expand button is clicked */
  onRestore: () => void;
}

/**
 * MinimizedDialogBar - The collapsed state of a minimizable dialog.
 *
 * Shows a small bar at the bottom-left of the viewport with the dialog title
 * and a button to restore the dialog.
 */
function MinimizedDialogBar({ dialogId, title, range, onRestore }: MinimizedDialogBarProps) {
  return (
    <div
      className="fixed bottom-4 left-4 z-ss-modal flex max-w-[min(420px,calc(100vw-32px))] items-center gap-2 bg-ss-surface rounded-ss-md shadow-ss-lg border border-ss-border px-3 py-2"
      role="dialog"
      aria-label={title}
      data-dialog-id={dialogId}
      data-testid="minimized-dialog-bar"
    >
      <span className="text-body-sm font-medium text-ss-text truncate">{title}</span>
      <input className="sr-only" readOnly value={range} aria-label={`${title} selected range`} />
      {range && (
        <span className="text-body-sm text-ss-text-secondary truncate border-l border-ss-border pl-2">
          {range}
        </span>
      )}
      <button
        type="button"
        onClick={onRestore}
        className="p-1.5 rounded text-ss-text-secondary hover:bg-ss-surface-hover hover:text-ss-text transition-colors cursor-pointer"
        aria-label="Expand dialog"
        title="Expand dialog (Escape cancels selection, Enter completes range)"
      >
        <RestoreIcon />
      </button>
    </div>
  );
}

// =============================================================================
// MinimizableDialog Component
// =============================================================================

/**
 * MinimizableDialog - A dialog that can minimize during range selection mode.
 *
 * This component wraps the standard Dialog and adds the ability to minimize
 * when the user enters range selection mode. The minimized state shows a small
 * bar at the bottom-left of the viewport with the dialog title and a restore
 * button.
 *
 * The dialog will minimize when:
 * - rangeSelectionMode.active === true
 * - rangeSelectionMode.sourceDialogId === dialogId
 *
 * @example
 * ```tsx
 * <MinimizableDialog
 * dialogId="sort-dialog"
 * title="Sort"
 * open={isOpen}
 * onOpenChange={setIsOpen}
 * >
 * <DialogHeader onClose={ => setIsOpen(false)}>Sort</DialogHeader>
 * <DialogBody>
 * <CollapsibleRangeInput
 * dialogId="sort-dialog"
 * inputId="sort-range"
 * value={range}
 * onChange={setRange}
 * />
 * </DialogBody>
 * <DialogFooter>
 * <Button variant="primary">OK</Button>
 * </DialogFooter>
 * </MinimizableDialog>
 * ```
 */
export function MinimizableDialog({
  dialogId,
  parentDialogId,
  title,
  children,
  open,
  onEnterKeyDown,
  ...dialogProps
}: MinimizableDialogProps) {
  // Subscribe to dialog stack actions for registration
  const registerDialog = useUIStore((s) => s.registerDialog);
  const unregisterDialog = useUIStore((s) => s.unregisterDialog);

  // Subscribe to dialog stack for minimize state
  const isDialogMinimized = useUIStore((s) => s.isDialogMinimized(dialogId));
  const sourceDialogId = useUIStore((s) => s.rangeSelectionMode.sourceDialogId);
  const currentRange = useUIStore((s) => s.rangeSelectionMode.currentRange);
  const dispatchAction = useDispatch();

  // Suppress onEnterKeyDown while CollapsibleRangeInput's global Enter handler
  // owns the keystream — Enter completes the range, not the dialog.
  const guardedEnter = useRangeSelectionEnterGuard(onEnterKeyDown);

  // Register/unregister dialog on mount/unmount when open
  useEffect(() => {
    if (open) {
      registerDialog(dialogId, parentDialogId);
    }
    return () => {
      if (open) {
        unregisterDialog(dialogId);
      }
    };
  }, [open, dialogId, parentDialogId, registerDialog, unregisterDialog]);

  // Handle restore - complete the range selection (keeps the selected range)
  const handleRestore = () => {
    // Clicking restore completes the selection with the current value
    dispatchAction('COMPLETE_RANGE_SELECTION');
  };

  // When minimized as the SOURCE dialog, show the minimized bar
  if (isDialogMinimized && sourceDialogId === dialogId) {
    return (
      <MinimizedDialogBar
        dialogId={dialogId}
        title={title}
        range={currentRange}
        onRestore={handleRestore}
      />
    );
  }

  // When minimized as a PARENT dialog, hide completely
  if (isDialogMinimized && sourceDialogId !== dialogId) {
    return null;
  }

  // When not minimized, render the normal dialog
  return (
    <Dialog open={open} dialogId={dialogId} onEnterKeyDown={guardedEnter} {...dialogProps}>
      {children}
    </Dialog>
  );
}
