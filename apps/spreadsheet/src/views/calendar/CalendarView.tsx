/**
 * CalendarView Component
 *
 * Main calendar view component that:
 * - Switches between month/week/day views
 * - Manages navigation state
 * - Handles event interactions
 */

import { useMachine } from '@xstate/react';
import React, { useCallback, useMemo } from 'react';
import { CalendarHeader, DayView, MonthGrid, WeekView } from './components';
import type {
  CalendarEvent as CalendarEventType,
  CalendarRuntimeConfig,
  CalendarViewMode,
} from './config';
import { calendarMachine, initialCalendarContext } from './machines';

// =============================================================================
// Types
// =============================================================================

interface CalendarViewProps {
  /** Calendar configuration (extended runtime config) */
  config: CalendarRuntimeConfig;
  /** Events to display */
  events: CalendarEventType[];
  /** Initial view mode (defaults to 'month') */
  initialViewMode?: CalendarViewMode;
  /** First day of week: 0 = Sunday, 1 = Monday (defaults to 0) */
  weekStartsOn?: 0 | 1;
  /** Called when an event is clicked */
  onEventClick?: (rowId: string, shiftKey: boolean, ctrlKey: boolean) => void;
  /** Called when an event is double-clicked (open detail) */
  onEventDoubleClick?: (rowId: string) => void;
  /** Called when a day/time is double-clicked (create event) */
  onCreateEvent?: (date: Date) => void;
  /** Called when an event is dropped on a new date (reschedule) */
  onRescheduleEvent?: (rowId: string, newDate: Date) => void;
  /** External selection state (for adapter integration) */
  selectedEvents?: Set<string>;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

// =============================================================================
// Component
// =============================================================================

export function CalendarView({
  config,
  events,
  initialViewMode = 'month',
  weekStartsOn = 0,
  onEventClick,
  onEventDoubleClick,
  onCreateEvent,
  onRescheduleEvent,
  selectedEvents: externalSelectedEvents,
  onSelectionChange,
}: CalendarViewProps): React.ReactElement {
  // Use config weekStartsOn if provided, otherwise use prop
  const effectiveWeekStartsOn = config.weekStartsOn ?? weekStartsOn;

  // Derive initial view mode from config's calendarMode if available
  const effectiveInitialViewMode: CalendarViewMode = config.calendarMode ?? initialViewMode;

  // Initialize machine with config defaults
  const [state, send] = useMachine(calendarMachine, {
    input: {
      ...initialCalendarContext,
      viewMode: effectiveInitialViewMode,
    },
  });

  // Use external selection if provided, otherwise use internal
  const selectedEvents = externalSelectedEvents ?? state.context.selectedEvents;

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    send({ type: 'NAVIGATE_PREV' });
  }, [send]);

  const handleNext = useCallback(() => {
    send({ type: 'NAVIGATE_NEXT' });
  }, [send]);

  const handleToday = useCallback(() => {
    send({ type: 'NAVIGATE_TODAY' });
  }, [send]);

  const handleViewModeChange = useCallback(
    (mode: 'month' | 'week' | 'day') => {
      send({ type: 'CHANGE_VIEW_MODE', mode });
    },
    [send],
  );

  // Event handlers
  const handleEventClick = useCallback(
    (event: CalendarEventType, e: React.MouseEvent) => {
      send({
        type: 'EVENT_CLICK',
        rowId: event.rowId,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey || e.metaKey,
      });

      // Update external selection if callback provided
      if (onSelectionChange) {
        const newSelected = new Set(selectedEvents);
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (newSelected.has(event.rowId)) {
            newSelected.delete(event.rowId);
          } else {
            newSelected.add(event.rowId);
          }
        } else {
          newSelected.clear();
          newSelected.add(event.rowId);
        }
        onSelectionChange(newSelected);
      }

      onEventClick?.(event.rowId, e.shiftKey, e.ctrlKey || e.metaKey);
    },
    [send, selectedEvents, onSelectionChange, onEventClick],
  );

  const handleEventDoubleClick = useCallback(
    (event: CalendarEventType) => {
      onEventDoubleClick?.(event.rowId);
    },
    [onEventDoubleClick],
  );

  const handleDayClick = useCallback(
    (_date: Date, e: React.MouseEvent) => {
      // Clear selection on clicking empty space (unless shift/ctrl held)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        send({ type: 'CLEAR_SELECTION' });
        onSelectionChange?.(new Set());
      }
    },
    [send, onSelectionChange],
  );

  const handleDayDoubleClick = useCallback(
    (date: Date) => {
      onCreateEvent?.(date);
    },
    [onCreateEvent],
  );

  const handleEventDragStart = useCallback(
    (event: CalendarEventType) => {
      send({ type: 'DRAG_START', rowId: event.rowId });
    },
    [send],
  );

  const handleEventDrop = useCallback(
    (eventId: string, newDate: Date) => {
      send({ type: 'DRAG_END' });
      onRescheduleEvent?.(eventId, newDate);
    },
    [send, onRescheduleEvent],
  );

  // Calculate if showing today
  const isShowingToday = useMemo(() => {
    const today = new Date();
    const current = state.context.currentDate;

    switch (state.context.viewMode) {
      case 'month':
        return (
          today.getMonth() === current.getMonth() && today.getFullYear() === current.getFullYear()
        );
      case 'week': {
        const weekStart = new Date(current);
        weekStart.setDate(
          weekStart.getDate() - weekStart.getDay() + (effectiveWeekStartsOn === 1 ? 1 : 0),
        );
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        return today >= weekStart && today < weekEnd;
      }
      case 'day':
        return (
          today.getDate() === current.getDate() &&
          today.getMonth() === current.getMonth() &&
          today.getFullYear() === current.getFullYear()
        );
    }
  }, [state.context.viewMode, state.context.currentDate, effectiveWeekStartsOn]);

  // Format title
  const title = useMemo(() => {
    const current = state.context.currentDate;

    switch (state.context.viewMode) {
      case 'month':
        return current.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        });
      case 'week': {
        const weekStart = new Date(current);
        weekStart.setDate(
          weekStart.getDate() - weekStart.getDay() + (effectiveWeekStartsOn === 1 ? 1 : 0),
        );
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const startStr = weekStart.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        const endStr = weekEnd.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        return `${startStr} - ${endStr}`;
      }
      case 'day':
        return current.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
    }
  }, [state.context.viewMode, state.context.currentDate, effectiveWeekStartsOn]);

  // Render the appropriate view
  const renderView = () => {
    const commonProps = {
      currentDate: state.context.currentDate,
      events,
      selectedEvents,
      draggedEventId: state.context.draggedEvent,
      onEventClick: handleEventClick,
      onEventDoubleClick: handleEventDoubleClick,
      onEventDragStart: handleEventDragStart,
      onEventDrop: handleEventDrop,
    };

    switch (state.context.viewMode) {
      case 'month':
        return (
          <MonthGrid
            {...commonProps}
            weekStartsOn={effectiveWeekStartsOn}
            onDayClick={handleDayClick}
            onDayDoubleClick={handleDayDoubleClick}
          />
        );
      case 'week':
        return (
          <WeekView
            {...commonProps}
            weekStartsOn={effectiveWeekStartsOn}
            onDayClick={handleDayClick}
            onDayDoubleClick={handleDayDoubleClick}
          />
        );
      case 'day':
        return (
          <DayView
            {...commonProps}
            onTimeSlotClick={(date, _hour, e) => handleDayClick(date, e)}
            onTimeSlotDoubleClick={(date, _hour) => handleDayDoubleClick(date)}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-ss-surface border border-ss-border rounded-ss-md overflow-hidden">
      <CalendarHeader
        title={title}
        viewMode={state.context.viewMode}
        isShowingToday={isShowingToday}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
        onViewModeChange={handleViewModeChange}
      />
      <div className="flex-1 overflow-hidden">{renderView()}</div>
    </div>
  );
}
