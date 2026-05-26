/**
 * Timeline View Definition
 *
 * Registers the Timeline view in the ViewRegistry.
 */

import type { TimelineViewConfig, ViewDefinition } from '../types';
import { TimelineViewAdapter } from './TimelineViewAdapter';
import { TimelineViewContainer } from './TimelineViewContainer';

/**
 * Timeline view definition for registration in ViewRegistry.
 */
export const timelineViewDefinition: ViewDefinition<'timeline'> = {
  type: 'timeline',
  name: 'Timeline',
  icon: 'timeline',
  description: 'Gantt-style timeline view showing records as bars on a time axis',

  // Timeline requires date columns
  requiredColumns: ['date'],

  renderingMode: 'react', // Timeline uses React rendering
  component: TimelineViewContainer,

  createAdapter: (config) => new TimelineViewAdapter(config),

  defaultConfig: {
    timeScale: 'day',
    rowHeight: 40,
    labelColumnWidth: 200,
    showTodayMarker: true,
    showWeekends: true,
  } as Partial<TimelineViewConfig>,
};
