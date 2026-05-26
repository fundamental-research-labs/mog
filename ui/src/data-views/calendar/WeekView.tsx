/**
 * WeekView Component - Kernel-Agnostic
 *
 * Renders a week view with 7 columns, each showing time slots.
 * Events are positioned based on their time.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CalendarEvent as CalendarEventComponent } from './CalendarEvent';
import type { CalendarEvent } from './types';
import {
  formatHour,
  generateWeekDays,
  getDayNames,
  getHoursInDay,
  isSameDay,
  positionDayEvents,
  startOfDay,
} from './utils';

// =============================================================================
// Types
// =============================================================================

interface WeekViewProps {
  /** Current date (determines which week to show) */
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

const HOUR_HEIGHT = 60; // pixels per hour

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'grid',
    gridTemplateColumns: '60px repeat(7, 1fr)',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  timeHeaderCell: {
    padding: '8px',
    borderRight: '1px solid #e5e7eb',
  },
  dayHeader: {
    padding: '8px',
    textAlign: 'center' as const,
    borderRight: '1px solid #e5e7eb',
  },
  dayName: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  dayDate: {
    fontSize: '20px',
    fontWeight: 500,
    color: '#111827',
    marginTop: '4px',
  },
  dayDateToday: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'auto',
  },
  timeColumn: {
    width: '60px',
    flexShrink: 0,
    borderRight: '1px solid #e5e7eb',
  },
  timeCell: {
    height: HOUR_HEIGHT,
    padding: '0 8px',
    fontSize: '11px',
    color: '#6b7280',
    textAlign: 'right' as const,
    position: 'relative' as const,
  },
  timeLabel: {
    position: 'absolute' as const,
    top: '-6px',
    right: '8px',
  },
  daysContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    flex: 1,
  },
  dayColumn: {
    position: 'relative' as const,
    borderRight: '1px solid #e5e7eb',
    minWidth: '100px',
  },
  hourSlot: {
    height: HOUR_HEIGHT,
    borderBottom: '1px solid #e5e7eb',
  },
  eventsContainer: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
  },
  eventWrapper: {
    position: 'absolute' as const,
    pointerEvents: 'auto' as const,
    padding: '0 2px',
  },
  dragOver: {
    backgroundColor: '#dbeafe',
  },
};

// =============================================================================
// Component
// =============================================================================

export function WeekView({
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
    const result = new Map<string, ReturnType<typeof positionDayEvents>>();

    weekDays.forEach((day) => {
      const dayKey = startOfDay(day.date).toISOString();
      const dayEvents = day.events.filter((e) => !e.allDay);
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
    <div style={styles.container}>
      {/* Header with day names and dates */}
      <div style={styles.header}>
        <div style={styles.timeHeaderCell} />
        {weekDays.map((day, index) => (
          <div key={index} style={styles.dayHeader}>
            <div style={styles.dayName}>{dayNames[index]}</div>
            <div
              style={{
                ...styles.dayDate,
                ...(day.isToday ? styles.dayDateToday : {}),
              }}
            >
              {day.date.getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* Body with time slots */}
      <div style={styles.body}>
        {/* Time column */}
        <div style={styles.timeColumn}>
          {hours.map((hour) => (
            <div key={hour} style={styles.timeCell}>
              {hour > 0 && <span style={styles.timeLabel}>{formatHour(hour)}</span>}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div style={styles.daysContainer}>
          {weekDays.map((day, dayIndex) => {
            const dayKey = startOfDay(day.date).toISOString();
            const positioned = positionedEventsByDay.get(dayKey) || [];
            const isDragOver = dragOverDate !== null && isSameDay(day.date, dragOverDate);

            return (
              <div
                key={dayIndex}
                style={{
                  ...styles.dayColumn,
                  ...(isDragOver ? styles.dragOver : {}),
                }}
                onClick={handleDayClick(day.date)}
                onDoubleClick={handleDayDoubleClick(day.date)}
                onDragOver={handleDragOver(day.date)}
                onDrop={handleDrop(day.date)}
              >
                {/* Hour slots */}
                {hours.map((hour) => (
                  <div key={hour} style={styles.hourSlot} />
                ))}

                {/* Events overlay */}
                <div style={styles.eventsContainer}>
                  {positioned.map((event) => (
                    <div
                      key={event.id}
                      style={{
                        ...styles.eventWrapper,
                        top: event.top,
                        left: `${event.left}%`,
                        width: `${event.width}%`,
                        height: event.height,
                      }}
                    >
                      <CalendarEventComponent
                        event={event}
                        isSelected={selectedEventIds.has(event.id)}
                        isDragging={draggedEventId === event.id}
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
