/**
 * Calendar Data View - Kernel-Agnostic
 *
 * Exports all calendar components and utilities.
 */

// Main component
export { Calendar } from './Calendar';

// Sub-components
export { CalendarEvent } from './CalendarEvent';
export { CalendarHeader } from './CalendarHeader';
export { DayView } from './DayView';
export { MonthGrid } from './MonthGrid';
export { WeekView } from './WeekView';

// Types
export type {
  CalendarDay,
  CalendarEvent as CalendarEventData,
  CalendarProps,
  CalendarState,
  CalendarViewMode,
  PositionedEvent,
} from './types';

// Utilities
export {
  addDays,
  formatDate,
  formatHour,
  formatMonthYear,
  generateMonthGrid,
  generateWeekDays,
  getContrastColor,
  getDayNames,
  getDecimalHour,
  getEventHeight,
  getHoursInDay,
  getTimePosition,
  groupOverlappingEvents,
  isInMonth,
  isSameDay,
  isToday,
  positionDayEvents,
  positionOverlappingEvents,
  startOfDay,
  startOfMonth,
  startOfWeek,
  timeRangesOverlap,
} from './utils';
