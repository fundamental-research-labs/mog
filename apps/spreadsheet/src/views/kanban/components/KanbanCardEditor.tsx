/**
 * KanbanCardEditor Component
 *
 * Inline editor for card title (and potentially other fields).
 * Appears when double-clicking a card or pressing Enter.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
export interface KanbanCardEditorProps {
  /** Card being edited */
  cardId: RowId;
  /** Initial value */
  initialValue: string;
  /** Field being edited (null = title) */
  fieldId: ColId | null;
  /** Callback when edit is committed */
  onCommit: (cardId: RowId, fieldId: ColId | null, value: CellValue) => void;
  /** Callback when edit is cancelled */
  onCancel: () => void;
}

/**
 * Inline editor for Kanban card fields.
 */
function KanbanCardEditorComponent({
  cardId,
  initialValue,
  fieldId,
  onCommit,
  onCancel,
}: KanbanCardEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  // Handle input change
  const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        onCommit(cardId, fieldId, value);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    },
    [cardId, fieldId, value, onCommit, onCancel],
  );

  // Handle blur (commit on blur)
  const handleBlur = useCallback(() => {
    if (value !== initialValue) {
      onCommit(cardId, fieldId, value);
    } else {
      onCancel();
    }
  }, [cardId, fieldId, value, initialValue, onCommit, onCancel]);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className="w-full px-2 py-1 text-body-sm border border-ss-border-focus rounded-ss-sm focus:outline-none focus:ring-2 focus:ring-ss-primary-light"
      placeholder={fieldId ? 'Enter value...' : 'Enter title...'}
    />
  );
}

export const KanbanCardEditor = memo(KanbanCardEditorComponent);
KanbanCardEditor.displayName = 'KanbanCardEditor';
