/**
 * AddCardButton Component
 *
 * Button to add a new card to a column.
 * Can expand to show an inline form for quick entry.
 */

import React, { memo, useCallback, useRef, useState } from 'react';

export interface AddCardButtonProps {
  /** Column value to add card to */
  columnValue: string;
  /** Whether the add form is active */
  isAdding: boolean;
  /** Callback to start adding a card */
  onStartAdd: (columnValue: string) => void;
  /** Callback to commit adding a card */
  onCommitAdd: (columnValue: string, title: string) => void;
  /** Callback to cancel adding a card */
  onCancelAdd: () => void;
}

/**
 * Button/form for adding new cards to a column.
 */
function AddCardButtonComponent({
  columnValue,
  isAdding,
  onStartAdd,
  onCommitAdd,
  onCancelAdd,
}: AddCardButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');

  // Focus input when form opens
  React.useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  // Handle start add
  const handleStartAdd = useCallback(() => {
    onStartAdd(columnValue);
  }, [columnValue, onStartAdd]);

  // Handle input change
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  }, []);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && title.trim()) {
        event.preventDefault();
        onCommitAdd(columnValue, title.trim());
        setTitle('');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setTitle('');
        onCancelAdd();
      }
    },
    [columnValue, title, onCommitAdd, onCancelAdd],
  );

  // Handle blur
  const handleBlur = useCallback(() => {
    if (title.trim()) {
      onCommitAdd(columnValue, title.trim());
      setTitle('');
    } else {
      onCancelAdd();
    }
  }, [columnValue, title, onCommitAdd, onCancelAdd]);

  // Handle submit button click
  const handleSubmit = useCallback(() => {
    if (title.trim()) {
      onCommitAdd(columnValue, title.trim());
      setTitle('');
    }
  }, [columnValue, title, onCommitAdd]);

  if (isAdding) {
    return (
      <div className="p-2 bg-ss-surface-secondary rounded-ss-md border border-ss-border">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="w-full px-3 py-2 text-body-sm border border-ss-border rounded-ss-sm focus:outline-none focus:ring-2 focus:ring-ss-primary-light focus:border-ss-border-focus"
          placeholder="Enter card title..."
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="px-3 py-1.5 text-body-sm font-medium text-ss-text-inverse bg-ss-primary rounded-ss-sm hover:bg-ss-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add card
          </button>
          <button
            onClick={onCancelAdd}
            className="px-3 py-1.5 text-body-sm font-medium text-ss-text-secondary bg-ss-surface border border-ss-border rounded-ss-sm hover:bg-ss-surface-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleStartAdd}
      className="w-full p-2 text-body-sm text-ss-text-secondary hover:text-ss-text hover:bg-ss-surface-hover rounded-ss-md transition-colors flex items-center gap-1"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      Add card
    </button>
  );
}

export const AddCardButton = memo(AddCardButtonComponent);
AddCardButton.displayName = 'AddCardButton';
