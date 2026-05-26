/**
 * KanbanBoard Component
 *
 * Main board layout with horizontal scrolling columns.
 * Manages keyboard navigation and orchestrates drag and drop.
 *
 * Keyboard handling flows through the kernel's KeyboardEventProcessor
 * for IME safety and platform normalization.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import { KeyboardEventProcessor } from '@mog-sdk/kernel/keyboard';
import React, { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { KanbanSnapshot, KeyModifiers } from '../machines';
import type { KanbanColumn as KanbanColumnData } from '../utils/card-grouping';
import { getNextCardId } from '../utils/card-grouping';
import { detectPlatform } from '../../../utils/platform';
import { KanbanColumn } from './KanbanColumn';
export interface KanbanBoardProps {
  /** Columns with their cards */
  columns: KanbanColumnData[];
  /** Kanban state snapshot */
  snapshot: KanbanSnapshot;
  /** Column schemas for field rendering */
  columnSchemas?: Map<ColId, { name: string; type: string }>;
  /** Callback when a card is clicked */
  onCardClick: (cardId: RowId, modifiers: KeyModifiers) => void;
  /** Callback when a card is double-clicked */
  onCardDoubleClick: (cardId: RowId) => void;
  /** Callback when keyboard event occurs */
  onKeyboard: (key: string, modifiers: KeyModifiers) => void;
  /** Callback when a card is dropped */
  onCardDrop: (cardId: RowId, targetColumn: string, targetIndex: number) => void;
  /** Start adding a card */
  onStartAddCard: (columnValue: string) => void;
  /** Commit adding a card */
  onCommitAddCard: (columnValue: string, title: string) => void;
  /** Cancel adding a card */
  onCancelAddCard: () => void;
  /** Toggle column collapse */
  onToggleCollapse: (columnValue: string) => void;
  /** Focus a card */
  onFocusCard: (cardId: RowId) => void;
  /** Drag start */
  onDragStart: (cardId: RowId) => void;
  /** Drag over */
  onDragOver: (column: string, index: number) => void;
  /** Drag end */
  onDragEnd: () => void;
}

/**
 * Main Kanban board component.
 */
