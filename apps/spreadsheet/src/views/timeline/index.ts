/**
 * Timeline View
 *
 * Gantt-style timeline view showing records as horizontal bars on a time axis.
 *
 * Features:
 * - Horizontal bars representing date ranges
 * - Time axis with day/week/month/quarter/year scales
 * - Drag to move bars (change dates)
 * - Drag edges to resize (change duration)
 * - Pan viewport left/right
 * - Zoom in/out (change scale)
 * - Row grouping with collapsible sections
 * - Click to select bars
 * - Keyboard navigation
 *
 */

// View definition (for registration)
export { timelineViewDefinition } from './definition';

// Main component
export { TimelineView, type TimelineViewProps } from './TimelineView';

// Container component (for React rendering)
export { TimelineViewContainer, type TimelineViewContainerProps } from './TimelineViewContainer';

// Adapter
export { TimelineViewAdapter } from './TimelineViewAdapter';

// Configuration
export {
  DEFAULT_TIMELINE_CONFIG,
  getPixelsPerUnit,
  getUnitDuration,
  type TimelineScale,
  type TimelineViewConfig,
} from './config';

// State machine
export {
  TimelineEvents,
  timelineMachine,
  timelineSelectors,
  type TimelineActor,
  type TimelineContext,
  type TimelineEvent,
  type TimelineInteraction,
  type TimelineMachine,
  type TimelineState,
} from './machines';
// Re-export KeyModifiers with view-specific name to avoid conflict
export type { KeyModifiers as TimelineKeyModifiers } from './machines';

// Hooks
export {
  useTimelineData,
  useTimelineViewport,
  type TimelineViewportState,
  type UseTimelineDataOptions,
  type UseTimelineDataResult,
  type UseTimelineViewportOptions,
  type UseTimelineViewportResult,
} from './hooks';

// Components
export {
  TimeAxis,
  TimelineBar as TimelineBarComponent,
  TimelineCanvas,
  TimelineGroupHeader,
  TimelineRow,
  type TimeAxisProps,
  type TimelineBarProps,
  type TimelineCanvasProps,
  type TimelineGroupHeaderProps,
  type TimelineRowProps,
} from './components';

// Renderers
export {
  renderAxis,
  renderBars,
  renderGridLines,
  renderResizeHandles,
  renderRowSeparators,
  type AxisRenderOptions,
  type BarRenderOptions,
} from './renderer';

// Utilities
export {
  // Bar positioning
  calculateBarLayout,
  calculateDateRange,
  // Date utilities
  dateToPixels,
  formatAxisLabel,
  generateAxisLabels,
  getNextUnit,
  getVisibleBars,
  getWeekNumber,
  hitTestBar,
  hitTestBarEdge,
  hitTestGroup,
  isWeekend,
  // isSameDay - not exported to avoid conflict with calendar view
  parseDate,
  pixelsToDate,
  snapToUnit,
  type AxisLabel,
  type BarLayout,
  type BarLayoutOptions,
  type ResizeHit,
  type TimelineBar,
  type TimelineGroup,
  type TimelineRecord,
} from './utils';
