/**
 * Statistical Functions for Chart Math Utilities
 *
 * Pure functions implementing descriptive statistics, quantiles,
 * outlier detection, and Kernel Density Estimation (KDE).
 * No external dependencies - all calculations from scratch.
 */

// =============================================================================
// Descriptive Statistics
// =============================================================================

/**
 * Calculate the arithmetic mean of an array of numbers.
 * Returns NaN for empty arrays.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate the median (50th percentile) of an array of numbers.
 * Returns NaN for empty arrays.
 */
export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/**
 * Calculate the population variance of an array of numbers.
 * Uses N in the denominator (population variance, not sample variance).
 * Returns NaN for empty arrays.
 */
export function variance(values: number[]): number {
  if (values.length === 0) return NaN;
  const m = mean(values);
  const squaredDiffs = values.map((v) => (v - m) ** 2);
  return squaredDiffs.reduce((acc, val) => acc + val, 0) / values.length;
}

/**
 * Calculate the sample variance of an array of numbers.
 * Uses N-1 in the denominator (Bessel's correction).
 * Returns NaN for arrays with less than 2 elements.
 */
export function sampleVariance(values: number[]): number {
  if (values.length < 2) return NaN;
  const m = mean(values);
  const squaredDiffs = values.map((v) => (v - m) ** 2);
  return squaredDiffs.reduce((acc, val) => acc + val, 0) / (values.length - 1);
}

/**
 * Calculate the population standard deviation.
 * Returns NaN for empty arrays.
 */
export function stdDev(values: number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Calculate the sample standard deviation.
 * Uses Bessel's correction (N-1 denominator).
 * Returns NaN for arrays with less than 2 elements.
 */
export function sampleStdDev(values: number[]): number {
  return Math.sqrt(sampleVariance(values));
}

/**
 * Calculate the minimum value in an array.
 * Returns Infinity for empty arrays.
 */
export function min(values: number[]): number {
  if (values.length === 0) return Infinity;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < result) {
      result = values[i];
    }
  }
  return result;
}

/**
 * Calculate the maximum value in an array.
 * Returns -Infinity for empty arrays.
 */
export function max(values: number[]): number {
  if (values.length === 0) return -Infinity;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > result) {
      result = values[i];
    }
  }
  return result;
}

/**
 * Calculate the range (max - min) of an array.
 * Returns NaN for empty arrays.
 */
export function range(values: number[]): number {
  if (values.length === 0) return NaN;
  return max(values) - min(values);
}

/**
 * Calculate the sum of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function sum(values: number[]): number {
  return values.reduce((acc, val) => acc + val, 0);
}

// =============================================================================
// Quantiles
// =============================================================================

/**
 * Calculate a quantile (percentile / 100) of an array using linear interpolation.
 * Uses the R-7 quantile method (linear interpolation between points).
 *
 * @param values - Array of numbers (will be sorted internally)
 * @param p - Quantile in range [0, 1] (e.g., 0.5 for median)
 * @returns The quantile value, or NaN for empty arrays
 */
