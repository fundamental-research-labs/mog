/**
 * DayView Component
 *
 * Renders a single day view with hourly time slots.
 * Events are positioned based on their time with overlapping support.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { CalendarEvent as CalendarEventType } from '../config';
import { formatDate, formatHour, getHoursInDay, startOfDay } from '../utils/date-grid';
import { positionDayEvents } from '../utils/event-positioning';
import { CalendarEvent } from './CalendarEvent';

// =============================================================================
// Types
// =============================================================================

interface DayViewProps {
  /** Current date to display */
  currentDate: Date;
  /** Events to display */
  events: CalendarEventType[];
  /** Selected event IDs */
  selectedEvents: Set<string>;
  /** Event being dragged */
  draggedEventId: string | null;
  /** Time slot click handler */
  onTimeSlotClick?: (date: Date, hour: number, e: React.MouseEvent) => void;
  /** Time slot double-click handler (create event) */
  onTimeSlotDoubleClick?: (date: Date, hour: number) => void;
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

export function DayView({
  currentDate,
  events,
  selectedEvents,
  draggedEventId,
  onTimeSlotClick,
  onTimeSlotDoubleClick,
  onEventClick,
  onEventDoubleClick,
  onEventDragStart,
  onEventDrop,
}: DayViewProps): React.ReactElement {
  const [isDragOver, setIsDragOver] = useState(false);

  // Get hours
  const hours = useMemo(() => getHoursInDay(), []);

  // Filter events for this day
  const dayEvents = useMemo(() => {
    const dayStart = startOfDay(currentDate);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return events.filter((event) => {
      return event.startDate >= dayStart && event.startDate < dayEnd;
    });
  }, [currentDate, events]);

  // Position events
  const positionedEvents = useMemo(
    () =>
      positionDayEvents(
        dayEvents.filter((e) => !e.isMultiDay),
        HOUR_HEIGHT,
      ),
    [dayEvents],
  );

  // Check if current date is today
  const isToday = useMemo(() => {
    const today = new Date();
    return (
      currentDate.getFullYear() === today.getFullYear() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getDate() === today.getDate()
    );
  }, [currentDate]);

  // Calculate current time line position
  const currentTimePosition = useMemo(() => {
    if (!isToday) return null;

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return (hours + minutes / 60) * HOUR_HEIGHT;
  }, [isToday]);

  // Handle time slot click
  const handleTimeSlotClick = useCallback(
    (hour: number) => (e: React.MouseEvent) => {
      onTimeSlotClick?.(currentDate, hour, e);
    },
    [currentDate, onTimeSlotClick],
  );

  // Handle time slot double click
  const handleTimeSlotDoubleClick = useCallback(
    (hour: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      onTimeSlotDoubleClick?.(currentDate, hour);
    },
    [currentDate, onTimeSlotDoubleClick],
  );

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const eventId = e.dataTransfer.getData('text/plain');
      if (eventId && onEventDrop) {
        onEventDrop(eventId, currentDate);
      }
    },
    [currentDate, onEventDrop],
  );

  // Format day name and date
  const dayName = formatDate(currentDate, { weekday: 'long' });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex px-4 py-3 border-b border-ss-border bg-ss-surface-secondary">
        <div className="w-[60px] shrink-0" />
        <div className="flex-1 text-center">
          <div className="text-caption font-semibold text-ss-text-secondary uppercase">
            {dayName}
          </div>
          <div
            className={`text-subtitle font-medium text-ss-text mt-1 ${
              isToday
                ? 'inline-flex items-center justify-center w-10 h-10 rounded-full bg-ss-primary text-ss-text-inverse'
                : ''
            }`}
          >
            {currentDate.getDate()}
          </div>
        </div>
      </div>

      {/* Body */}
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

        {/* Day column */}
        <div
          className={`relative flex-1 min-w-[200px] ${isDragOver ? 'bg-ss-primary-lighter' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Hour slots */}
          {hours.map((hour) => (
            <div
              key={hour}
              className="h-[60px] border-b border-ss-border cursor-pointer transition-colors duration-ss hover:bg-ss-surface-hover"
              onClick={handleTimeSlotClick(hour)}
              onDoubleClick={handleTimeSlotDoubleClick(hour)}
            />
          ))}

          {/* Current time line */}
          {currentTimePosition !== null && (
            <div
              className="absolute left-0 right-0 h-0.5 bg-ss-error z-ss-sticky"
              style={{ top: currentTimePosition }}
            >
              <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-ss-error" />
            </div>
          )}

          {/* Events overlay */}
          <div className="absolute inset-0 pointer-events-none">
            {positionedEvents.map((event) => (
              <div
                key={event.rowId}
                className="absolute pointer-events-auto px-1"
                style={{
                  top: event.top,
                  left: `calc(${event.left}% + 4px)`,
                  width: `calc(${event.width}% - 8px)`,
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
      </div>
    </div>
  );
}
