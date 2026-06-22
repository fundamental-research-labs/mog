/**
 * MoveOrCopySheetDialog Component
 *
 * Dialog for moving or copying sheets within the same workbook.
 * Matches Excel's "Move or Copy" dialog functionality.
 *
 * Features:
 * - "Create a copy" checkbox to toggle between Move and Copy modes
 * - Sheet name input (shown only in Copy mode, with auto-generated default)
 * - "Before sheet" listbox for target position selection
 * - "(move to end)" special option
 * - Keyboard navigation (Arrow keys, Enter, Escape, double-click)
 *
 * Excel Parity: Issue 3 (Sheet Tab Context Menu)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CheckmarkSvg } from '@mog/icons';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';
import type { SheetTabInfo } from '../../internal-api';

// =============================================================================
// Types
// =============================================================================

export interface MoveOrCopySheetDialogProps {
  /** Whether dialog is open */
  isOpen: boolean;
  /** Source sheet ID to move/copy */
  sourceSheetId: string;
  /** Source sheet name (for display and default copy name) */
  sourceSheetName: string;
  /** All sheets in workbook (for target list) */
  sheets: SheetTabInfo[];
  /** Callback to close the dialog */
  onClose: () => void;
  /** Callback when Move is confirmed (sourceSheetId, beforeSheetId) */
  onMove: (sourceSheetId: string, beforeSheetId: string | null) => void;
  /** Callback when Copy is confirmed (sourceSheetId, beforeSheetId, newName) */
  onCopy: (sourceSheetId: string, beforeSheetId: string | null, newName: string) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate default copy name with (2) suffix.
 * If "Sheet1 (2)" exists, tries "Sheet1 (3)", etc.
 */
function generateCopyName(baseName: string, existingNames: string[]): string {
  const existingSet = new Set(existingNames);
  let counter = 2;
  let candidate = `${baseName} (${counter})`;

  while (existingSet.has(candidate)) {
    counter++;
    candidate = `${baseName} (${counter})`;
  }

  return candidate;
}

// =============================================================================
// Component
// =============================================================================

