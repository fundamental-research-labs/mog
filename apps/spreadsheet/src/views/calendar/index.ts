/**
 * Calendar View
 *
 * Displays records on a calendar grid with month/week/day views.
 *
 * @example
 * ```typescript
 * import { CalendarView, calendarViewDefinition } from '@mog/shell/views/calendar';
 *
 * // Register the view type
 * VIEW_REGISTRY.register(calendarViewDefinition);
 *
 * // Use the component
 * <CalendarView
 * config={calendarConfig}
 * events={events}
 * onEventClick={handleEventClick}
 * onRescheduleEvent={handleReschedule}
 * />
 * ```
 */

// Main exports
export { CalendarView } from './CalendarView';
export { CalendarViewAdapter } from './CalendarViewAdapter';
export { CalendarViewContainer, type CalendarViewContainerProps } from './CalendarViewContainer';
export { calendarViewDefinition } from './definition';

// Config and types
export { DEFAULT_CALENDAR_CONFIG } from './config';
export type {
  CalendarDay,
  CalendarEvent,
  CalendarRuntimeConfig,
  CalendarViewConfig,
  CalendarViewMode,
  TimeSlot,
} from './config';

// State machine
export {
  CalendarEvents,
  calendarMachine,
  getCalendarSnapshot,
  initialCalendarContext,
  type CalendarActor,
  type CalendarContext,
  type CalendarEvent_Machine,
  type CalendarMachine,
  type CalendarSnapshot,
  type CalendarState,
} from './machines';

// Hooks
export { useCalendarData } from './hooks/use-calendar-data';
export { useCalendarNavigation } from './hooks/use-calendar-navigation';

// Components (for customization)
export {
  CalendarEvent as CalendarEventComponent,
  CalendarHeader,
  DayCell,
  DayView,
  MonthGrid,
  WeekView,
} from './components';

// Utilities (for custom implementations)
export {
  addDays,
  formatDate,
  formatHour,
  formatMonthYear,
  generateMonthGrid,
  generateWeekDays,
  getDayNames,
  getDecimalHour,
  getEventHeight,
  getHoursInDay,
  getTimePosition,
  getWeekRangeString,
  groupOverlappingEvents,
  isInMonth,
  isSameDay,
  isToday,
  positionAllDayEvents,
  positionDayEvents,
  positionOverlappingEvents,
  startOfDay,
  startOfMonth,
  startOfWeek,
  timeRangesOverlap,
  type PositionedEvent,
} from './utils';