export function quantile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  if (p < 0 || p > 1) {
    throw new Error(`Quantile p must be in range [0, 1], got ${p}`);
  }

  // Sort a copy of the array
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 1) return sorted[0];
  if (p === 0) return sorted[0];
  if (p === 1) return sorted[n - 1];

  // R-7 quantile method (default in R and used by many statistical packages)
  // Index = (n - 1) * p
  const index = (n - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  // Linear interpolation
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Quartile results interface.
 */
export interface Quartiles {
  /** First quartile (25th percentile) */
  q1: number;
  /** Second quartile / median (50th percentile) */
  median: number;
  /** Third quartile (75th percentile) */
  q3: number;
}

/**
 * Calculate all three quartiles of an array.
 *
 * @param values - Array of numbers
 * @returns Object with q1, median, and q3
 */
export function quartiles(values: number[]): Quartiles {
  return {
    q1: quantile(values, 0.25),
    median: quantile(values, 0.5),
    q3: quantile(values, 0.75),
  };
}

/**
 * Calculate the Interquartile Range (IQR = Q3 - Q1).
 *
 * @param values - Array of numbers
 * @returns IQR value, or NaN for empty arrays
 */
export function iqr(values: number[]): number {
  if (values.length === 0) return NaN;
  return quantile(values, 0.75) - quantile(values, 0.25);
}

// =============================================================================
// Outlier Detection
// =============================================================================

/**
 * Outlier bounds result interface.
 */
export interface OutlierBounds {
  /** Lower bound (Q1 - 1.5 * IQR) */
  lower: number;
  /** Upper bound (Q3 + 1.5 * IQR) */
  upper: number;
}

/**
 * Calculate Tukey's outlier bounds using the 1.5 * IQR rule.
 * Values outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] are considered outliers.
 *
 * @param values - Array of numbers
 * @param multiplier - IQR multiplier (default 1.5, use 3 for "far outliers")
 * @returns Object with lower and upper bounds
 */
export function outlierBounds(values: number[], multiplier: number = 1.5): OutlierBounds {
  const q = quartiles(values);
  const interquartileRange = q.q3 - q.q1;

  return {
    lower: q.q1 - multiplier * interquartileRange,
    upper: q.q3 + multiplier * interquartileRange,
  };
}

/**
 * Find outliers in an array using Tukey's 1.5 * IQR rule.
 *
 * @param values - Array of numbers
 * @param multiplier - IQR multiplier (default 1.5)
 * @returns Array of outlier values
 */
export function outliers(values: number[], multiplier: number = 1.5): number[] {
  const bounds = outlierBounds(values, multiplier);
  return values.filter((v) => v < bounds.lower || v > bounds.upper);
}

/**
 * Filter values to only include non-outliers (within Tukey's bounds).
 *
 * @param values - Array of numbers
 * @param multiplier - IQR multiplier (default 1.5)
 * @returns Array of non-outlier values
 */
export function removeOutliers(values: number[], multiplier: number = 1.5): number[] {
  const bounds = outlierBounds(values, multiplier);
  return values.filter((v) => v >= bounds.lower && v <= bounds.upper);
}

// =============================================================================
// Kernel Density Estimation (KDE)
// =============================================================================

/**
 * KDE result interface.
 */
export interface KDEResult {
  /** X coordinates of the density curve */
  x: number[];
  /** Y coordinates (density values) of the curve */
  y: number[];
}

/**
 * Gaussian kernel function.
 * K(u) = (1/sqrt(2*pi)) * exp(-0.5 * u^2)
 */
export function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

/**
 * Epanechnikov kernel function.
 * K(u) = (3/4)(1 - u^2) for |u| <= 1, 0 otherwise
 * More efficient than Gaussian (compact support).
 */
export function epanechnikovKernel(u: number): number {
  const absU = Math.abs(u);
  if (absU > 1) return 0;
  return (3 / 4) * (1 - u * u);
}

/**
 * Calculate Silverman's rule of thumb bandwidth for KDE.
 * h = 1.06 * sigma * n^(-1/5)
 *
 * This is optimal for Gaussian data but works well in practice
 * for many distributions.
 *
 * @param values - Array of numbers
 * @returns Optimal bandwidth estimate
 */
export function silvermanBandwidth(values: number[]): number {
  if (values.length === 0) return 1;
  const n = values.length;
  const s = sampleStdDev(values);
  const interquartileRange = iqr(values);

  // Use the robust Silverman estimate: min(stdDev, IQR/1.34)
  // This avoids over-smoothing for heavy-tailed distributions.
  const robustIqr =
    isNaN(interquartileRange) || interquartileRange === 0 ? Infinity : interquartileRange / 1.34;
  const sigma = isNaN(s) || s === 0 ? robustIqr : Math.min(s, robustIqr);

  // If both stdDev and IQR are 0 (all values identical), return a small positive default
  if (!isFinite(sigma) || sigma === 0) {
    return 1;
  }

  return 1.06 * sigma * Math.pow(n, -1 / 5);
}

/**
 * Scott's rule bandwidth (alternative to Silverman's).
 * h = 1.059 * sigma * n^(-1/5)
 */
export function scottBandwidth(values: number[]): number {
  if (values.length === 0) return 1;
  const n = values.length;
  const s = sampleStdDev(values);

  if (s === 0 || isNaN(s)) {
    return 1;
  }

  return 1.059 * s * Math.pow(n, -1 / 5);
}

/**
 * KDE options interface.
 */
export interface KDEOptions {
  /** Smoothing bandwidth (default: Silverman's rule) */
  bandwidth?: number;
  /** Number of output points (default: 100) */
  points?: number;
  /** Kernel function (default: gaussian) */
  kernel?: 'gaussian' | 'epanechnikov';
  /** Minimum x value (default: min(data) - 3*bandwidth) */
  minX?: number;
  /** Maximum x value (default: max(data) + 3*bandwidth) */
  maxX?: number;
}

/**
 * Kernel Density Estimation (KDE) for estimating probability density.
 *
 * KDE provides a smooth estimate of the probability density function
 * of a continuous random variable. It's useful for violin plots,
 * density plots, and histograms with smoothed curves.
 *
 * @param values - Array of numbers (data points)
 * @param options - KDE configuration options
 * @returns Object with x and y arrays for plotting the density curve
 *
 * @example
 * const data = [1, 2, 2, 3, 3, 3, 4, 4, 5];
 * const density = kde(data, { points: 50 });
 * // density.x: [-0.5, -0.4, ..., 5.5]
 * // density.y: [0.01, 0.02, ..., 0.01]
 */
export function kde(values: number[], options: KDEOptions = {}): KDEResult {
  if (values.length === 0) {
    return { x: [], y: [] };
  }

  const { bandwidth = silvermanBandwidth(values), points = 100, kernel = 'gaussian' } = options;

  // Determine x range
  const dataMin = min(values);
  const dataMax = max(values);
  const padding = 3 * bandwidth; // Extend beyond data range

  const minX = options.minX ?? dataMin - padding;
  const maxX = options.maxX ?? dataMax + padding;

  // Select kernel function
  const kernelFn = kernel === 'epanechnikov' ? epanechnikovKernel : gaussianKernel;

  // Generate x values
  const x: number[] = [];
  const step = (maxX - minX) / (points - 1);
  for (let i = 0; i < points; i++) {
    x.push(minX + i * step);
  }

  // Calculate density at each x point
  const n = values.length;
  const y: number[] = x.map((xi) => {
    let density = 0;
    for (const val of values) {
      const u = (xi - val) / bandwidth;
      density += kernelFn(u);
    }
    return density / (n * bandwidth);
  });

  return { x, y };
}

// =============================================================================
// Binning (for histograms)
// =============================================================================

/**
 * Bin result interface.
 */
export interface Bin {
  /** Start of bin range (inclusive) */
  x0: number;
  /** End of bin range (exclusive, except for last bin) */
  x1: number;
  /** Count of values in this bin */
  count: number;
  /** Values that fall in this bin */
  values: number[];
}

/**
 * Calculate the optimal number of bins using Sturges' rule.
 * bins = ceil(log2(n) + 1)
 */
export function sturgesBins(n: number): number {
  if (n <= 0) return 1;
  return Math.ceil(Math.log2(n) + 1);
}

/**
 * Calculate the optimal number of bins using the Freedman-Diaconis rule.
 * binWidth = 2 * IQR * n^(-1/3)
 */
export function freedmanDiaconisBins(values: number[]): number {
  if (values.length === 0) return 1;
  const n = values.length;
  const interquartileRange = iqr(values);

  if (interquartileRange === 0 || isNaN(interquartileRange)) {
    return sturgesBins(n);
  }

  const binWidth = 2 * interquartileRange * Math.pow(n, -1 / 3);
  const dataRange = range(values);

  if (binWidth === 0) {
    return sturgesBins(n);
  }

  return Math.max(1, Math.ceil(dataRange / binWidth));
}

/**
 * Bin options interface.
 */
export interface BinOptions {
  /** Number of bins (default: Sturges' rule) */
  binCount?: number;
  /** Bin width (overrides binCount if specified) */
  binWidth?: number;
  /** Minimum value for binning range */
  minValue?: number;
  /** Maximum value for binning range */
  maxValue?: number;
  /** Use nice round bin boundaries */
  nice?: boolean;
}

/**
 * Create histogram bins from an array of values.
 *
 * @param values - Array of numbers to bin
 * @param options - Binning options
 * @returns Array of Bin objects
 */
export function bin(values: number[], options: BinOptions = {}): Bin[] {
  if (values.length === 0) return [];

  const dataMin = options.minValue ?? min(values);
  const dataMax = options.maxValue ?? max(values);
  const dataRange = dataMax - dataMin;

  // Determine bin width and count
  let binWidth: number;
  let binCount: number;

  if (options.binWidth !== undefined) {
    binWidth = options.binWidth;
    binCount = Math.max(1, Math.ceil(dataRange / binWidth));
  } else {
    binCount = options.binCount ?? sturgesBins(values.length);
    binWidth = dataRange / binCount;
  }

  // Handle edge case where all values are the same
  if (binWidth === 0 || !isFinite(binWidth)) {
    return [
      {
        x0: dataMin,
        x1: dataMax,
        count: values.length,
        values: [...values],
      },
    ];
  }

  // Adjust for nice boundaries if requested
  let actualMin = dataMin;
  if (options.nice) {
    actualMin = Math.floor(dataMin / binWidth) * binWidth;
    binCount = Math.ceil((dataMax - actualMin) / binWidth);
  }

  // Create empty bins
  const bins: Bin[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push({
      x0: actualMin + i * binWidth,
      x1: actualMin + (i + 1) * binWidth,
      count: 0,
      values: [],
    });
  }

  // Assign values to bins
  for (const val of values) {
    // Find the bin index for this value
    let binIndex = Math.floor((val - actualMin) / binWidth);

    // Handle edge case: value equals max goes in last bin
    if (binIndex >= binCount) {
      binIndex = binCount - 1;
    }
    if (binIndex < 0) {
      binIndex = 0;
    }

    bins[binIndex].count++;
    bins[binIndex].values.push(val);
  }

  return bins;
}

// =============================================================================
// Correlation and Covariance
// =============================================================================

/**
 * Calculate the covariance between two arrays.
 * Uses population covariance (divides by N).
 */
export function covariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return NaN;

  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY);
  }

  return cov / n;
}