export function MoveOrCopySheetDialog({
  isOpen,
  sourceSheetId,
  sourceSheetName,
  sheets,
  onClose,
  onMove,
  onCopy,
}: MoveOrCopySheetDialogProps) {
  // State
  const [createCopy, setCreateCopy] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedBeforeSheetId, setSelectedBeforeSheetId] = useState<string | null>(null);
  const resetScopeRef = useRef<{ isOpen: boolean; sourceSheetId: string | null }>({
    isOpen: false,
    sourceSheetId: null,
  });
  const wasCreateCopyRef = useRef(false);

  // Reset state when a dialog session starts, not on incidental parent re-renders.
  useEffect(() => {
    const previous = resetScopeRef.current;
    const shouldReset = isOpen && (!previous.isOpen || previous.sourceSheetId !== sourceSheetId);
    resetScopeRef.current = {
      isOpen,
      sourceSheetId: isOpen ? sourceSheetId : null,
    };

    if (!shouldReset) {
      if (!isOpen) {
        wasCreateCopyRef.current = false;
      }
      return;
    }

    wasCreateCopyRef.current = false;
    setCreateCopy(false);
    const existingNames = sheets.map((s) => s.name);
    const defaultName = generateCopyName(sourceSheetName, existingNames);
    setNewName(defaultName);
    setSelectedBeforeSheetId(null);
  }, [isOpen, sourceSheetId, sourceSheetName, sheets]);

  // Seed the default copy name only when the user enters copy mode.
  useEffect(() => {
    const shouldSeedCopyName = createCopy && !wasCreateCopyRef.current;
    wasCreateCopyRef.current = createCopy;
    if (!shouldSeedCopyName) return;

    const existingNames = sheets.map((s) => s.name);
    const defaultName = generateCopyName(sourceSheetName, existingNames);
    setNewName(defaultName);
  }, [createCopy, sourceSheetName, sheets]);

  // If the target sheet disappears while the dialog is open, fall back to end.
  useEffect(() => {
    if (!isOpen || selectedBeforeSheetId === null) return;
    if (!sheets.some((sheet) => sheet.id === selectedBeforeSheetId)) {
      setSelectedBeforeSheetId(null);
    }
  }, [isOpen, selectedBeforeSheetId, sheets]);

  const handleOk = useCallback(() => {
    if (createCopy) {
      // Copy mode: validate name
      const trimmedName = newName.trim();
      if (!trimmedName) {
        // Show error or just prevent submission
        return;
      }
      onCopy(sourceSheetId, selectedBeforeSheetId, trimmedName);
    } else {
      // Move mode
      onMove(sourceSheetId, selectedBeforeSheetId);
    }
    onClose();
  }, [createCopy, newName, sourceSheetId, selectedBeforeSheetId, onCopy, onMove, onClose]);

  const handleDoubleClick = useCallback(() => {
    handleOk();
  }, [handleOk]);

  // Handle keyboard navigation in sheet list
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter') {
        handleOk();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();

        // Build list of selectable IDs (sheets + null for "move to end")
        const selectableIds: (string | null)[] = [...sheets.map((s) => s.id), null];
        const currentIndex = selectableIds.indexOf(selectedBeforeSheetId);

        let newIndex = currentIndex;
        if (e.key === 'ArrowDown') {
          newIndex = Math.min(currentIndex + 1, selectableIds.length - 1);
        } else {
          newIndex = Math.max(currentIndex - 1, 0);
        }

        setSelectedBeforeSheetId(selectableIds[newIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedBeforeSheetId, sheets, onClose, handleOk]);

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      dialogId="move-or-copy-sheet-dialog"
      width={360}
      closeOnOverlayClick={true}
    >
      <DialogHeader>Move or Copy</DialogHeader>

      <DialogBody className="py-4 px-5 min-h-[200px]">
        {/* Title */}
        <div className="text-body-sm text-text-ss-primary mb-4">
          Move selected sheet{createCopy ? ' and create a copy' : ''}
        </div>

        {/* To book (disabled for now - single workbook only) */}
        <div className="mb-4">
          <label className="block text-body-sm text-ss-text-secondary mb-1">To book:</label>
          <select
            disabled
            className="w-full px-2 py-1.5 border border-ss-border rounded bg-ss-surface-secondary text-ss-text-disabled cursor-not-allowed text-body-sm"
          >
            <option>Current Workbook</option>
          </select>
          <div className="text-caption text-ss-text-tertiary mt-1">
            Multi-workbook support coming soon
          </div>
        </div>

        {/* Before sheet */}
        <div className="mb-4">
          <label className="block text-body-sm text-ss-text-secondary mb-1">Before sheet:</label>
          <div
            className="border border-ss-border rounded max-h-[120px] overflow-y-auto"
            role="listbox"
            aria-label="Before sheet"
          >
            {sheets.map((sheet) => {
              const isSelected = selectedBeforeSheetId === sheet.id;
              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => setSelectedBeforeSheetId(sheet.id)}
                  onDoubleClick={handleDoubleClick}
                  className={`flex items-center w-full px-3 py-2 border-none bg-transparent cursor-pointer text-body-sm text-left hover:bg-ss-surface-hover ${
                    isSelected
                      ? 'bg-ss-primary-light text-ss-primary font-medium'
                      : 'text-text-ss-primary'
                  }`}
                  role="option"
                  aria-selected={isSelected}
                  data-testid={`move-copy-sheet-${sheet.id}`}
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

            {/* "(move to end)" option */}
            <button
              type="button"
              onClick={() => setSelectedBeforeSheetId(null)}
              onDoubleClick={handleDoubleClick}
              className={`flex items-center w-full px-3 py-2 border-none bg-transparent cursor-pointer text-body-sm text-left hover:bg-ss-surface-hover ${
                selectedBeforeSheetId === null
                  ? 'bg-ss-primary-light text-ss-primary font-medium'
                  : 'text-ss-text-secondary'
              }`}
              role="option"
              aria-selected={selectedBeforeSheetId === null}
              data-testid="move-copy-sheet-to-end"
            >
              <span className="min-w-0 flex-1 truncate">(move to end)</span>
              <span
                className="ml-3 flex h-4 w-4 flex-shrink-0 items-center justify-center text-ss-primary"
                aria-hidden="true"
              >
                {selectedBeforeSheetId === null ? <CheckmarkSvg className="h-3.5 w-3.5" /> : null}
              </span>
            </button>
          </div>
        </div>

        {/* Create a copy checkbox */}
        <div className="mb-4">
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={createCopy}
              onChange={(e) => setCreateCopy(e.target.checked)}
              className="mr-2 w-4 h-4 cursor-pointer"
              data-testid="create-copy-checkbox"
            />
            <span className="text-body-sm text-text-ss-primary">Create a copy</span>
          </label>
        </div>

        {/* New name input (only in Copy mode) */}
        {createCopy && (
          <div className="mb-4">
            <label className="block text-body-sm text-ss-text-secondary mb-1">
              New sheet name:
            </label>
            <Input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter sheet name"
              autoFocus
              data-testid="new-sheet-name-input"
            />
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleOk}
          disabled={createCopy && !newName.trim()}
          data-testid="move-copy-ok-button"
        >
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
