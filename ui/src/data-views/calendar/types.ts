/**
 * Calendar View Types - Kernel-Agnostic
 *
 * Type definitions for calendar components that work with plain string IDs
 * and have no kernel dependencies.
 */

// =============================================================================
// Calendar Event
// =============================================================================

/**
 * A calendar event with plain string ID.
 * All data is passed as props - no kernel dependencies.
 */
export interface CalendarEvent {
  /** Unique event ID (plain string, no kernel dependency) */
  id: string;
  /** Event title */
  title: string;
  /** Start date/time */
  startDate: Date;
  /** End date/time */
  endDate: Date;
  /** Optional color (hex string) */
  color?: string;
  /** Is this an all-day or multi-day event? */
  allDay?: boolean;
}

// =============================================================================
// Calendar View Mode
// =============================================================================

/**
 * Calendar view mode.
 */
export type CalendarViewMode = 'month' | 'week' | 'day';

// =============================================================================
// Calendar State
// =============================================================================

/**
 * Calendar state (controlled by parent).
 */
export interface CalendarState {
  /** Current date being viewed */
  currentDate: Date;
  /** Current view mode */
  viewMode: CalendarViewMode;
  /** Selected event IDs */
  selectedEventIds: Set<string>;
}

// =============================================================================
// Calendar Props
// =============================================================================

/**
 * Props for the Calendar component.
 */
export interface CalendarProps {
  /** Events to display */
  events: CalendarEvent[];
  /** Current state */
  state: CalendarState;
  /** First day of week: 0 = Sunday, 1 = Monday (defaults to 0) */
  weekStartsOn?: 0 | 1;

  // Event handlers
  /** Called when an event is clicked */
  onEventClick?: (eventId: string, shiftKey: boolean, ctrlKey: boolean) => void;
  /** Called when an event is double-clicked */
  onEventDoubleClick?: (eventId: string) => void;
  /** Called when a day/time is double-clicked (create event) */
  onCreateEvent?: (date: Date) => void;
  /** Called when an event is dropped on a new date (reschedule) */
  onEventDrop?: (eventId: string, newDate: Date) => void;
  /** Called when navigation changes (prev/next/today) */
  onNavigate?: (direction: 'prev' | 'next' | 'today') => void;
  /** Called when view mode changes */
  onViewModeChange?: (mode: CalendarViewMode) => void;
  /** Called when selection changes */
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

// =============================================================================
// Internal Types for Rendering
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
