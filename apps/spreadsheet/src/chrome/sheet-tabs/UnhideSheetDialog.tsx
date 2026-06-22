/**
 * UnhideSheetDialog Component
 *
 * A dialog that lists hidden sheets and allows the user to select one to unhide.
 *
 * Tab Strip Enhancement
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CheckmarkSvg } from '@mog/icons';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import type { SheetTabInfo } from '../../internal-api';

// =============================================================================
// Types
// =============================================================================

export interface UnhideSheetDialogProps {
  /** Whether dialog is open */
  isOpen: boolean;
  /** List of hidden sheets */
  hiddenSheets: SheetTabInfo[];
  /** Callback when a sheet is selected to unhide */
  onUnhide: (sheetId: string) => void;
  /** Callback to close the dialog */
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function UnhideSheetDialog({
  isOpen,
  hiddenSheets,
  onUnhide,
  onClose,
}: UnhideSheetDialogProps) {
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const wasOpenRef = useRef(false);

  // Reset selection when a dialog session starts, not on incidental parent re-renders.
  useEffect(() => {
    const shouldReset = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!shouldReset) return;

    setSelectedSheetId(hiddenSheets[0]?.id ?? null);
  }, [isOpen, hiddenSheets]);

  // If the selected hidden sheet disappears while the dialog is open, choose
  // the first remaining hidden sheet so OK never targets stale metadata.
  useEffect(() => {
    if (!isOpen || selectedSheetId === null) return;
    if (!hiddenSheets.some((sheet) => sheet.id === selectedSheetId)) {
      setSelectedSheetId(hiddenSheets[0]?.id ?? null);
    }
  }, [isOpen, selectedSheetId, hiddenSheets]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && selectedSheetId) {
        onUnhide(selectedSheetId);
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = hiddenSheets.findIndex((s) => s.id === selectedSheetId);
        let newIndex = currentIndex;
        if (e.key === 'ArrowDown') {
          newIndex = Math.min(currentIndex + 1, hiddenSheets.length - 1);
        } else {
          newIndex = Math.max(currentIndex - 1, 0);
        }
        setSelectedSheetId(hiddenSheets[newIndex]?.id ?? null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedSheetId, hiddenSheets, onUnhide, onClose]);

  const handleOk = useCallback(() => {
    if (selectedSheetId) {
      onUnhide(selectedSheetId);
      onClose();
    }
  }, [selectedSheetId, onUnhide, onClose]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      dialogId="unhide-sheet-dialog"
      width={300}
      closeOnOverlayClick={true}
    >
      <DialogHeader>Unhide Sheet</DialogHeader>

      <DialogBody className="py-2 px-0 min-h-[100px] max-h-[250px]">
        {hiddenSheets.length === 0 ? (
          <div className="p-5 text-center text-ss-text-secondary text-body-sm">
            No hidden sheets
          </div>
        ) : (
          <div role="listbox" aria-label="Hidden sheets">
            {hiddenSheets.map((sheet) => {
              const isSelected = sheet.id === selectedSheetId;

              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => setSelectedSheetId(sheet.id)}
                  onDoubleClick={handleOk}
                  className={`flex items-center w-full px-5 py-2.5 border-none bg-transparent cursor-pointer text-body-sm text-left hover:bg-ss-surface-hover ${
                    isSelected
                      ? 'bg-ss-primary-light text-ss-primary font-medium'
                      : 'text-text-ss-primary'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`unhide-sheet-${sheet.id}`}
                >
                  <div
                    className="w-3 h-3 rounded-ss-sm mr-3 border border-ss-border flex-shrink-0"
                    style={{
                      backgroundColor: sheet.tabColor || '#fff',
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{sheet.name}</span>
                  <span
                    className="ml-3 flex h-4 w-4 flex-shrink-0 items-center justify-center text-ss-primary"
                    aria-hidden="true"
                  >
                    {isSelected ? <CheckmarkSvg className="h-3.5 w-3.5" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!selectedSheetId}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
