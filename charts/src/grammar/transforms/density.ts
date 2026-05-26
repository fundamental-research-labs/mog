/**
 * Density Transform
 *
 * Computes kernel density estimation (KDE) for data.
 * Used for violin plots, density plots, and smooth histograms.
 *
 * Pure functions - no side effects.
 */

import type { DataRow, DensitySpec } from '../spec';

// =============================================================================
// Safe Min/Max Helpers (avoid call stack overflow with large arrays)
// =============================================================================

function safeMin(values: number[]): number {
  let min = Infinity;
  for (const v of values) {
    if (v < min) min = v;
  }
  return min;
}

function safeMax(values: number[]): number {
  let max = -Infinity;
  for (const v of values) {
    if (v > max) max = v;
  }
  return max;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Density estimation result.
 */
export interface DensityResult {
  /** X values */
  x: number[];
  /** Density values */
  density: number[];
  /** Bandwidth used */
  bandwidth: number;
  /** Maximum density value */
  maxDensity: number;
}

// =============================================================================
// Density Transform
// =============================================================================

/**
 * Apply a density transform to data.
 *
 * @param data - Input data rows
 * @param spec - Density specification
 * @returns Data rows with density estimates
 */
export function applyDensity(data: DataRow[], spec: DensitySpec): DataRow[] {
  const { density: field, bandwidth, extent, steps = 100, as = ['value', 'density'] } = spec;

  // Get values
  const values = data
    .map((d) => d[field])
    .filter((v) => typeof v === 'number' && !isNaN(v)) as number[];

  if (values.length === 0) {
    return [];
  }

  // Calculate density
  const result = kernelDensityEstimation(values, {
    bandwidth,
    extent,
    steps,
  });

  // Convert to data rows
  return result.x.map((x, i) => ({
    [as[0]]: x,
    [as[1]]: result.density[i],
  }));
}

// =============================================================================
// Kernel Density Estimation
// =============================================================================

/**
 * Compute kernel density estimation.
 *
 * @param values - Numeric values
 * @param options - KDE options
 * @returns Density result
 */
export function kernelDensityEstimation(
  values: number[],
  options: {
    bandwidth?: number;
    extent?: [number, number];
    steps?: number;
    kernel?: 'gaussian' | 'epanechnikov' | 'triangular';
  } = {},
): DensityResult {
  const { steps = 100, kernel = 'gaussian' } = options;

  // Calculate extent
  const min = options.extent?.[0] ?? safeMin(values);
  const max = options.extent?.[1] ?? safeMax(values);
  const range = max - min;

  // Calculate bandwidth (using Silverman's rule of thumb if not provided)
  const bandwidth = options.bandwidth ?? silvermanBandwidth(values);

  // Generate x values
  const x: number[] = [];
  const step = range / (steps - 1);

  for (let i = 0; i < steps; i++) {
    x.push(min + i * step);
  }

  // Select kernel function
  const kernelFn = getKernelFunction(kernel);

  // Compute density at each x
  const density: number[] = [];
  const n = values.length;

  for (const xi of x) {
    let sum = 0;

    for (const v of values) {
      const u = (xi - v) / bandwidth;
      sum += kernelFn(u);
    }

    density.push(sum / (n * bandwidth));
  }

  const maxDensity = safeMax(density);

  return {
    x,
    density,
    bandwidth,
    maxDensity,
  };
}

/**
 * Calculate Silverman's rule of thumb bandwidth.
 * Includes a guard against zero bandwidth when all values are identical.
 */
export function silvermanBandwidth(values: number[]): number {
  const n = values.length;

  if (n < 2) return 1;

  // Calculate standard deviation
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);

  // Calculate IQR
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  // Silverman's rule
  const sigmaHat = Math.min(std, iqr / 1.34);

  const bw = 0.9 * sigmaHat * Math.pow(n, -0.2);

  // Guard against zero bandwidth (e.g., all values identical -> std=0, iqr=0).
  // Use a small positive fallback based on the data range or an absolute minimum.
  if (bw <= 0) {
    const dataRange = sorted[n - 1] - sorted[0];
    return dataRange > 0 ? dataRange / n : 1;
  }

  return bw;
}

/**
 * Get kernel function by name.
 */
