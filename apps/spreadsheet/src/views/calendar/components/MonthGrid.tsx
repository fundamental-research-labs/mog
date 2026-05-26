/**
 * MonthGrid Component
 *
 * Renders a month view with a 7-column x 6-row grid.
 * Shows day headers and day cells with events.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { CalendarEvent as CalendarEventType } from '../config';
import { generateMonthGrid, getDayNames } from '../utils/date-grid';
import { DayCell } from './DayCell';

// =============================================================================
// Types
// =============================================================================

interface MonthGridProps {
  /** Current date (determines which month to show) */
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
// Styles - Using Tailwind classes with design tokens
// =============================================================================

// =============================================================================
// Component
// =============================================================================

export function MonthGrid({
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
            selectedEvents={selectedEvents}
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