function KanbanBoardComponent({
  columns,
  snapshot,
  columnSchemas,
  onCardClick,
  onCardDoubleClick,
  onKeyboard,
  onCardDrop,
  onStartAddCard,
  onCommitAddCard,
  onCancelAddCard,
  onToggleCollapse,
  onFocusCard,
  onDragStart,
  onDragOver,
  onDragEnd,
}: KanbanBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const dragDataRef = useRef<{ cardId: RowId; sourceColumn: string } | null>(null);

  // Processor is stateless (aside from platform); create once and reuse.
  const processor = useMemo(() => new KeyboardEventProcessor(detectPlatform()), []);

  // Handle card click with modifiers extraction
  const handleCardClick = useCallback(
    (cardId: RowId, event: React.MouseEvent) => {
      const modifiers: KeyModifiers = {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      };
      onCardClick(cardId, modifiers);
    },
    [onCardClick],
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (event: React.DragEvent, cardId: RowId, columnValue: string) => {
      dragDataRef.current = { cardId, sourceColumn: columnValue };
      event.dataTransfer.effectAllowed = 'move';
      onDragStart(cardId);
    },
    [onDragStart],
  );

  // Handle drag over on column
  const handleDragOver = useCallback(
    (event: React.DragEvent, columnValue: string, index: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      onDragOver(columnValue, index);
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
        onCardDrop(dragData.cardId, columnValue, index);
      }
      dragDataRef.current = null;
    },
    [onCardDrop],
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (_event: React.DragEvent) => {
      dragDataRef.current = null;
      onDragEnd();
    },
    [onDragEnd],
  );

  // Handle keyboard events through kernel processor for IME safety & normalization.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Normalize through the kernel processor
      const input = processor.process(event.nativeEvent);

      // IME safety: never act during composition (CJK input, etc.)
      if (input.isComposing) {
        return;
      }

      // Don't handle if we're editing or adding
      if (snapshot.editingCard !== null || snapshot.addingInColumn !== null) {
        return;
      }

      const modifiers: KeyModifiers = {
        shiftKey: input.modifiers.shift,
        ctrlKey: input.modifiers.ctrl,
        metaKey: input.modifiers.meta,
        altKey: input.modifiers.alt,
      };

      // Use the normalized character (event.key equivalent) for semantic checks
      const key = input.character;

      // Handle arrow key navigation
      if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();

        if (snapshot.focusedCard) {
          const direction =
            key === 'ArrowUp'
              ? 'up'
              : key === 'ArrowDown'
                ? 'down'
                : key === 'ArrowLeft'
                  ? 'left'
                  : 'right';

          const nextCard = getNextCardId(columns, snapshot.focusedCard, direction);
          if (nextCard) {
            onFocusCard(nextCard);
            // Also select if shift is held
            if (input.modifiers.shift) {
              onCardClick(nextCard, modifiers);
            }
          }
        } else if (columns.length > 0 && columns[0].cards.length > 0) {
          // Focus first card if none focused
          onFocusCard(columns[0].cards[0].rowId);
        }
        return;
      }

      // Handle Enter to edit
      if (key === 'Enter' && snapshot.focusedCard) {
        event.preventDefault();
        onCardDoubleClick(snapshot.focusedCard);
        return;
      }

      // Handle 'n' to add new card
      if (key === 'n' && !input.modifiers.ctrl && !input.modifiers.meta) {
        // Add card to focused column or first column
        const focusedColumn = snapshot.focusedCard
          ? columns.find((c) => c.cards.some((card) => card.rowId === snapshot.focusedCard))
          : columns[0];

        if (focusedColumn) {
          event.preventDefault();
          onStartAddCard(focusedColumn.value);
        }
        return;
      }

      // Handle Delete/Backspace
      if ((key === 'Delete' || key === 'Backspace') && snapshot.selectedCards.length > 0) {
        event.preventDefault();
        // Delegate to parent for delete confirmation
        onKeyboard(key, modifiers);
        return;
      }

      // Handle Escape
      if (key === 'Escape') {
        event.preventDefault();
        onKeyboard(key, modifiers);
        return;
      }

      // Handle Ctrl/Cmd+A to select all
      if (key === 'a' && (input.modifiers.ctrl || input.modifiers.meta)) {
        event.preventDefault();
        onKeyboard(key, modifiers);
        return;
      }

      // Pass other keyboard events
      onKeyboard(key, modifiers);
    },
    [
      processor,
      columns,
      snapshot,
      onCardClick,
      onCardDoubleClick,
      onFocusCard,
      onStartAddCard,
      onKeyboard,
    ],
  );

  // Focus the board when mounted
  useEffect(() => {
    if (boardRef.current) {
      boardRef.current.focus();
    }
  }, []);

  return (
    <div
      ref={boardRef}
      className="kanban-board flex gap-4 p-4 overflow-x-auto h-full outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Kanban board"
    >
      {columns.map((column) => (
        <KanbanColumn
          key={column.value}
          column={column}
          snapshot={snapshot}
          onCardClick={handleCardClick}
          onCardDoubleClick={onCardDoubleClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onStartAddCard={onStartAddCard}
          onCommitAddCard={onCommitAddCard}
          onCancelAddCard={onCancelAddCard}
          onToggleCollapse={onToggleCollapse}
          columnSchemas={columnSchemas}
        />
      ))}

      {/* Empty state */}
      {columns.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-ss-text-secondary">
          <div className="text-center">
            <p className="text-section font-medium">No columns configured</p>
            <p className="text-body-sm">Select a column to group by to create columns</p>
          </div>
        </div>
      )}
    </div>
  );
}

export const KanbanBoard = memo(KanbanBoardComponent);
KanbanBoard.displayName = 'KanbanBoard';
