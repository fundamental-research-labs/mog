/**
 * Math Utilities for Chart Engine
 *
 * Pure mathematical functions for:
 * - Descriptive statistics and quantiles
 * - Kernel Density Estimation (KDE)
 * - Regression analysis (linear, polynomial, exponential, logarithmic, power)
 * - Geometry and path generation
 *
 * All functions are pure (no side effects) and have no external dependencies.
 */

// Statistics
export {
  // Binning
  bin,
  correlation,
  // Correlation
  covariance,
  epanechnikovKernel,
  freedmanDiaconisBins,
  gaussianKernel,
  iqr,
  // Kernel Density Estimation
  kde,
  max,
  // Descriptive statistics
  mean,
  median,
  min,
  normalize,
  // Outlier detection
  outlierBounds,
  outliers,
  // Quantiles
  quantile,
  quartiles,
  range,
  removeOutliers,
  sampleCovariance,
  sampleStdDev,
  sampleVariance,
  scottBandwidth,
  silvermanBandwidth,
  stdDev,
  sturgesBins,
  sum,
  variance,
  // Normalization
  zScores,
  type Bin,
  type BinOptions,
  type KDEOptions,
  type KDEResult,
  type OutlierBounds,
  // Types
  type Quartiles,
} from './statistics';

// Regression
export {
  createRegression,
  exponentialRegression,
  // Regression functions
  linearRegression,
  logarithmicRegression,
  // Moving average
  movingAverage,
  polynomialRegression,
  powerRegression,
  type MovingAverageResult,
  // Types
  type Point,
  type RegressionOptions,
  type RegressionResult,
  type RegressionType,
} from './regression';

// Geometry
export {
  // Arc and circle
  arcPath,
  areaPath,
  // Bounding box
  boundingBox,
  boxPlotBoxPath,
  boxPlotMedianPath,
  boxPlotWhiskerPaths,
  boxesIntersect,
  cartesianToPolar,
  // Bezier utilities
  catmullRomToBezier,
  // Point operations
  distance,
  evaluateBezier,
  expandBox,
  heatmapCells,
  // Histogram and heatmap
  histogramBars,
  lerp,
  // SVG path generation
  linePath,
  midpoint,
  pointInBox,
  polarToCartesian,
  polygonPath,
  rotatePoint,
  sampleBezier,
  scalePoint,
  slicePath,
  smoothAreaPath,
  smoothClosedPath,
  smoothCurvePath,
  translatePoint,
  // Statistical chart geometry
  violinPath,
  type BoundingBox,
  type BoxPlotGeometry,
  type CubicBezier,
  type HeatmapCell,
  type HistogramBar,
  type LineSegment,
  // Types
  type Point2D,
} from './geometry';

// Trendlines (Excel-compatible trendline calculations)
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
} from './trendlines';
