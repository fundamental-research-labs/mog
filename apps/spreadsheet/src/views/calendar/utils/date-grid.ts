/**
 * Date Grid Utilities
 *
 * Functions for generating month/week/day grids for the calendar view.
 */

import type { CalendarDay, CalendarEvent } from '../config';

// =============================================================================
// Date Helpers
// =============================================================================

/**
 * Check if two dates are the same day.
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if a date is today.
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Check if a date is in the given month.
 */
export function isInMonth(date: Date, month: number, year: number): boolean {
  return date.getMonth() === month && date.getFullYear() === year;
}

/**
 * Get the start of the day.
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the start of the week.
 */
export function startOfWeek(date: Date, weekStartsOn: 0 | 1 = 0): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the start of the month.
 */
export function startOfMonth(date: Date): Date {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Add days to a date.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format a date as a locale string.
 */
export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString(undefined, options);
}

/**
 * Format month and year.
 */
export function formatMonthYear(date: Date): string {
  return formatDate(date, { month: 'long', year: 'numeric' });
}

/**
 * Get the day names for the week.
 */
export function getDayNames(
  weekStartsOn: 0 | 1 = 0,
  format: 'short' | 'narrow' | 'long' = 'short',
): string[] {
  const days = [];
  const date = new Date(2024, 0, 7 + weekStartsOn); // Jan 7, 2024 is a Sunday

  for (let i = 0; i < 7; i++) {
    days.push(formatDate(addDays(date, i), { weekday: format }));
  }

  return days;
}

// =============================================================================
// Month Grid Generation
// =============================================================================

/**
 * Generate a month grid for the given date.
 *
 * Returns a 2D array of CalendarDay objects representing the month view.
 * The grid always has 6 rows (weeks) to maintain consistent height.
 *
 * @param date - A date in the month to display
 * @param weekStartsOn - 0 for Sunday, 1 for Monday
 * @param events - Events to place on the calendar
 */
export function generateMonthGrid(
  date: Date,
  weekStartsOn: 0 | 1 = 0,
  events: CalendarEvent[] = [],
): CalendarDay[][] {
  const month = date.getMonth();
  const year = date.getFullYear();

  // Find the first day to display (may be in previous month)
  const firstOfMonth = startOfMonth(date);
  const startDate = startOfWeek(firstOfMonth, weekStartsOn);

  // Create a map of events by date for quick lookup
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const dateKey = startOfDay(event.startDate).toISOString();
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey)!.push(event);

    // For multi-day events, add to each day
    if (event.isMultiDay) {
      let currentDate = addDays(event.startDate, 1);
      while (currentDate <= event.endDate) {
        const key = startOfDay(currentDate).toISOString();
        if (!eventsByDate.has(key)) {
          eventsByDate.set(key, []);
        }
        eventsByDate.get(key)!.push(event);
        currentDate = addDays(currentDate, 1);
      }
    }
  });

  // Generate 6 weeks
  const grid: CalendarDay[][] = [];
  let currentDate = startDate;

  for (let week = 0; week < 6; week++) {
    const weekDays: CalendarDay[] = [];

    for (let day = 0; day < 7; day++) {
      const dateKey = startOfDay(currentDate).toISOString();
      const dayEvents = eventsByDate.get(dateKey) || [];

      weekDays.push({
        date: new Date(currentDate),
        isCurrentMonth: isInMonth(currentDate, month, year),
        isToday: isToday(currentDate),
        events: dayEvents,
      });

      currentDate = addDays(currentDate, 1);
    }

    grid.push(weekDays);
  }

  return grid;
}

// =============================================================================
// Week Grid Generation
// =============================================================================

/**
 * Generate a week grid for the given date.
 *
 * @param date - A date in the week to display
 * @param weekStartsOn - 0 for Sunday, 1 for Monday
 * @param events - Events to place on the calendar
 */
export function generateWeekDays(
  date: Date,
  weekStartsOn: 0 | 1 = 0,
  events: CalendarEvent[] = [],
): CalendarDay[] {
  const startDate = startOfWeek(date, weekStartsOn);

  // Create a map of events by date
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach((event) => {
    const dateKey = startOfDay(event.startDate).toISOString();
    if (!eventsByDate.has(dateKey)) {
      eventsByDate.set(dateKey, []);
    }
    eventsByDate.get(dateKey)!.push(event);
  });

  const days: CalendarDay[] = [];
  let currentDate = startDate;

  for (let day = 0; day < 7; day++) {
    const dateKey = startOfDay(currentDate).toISOString();
    const dayEvents = eventsByDate.get(dateKey) || [];

    days.push({
      date: new Date(currentDate),
      isCurrentMonth: true, // Week view doesn't show "other month" styling
      isToday: isToday(currentDate),
      events: dayEvents,
    });

    currentDate = addDays(currentDate, 1);
  }

  return days;
}

// =============================================================================
// Day View Helpers
// =============================================================================

/**
 * Get hours for day view (0-23).
 */
export function getHoursInDay(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

/**
 * Format an hour for display.
 */
export function formatHour(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', hour12: true });
}

/**
 * Get the week range string (e.g., "Jan 1 - Jan 7, 2024").
 */
export function getWeekRangeString(date: Date, weekStartsOn: 0 | 1 = 0): string {
  const start = startOfWeek(date, weekStartsOn);
  const end = addDays(start, 6);

  const startStr = formatDate(start, { month: 'short', day: 'numeric' });
  const endStr = formatDate(end, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${startStr} - ${endStr}`;
}
