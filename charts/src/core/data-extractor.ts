/**
 * Data Extractor - compatibility facade for chart data extraction APIs.
 */
export {
  HIDDEN_CHART_CELL,
  ObjectCellAccessor,
  isHiddenChartCellValue,
  parseRange,
  type CellAddress,
  type CellDataAccessor,
  type CellRange,
  type ChartCellValue,
  type HiddenChartCellValue,
} from './data-extractor-primitives';
export { extractChartData } from './data-extractor-config';
export { detectSeriesOrientation, extractChartDataFromRange } from './data-extractor-range';
