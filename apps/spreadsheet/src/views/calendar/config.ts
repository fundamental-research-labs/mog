/**
 * Calendar View Configuration
 *
 * Extends the base CalendarViewConfig from types.ts with additional options
 * and provides runtime defaults.
 */

import type { ColId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue } from '@mog-sdk/contracts/core';
import type { ColumnSchema } from '../../domain/clipboard/types';
import type { CalendarViewConfig as BaseCalendarViewConfig } from '../types';

// =============================================================================
// Re-export base config
// =============================================================================

export type { CalendarViewConfig } from '../types';

// =============================================================================
// Calendar View Mode
// =============================================================================

export type CalendarViewMode = 'month' | 'week' | 'day';

// =============================================================================
// Extended Configuration (runtime options beyond persisted config)
// =============================================================================

/**
 * Extended runtime configuration for calendar view.
 * Includes all properties from CalendarViewConfig plus additional runtime options.
 */
export interface CalendarRuntimeConfig extends BaseCalendarViewConfig {
  /** Column containing event titles (defaults to first text column) */
  titleColumn?: ColId;
  /** Column containing event end dates (for multi-day events) */
  endDateColumn?: ColId;
  /** Color events by this column's value */
  colorByColumn?: ColId;
  /** First day of week: 0 = Sunday, 1 = Monday */
  weekStartsOn?: 0 | 1;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration values for new calendar views.
 */
export const DEFAULT_CALENDAR_CONFIG: Partial<CalendarRuntimeConfig> = {
  calendarMode: 'month',
  weekStartsOn: 0, // Sunday
};

// =============================================================================
// Calendar Event (internal representation)
// =============================================================================

/**
 * Internal representation of a calendar event derived from a table row.
 */
export interface CalendarEvent {
  /** Row ID from the source table */
  rowId: string;
  /** Event title from titleColumn (pre-formatted for display) */
  title: string;
  /** Raw title value for column renderer (enables rich rendering) */
  titleValue?: CellValue;
  /** Column schema for title column (enables rich rendering) */
  titleColumn?: ColumnSchema;
  /** Start date */
  startDate: Date;
  /** End date (same as startDate if not multi-day) */
  endDate: Date;
  /** Color (if colorByColumn is set) */
  color?: string;
  /** Is this a multi-day event? */
  isMultiDay: boolean;
}

// =============================================================================
// Calendar Day
// =============================================================================

/**
 * Represents a single day in the calendar grid.
 */
export interface CalendarDay {
  /** The date */
  date: Date;
  /** Is this day in the current month (for month view)? */
  isCurrentMonth: boolean;
  /** Is this today? */
  isToday: boolean;
  /** Events on this day */
  events: CalendarEvent[];
}

// =============================================================================
// Time Slot (for week/day views)
// =============================================================================

/**
 * Represents a time slot in week/day views.
 */
export interface TimeSlot {
  /** Start hour (0-23) */
  hour: number;
  /** Events in this time slot */
  events: CalendarEvent[];
}
