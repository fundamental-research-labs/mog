/**
 * KanbanColumn Component
 *
 * Renders a single column in the Kanban board.
 * Contains a header, list of cards, and add card button.
 * Supports drag and drop as a drop zone.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import React, { memo, useCallback, useRef } from 'react';
import type { KanbanSnapshot } from '../machines';
import type { KanbanColumn as KanbanColumnData } from '../utils/card-grouping';
import { AddCardButton } from './AddCardButton';
import { KanbanCard } from './KanbanCard';
export interface KanbanColumnProps {
  /** Column data */
  column: KanbanColumnData;
  /** Kanban state snapshot */
  snapshot: KanbanSnapshot;
  /** Callback when a card is clicked */
  onCardClick: (cardId: RowId, event: React.MouseEvent) => void;
  /** Callback when a card is double-clicked */
  onCardDoubleClick: (cardId: RowId) => void;
  /** Drag start handler */
  onDragStart: (event: React.DragEvent, cardId: RowId, columnValue: string) => void;
  /** Drag over handler */
  onDragOver: (event: React.DragEvent, columnValue: string, index: number) => void;
  /** Drag enter handler */
  onDragEnter: (event: React.DragEvent, columnValue: string) => void;
  /** Drag leave handler */
  onDragLeave: (event: React.DragEvent) => void;
  /** Drop handler */
  onDrop: (event: React.DragEvent, columnValue: string, index: number) => void;
  /** Drag end handler */
  onDragEnd: (event: React.DragEvent) => void;
  /** Start adding a card */
  onStartAddCard: (columnValue: string) => void;
  /** Commit adding a card */
  onCommitAddCard: (columnValue: string, title: string) => void;
  /** Cancel adding a card */
  onCancelAddCard: () => void;
  /** Toggle column collapse */
  onToggleCollapse: (columnValue: string) => void;
  /** Column schemas for field rendering */
  columnSchemas?: Map<ColId, { name: string; type: string }>;
}

/**
 * Kanban column component.
 */
function KanbanColumnComponent({
  column,
  snapshot,
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
  columnSchemas,
}: KanbanColumnProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  const isAddingHere = snapshot.addingInColumn === column.value;
  const isDraggedOver = snapshot.draggedOverColumn === column.value;
  const dropIndex =
    snapshot.dropPosition?.column === column.value ? snapshot.dropPosition.index : null;

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

  // Build header class names
  const headerClasses = [
    'kanban-column-header',
    'flex',
    'items-center',
    'justify-between',
    'p-3',
    'border-b',
    'border-ss-border',
  ];

  // Build column class names
  const columnClasses = [
    'kanban-column',
    'flex',
    'flex-col',
    'min-w-[280px]',
    'max-w-[320px]',
    'bg-ss-surface-tertiary',
    'rounded-ss-md',
    'flex-shrink-0',
  ];

  if (isDraggedOver) {
    columnClasses.push('ring-2', 'ring-ss-primary', 'ring-inset');
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
      <div className={headerClasses.join(' ')}>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleCollapse}
            className="text-ss-text-disabled hover:text-ss-text-secondary"
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
          <h3 className="font-medium text-ss-text">{column.label}</h3>
          <span className="text-body-sm text-ss-text-secondary">
            {column.cards.length}
            {column.wipLimit !== undefined && (
              <span className={column.isOverLimit ? 'text-ss-error font-medium' : ''}>
                /{column.wipLimit}
              </span>
            )}
          </span>
        </div>

        {/* WIP limit warning */}
        {column.isOverLimit && (
          <span className="text-caption text-ss-error font-medium">Over limit</span>
        )}
      </div>

      {/* Cards container */}
      {!column.isCollapsed && (
        <div ref={cardsContainerRef} className="flex-1 p-2 overflow-y-auto min-h-[100px]">
          {column.cards.map((card, index) => (
            <React.Fragment key={card.rowId}>
              {/* Drop indicator */}
              {isDraggedOver && dropIndex === index && (
                <div className="h-1 bg-ss-primary rounded-ss-sm my-1" />
              )}
              <KanbanCard
                card={card}
                columnValue={column.value}
                snapshot={snapshot}
                onClick={onCardClick}
                onDoubleClick={onCardDoubleClick}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                columnSchemas={columnSchemas}
              />
            </React.Fragment>
          ))}

          {/* Drop indicator at end */}
          {isDraggedOver && dropIndex === column.cards.length && (
            <div className="h-1 bg-ss-primary rounded-ss-sm my-1" />
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
        <div className="p-3 text-center text-body-sm text-ss-text-secondary">
          {column.cards.length} card{column.cards.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

export const KanbanColumn = memo(KanbanColumnComponent);
KanbanColumn.displayName = 'KanbanColumn';
