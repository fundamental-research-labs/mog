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
export { collectMarks, configToSpec } from './chart-engine';
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
