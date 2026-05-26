/**
 * DayView Component - Kernel-Agnostic
 *
 * Renders a single day view with hourly time slots.
 * Events are positioned based on their time with overlapping support.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { CalendarEvent as CalendarEventComponent } from './CalendarEvent';
import type { CalendarEvent } from './types';
import { formatDate, formatHour, getHoursInDay, positionDayEvents, startOfDay } from './utils';

// =============================================================================
// Types
// =============================================================================

interface DayViewProps {
  /** Current date to display */
  currentDate: Date;
  /** Events to display */
  events: CalendarEvent[];
  /** Selected event IDs */
  selectedEventIds: Set<string>;
  /** Event being dragged */
  draggedEventId: string | null;
  /** Time slot click handler */
  onTimeSlotClick?: (date: Date, hour: number, e: React.MouseEvent) => void;
  /** Time slot double-click handler (create event) */
  onTimeSlotDoubleClick?: (date: Date, hour: number) => void;
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
    display: 'flex',
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  timeHeaderSpacer: {
    width: '60px',
    flexShrink: 0,
  },
  dayHeader: {
    flex: 1,
    textAlign: 'center' as const,
  },
  dayName: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  dayDate: {
    fontSize: '24px',
    fontWeight: 500,
    color: '#111827',
    marginTop: '4px',
  },
  dayDateToday: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
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
  dayColumn: {
    position: 'relative' as const,
    flex: 1,
    minWidth: '200px',
  },
  hourSlot: {
    height: HOUR_HEIGHT,
    borderBottom: '1px solid #e5e7eb',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
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
    padding: '0 4px',
  },
  dragOver: {
    backgroundColor: '#dbeafe',
  },
  currentTimeLine: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: '2px',
    backgroundColor: '#ef4444',
    zIndex: 10,
  },
  currentTimeIndicator: {
    position: 'absolute' as const,
    left: '-4px',
    top: '-3px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#ef4444',
  },
};

// =============================================================================
// Component
// =============================================================================

export function DayView({
  currentDate,
  events,
  selectedEventIds,
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
        dayEvents.filter((e) => !e.allDay),
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
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.timeHeaderSpacer} />
        <div style={styles.dayHeader}>
          <div style={styles.dayName}>{dayName}</div>
          <div
            style={{
              ...styles.dayDate,
              ...(isToday ? styles.dayDateToday : {}),
            }}
          >
            {currentDate.getDate()}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Time column */}
        <div style={styles.timeColumn}>
          {hours.map((hour) => (
            <div key={hour} style={styles.timeCell}>
              {hour > 0 && <span style={styles.timeLabel}>{formatHour(hour)}</span>}
            </div>
          ))}
        </div>

        {/* Day column */}
        <div
          style={{
            ...styles.dayColumn,
            ...(isDragOver ? styles.dragOver : {}),
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Hour slots */}
          {hours.map((hour) => (
            <div
              key={hour}
              style={styles.hourSlot}
              onClick={handleTimeSlotClick(hour)}
              onDoubleClick={handleTimeSlotDoubleClick(hour)}
            />
          ))}

          {/* Current time line */}
          {currentTimePosition !== null && (
            <div style={{ ...styles.currentTimeLine, top: currentTimePosition }}>
              <div style={styles.currentTimeIndicator} />
            </div>
          )}

          {/* Events overlay */}
          <div style={styles.eventsContainer}>
            {positionedEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  ...styles.eventWrapper,
                  top: event.top,
                  left: `calc(${event.left}% + 4px)`,
                  width: `calc(${event.width}% - 8px)`,
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
      </div>
    </div>
  );
}
