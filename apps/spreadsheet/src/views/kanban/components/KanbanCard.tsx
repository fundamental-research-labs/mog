/**
 * KanbanCard Component
 *
 * Renders a single card in the Kanban board.
 * Supports selection, drag and drop, and inline editing.
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import React, { memo, useCallback, useRef } from 'react';
import type { KanbanSnapshot } from '../machines';
import type { KanbanCard as KanbanCardData } from '../utils/card-grouping';
export interface KanbanCardProps {
  /** Card data */
  card: KanbanCardData;
  /** Column this card belongs to */
  columnValue: string;
  /** Kanban state snapshot */
  snapshot: KanbanSnapshot;
  /** Callback when card is clicked */
  onClick: (cardId: RowId, event: React.MouseEvent) => void;
  /** Callback when card is double-clicked */
  onDoubleClick: (cardId: RowId) => void;
  /** Drag start handler */
  onDragStart: (event: React.DragEvent, cardId: RowId, columnValue: string) => void;
  /** Drag end handler */
  onDragEnd: (event: React.DragEvent) => void;
  /** Column schemas for field rendering */
  columnSchemas?: Map<ColId, { name: string; type: string }>;
}

/**
 * Format a cell value for display.
 */
function formatValue(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

/**
 * KanbanCard component.
 */
function KanbanCardComponent({
  card,
  columnValue,
  snapshot,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragEnd,
  columnSchemas,
}: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const isSelected = snapshot.selectedCards.includes(card.rowId);
  const isFocused = snapshot.focusedCard === card.rowId;
  const isDragging = snapshot.draggedCard === card.rowId;
  const isEditing = snapshot.editingCard === card.rowId;

  // Click handler
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      onClick(card.rowId, event);
    },
    [onClick, card.rowId],
  );

  // Double-click handler
  const handleDoubleClick = useCallback(() => {
    onDoubleClick(card.rowId);
  }, [onDoubleClick, card.rowId]);

  // Drag start handler
  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      onDragStart(event, card.rowId, columnValue);
    },
    [onDragStart, card.rowId, columnValue],
  );

  // Keyboard handler for card
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !isEditing) {
        event.preventDefault();
        onDoubleClick(card.rowId);
      }
    },
    [onDoubleClick, card.rowId, isEditing],
  );

  // Build class names
  const classNames = [
    'kanban-card',
    'relative',
    'p-3',
    'mb-2',
    'bg-ss-surface',
    'rounded-ss-md',
    'shadow-ss-sm',
    'border',
    'cursor-pointer',
    'transition-all',
    'duration-ss',
  ];

  if (isSelected) {
    classNames.push('border-ss-primary', 'ring-2', 'ring-ss-primary-light');
  } else {
    classNames.push('border-ss-border', 'hover:border-ss-border-light');
  }

  if (isFocused) {
    classNames.push('ring-2', 'ring-ss-primary');
  }

  if (isDragging) {
    classNames.push('opacity-50', 'scale-95');
  }

  // Color indicator from card color
  const colorIndicatorStyle = card.color ? { backgroundColor: card.color } : undefined;

  return (
    <div
      ref={cardRef}
      className={classNames.join(' ')}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      draggable={!isEditing}
      tabIndex={0}
      role="button"
      aria-selected={isSelected}
      data-card-id={card.rowId}
    >
      {/* Color indicator */}
      {colorIndicatorStyle && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-ss-md"
          style={colorIndicatorStyle}
        />
      )}

      {/* Card title */}
      <div className="font-medium text-ss-text mb-1 truncate">{card.title || '(Untitled)'}</div>

      {/* Card fields */}
      {card.fields.size > 0 && (
        <div className="space-y-1 text-body-sm text-ss-text-secondary">
          {Array.from(card.fields.entries()).map(([colId, value]) => {
            const schema = columnSchemas?.get(colId);
            const label = schema?.name || colId;
            return (
              <div key={colId} className="flex items-center gap-1">
                <span className="text-ss-text-disabled text-caption">{label}:</span>
                <span className="truncate">{formatValue(value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const KanbanCard = memo(KanbanCardComponent, (prev, next) => {
  // Custom comparison for performance
  if (prev.card.rowId !== next.card.rowId) return false;
  if (prev.card.title !== next.card.title) return false;
  if (prev.columnValue !== next.columnValue) return false;

  // Check snapshot values that affect this card
  const prevSelected = prev.snapshot.selectedCards.includes(prev.card.rowId);
  const nextSelected = next.snapshot.selectedCards.includes(next.card.rowId);
  if (prevSelected !== nextSelected) return false;

  const prevFocused = prev.snapshot.focusedCard === prev.card.rowId;
  const nextFocused = next.snapshot.focusedCard === next.card.rowId;
  if (prevFocused !== nextFocused) return false;

  const prevDragging = prev.snapshot.draggedCard === prev.card.rowId;
  const nextDragging = next.snapshot.draggedCard === next.card.rowId;
  if (prevDragging !== nextDragging) return false;

  const prevEditing = prev.snapshot.editingCard === prev.card.rowId;
  const nextEditing = next.snapshot.editingCard === next.card.rowId;
  if (prevEditing !== nextEditing) return false;

  return true;
});

KanbanCard.displayName = 'KanbanCard';
