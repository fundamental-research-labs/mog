/**
 * AddCardButton Component
 *
 * Button/input for adding new cards to a Kanban column.
 * Kernel-agnostic: no kernel dependencies.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AddCardButtonProps } from './types';

/**
 * AddCardButton component.
 */
function AddCardButtonComponent({
  columnValue,
  isAdding,
  onStartAdd,
  onCommitAdd,
  onCancelAdd,
}: AddCardButtonProps) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when adding starts
  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

  // Clear title when adding state changes
  useEffect(() => {
    if (!isAdding) {
      setTitle('');
    }
  }, [isAdding]);

  // Handle start adding
  const handleStartAdd = useCallback(() => {
    onStartAdd(columnValue);
  }, [onStartAdd, columnValue]);

  // Handle commit
  const handleCommit = useCallback(() => {
    if (title.trim()) {
      onCommitAdd(columnValue, title.trim());
      setTitle('');
    } else {
      onCancelAdd();
    }
  }, [onCommitAdd, onCancelAdd, columnValue, title]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setTitle('');
    onCancelAdd();
  }, [onCancelAdd]);

  // Handle key events
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleCommit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      }
    },
    [handleCommit, handleCancel],
  );

  // Handle blur
  const handleBlur = useCallback(() => {
    // Small delay to allow click on commit button
    setTimeout(() => {
      if (title.trim()) {
        handleCommit();
      } else {
        handleCancel();
      }
    }, 100);
  }, [title, handleCommit, handleCancel]);

  if (isAdding) {
    return (
      <div className="add-card-input p-2 bg-white rounded-md shadow-sm border border-gray-200">
        <input
          ref={inputRef}
          type="text"
          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter card title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={handleCommit}
          >
            Add
          </button>
          <button
            type="button"
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 focus:outline-none"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="add-card-button w-full p-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors text-left"
      onClick={handleStartAdd}
    >
      + Add card
    </button>
  );
}

export const AddCardButton = memo(AddCardButtonComponent);
AddCardButton.displayName = 'AddCardButton';
