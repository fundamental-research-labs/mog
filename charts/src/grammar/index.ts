/**
 * Grammar Module - ChartSpec types and compiler for declarative chart creation.
 *
 * This module provides the grammar of graphics system for charts:
 * - ChartSpec types (Vega-Lite compatible)
 * - Compiler (spec + data -> marks)
 * - Layout calculator
 * - Encoding resolver (field -> scale -> visual)
 * - Data transforms (filter, sort, aggregate, bin, regression, density)
 */

// Core types
export * from './spec';

// Layout
export {
  DEFAULT_LAYOUT,
  calculateLayout,
  clampToPlotArea,
  getChartArea,
  getInnerDimensions,
  getXRange,
  getYRange,
  isInPlotArea,
  type LayoutDimensions,
} from './layout';

// Encoding resolution
export {
  DEFAULT_CATEGORY_COLORS,
  DEFAULT_SEQUENTIAL_COLORS,
  DEFAULT_SHAPES,
  createColorScale,
  createScaleForChannel,
  createScales,
  inferFieldType,
  inferScaleType,
  resolveEncoding,
  resolveEncodings,
  type AnyScale,
  type ResolvedEncoding,
  type ResolvedEncodings,
  type ScaleMap,
} from './encoding-resolver';

// Compiler
export { compile, type CompileOptions, type CompileResult } from './compiler';

// Layout snapshot (pixel -> point extraction)
export { extractChartLayout } from './layout-snapshot';

// Transforms
export {
  // Aggregate
  applyAggregate,
  // Bin
  applyBin,
  // Density
  applyDensity,
  // Filter
  applyFilter,
  // Regression
  applyRegression,
  // Sort
  applySort,
  applyTransform,
  // Pipeline
  applyTransforms,
  biweightKernel,
  computeRegression,
  count,
  countBy,
  cumulativeHistogram,
  densityAt,
  epanechnikovKernel,
  exponentialRegression,
  extent,
  filterNonEmpty,
  filterOneOf,
  filterRange,
  filterValid,
  findMode,
  gaussianKernel,
  generateTrendline,
  getBinBoundaries,
  getRegressionEquation,
  getSortedUniqueValues,
  histogram,
  histogramFromData,
  isMultimodal,
  kernelDensityEstimation,
  linearRegression,
  logarithmicRegression,
  max,
  mean,
  min,
  normalizedHistogram,
  polynomialRegression,
  powerRegression,
  reverseData,
  silvermanBandwidth,
  sortAscending,
  sortByComparator,
  sortByCustomOrder,
  sortByFields,
  sortDescending,
  stableSort,
  sum,
  triangularKernel,
  uniformKernel,
  unique,
  violinShape,
  type DensityResult,
  type RegressionResult,
} from './transforms';
