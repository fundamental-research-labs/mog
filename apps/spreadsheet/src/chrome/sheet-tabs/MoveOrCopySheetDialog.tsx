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

import { useCallback, useEffect, useState } from 'react';

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

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setCreateCopy(false);
      const existingNames = sheets.map((s) => s.name);
      const defaultName = generateCopyName(sourceSheetName, existingNames);
      setNewName(defaultName);

      // Default selection: move to end (null)
      setSelectedBeforeSheetId(null);
    }
  }, [isOpen, sourceSheetName, sheets]);

  // Update default name when createCopy changes
  useEffect(() => {
    if (createCopy) {
      const existingNames = sheets.map((s) => s.name);
      const defaultName = generateCopyName(sourceSheetName, existingNames);
      setNewName(defaultName);
    }
  }, [createCopy, sourceSheetName, sheets]);

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
  }, [isOpen, selectedBeforeSheetId, sheets, onClose]);

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
          <div className="border border-ss-border rounded max-h-[120px] overflow-y-auto">
            {sheets.map((sheet) => {
              const isSelected = selectedBeforeSheetId === sheet.id;
              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => setSelectedBeforeSheetId(sheet.id)}
                  onDoubleClick={handleDoubleClick}
                  className={`flex items-center w-full px-3 py-2 border-none bg-transparent cursor-pointer text-body-sm text-text-ss-primary text-left hover:bg-ss-surface-hover ${
                    isSelected ? 'bg-ss-primary-light' : ''
                  }`}
                  aria-selected={isSelected}
                  data-testid={`move-copy-sheet-${sheet.id}`}
                >
                  <div
                    className="w-3 h-3 rounded-ss-sm mr-3 border border-ss-border flex-shrink-0"
                    style={{
                      backgroundColor: sheet.tabColor || '#fff',
                    }}
                  />
                  {sheet.name}
                </button>
              );
            })}

            {/* "(move to end)" option */}
            <button
              type="button"
              onClick={() => setSelectedBeforeSheetId(null)}
              onDoubleClick={handleDoubleClick}
              className={`flex items-center w-full px-3 py-2 border-none bg-transparent cursor-pointer text-body-sm text-ss-text-secondary text-left hover:bg-ss-surface-hover ${
                selectedBeforeSheetId === null ? 'bg-ss-primary-light' : ''
              }`}
              aria-selected={selectedBeforeSheetId === null}
              data-testid="move-copy-sheet-to-end"
            >
              (move to end)
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
