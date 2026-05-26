/**
 * Calendar Utilities - Kernel-Agnostic
 *
 * Date grid generation and event positioning utilities.
 */

import type { CalendarDay, CalendarEvent, PositionedEvent } from './types';

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

    // For multi-day/all-day events, add to each day
    if (event.allDay && event.endDate > event.startDate) {
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
// Event Positioning for Week/Day Views
// =============================================================================

/**
 * Get the hour as a decimal (e.g., 14:30 = 14.5).
 */
export function getDecimalHour(date: Date): number {
  return date.getHours() + date.getMinutes() / 60;
}

/**
 * Calculate pixel position for a time.
 * @param date - The date/time
 * @param hourHeight - Height of one hour slot in pixels
 */
export function getTimePosition(date: Date, hourHeight: number): number {
  return getDecimalHour(date) * hourHeight;
}

/**
 * Calculate event height based on duration.
 * @param startDate - Start time
 * @param endDate - End time
 * @param hourHeight - Height of one hour slot in pixels
 * @param minHeight - Minimum height in pixels
 */
export function getEventHeight(
  startDate: Date,
  endDate: Date,
  hourHeight: number,
  minHeight: number = 20,
): number {
  const startHour = getDecimalHour(startDate);
  const endHour = getDecimalHour(endDate);
  const duration = endHour - startHour;
  return Math.max(duration * hourHeight, minHeight);
}

/**
 * Check if two time ranges overlap.
 */
export function timeRangesOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
  return start1 < end2 && end1 > start2;
}

/**
 * Group events that overlap with each other.
 */
export function groupOverlappingEvents(events: CalendarEvent[]): CalendarEvent[][] {
  if (events.length === 0) return [];

  // Sort by start time
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const groups: CalendarEvent[][] = [];
  let currentGroup: CalendarEvent[] = [];
  let groupEnd: Date | null = null;

  for (const event of sorted) {
    if (groupEnd === null || event.startDate >= groupEnd) {
      // Start a new group
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentGroup = [event];
      groupEnd = event.endDate;
    } else {
      // Add to current group
      currentGroup.push(event);
      if (event.endDate > groupEnd) {
        groupEnd = event.endDate;
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Calculate positions for a group of overlapping events.
 *
 * Uses a column-based layout where overlapping events are placed
 * side by side in columns.
 */
export function positionOverlappingEvents(
  events: CalendarEvent[],
  hourHeight: number,
): PositionedEvent[] {
  if (events.length === 0) return [];

  // Sort by start time, then by duration (longer events first)
  const sorted = [...events].sort((a, b) => {
    const startDiff = a.startDate.getTime() - b.startDate.getTime();
    if (startDiff !== 0) return startDiff;
    // For same start time, put longer events first
    const durationA = a.endDate.getTime() - a.startDate.getTime();
    const durationB = b.endDate.getTime() - b.startDate.getTime();
    return durationB - durationA;
  });

  // Track which column each event is in
  const columns: Date[][] = []; // Each column tracks end times of events in that column
  const eventColumns = new Map<string, number>();

  for (const event of sorted) {
    // Find the first column where this event fits
    let column = 0;
    for (let i = 0; i < columns.length; i++) {
      const columnEndTimes = columns[i];
      const canFit = columnEndTimes.every((endTime) => event.startDate >= endTime);
      if (canFit) {
        column = i;
        break;
      }
      column = i + 1;
    }

    // Add to column
    if (!columns[column]) {
      columns[column] = [];
    }
    columns[column].push(event.endDate);
    eventColumns.set(event.id, column);
  }

  const totalColumns = columns.length;

  // Position events
  return sorted.map((event) => {
    const column = eventColumns.get(event.id) || 0;
    const width = 100 / totalColumns;
    const left = column * width;
    const top = getTimePosition(event.startDate, hourHeight);
    const height = getEventHeight(event.startDate, event.endDate, hourHeight);

    return {
      ...event,
      left,
      width,
      top,
      height,
      column,
      totalColumns,
    };
  });
}

/**
 * Position all events for a day view.
 */
export function positionDayEvents(events: CalendarEvent[], hourHeight: number): PositionedEvent[] {
  const groups = groupOverlappingEvents(events);
  return groups.flatMap((group) => positionOverlappingEvents(group, hourHeight));
}

// =============================================================================
// Contrast Color Utility
// =============================================================================

/**
 * Get contrasting text color (black or white) for a background color.
 */
export function getContrastColor(hexColor: string): string {
  // Remove # if present
  const hex = hexColor.replace('#', '');

  // Parse RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#ffffff';
}
