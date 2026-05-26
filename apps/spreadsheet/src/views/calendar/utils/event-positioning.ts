/**
 * Event Positioning Utilities
 *
 * Functions for calculating event positions in week/day views
 * where events have time components and may overlap.
 */

import type { CalendarEvent } from '../config';

// =============================================================================
// Types
// =============================================================================

/**
 * Positioned event for rendering in week/day views.
 */
export interface PositionedEvent extends CalendarEvent {
  /** Left position as percentage (0-100) */
  left: number;
  /** Width as percentage (0-100) */
  width: number;
  /** Top position in pixels (relative to time grid) */
  top: number;
  /** Height in pixels */
  height: number;
  /** Column index for overlapping events */
  column: number;
  /** Total columns for this overlap group */
  totalColumns: number;
}

// =============================================================================
// Time Helpers
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

// =============================================================================
// Overlap Detection
// =============================================================================

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

// =============================================================================
// Event Positioning
// =============================================================================

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
    eventColumns.set(event.rowId, column);
  }

  const totalColumns = columns.length;

  // Position events
  return sorted.map((event) => {
    const column = eventColumns.get(event.rowId) || 0;
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

/**
 * Position events for all-day or multi-day display at the top of week view.
 */
export function positionAllDayEvents(
  events: CalendarEvent[],
  startDate: Date,
  _daysCount: number = 7,
): (CalendarEvent & { startColumn: number; span: number })[] {
  return events
    .filter((e) => e.isMultiDay)
    .map((event) => {
      // Calculate which column this event starts in
      const eventStart = new Date(event.startDate);
      eventStart.setHours(0, 0, 0, 0);

      const gridStart = new Date(startDate);
      gridStart.setHours(0, 0, 0, 0);

      const startColumn = Math.max(
        0,
        Math.floor((eventStart.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)),
      );

      // Calculate span
      const eventEnd = new Date(event.endDate);
      eventEnd.setHours(0, 0, 0, 0);

      const daysFromStart = Math.floor(
        (eventEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000),
      );
      const span = Math.min(7, daysFromStart + 1) - startColumn;

      return {
        ...event,
        startColumn,
        span: Math.max(1, span),
      };
    });
}
