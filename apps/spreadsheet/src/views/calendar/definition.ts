/**
 * Calendar View Definition
 *
 * Registers the Calendar view type with the ViewRegistry.
 */

import type { ViewAdapterConfig, ViewDefinition } from '../types';
import { CalendarViewAdapter } from './CalendarViewAdapter';
import { CalendarViewContainer } from './CalendarViewContainer';
import { DEFAULT_CALENDAR_CONFIG } from './config';

/**
 * Calendar View Definition
 *
 * Calendar displays records on a calendar grid (month/week/day views).
 * Requires a date column to position events on the calendar.
 */
export const calendarViewDefinition: ViewDefinition<'calendar'> = {
  type: 'calendar',
  name: 'Calendar',
  icon: 'calendar',
  description: 'View records on a calendar grid with month, week, and day views',

  // Calendar requires a date column
  requiredColumns: ['date'],

  renderingMode: 'react', // Calendar uses React rendering
  component: CalendarViewContainer,

  // Create adapter instance
  createAdapter(config: ViewAdapterConfig<'calendar'>) {
    return new CalendarViewAdapter(config);
  },

  // Default configuration
  defaultConfig: {
    ...DEFAULT_CALENDAR_CONFIG,
  },
};
