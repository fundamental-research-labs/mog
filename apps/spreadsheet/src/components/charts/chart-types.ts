/**
 * Chart Type Definitions
 *
 * Shared types for chart components and hooks.
 * These types define the shape of chart data as stored in state.
 *
 * @module components/charts/chart-types
 */

import type { ChartData, ChartType, StoredChartConfig } from '@mog/charts';
import type { ChartAppModel } from '@mog-sdk/contracts/data/chart-app-model';

/**
 * Chart definition stored in state
 *
 * This type represents a chart as it exists in the spreadsheet's state.
 * It combines chart configuration, extracted data, and semantic model state.
 */
export interface ChartDefinition {
  /** Unique chart ID */
  id: string;
  /** Chart type (bar, line, pie, etc.) */
  type: ChartType;
  /** Chart configuration (title, colors, options) */
  config: StoredChartConfig;
  /** Chart data (categories and series) */
  data: ChartData;
  /** Semantic chart model for first-party controls. */
  appModel?: ChartAppModel;
}
