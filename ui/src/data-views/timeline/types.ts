/**
 * Timeline View Types
 *
 * Kernel-agnostic type definitions for Timeline component.
 * All IDs are plain strings (no RowId, ColId, etc.).
 */

/**
 * Time scale options for timeline display.
 */
export type TimelineScale = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * A timeline bar representing a task or event.
 */
export interface TimelineBar {
  /** Unique identifier (plain string, not RowId) */
  id: string;
  /** Display title */
  title: string;
  /** Start date */
  startDate: Date;
  /** End date (same as startDate for milestones) */
  endDate: Date;
  /** Bar color (CSS color string) */
  color: string;
  /** Group identifier (if grouped) */
  groupId?: string;
  /** Whether this is a milestone (single point in time) */
  isMilestone?: boolean;
  /** Dependencies (IDs this bar depends on) */
  dependencies?: string[];
}

/**
 * A group containing related bars.
 */
export interface TimelineGroup {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Bars in this group */
  bars: TimelineBar[];
  /** Whether the group is collapsed */
  collapsed?: boolean;
}

/**
 * Drag state information.
 */
export interface TimelineDragState {
  /** Type of drag operation */
  type: 'move' | 'resize-start' | 'resize-end';
  /** Bar being dragged */
  barId: string;
  /** Starting X position */
  startX: number;
  /** Current X position */
  currentX: number;
}

/**
 * Selection state for timeline.
 */
export interface TimelineSelectionState {
  /** Selected bar IDs */
  selectedBarIds: Set<string>;
  /** Focused bar ID (for keyboard nav) */
  focusedBarId: string | null;
}

/**
 * Viewport state for timeline.
 */
export interface TimelineViewportState {
  /** Horizontal scroll position */
  scrollLeft: number;
  /** Vertical scroll position */
  scrollTop: number;
  /** Current time scale */
  scale: TimelineScale;
  /** Viewport start date */
  viewportStart: Date;
  /** Viewport end date */
  viewportEnd: Date;
}

/**
 * Complete timeline state.
 */
export interface TimelineState {
  /** Selection state */
  selection: TimelineSelectionState;
  /** Viewport state */
  viewport: TimelineViewportState;
  /** Active drag operation */
  dragState: TimelineDragState | null;
  /** Collapsed group IDs */
  collapsedGroups: Set<string>;
}

/**
 * Axis label for timeline header.
 */
export interface TimelineAxisLabel {
  /** Date this label represents */
  date: Date;
  /** Display text */
  label: string;
  /** X position in pixels */
  x: number;
  /** Width in pixels */
  width: number;
  /** Whether this is a minor label (smaller/lighter) */
  isMinor: boolean;
}

/**
 * Positioned bar data (after layout calculation).
 */
export interface PositionedTimelineBar extends TimelineBar {
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Timeline configuration options.
 */
export interface TimelineConfig {
  /** Row height in pixels */
  rowHeight: number;
  /** Bar padding in pixels */
  barPadding: number;
  /** Group header height in pixels */
  groupHeaderHeight: number;
  /** Label column width in pixels */
  labelColumnWidth: number;
  /** Whether to show today marker */
  showTodayMarker: boolean;
  /** Whether to shade weekends */
  showWeekends: boolean;
  /** Minimum bar width in pixels */
  minBarWidth: number;
}

/**
 * Event handlers for timeline interactions.
 */
export interface TimelineEventHandlers {
  /** Called when a bar is clicked */
  onBarClick?: (barId: string, event: React.MouseEvent) => void;
  /** Called when a bar is double-clicked */
  onBarDoubleClick?: (barId: string) => void;
  /** Called when a bar is dragged to a new position */
  onBarDrag?: (barId: string, newStartDate: Date, newEndDate: Date) => void;
  /** Called when a bar is resized */
  onBarResize?: (barId: string, newStartDate: Date, newEndDate: Date) => void;
  /** Called when selection changes */
  onSelectionChange?: (selectedBarIds: string[]) => void;
  /** Called when a group is toggled */
  onGroupToggle?: (groupId: string, collapsed: boolean) => void;
  /** Called when viewport changes */
  onViewportChange?: (viewport: TimelineViewportState) => void;
}

/**
 * Props for Timeline component.
 */
export interface TimelineProps {
  /** Bars to display (can be flat or grouped) */
  bars: TimelineBar[];
  /** Groups (optional - bars can reference groupId) */
  groups?: TimelineGroup[];
  /** Current state */
  state: TimelineState;
  /** Configuration options */
  config?: Partial<TimelineConfig>;
  /** Event handlers */
  handlers?: TimelineEventHandlers;
  /** Optional class name */
  className?: string;
  /** Optional style */
  style?: React.CSSProperties;
}
