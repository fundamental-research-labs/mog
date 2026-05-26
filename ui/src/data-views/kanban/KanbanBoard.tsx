/**
 * KanbanBoard Component
 *
 * Main board layout with horizontal scrolling columns.
 * Manages keyboard navigation and orchestrates drag and drop.
 * Kernel-agnostic: uses plain string IDs, no kernel dependencies.
 *
 * Keyboard handling is IME-safe: events during IME composition are ignored
 * to prevent spurious actions on CJK input systems.
 */

import React, { memo, useCallback, useEffect, useRef } from 'react';
import type { KeyModifiers } from '../../types';
import { KanbanColumn } from './KanbanColumn';
import type { KanbanBoardProps } from './types';
import { getFirstCardId, getNextCardId } from './utils';

/**
 * Main Kanban board component.
 */
function KanbanBoardComponent({
  columns,
  state,
  columnInfos,
  onCardClick,
  onCardDoubleClick,
  onClearSelection,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onStartAddCard,
  onCommitAddCard,
  onCancelAddCard,
  onToggleCollapse,
  onFocusCard,
  onKeyDown,
  className = '',
}: KanbanBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dragDataRef = useRef<{ cardId: string; sourceColumn: string } | null>(null);

  // Handle card click with modifiers extraction
  const handleCardClick = useCallback(
    (cardId: string, event: React.MouseEvent) => {
      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };
      onCardClick?.(cardId, modifiers);
    },
    [onCardClick],
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (event: React.DragEvent, cardId: string, columnValue: string) => {
      dragDataRef.current = { cardId, sourceColumn: columnValue };
      event.dataTransfer.effectAllowed = 'move';
      onDragStart?.(cardId);
    },
    [onDragStart],
  );

  // Handle drag over on column
  const handleDragOver = useCallback(
    (event: React.DragEvent, columnValue: string, index: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onDragOver?.(columnValue, index);
    },
    [onDragOver],
  );

  // Handle drag enter
  const handleDragEnter = useCallback((event: React.DragEvent, _columnValue: string) => {
    event.preventDefault();
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((_event: React.DragEvent) => {
    // Could track leave for visual feedback
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (event: React.DragEvent, columnValue: string, index: number) => {
      event.preventDefault();
      const dragData = dragDataRef.current;
      if (dragData) {
        onDrop?.(dragData.cardId, columnValue, index);
      }
      dragDataRef.current = null;
    },
    [onDrop],
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (_event: React.DragEvent) => {
      dragDataRef.current = null;
      onDragEnd?.();
    },
    [onDragEnd],
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // IME safety: never handle events during IME composition (e.g., CJK input).
      // Both the explicit isComposing flag and the legacy keyCode 229 are checked.
      const nativeEvent = event.nativeEvent;
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }

      // Don't handle if we're editing or adding
      if (state.editingCardId !== null || state.addingInColumn !== null) {
        return;
      }

      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };

      const key = event.key;

      // Handle arrow key navigation
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();

        if (state.focusedCardId) {
          const direction =
            key === 'ArrowUp'
              ? 'up'
              : key === 'ArrowDown'
                ? 'down'
                : key === 'ArrowLeft'
                  ? 'left'
                  : 'right';

          const nextCard = getNextCardId(columns, state.focusedCardId, direction);
          if (nextCard) {
            onFocusCard?.(nextCard);
            // Also select if shift is held
            if (event.shiftKey && onCardClick) {
              onCardClick(nextCard, modifiers);
            }
          }
        } else {
          // Focus first card if none focused
          const firstCard = getFirstCardId(columns);
          if (firstCard) {
            onFocusCard?.(firstCard);
          }
        }
        return;
      }

      // Handle Enter to edit
      if (key === 'Enter' && state.focusedCardId) {
        event.preventDefault();
        onCardDoubleClick?.(state.focusedCardId);
        return;
      }

      // Handle 'n' to add new card
      if (key === 'n' && !modifiers.ctrlKey && !modifiers.metaKey) {
        // Add card to focused column or first column
        const focusedColumn = state.focusedCardId
          ? columns.find((c) => c.cards.some((card) => card.id === state.focusedCardId))
          : columns[0];

        if (focusedColumn) {
          event.preventDefault();
          onStartAddCard?.(focusedColumn.value);
        }
        return;
      }

      // Handle Delete/Backspace
      if ((key === 'Delete' || key === 'Backspace') && state.selectedCardIds.length > 0) {
        event.preventDefault();
        onKeyDown?.(key, modifiers);
        return;
      }

      // Handle Escape
      if (key === 'Escape') {
        event.preventDefault();
        if (state.selectedCardIds.length > 0) {
          onClearSelection?.();
        }
        onKeyDown?.(key, modifiers);
        return;
      }

      // Handle Ctrl/Cmd+A to select all
      if (key === 'a' && (modifiers.ctrlKey || modifiers.metaKey)) {
        event.preventDefault();
        onKeyDown?.(key, modifiers);
        return;
      }

      // Pass other keyboard events
      onKeyDown?.(key, modifiers);
    },
    [
      columns,
      state,
      onCardClick,
      onCardDoubleClick,
      onFocusCard,
      onStartAddCard,
      onKeyDown,
      onClearSelection,
    ],
  );

  // Focus the board when mounted
  useEffect(() => {
    if (boardRef.current) {
      boardRef.current.focus();
    }
  }, []);

  // Build class names
  const boardClasses = [
    'kanban-board',
    'flex',
    'gap-4',
    'p-4',
    'overflow-x-auto',
    'h-full',
    'outline-none',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={boardRef}
      className={boardClasses}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Kanban board"
    >
      {columns.map((column) => (
        <KanbanColumn
          key={column.value}
          column={column}
          state={state}
          columnInfos={columnInfos}
          onCardClick={handleCardClick}
          onCardDoubleClick={onCardDoubleClick || (() => {})}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onStartAddCard={onStartAddCard || (() => {})}
          onCommitAddCard={onCommitAddCard || (() => {})}
          onCancelAddCard={onCancelAddCard || (() => {})}
          onToggleCollapse={onToggleCollapse || (() => {})}
        />
      ))}

      {/* Empty state */}
      {columns.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="text-lg font-medium">No columns configured</p>
            <p className="text-sm">Select a column to group by to create columns</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const KanbanBoard = memo(KanbanBoardComponent);
KanbanBoard.displayName = 'KanbanBoard';
