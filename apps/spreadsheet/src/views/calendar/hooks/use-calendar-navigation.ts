/**
 * useCalendarNavigation Hook
 *
 * Manages calendar navigation state including current date and view mode.
 * Provides functions for navigating between periods.
 */

import { useCallback, useMemo, useState } from 'react';
import type { CalendarViewMode } from '../config';
import {
  addDays,
  formatDate,
  formatMonthYear,
  getWeekRangeString,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../utils/date-grid';

// =============================================================================
// Types
// =============================================================================

interface UseCalendarNavigationOptions {
  /** Initial date */
  initialDate?: Date;
  /** Initial view mode */
  initialMode?: CalendarViewMode;
  /** First day of week: 0 = Sunday, 1 = Monday */
  weekStartsOn?: 0 | 1;
}

interface UseCalendarNavigationResult {
  /** Current reference date */
  currentDate: Date;
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Navigate to previous period */
  navigatePrev: () => void;
  /** Navigate to next period */
  navigateNext: () => void;
  /** Navigate to today */
  navigateToday: () => void;
  /** Change view mode */
  setViewMode: (mode: CalendarViewMode) => void;
  /** Navigate to a specific date */
  navigateToDate: (date: Date) => void;
  /** Formatted title for current view (e.g., "January 2024") */
  title: string;
  /** Is current period showing today? */
  isShowingToday: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useCalendarNavigation({
  initialDate = new Date(),
  initialMode = 'month',
  weekStartsOn = 0,
}: UseCalendarNavigationOptions = {}): UseCalendarNavigationResult {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialMode);

  // Navigate to previous period
  const navigatePrev = useCallback(() => {
    setCurrentDate((date) => {
      const newDate = new Date(date);

      switch (viewMode) {
        case 'month':
          newDate.setMonth(newDate.getMonth() - 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() - 7);
          break;
        case 'day':
          newDate.setDate(newDate.getDate() - 1);
          break;
      }

      return newDate;
    });
  }, [viewMode]);

  // Navigate to next period
  const navigateNext = useCallback(() => {
    setCurrentDate((date) => {
      const newDate = new Date(date);

      switch (viewMode) {
        case 'month':
          newDate.setMonth(newDate.getMonth() + 1);
          break;
        case 'week':
          newDate.setDate(newDate.getDate() + 7);
          break;
        case 'day':
          newDate.setDate(newDate.getDate() + 1);
          break;
      }

      return newDate;
    });
  }, [viewMode]);

  // Navigate to today
  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Navigate to a specific date
  const navigateToDate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  // Calculate title
  const title = useMemo(() => {
    switch (viewMode) {
      case 'month':
        return formatMonthYear(currentDate);
      case 'week':
        return getWeekRangeString(currentDate, weekStartsOn);
      case 'day':
        return formatDate(currentDate, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
    }
  }, [currentDate, viewMode, weekStartsOn]);

  // Check if showing today
  const isShowingToday = useMemo(() => {
    const today = new Date();

    switch (viewMode) {
      case 'month': {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        return today >= monthStart && today < monthEnd;
      }
      case 'week': {
        const weekStart = startOfWeek(currentDate, weekStartsOn);
        const weekEnd = addDays(weekStart, 7);
        return today >= weekStart && today < weekEnd;
      }
      case 'day': {
        const dayStart = startOfDay(currentDate);
        const dayEnd = addDays(dayStart, 1);
        return today >= dayStart && today < dayEnd;
      }
    }
  }, [currentDate, viewMode, weekStartsOn]);

  return {
    currentDate,
    viewMode,
    navigatePrev,
    navigateNext,
    navigateToday,
    setViewMode,
    navigateToDate,
    title,
    isShowingToday,
  };
}
