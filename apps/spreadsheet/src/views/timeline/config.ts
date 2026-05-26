/**
 * Timeline View Configuration
 *
 * Re-exports the TimelineViewConfig from types and provides additional utilities.
 * Timeline views display records as horizontal bars on a time axis.
 */

// Re-export TimelineViewConfig from the canonical types location
export type { TimelineViewConfig } from '../types';

/**
 * Time scale options for the timeline axis.
 */
export type TimelineScale = 'day' | 'week' | 'month' | 'quarter' | 'year';

import type { TimelineViewConfig } from '../types';

/**
 * Default configuration values for Timeline views.
 */
export const DEFAULT_TIMELINE_CONFIG: Partial<TimelineViewConfig> = {
  timeScale: 'day',
  rowHeight: 40,
  labelColumnWidth: 200,
  showTodayMarker: true,
  showWeekends: true,
};

/**
 * Get the number of pixels per unit for a given time scale.
 * Used to calculate bar widths and positions.
 */
export function getPixelsPerUnit(scale: TimelineScale): number {
  switch (scale) {
    case 'day':
      return 40;
    case 'week':
      return 120;
    case 'month':
      return 160;
    case 'quarter':
      return 200;
    case 'year':
      return 240;
  }
}

/**
 * Get the duration in milliseconds for a given time scale unit.
 */
export function getUnitDuration(scale: TimelineScale): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  switch (scale) {
    case 'day':
      return DAY_MS;
    case 'week':
      return 7 * DAY_MS;
    case 'month':
      return 30 * DAY_MS; // Approximate
    case 'quarter':
      return 91 * DAY_MS; // Approximate
    case 'year':
      return 365 * DAY_MS; // Approximate
  }
}
