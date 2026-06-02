export {
  calculateExponentialRegression,
  calculateLinearRegression,
  calculateLogarithmicRegression,
  calculatePolynomialRegression,
  calculatePowerRegression,
  generateExponentialTrendline,
  generateLinearTrendline,
  generateLogarithmicTrendline,
  generateMovingAverageTrendline,
  generatePolynomialTrendline,
  generatePowerTrendline,
  generateTrendlinePoints,
  type ExponentialCoefficients,
  type LinearCoefficients,
  type LogarithmicCoefficients,
  type MovingAverageCoefficients,
  type PolynomialCoefficients,
  type PowerCoefficients,
  type TrendlineCoefficients,
  type TrendlineResult,
} from '../math/trendlines';
export { collectMarks } from './chart-engine';
export { chartDataToRows, configToSpec } from './config-to-spec';
export {
  DEFAULT_EXCEL_BAR_GAP_WIDTH,
  DEFAULT_EXCEL_CLUSTERED_BAR_OVERLAP,
  DEFAULT_EXCEL_STACKED_BAR_OVERLAP,
  barGroupingForConfig,
  barGroupingForConfigSpec,
  barOrientationForChartType,
  effectiveBarGeometry,
  effectiveBarGeometryFromSpec,
  effectiveGapWidth,
  effectiveOverlap,
  excelBarSlotGeometry,
  hasExcelBarGeometryConfig,
  hasExcelBarGeometrySpec,
  isBarLikeChartType,
  isStackedBarGrouping,
  resolveBarGeometryGroups,
  stackModeForChartType,
  type BarGeometryGroup,
  type BarSlotGeometry,
  type ResolveBarGeometryGroupsOptions,
} from './config-to-spec/bar-geometry';
export * from './style-resolver';
export {
  rustToTsChartType,
  tsToRustChartType,
  type RustBarDirection,
  type RustChartType,
  type RustChartTypeResult,
} from './chart-type-bridge';
export {
  ObjectCellAccessor,
  HIDDEN_CHART_CELL,
  detectSeriesOrientation,
  extractChartData,
  extractChartDataFromRange,
  isHiddenChartCellValue,
  parseRange,
  type CellDataAccessor,
  type CellRange,
  type ChartCellValue,
} from './data-extractor';
export { stockRolePlan, type StockRole, type StockRolePlan } from './data-extractor-imported';
export {
  chartDataSeriesIdentity,
  seriesConfigForDataSeries,
  seriesConfigSourceIndex,
  seriesConfigSourceKey,
  seriesOrderForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
  withSeriesConfigIdentity,
} from './series-identity';
export {
  asStockConfig,
  hasStockRoleSeries,
  hasStockSubtype,
  shouldProjectStockSeries,
  shouldRenderStockChart,
} from './stock-semantics';
