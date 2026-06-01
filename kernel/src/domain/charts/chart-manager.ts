/**
 * Chart Manager (Spreadsheet-Specific)
 *
 * Standalone functions for chart-specific floating object operations.
 * Bridges the gap between the Charts domain module and the FloatingObjectManager.
 *
 * This is spreadsheet-specific because:
 * - Charts use cell-based positioning (anchorRow/Col, widthCells/heightCells)
 * - Position conversion requires dimension lookups (cell widths/heights)
 * - Charts domain module uses cell coordinates for storage
 *
 * Uses ComputeBridge for dimension queries. Functions that perform
 * dimension queries are async.
 *
 * Architecture:
 * - Charts are NOT stored in floatingObjects CRDT map
 * - Charts have their own Y.Map<ChartFloatingObject> per sheet
 * - This module provides conversion functions, not CRUD operations
 * - CRUD operations are in spreadsheet-model/src/charts.ts
 *
 * @see charts/src/types/chart-types.ts - For StoredChartConfig, ChartConfig
 * @see spreadsheet-model/src/charts.ts - For chart CRUD operations
 */

export {
  calculateChartPixelBounds,
  chartNeedsPositionUpdate,
  isPointInChart,
} from './chart-manager-bounds';
export {
  convertChartToFloatingObject,
  convertFloatingObjectToChartPosition,
} from './chart-manager-conversion';
export { cellsToPixels, pixelsToCells } from './chart-manager-dimensions';
export type { ChartObject, ChartPosition } from './chart-manager-types';
export { filterCharts, isChart } from './chart-manager-types';
