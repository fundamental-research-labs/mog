/**
 * Date Utilities for Timeline View
 *
 * Provides date calculations and scale conversions for the timeline.
 */

import type { TimelineScale } from '../config';
import { getPixelsPerUnit, getUnitDuration } from '../config';

/**
 * Convert a date to pixels from the timeline start.
 */
export function dateToPixels(date: Date, timelineStart: Date, scale: TimelineScale): number {
  const diffMs = date.getTime() - timelineStart.getTime();
  const unitDuration = getUnitDuration(scale);
  const pixelsPerUnit = getPixelsPerUnit(scale);
  return (diffMs / unitDuration) * pixelsPerUnit;
}

/**
 * Convert pixels to a date offset from the timeline start.
 */
export function pixelsToDate(pixels: number, timelineStart: Date, scale: TimelineScale): Date {
  const unitDuration = getUnitDuration(scale);
  const pixelsPerUnit = getPixelsPerUnit(scale);
  const offsetMs = (pixels / pixelsPerUnit) * unitDuration;
  return new Date(timelineStart.getTime() + offsetMs);
}

/**
 * Snap a date to the nearest unit boundary.
 */
export function snapToUnit(date: Date, scale: TimelineScale): Date {
  const d = new Date(date);

  switch (scale) {
    case 'day':
      d.setHours(0, 0, 0, 0);
      break;
    case 'week':
      d.setHours(0, 0, 0, 0);
      // Snap to Monday (start of week)
      const dayOfWeek = d.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      d.setDate(d.getDate() + diff);
      break;
    case 'month':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      break;
    case 'quarter':
      const quarterMonth = Math.floor(d.getMonth() / 3) * 3;
      d.setMonth(quarterMonth, 1);
      d.setHours(0, 0, 0, 0);
      break;
    case 'year':
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      break;
  }

  return d;
}

/**
 * Get the start of the next unit after the given date.
 */
export function getNextUnit(date: Date, scale: TimelineScale): Date {
  const d = snapToUnit(new Date(date), scale);

  switch (scale) {
    case 'day':
      d.setDate(d.getDate() + 1);
      break;
    case 'week':
      d.setDate(d.getDate() + 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarter':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }

  return d;
}

/**
 * Generate axis labels for the timeline header.
 */
export interface AxisLabel {
  date: Date;
  label: string;
  x: number;
  width: number;
  isMinor: boolean;
}

/**
 * Generate axis labels for a date range at a given scale.
 */
export function generateAxisLabels(
  startDate: Date,
  endDate: Date,
  scale: TimelineScale,
  timelineStart: Date,
): AxisLabel[] {
  const labels: AxisLabel[] = [];
  let current = snapToUnit(new Date(startDate), scale);

  while (current <= endDate) {
    const next = getNextUnit(current, scale);
    const x = dateToPixels(current, timelineStart, scale);
    const width = dateToPixels(next, timelineStart, scale) - x;

    labels.push({
      date: new Date(current),
      label: formatAxisLabel(current, scale),
      x,
      width,
      isMinor: isMinorLabel(current, scale),
    });

    current = next;
  }

  return labels;
}

/**
 * Format a date for display in the axis header.
 */
export function formatAxisLabel(date: Date, scale: TimelineScale): string {
  switch (scale) {
    case 'day':
      return date.getDate().toString();
    case 'week':
      // Show week number or date range
      return `W${getWeekNumber(date)}`;
    case 'month':
      return date.toLocaleDateString('en-US', { month: 'short' });
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1}`;
    case 'year':
      return date.getFullYear().toString();
  }
}

/**
 * Check if a label should be rendered as minor (smaller/lighter).
 */
function isMinorLabel(date: Date, scale: TimelineScale): boolean {
  switch (scale) {
    case 'day':
      // Weekends are minor
      return date.getDay() === 0 || date.getDay() === 6;
    case 'week':
      return false;
    case 'month':
      // Non-quarter months are minor
      return date.getMonth() % 3 !== 0;
    case 'quarter':
      return false;
    case 'year':
      return false;
  }
}

/**
 * Get the ISO week number for a date.
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Get a reasonable date range for the timeline based on data.
 */
export function calculateDateRange(
  dates: Date[],
  scale: TimelineScale,
  padding: number = 2,
): { start: Date; end: Date } {
  if (dates.length === 0) {
    // Default to current month if no data
    const now = new Date();
    const start = snapToUnit(now, scale);
    const end = getNextUnit(getNextUnit(start, scale), scale);
    return { start, end };
  }

  let minDate = dates[0];
  let maxDate = dates[0];

  for (const d of dates) {
    if (d < minDate) minDate = d;
    if (d > maxDate) maxDate = d;
  }

  // Add padding
  let start = snapToUnit(new Date(minDate), scale);
  let end = snapToUnit(new Date(maxDate), scale);

  for (let i = 0; i < padding; i++) {
    start = new Date(start.getTime() - getUnitDuration(scale));
    end = getNextUnit(end, scale);
  }

  return { start: snapToUnit(start, scale), end };
}

/**
 * Check if a date falls on a weekend.
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if two dates are the same day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Parse a value to a Date object.
 * Handles various input formats: Date, string, number.
 */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'number') {
    // Excel serial date or timestamp
    if (value > 25569 && value < 2958466) {
      // Excel serial date (1900-based)
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + value * 86400000);
    }
    // Unix timestamp
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}
