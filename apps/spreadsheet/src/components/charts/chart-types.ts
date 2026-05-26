/**
 * Chart Type Definitions
 *
 * Shared types for chart components and hooks.
 * These types define the shape of chart data as stored in state.
 *
 * @module components/charts/chart-types
 */

import type { ChartData, ChartType, StoredChartConfig } from '@mog/charts';
import type { ChartPosition } from '@mog/grid-renderer';

/**
 * Chart definition stored in state
 *
 * This type represents a chart as it exists in the spreadsheet's state.
 * It combines positioning information with the chart configuration and data.
 */
export interface ChartDefinition {
  /** Unique chart ID */
  id: string;
  /** Chart type (bar, line, pie, etc.) */
  type: ChartType;
  /** Position in the spreadsheet (cell-based) */
  position: ChartPosition;
  /** Chart configuration (title, colors, options) */
  config: StoredChartConfig;
  /** Chart data (categories and series) */
  data: ChartData;
}

// Re-export ChartPosition for convenience
export type { ChartPosition };
