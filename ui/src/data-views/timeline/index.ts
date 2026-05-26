/**
 * Timeline Data View
 *
 * Barrel export for all timeline components and utilities.
 * Kernel-agnostic timeline view for Gantt-style visualization.
 */

// Components
export { Timeline } from './Timeline';
export { TimelineAxis } from './TimelineAxis';
export { TimelineBar } from './TimelineBar';

// Types
export type {
  PositionedTimelineBar,
  TimelineAxisLabel,
  TimelineBar as TimelineBarData,
  TimelineConfig,
  TimelineDragState,
  TimelineEventHandlers,
  TimelineGroup,
  TimelineProps,
  TimelineScale,
  TimelineSelectionState,
  TimelineState,
  TimelineViewportState,
} from './types';

// Utilities
export {
  calculateDateRange,
  dateToPixels,
  formatAxisLabel,
  formatDateRange,
  generateAxisLabels,
  getDateRange,
  getNextUnit,
  getPixelsPerUnit,
  getToday,
  getUnitDuration,
  getWeekNumber,
  isSameDay,
  isWeekend,
  pixelsToDate,
  snapToUnit,
} from './utils';
