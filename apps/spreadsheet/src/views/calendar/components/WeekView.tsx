/**
 * WeekView Component
 *
 * Renders a week view with 7 columns, each showing time slots.
 * Events are positioned based on their time.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { CalendarEvent as CalendarEventType } from '../config';
import {
  formatHour,
  generateWeekDays,
  getDayNames,
  getHoursInDay,
  isSameDay,
  startOfDay,
} from '../utils/date-grid';
import { positionDayEvents, type PositionedEvent } from '../utils/event-positioning';
import { CalendarEvent } from './CalendarEvent';

// =============================================================================
// Types
// =============================================================================

interface WeekViewProps {
  /** Current date (determines which week to show) */
  currentDate: Date;
  /** Events to display */
  events: CalendarEventType[];
  /** First day of week: 0 = Sunday, 1 = Monday */
  weekStartsOn: 0 | 1;
  /** Selected event IDs */
  selectedEvents: Set<string>;
  /** Event being dragged */
  draggedEventId: string | null;
  /** Day click handler */
  onDayClick?: (date: Date, e: React.MouseEvent) => void;
  /** Day double-click handler (create event) */
  onDayDoubleClick?: (date: Date) => void;
  /** Event click handler */
  onEventClick?: (event: CalendarEventType, e: React.MouseEvent) => void;
  /** Event double-click handler */
  onEventDoubleClick?: (event: CalendarEventType) => void;
  /** Event drag start handler */
  onEventDragStart?: (event: CalendarEventType) => void;
  /** Event drop handler (reschedule) */
  onEventDrop?: (eventId: string, newDate: Date) => void;
}

// =============================================================================
// Constants
// =============================================================================

const HOUR_HEIGHT = 60; // pixels per hour

// =============================================================================
// Component
// =============================================================================

export function WeekView({
  currentDate,
  events,
  weekStartsOn,
  selectedEvents,
  draggedEventId,
  onDayClick,
  onDayDoubleClick,
  onEventClick,
  onEventDoubleClick,
  onEventDragStart,
  onEventDrop,
}: WeekViewProps): React.ReactElement {
  const [dragOverDate, setDragOverDate] = useState<Date | null>(null);

  // Generate week days
  const weekDays = useMemo(
    () => generateWeekDays(currentDate, weekStartsOn, events),
    [currentDate, weekStartsOn, events],
  );

  // Get day names
  const dayNames = useMemo(() => getDayNames(weekStartsOn, 'short'), [weekStartsOn]);

  // Get hours
  const hours = useMemo(() => getHoursInDay(), []);

  // Position events for each day
  const positionedEventsByDay = useMemo(() => {
    const result = new Map<string, PositionedEvent[]>();

    weekDays.forEach((day) => {
      const dayKey = startOfDay(day.date).toISOString();
      const dayEvents = day.events.filter((e) => !e.isMultiDay);
      const positioned = positionDayEvents(dayEvents, HOUR_HEIGHT);
      result.set(dayKey, positioned);
    });

    return result;
  }, [weekDays]);

  // Handle drag over
  const handleDragOver = useCallback(
    (date: Date) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverDate(date);
    },
    [],
  );

  // Handle drop
  const handleDrop = useCallback(
    (date: Date) => (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverDate(null);
      const eventId = e.dataTransfer.getData('text/plain');
      if (eventId && onEventDrop) {
        onEventDrop(eventId, date);
      }
    },
    [onEventDrop],
  );

  // Handle click
  const handleDayClick = useCallback(
    (date: Date) => (e: React.MouseEvent) => {
      onDayClick?.(date, e);
    },
    [onDayClick],
  );

  // Handle double click
  const handleDayDoubleClick = useCallback(
    (date: Date) => (e: React.MouseEvent) => {
      e.preventDefault();
      onDayDoubleClick?.(date);
    },
    [onDayDoubleClick],
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with day names and dates */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-ss-border bg-ss-surface-secondary">
        <div className="p-2 border-r border-ss-border" />
        {weekDays.map((day, index) => (
          <div key={index} className="p-2 text-center border-r border-ss-border">
            <div className="text-caption font-semibold text-ss-text-secondary uppercase">
              {dayNames[index]}
            </div>
            <div
              className={`text-subtitle font-medium text-ss-text mt-1 ${
                day.isToday
                  ? 'inline-flex items-center justify-center w-8 h-8 rounded-full bg-ss-primary text-ss-text-inverse'
                  : ''
              }`}
            >
              {day.date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Body with time slots */}
      <div className="flex flex-1 overflow-auto">
        {/* Time column */}
        <div className="w-[60px] shrink-0 border-r border-ss-border">
          {hours.map((hour) => (
            <div
              key={hour}
              className="h-[60px] px-2 text-hint text-ss-text-secondary text-right relative"
            >
              {hour > 0 && <span className="absolute -top-1.5 right-2">{formatHour(hour)}</span>}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="grid grid-cols-7 flex-1">
          {weekDays.map((day, dayIndex) => {
            const dayKey = startOfDay(day.date).toISOString();
            const positioned = positionedEventsByDay.get(dayKey) || [];
            const isDragOver = dragOverDate !== null && isSameDay(day.date, dragOverDate);

            return (
              <div
                key={dayIndex}
                className={`relative border-r border-ss-border min-w-[100px] ${
                  isDragOver ? 'bg-ss-primary-lighter' : ''
                }`}
                onClick={handleDayClick(day.date)}
                onDoubleClick={handleDayDoubleClick(day.date)}
                onDragOver={handleDragOver(day.date)}
                onDrop={handleDrop(day.date)}
              >
                {/* Hour slots */}
                {hours.map((hour) => (
                  <div key={hour} className="h-[60px] border-b border-ss-border" />
                ))}

                {/* Events overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  {positioned.map((event) => (
                    <div
                      key={event.rowId}
                      className="absolute pointer-events-auto px-0.5"
                      style={{
                        top: event.top,
                        left: `${event.left}%`,
                        width: `${event.width}%`,
                        height: event.height,
                      }}
                    >
                      <CalendarEvent
                        event={event}
                        isSelected={selectedEvents.has(event.rowId)}
                        isDragging={draggedEventId === event.rowId}
                        variant="full"
                        onClick={onEventClick}
                        onDoubleClick={onEventDoubleClick}
                        onDragStart={onEventDragStart}
                        style={{ height: '100%' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
