/**
 * KanbanCard Component
 *
 * Renders a single card in the Kanban board.
 * Kernel-agnostic: uses plain string IDs, no kernel dependencies.
 */

import React, { memo, useCallback, useRef } from 'react';
import type { CellValueOrError } from '../../types';
import type { KanbanCardProps } from './types';

/**
 * Format a cell value for display.
 */
function formatValue(value: CellValueOrError): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return value.code;
  }
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
  isSelected,
  isFocused,
  isDragging,
  isEditing,
  columnInfos,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragEnd,
}: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Click handler
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      onClick(card.id, event);
    },
    [onClick, card.id],
  );

  // Double-click handler
  const handleDoubleClick = useCallback(() => {
    onDoubleClick(card.id);
  }, [onDoubleClick, card.id]);

  // Drag start handler
  const handleDragStart = useCallback(
    (event: React.DragEvent) => {
      onDragStart(event, card.id, columnValue);
    },
    [onDragStart, card.id, columnValue],
  );

  // Keyboard handler for card
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !isEditing) {
        event.preventDefault();
        onDoubleClick(card.id);
      }
    },
    [onDoubleClick, card.id, isEditing],
  );

  // Build class names
  const classNames = [
    'kanban-card',
    'relative',
    'p-3',
    'mb-2',
    'bg-white',
    'rounded-md',
    'shadow-sm',
    'border',
    'cursor-pointer',
    'transition-all',
    'duration-150',
  ];

  if (isSelected) {
    classNames.push('border-blue-500', 'ring-2', 'ring-blue-200');
  } else {
    classNames.push('border-gray-200', 'hover:border-gray-300');
  }

  if (isFocused) {
    classNames.push('ring-2', 'ring-blue-500');
  }

  if (isDragging) {
    classNames.push('opacity-50', 'scale-95');
  }

  // Color indicator from card color
  const colorIndicatorStyle = card.color ? { backgroundColor: card.color } : undefined;

  // Build column info map for field name lookup
  const columnInfoMap = new Map(columnInfos?.map((c) => [c.id, c]) ?? []);

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
      data-card-id={card.id}
    >
      {/* Color indicator */}
      {colorIndicatorStyle && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
          style={colorIndicatorStyle}
        />
      )}

      {/* Card title */}
      <div className="font-medium text-gray-900 mb-1 truncate">{card.title || '(Untitled)'}</div>

      {/* Card fields */}
      {card.fields.size > 0 && (
        <div className="space-y-1 text-sm text-gray-600">
          {Array.from(card.fields.entries()).map(([fieldId, value]) => {
            const columnInfo = columnInfoMap.get(fieldId);
            const label = columnInfo?.name || fieldId;
            return (
              <div key={fieldId} className="flex items-center gap-1">
                <span className="text-gray-400 text-xs">{label}:</span>
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
  if (prev.card.id !== next.card.id) return false;
  if (prev.card.title !== next.card.title) return false;
  if (prev.columnValue !== next.columnValue) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isFocused !== next.isFocused) return false;
  if (prev.isDragging !== next.isDragging) return false;
  if (prev.isEditing !== next.isEditing) return false;

  return true;
});

KanbanCard.displayName = 'KanbanCard';
