/**
 * CalendarEvent Component - Kernel-Agnostic
 *
 * Renders a single event in the calendar. Used in month, week, and day views.
 * Supports drag-to-reschedule functionality.
 */

import React, { useCallback } from 'react';
import type { CalendarEvent as CalendarEventType } from './types';
import { getContrastColor } from './utils';

// =============================================================================
// Types
// =============================================================================

interface CalendarEventProps {
  /** The event data */
  event: CalendarEventType;
  /** Is this event selected? */
  isSelected: boolean;
  /** Is this event being dragged? */
  isDragging: boolean;
  /** Display variant */
  variant?: 'compact' | 'full';
  /** Click handler */
  onClick?: (event: CalendarEventType, e: React.MouseEvent) => void;
  /** Double-click handler */
  onDoubleClick?: (event: CalendarEventType) => void;
  /** Drag start handler */
  onDragStart?: (event: CalendarEventType) => void;
  /** Custom style overrides */
  style?: React.CSSProperties;
}

// =============================================================================
// Styles - Using Tailwind classes
// =============================================================================

const baseClasses =
  'rounded-ss-sm text-caption leading-tight cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap transition-all';
const selectedClasses = 'ring-2 ring-ss-primary/50';
const draggingClasses = 'opacity-50 shadow-ss-md';
const compactClasses = 'px-1 py-0.5 text-hint';
const fullClasses = 'px-2 py-1 whitespace-normal';

// =============================================================================
// Component
// =============================================================================

export function CalendarEvent({
  event,
  isSelected,
  isDragging,
  variant = 'compact',
  onClick,
  onDoubleClick,
  onDragStart,
  style,
}: CalendarEventProps): React.ReactElement {
  // Event handlers
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.(event, e);
    },
    [event, onClick],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick?.(event);
    },
    [event, onDoubleClick],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', event.id);
      e.dataTransfer.effectAllowed = 'move';
      onDragStart?.(event);
    },
    [event, onDragStart],
  );

  // Compute styles - backgroundColor and color must remain inline for dynamic values
  const backgroundColor = event.color || 'var(--color-ss-primary)';
  const textColor = getContrastColor(event.color || '#217346');

  const variantClasses = variant === 'compact' ? compactClasses : fullClasses;
  const stateClasses = [isSelected ? selectedClasses : '', isDragging ? draggingClasses : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`calendar-event ${baseClasses} ${variantClasses} ${stateClasses}`}
      style={{ backgroundColor, color: textColor, ...style }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      draggable
      onDragStart={handleDragStart}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={event.title}
    >
      {event.title}
    </div>
  );
}