/**
 * Calculate the sample covariance between two arrays.
 * Uses sample covariance (divides by N-1).
 */
export function sampleCovariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return NaN;

  const n = x.length;
  const meanX = mean(x);
  const meanY = mean(y);

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY);
  }

  return cov / (n - 1);
}

/**
 * Calculate the Pearson correlation coefficient between two arrays.
 * Returns a value in [-1, 1].
 */
export function correlation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return NaN;

  const cov = covariance(x, y);
  const stdX = stdDev(x);
  const stdY = stdDev(y);

  if (stdX === 0 || stdY === 0) return NaN;

  return cov / (stdX * stdY);
}

// =============================================================================
// Z-Score and Normalization
// =============================================================================

/**
 * Calculate z-scores (standard scores) for an array.
 * z = (x - mean) / stdDev
 */
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const s = stdDev(values);

  if (s === 0) {
    return values.map(() => 0);
  }

  return values.map((v) => (v - m) / s);
}

/**
 * Normalize values to the range [0, 1].
 * normalized = (x - min) / (max - min)
 */
export function normalize(values: number[]): number[] {
  const minVal = min(values);
  const maxVal = max(values);
  const rangeVal = maxVal - minVal;

  if (rangeVal === 0) {
    return values.map(() => 0.5);
  }

  return values.map((v) => (v - minVal) / rangeVal);
}
