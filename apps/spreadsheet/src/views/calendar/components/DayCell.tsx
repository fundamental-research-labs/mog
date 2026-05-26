/**
 * DayCell Component
 *
 * A single day cell in the month view grid.
 * Shows the day number and events for that day.
 */

import React, { useCallback } from 'react';
import type { CalendarDay, CalendarEvent as CalendarEventType } from '../config';
import { CalendarEvent } from './CalendarEvent';

// =============================================================================
// Types
// =============================================================================

interface DayCellProps {
  /** Day data */
  day: CalendarDay;
  /** Selected event IDs */
  selectedEvents: Set<string>;
  /** Dragged event ID */
  draggedEventId: string | null;
  /** Is this cell the drag target? */
  isDragOver: boolean;
  /** Click handler for the day */
  onDayClick?: (date: Date, e: React.MouseEvent) => void;
  /** Double-click handler for the day (create event) */
  onDayDoubleClick?: (date: Date) => void;
  /** Event click handler */
  onEventClick?: (event: CalendarEventType, e: React.MouseEvent) => void;
  /** Event double-click handler */
  onEventDoubleClick?: (event: CalendarEventType) => void;
  /** Drag start handler */
  onEventDragStart?: (event: CalendarEventType) => void;
  /** Drag over handler */
  onDragOver?: (date: Date, e: React.DragEvent) => void;
  /** Drop handler */
  onDrop?: (date: Date, e: React.DragEvent) => void;
}

// =============================================================================
// Constants & Styles - Using Tailwind classes with design tokens
// =============================================================================

const MAX_VISIBLE_EVENTS = 3;

const baseCellClasses =
  'min-h-[100px] p-1 border-r border-b border-ss-border cursor-pointer transition-colors overflow-hidden';
const otherMonthClasses = 'bg-ss-surface-secondary';
const todayCellClasses = 'bg-ss-primary-lighter';
const dragOverClasses = 'bg-ss-primary-light';
const normalCellClasses = 'bg-ss-surface';

// =============================================================================
// Component
// =============================================================================

export function DayCell({
  day,
  selectedEvents,
  draggedEventId,
  isDragOver,
  onDayClick,
  onDayDoubleClick,
  onEventClick,
  onEventDoubleClick,
  onEventDragStart,
  onDragOver,
  onDrop,
}: DayCellProps): React.ReactElement {
  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      onDayClick?.(day.date, e);
    },
    [day.date, onDayClick],
  );

  // Double-click handler
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDayDoubleClick?.(day.date);
    },
    [day.date, onDayDoubleClick],
  );

  // Drag over handler
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      onDragOver?.(day.date, e);
    },
    [day.date, onDragOver],
  );

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDrop?.(day.date, e);
    },
    [day.date, onDrop],
  );

  // Compute cell classes
  const cellBgClass = isDragOver
    ? dragOverClasses
    : day.isToday
      ? todayCellClasses
      : !day.isCurrentMonth
        ? otherMonthClasses
        : normalCellClasses;

  const cellClasses = `${baseCellClasses} ${cellBgClass}`;

  // Compute day number classes
  const dayNumberBaseClasses = 'text-body-sm font-medium mb-1';
  const dayNumberColorClass = !day.isCurrentMonth ? 'text-ss-text-disabled' : 'text-ss-text';
  const todayIndicatorClasses =
    'inline-flex items-center justify-center w-6 h-6 rounded-full bg-ss-primary text-ss-text-inverse';

  // Split events into visible and overflow
  const visibleEvents = day.events.slice(0, MAX_VISIBLE_EVENTS);
  const overflowCount = day.events.length - MAX_VISIBLE_EVENTS;

  return (
    <div
      className={cellClasses}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="gridcell"
      aria-label={`${day.date.toLocaleDateString()}, ${day.events.length} events`}
    >
      {/* Day number */}
      <div className={`${dayNumberBaseClasses} ${dayNumberColorClass}`}>
        {day.isToday ? (
          <span className={todayIndicatorClasses}>{day.date.getDate()}</span>
        ) : (
          day.date.getDate()
        )}
      </div>

      {/* Events */}
      <div className="flex flex-col gap-0.5">
        {visibleEvents.map((event) => (
          <CalendarEvent
            key={event.rowId}
            event={event}
            isSelected={selectedEvents.has(event.rowId)}
            isDragging={draggedEventId === event.rowId}
            variant="compact"
            onClick={onEventClick}
            onDoubleClick={onEventDoubleClick}
            onDragStart={onEventDragStart}
          />
        ))}

        {/* Overflow indicator */}
        {overflowCount > 0 && (
          <div className="text-hint text-ss-text-secondary px-1 py-0.5 cursor-pointer">
            +{overflowCount} more
          </div>
        )}
      </div>
    </div>
  );
}