function getKernelFunction(
  kernel: 'gaussian' | 'epanechnikov' | 'triangular',
): (u: number) => number {
  switch (kernel) {
    case 'epanechnikov':
      return epanechnikovKernel;
    case 'triangular':
      return triangularKernel;
    case 'gaussian':
    default:
      return gaussianKernel;
  }
}

// =============================================================================
// Kernel Functions
// =============================================================================

/**
 * Gaussian (normal) kernel.
 */
export function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

/**
 * Epanechnikov kernel.
 */
export function epanechnikovKernel(u: number): number {
  if (Math.abs(u) > 1) return 0;
  return 0.75 * (1 - u * u);
}

/**
 * Triangular kernel.
 */
export function triangularKernel(u: number): number {
  if (Math.abs(u) > 1) return 0;
  return 1 - Math.abs(u);
}

/**
 * Uniform (box) kernel.
 */
export function uniformKernel(u: number): number {
  if (Math.abs(u) > 1) return 0;
  return 0.5;
}

/**
 * Biweight (quartic) kernel.
 */
export function biweightKernel(u: number): number {
  if (Math.abs(u) > 1) return 0;
  const t = 1 - u * u;
  return (15 / 16) * t * t;
}

// =============================================================================
// Violin Plot Support
// =============================================================================

/**
 * Generate violin plot shape from density.
 *
 * @param values - Data values
 * @param options - Options for density estimation
 * @returns Violin shape points (left and right contours)
 */
export function violinShape(
  values: number[],
  options: {
    bandwidth?: number;
    steps?: number;
    maxWidth?: number;
  } = {},
): {
  left: Array<{ x: number; y: number }>;
  right: Array<{ x: number; y: number }>;
  stats: {
    min: number;
    max: number;
    median: number;
    q1: number;
    q3: number;
    mean: number;
  };
} {
  const { steps = 50, maxWidth = 1 } = options;

  if (values.length === 0) {
    return {
      left: [],
      right: [],
      stats: { min: 0, max: 0, median: 0, q1: 0, q3: 0, mean: 0 },
    };
  }

  // Calculate density
  const density = kernelDensityEstimation(values, {
    bandwidth: options.bandwidth,
    steps,
  });

  // Normalize to maxWidth
  const scale = maxWidth / (2 * density.maxDensity);

  // Generate contours
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < density.x.length; i++) {
    const y = density.x[i];
    const width = density.density[i] * scale;

    left.push({ x: -width, y });
    right.push({ x: width, y });
  }

  // Calculate statistics
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const stats = {
    min: sorted[0],
    max: sorted[n - 1],
    median: n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)],
    q1: sorted[Math.floor(n * 0.25)],
    q3: sorted[Math.floor(n * 0.75)],
    mean: values.reduce((sum, v) => sum + v, 0) / n,
  };

  return { left, right, stats };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Compute density at a specific point.
 */
export function densityAt(
  values: number[],
  x: number,
  bandwidth?: number,
  kernel: 'gaussian' | 'epanechnikov' | 'triangular' = 'gaussian',
): number {
  const h = bandwidth ?? silvermanBandwidth(values);
  const kernelFn = getKernelFunction(kernel);
  const n = values.length;

  let sum = 0;
  for (const v of values) {
    const u = (x - v) / h;
    sum += kernelFn(u);
  }

  return sum / (n * h);
}

/**
 * Find mode (peak of density).
 */
export function findMode(
  values: number[],
  options?: { bandwidth?: number; steps?: number },
): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const density = kernelDensityEstimation(values, options);
  const maxIndex = density.density.indexOf(safeMax(density.density));

  return density.x[maxIndex];
}

/**
 * Check if distribution is multimodal.
 */
export function isMultimodal(
  values: number[],
  options?: { bandwidth?: number; steps?: number; threshold?: number },
): boolean {
  const { threshold = 0.1 } = options ?? {};

  const density = kernelDensityEstimation(values, options);
  const maxDensity = safeMax(density.density);

  // Count local maxima above threshold
  let peaks = 0;
  const minPeakHeight = maxDensity * threshold;

  for (let i = 1; i < density.density.length - 1; i++) {
    const prev = density.density[i - 1];
    const curr = density.density[i];
    const next = density.density[i + 1];

    if (curr > prev && curr > next && curr > minPeakHeight) {
      peaks++;
    }
  }

  return peaks > 1;
}
