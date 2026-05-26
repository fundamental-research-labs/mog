/**
 * MonthGrid Component - Kernel-Agnostic
 *
 * Renders a month view with a 7-column x 6-row grid.
 * Shows day headers and day cells with events.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CalendarEvent as CalendarEventComponent } from './CalendarEvent';
import type { CalendarDay, CalendarEvent } from './types';
import { generateMonthGrid, getDayNames } from './utils';

// =============================================================================
// Types
// =============================================================================

interface MonthGridProps {
  /** Current date (determines which month to show) */
  currentDate: Date;
  /** Events to display */
  events: CalendarEvent[];
  /** First day of week: 0 = Sunday, 1 = Monday */
  weekStartsOn: 0 | 1;
  /** Selected event IDs */
  selectedEventIds: Set<string>;
  /** Event being dragged */
  draggedEventId: string | null;
  /** Day click handler */
  onDayClick?: (date: Date, e: React.MouseEvent) => void;
  /** Day double-click handler (create event) */
  onDayDoubleClick?: (date: Date) => void;
  /** Event click handler */
  onEventClick?: (event: CalendarEvent, e: React.MouseEvent) => void;
  /** Event double-click handler */
  onEventDoubleClick?: (event: CalendarEvent) => void;
  /** Event drag start handler */
  onEventDragStart?: (event: CalendarEvent) => void;
  /** Event drop handler (reschedule) */
  onEventDrop?: (eventId: string, newDate: Date) => void;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_VISIBLE_EVENTS = 3;

// =============================================================================
// DayCell Component
// =============================================================================

interface DayCellProps {
  day: CalendarDay;
  selectedEventIds: Set<string>;
  draggedEventId: string | null;
  isDragOver: boolean;
  onDayClick?: (date: Date, e: React.MouseEvent) => void;
  onDayDoubleClick?: (date: Date) => void;
  onEventClick?: (event: CalendarEvent, e: React.MouseEvent) => void;
  onEventDoubleClick?: (event: CalendarEvent) => void;
  onEventDragStart?: (event: CalendarEvent) => void;
  onDragOver?: (date: Date, e: React.DragEvent) => void;
  onDrop?: (date: Date, e: React.DragEvent) => void;
}

function DayCell({
  day,
  selectedEventIds,
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
  const baseCellClasses =
    'min-h-[100px] p-1 border-r border-b border-ss-border cursor-pointer transition-colors overflow-hidden';
  const cellBgClass = isDragOver
    ? 'bg-ss-primary-light'
    : day.isToday
      ? 'bg-ss-primary-lighter'
      : !day.isCurrentMonth
        ? 'bg-ss-surface-secondary'
        : 'bg-ss-surface';

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
          <CalendarEventComponent
            key={event.id}
            event={event}
            isSelected={selectedEventIds.has(event.id)}
            isDragging={draggedEventId === event.id}
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

// =============================================================================
// MonthGrid Component
// =============================================================================

export function MonthGrid({
  currentDate,
  events,
  weekStartsOn,
  selectedEventIds,
  draggedEventId,
  onDayClick,
  onDayDoubleClick,
  onEventClick,
  onEventDoubleClick,
  onEventDragStart,
  onEventDrop,
}: MonthGridProps): React.ReactElement {
  // Track which cell is being dragged over
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);

  // Generate the month grid
  const monthGrid = useMemo(
    () => generateMonthGrid(currentDate, weekStartsOn, events),
    [currentDate, weekStartsOn, events],
  );

  // Get day names for header
  const dayNames = useMemo(() => getDayNames(weekStartsOn, 'short'), [weekStartsOn]);

  // Handle drag over
  const handleDragOver = useCallback((date: Date, _e: React.DragEvent) => {
    setDragOverDate(date);
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (date: Date, e: React.DragEvent) => {
      setDragOverDate(null);
      const eventId = e.dataTransfer.getData('text/plain');
      if (eventId && onEventDrop) {
        onEventDrop(eventId, date);
      }
    },
    [onEventDrop],
  );

  // Handle drag leave (when leaving the grid)
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverDate(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden" onDragLeave={handleDragLeave}>
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-ss-border bg-ss-surface-secondary">
        {dayNames.map((name, index) => (
          <div
            key={index}
            className="p-2 text-center text-caption font-semibold text-ss-text-secondary uppercase tracking-wide"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 grid-rows-6 flex-1 overflow-hidden" role="grid">
        {monthGrid.flat().map((day, index) => (
          <DayCell
            key={index}
            day={day}
            selectedEventIds={selectedEventIds}
            draggedEventId={draggedEventId}
            isDragOver={
              dragOverDate !== null && day.date.toDateString() === dragOverDate.toDateString()
            }
            onDayClick={onDayClick}
            onDayDoubleClick={onDayDoubleClick}
            onEventClick={onEventClick}
            onEventDoubleClick={onEventDoubleClick}
            onEventDragStart={onEventDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  );
}
