/**
 * Calendar Component - Kernel-Agnostic
 *
 * Main calendar view component that:
 * - Switches between month/week/day views
 * - Manages navigation and interactions
 * - Handles event selection and drag-and-drop
 *
 * This is a controlled component - all state is managed by the parent.
 */

import React, { useCallback, useMemo } from 'react';
import { CalendarHeader } from './CalendarHeader';
import { DayView } from './DayView';
import { MonthGrid } from './MonthGrid';
import type { CalendarEvent, CalendarProps } from './types';
import { startOfWeek } from './utils';
import { WeekView } from './WeekView';

// =============================================================================
// Component
// =============================================================================

export function Calendar({
  events,
  state,
  weekStartsOn = 0,
  onEventClick,
  onEventDoubleClick,
  onCreateEvent,
  onEventDrop,
  onNavigate,
  onViewModeChange,
  onSelectionChange,
}: CalendarProps): React.ReactElement {
  // Track dragged event
  const [draggedEventId, setDraggedEventId] = React.useState<string | null>(null);

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    onNavigate?.('prev');
  }, [onNavigate]);

  const handleNext = useCallback(() => {
    onNavigate?.('next');
  }, [onNavigate]);

  const handleToday = useCallback(() => {
    onNavigate?.('today');
  }, [onNavigate]);

  const handleViewModeChange = useCallback(
    (mode: 'month' | 'week' | 'day') => {
      onViewModeChange?.(mode);
    },
    [onViewModeChange],
  );

  // Event handlers
  const handleEventClick = useCallback(
    (event: CalendarEvent, e: React.MouseEvent) => {
      // Update selection
      if (onSelectionChange) {
        const newSelected = new Set(state.selectedEventIds);
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          if (newSelected.has(event.id)) {
            newSelected.delete(event.id);
          } else {
            newSelected.add(event.id);
          }
        } else {
          newSelected.clear();
          newSelected.add(event.id);
        }
        onSelectionChange(newSelected);
      }

      onEventClick?.(event.id, e.shiftKey, e.ctrlKey || e.metaKey);
    },
    [state.selectedEventIds, onSelectionChange, onEventClick],
  );

  const handleEventDoubleClick = useCallback(
    (event: CalendarEvent) => {
      onEventDoubleClick?.(event.id);
    },
    [onEventDoubleClick],
  );

  const handleDayClick = useCallback(
    (_date: Date, e: React.MouseEvent) => {
      // Clear selection on clicking empty space (unless shift/ctrl held)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        onSelectionChange?.(new Set());
      }
    },
    [onSelectionChange],
  );

  const handleDayDoubleClick = useCallback(
    (date: Date) => {
      onCreateEvent?.(date);
    },
    [onCreateEvent],
  );

  const handleEventDragStart = useCallback((event: CalendarEvent) => {
    setDraggedEventId(event.id);
  }, []);

  const handleEventDrop = useCallback(
    (eventId: string, newDate: Date) => {
      setDraggedEventId(null);
      onEventDrop?.(eventId, newDate);
    },
    [onEventDrop],
  );

  // Calculate if showing today
  const isShowingToday = useMemo(() => {
    const today = new Date();
    const current = state.currentDate;

    switch (state.viewMode) {
      case 'month':
        return (
          today.getMonth() === current.getMonth() && today.getFullYear() === current.getFullYear()
        );
      case 'week': {
        const weekStart = startOfWeek(current, weekStartsOn);
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
  }, [state.viewMode, state.currentDate, weekStartsOn]);

  // Format title
  const title = useMemo(() => {
    const current = state.currentDate;

    switch (state.viewMode) {
      case 'month':
        return current.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        });
      case 'week': {
        const weekStart = startOfWeek(current, weekStartsOn);
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
  }, [state.viewMode, state.currentDate, weekStartsOn]);

  // Render the appropriate view
  const renderView = () => {
    const commonProps = {
      currentDate: state.currentDate,
      events,
      selectedEventIds: state.selectedEventIds,
      draggedEventId,
      onEventClick: handleEventClick,
      onEventDoubleClick: handleEventDoubleClick,
      onEventDragStart: handleEventDragStart,
      onEventDrop: handleEventDrop,
    };

    switch (state.viewMode) {
      case 'month':
        return (
          <MonthGrid
            {...commonProps}
            weekStartsOn={weekStartsOn}
            onDayClick={handleDayClick}
            onDayDoubleClick={handleDayDoubleClick}
          />
        );
      case 'week':
        return (
          <WeekView
            {...commonProps}
            weekStartsOn={weekStartsOn}
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
        viewMode={state.viewMode}
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
