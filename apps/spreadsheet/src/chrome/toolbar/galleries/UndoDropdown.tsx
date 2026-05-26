/**
 * UndoDropdown Component
 *
 * Displays a dropdown menu showing recent undo history.
 * Users can click on an entry to undo multiple operations at once.
 *
 * Uses Radix Popover for portal rendering, positioning, and dismiss behavior.
 */

import React, { useCallback } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@mog/shell';
import type { UndoHistoryEntry } from '../../../ui-store';

// =============================================================================
// Types
// =============================================================================

interface UndoDropdownProps {
  /** Whether the dropdown is open */
  isOpen: boolean;
  /** Undo history entries */
  history: UndoHistoryEntry[];
  /** Called when dropdown should close */
  onClose: () => void;
  /** Called when user clicks an entry to undo to that point */
  onUndoToEntry: (entryId: string) => void;
  /** Called when user clicks "Undo All" */
  onUndoAll?: () => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format a timestamp as a relative time string
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) {
    return 'just now';
  } else if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  } else if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  } else {
    const days = Math.floor(diff / 86400000);
    return `${days}d ago`;
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * Undo dropdown component with memo for performance optimization.
 * Prevents unnecessary re-renders when parent component updates.
 *
 * PERFORMANCE: Wrapped with React.memo to prevent re-renders from parent.
 */
export const UndoDropdown = React.memo(function UndoDropdown({
  isOpen,
  history,
  onClose,
  onUndoToEntry,
  onUndoAll,
}: UndoDropdownProps) {
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleItemClick = useCallback(
    (entryId: string) => {
      onUndoToEntry(entryId);
      onClose();
    },
    [onUndoToEntry, onClose],
  );

  const handleUndoAll = useCallback(() => {
    if (history.length > 0 && onUndoAll) {
      onUndoAll();
      onClose();
    }
  }, [history.length, onUndoAll, onClose]);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      {/* Zero-size placeholder anchored to parent's position.
 IMPORTANT: Cannot use "hidden" (display:none) because getBoundingClientRect() returns zeros.
 Must use absolute positioning to maintain a position reference for Floating UI. */}
      <PopoverTrigger asChild>
        <span className="absolute left-0 top-full w-0 h-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="min-w-[220px] max-w-[300px] max-h-[300px] overflow-y-auto py-1"
        role="menu"
        aria-label="Undo history"
      >
        {/* Header */}
        <div className="px-3 py-2 text-dropdown-header font-semibold text-ss-text-secondary border-b border-ss-border-light mb-1">
          Undo History
        </div>

        {history.length === 0 ? (
          <div className="px-3 py-4 text-dropdown text-ss-text-tertiary text-center">
            No actions to undo
          </div>
        ) : (
          <>
            {/* History Items */}
            {history.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(entry.id)}
                className="flex items-center w-full px-3 py-1.5 border-none bg-transparent cursor-pointer text-left text-dropdown text-text transition-colors duration-ss-fast hover:bg-ss-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-inset"
                title={`Undo: ${entry.description}`}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {entry.description}
                </span>
                <span className="text-ribbon-group text-ss-text-tertiary ml-2 shrink-0">
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </button>
            ))}

            {/* Footer - Undo All */}
            {onUndoAll && history.length > 1 && (
              <div className="border-t border-ss-border-light mt-1 pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleUndoAll}
                  className="flex items-center justify-center w-full px-3 py-2 border-none bg-transparent cursor-pointer text-dropdown font-medium text-ss-primary transition-colors duration-ss-fast hover:bg-ss-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ss-primary focus-visible:ring-inset"
                >
                  Undo All ({history.length} actions)
                </button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
});
