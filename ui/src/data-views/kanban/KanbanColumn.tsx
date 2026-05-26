/**
 * KanbanColumn Component
 *
 * Renders a single column in the Kanban board.
 * Kernel-agnostic: uses plain string IDs, no kernel dependencies.
 */

import React, { memo, useCallback, useRef } from 'react';
import { AddCardButton } from './AddCardButton';
import { KanbanCard } from './KanbanCard';
import type { KanbanColumnProps } from './types';

/**
 * Kanban column component.
 */
function KanbanColumnComponent({
  column,
  state,
  columnInfos,
  onCardClick,
  onCardDoubleClick,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
  onStartAddCard,
  onCommitAddCard,
  onCancelAddCard,
  onToggleCollapse,
}: KanbanColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  const isAddingHere = state.addingInColumn === column.value;
  const isDraggedOver = state.draggedOverColumn === column.value;
  const dropIndex = state.dropPosition?.column === column.value ? state.dropPosition.index : null;

  // Handle drag over on column
  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Calculate drop index based on mouse position
      const container = cardsContainerRef.current;
      if (!container) {
        onDragOver(event, column.value, column.cards.length);
        return;
      }

      const cards = container.querySelectorAll('[data-card-id]');
      let index = column.cards.length;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i] as HTMLElement;
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (event.clientY < midY) {
          index = i;
          break;
        }
      }

      onDragOver(event, column.value, index);
    },
    [column.value, column.cards.length, onDragOver],
  );

  // Handle drag enter on column
  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      onDragEnter(event, column.value);
    },
    [column.value, onDragEnter],
  );

  // Handle drop on column
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const index = dropIndex ?? column.cards.length;
      onDrop(event, column.value, index);
    },
    [column.value, dropIndex, column.cards.length, onDrop],
  );

  // Handle toggle collapse
  const handleToggleCollapse = useCallback(() => {
    onToggleCollapse(column.value);
  }, [column.value, onToggleCollapse]);

  // Build column class names
  const columnClasses = [
    'kanban-column',
    'flex',
    'flex-col',
    'min-w-[280px]',
    'max-w-[320px]',
    'bg-gray-50',
    'rounded-lg',
    'flex-shrink-0',
  ];

  if (isDraggedOver) {
    columnClasses.push('ring-2', 'ring-blue-500', 'ring-inset');
  }

  // Header color indicator
  const headerColorStyle = column.color ? { borderTopColor: column.color } : {};

  return (
    <div
      ref={columnRef}
      className={columnClasses.join(' ')}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={onDragLeave}
      onDrop={handleDrop}
      style={{ borderTopWidth: column.color ? '3px' : undefined, ...headerColorStyle }}
      data-column-value={column.value}
    >
      {/* Column header */}
      <div className="kanban-column-header flex items-center justify-between p-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleCollapse}
            className="text-gray-400 hover:text-gray-600"
            aria-label={column.isCollapsed ? 'Expand column' : 'Collapse column'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${column.isCollapsed ? '-rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <h3 className="font-medium text-gray-900">{column.label}</h3>
          <span className="text-sm text-gray-500">
            {column.cards.length}
            {column.wipLimit !== undefined && (
              <span className={column.isOverLimit ? 'text-red-600 font-medium' : ''}>
                /{column.wipLimit}
              </span>
            )}
          </span>
        </div>

        {/* WIP limit warning */}
        {column.isOverLimit && <span className="text-xs text-red-600 font-medium">Over limit</span>}
      </div>

      {/* Cards container */}
      {!column.isCollapsed && (
        <div ref={cardsContainerRef} className="flex-1 p-2 overflow-y-auto min-h-[100px]">
          {column.cards.map((card, index) => (
            <React.Fragment key={card.id}>
              {/* Drop indicator */}
              {isDraggedOver && dropIndex === index && (
                <div className="h-1 bg-blue-500 rounded-sm my-1" />
              )}
              <KanbanCard
                card={card}
                columnValue={column.value}
                isSelected={state.selectedCardIds.includes(card.id)}
                isFocused={state.focusedCardId === card.id}
                isDragging={state.draggedCardId === card.id}
                isEditing={state.editingCardId === card.id}
                columnInfos={columnInfos}
                onClick={onCardClick}
                onDoubleClick={onCardDoubleClick}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </React.Fragment>
          ))}

          {/* Drop indicator at end */}
          {isDraggedOver && dropIndex === column.cards.length && (
            <div className="h-1 bg-blue-500 rounded-sm my-1" />
          )}

          {/* Add card button */}
          <AddCardButton
            columnValue={column.value}
            isAdding={isAddingHere}
            onStartAdd={onStartAddCard}
            onCommitAdd={onCommitAddCard}
            onCancelAdd={onCancelAddCard}
          />
        </div>
      )}

      {/* Collapsed state */}
      {column.isCollapsed && (
        <div className="p-3 text-center text-sm text-gray-500">
          {column.cards.length} card{column.cards.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export const KanbanColumn = memo(KanbanColumnComponent);
KanbanColumn.displayName = 'KanbanColumn';
