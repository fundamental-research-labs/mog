/**
 * Regression Functions for Chart Math Utilities
 *
 * Pure functions implementing various regression methods for trendlines:
 * - Linear regression
 * - Polynomial regression (arbitrary degree)
 * - Exponential regression
 * - Logarithmic regression
 * - Power regression
 *
 * Single implementation for all regression math in the charts package.
 * The trendlines module (core/trendlines.ts) is a format adapter that
 * delegates to these functions.
 *
 * No external dependencies - all calculations from scratch.
 */

import { mean, sum } from './statistics';

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
 * A point with x and y coordinates.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Regression result with prediction function and statistics.
 */
export interface RegressionResult {
  /** Predict y for a given x value */
  predict: (x: number) => number;
  /** Regression coefficients (interpretation depends on method) */
  coefficients: number[];
  /** R-squared (coefficient of determination) */
  rSquared: number;
  /** Generated points for rendering the regression line/curve */
  points: Point[];
  /** Name of the regression type */
  type: string;
  /** Equation string for display */
  equation: string;
}

/**
 * Options for regression calculations.
 */
export interface RegressionOptions {
  /** Number of points to generate for rendering (default: 50) */
  numPoints?: number;
  /** Minimum x value for generated points (default: min of data) */
  minX?: number;
  /** Maximum x value for generated points (default: max of data) */
  maxX?: number;
  /** Precision for equation display (default: 4) */
  precision?: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate R-squared (coefficient of determination).
 * R^2 = 1 - (SS_res / SS_tot)
 */
function calculateRSquared(data: Point[], predict: (x: number) => number): number {
  if (data.length === 0) return NaN;

  const yMean = mean(data.map((p) => p.y));

  let ssTot = 0;
  let ssRes = 0;

  for (const point of data) {
    const predicted = predict(point.x);
    ssTot += (point.y - yMean) ** 2;
    ssRes += (point.y - predicted) ** 2;
  }

  if (ssTot === 0) return 1; // All y values are the same

  // Clamp to [0, 1] for Excel compatibility (R^2 can be negative for poor fits)
  return Math.max(0, 1 - ssRes / ssTot);
}

/**
 * Generate points for rendering the regression curve.
 */
function generatePoints(
  data: Point[],
  predict: (x: number) => number,
  options: RegressionOptions = {},
): Point[] {
  if (data.length === 0) return [];

  const { numPoints = 50 } = options;
  const xValues = data.map((p) => p.x);
  const minX = options.minX ?? safeMin(xValues);
  const maxX = options.maxX ?? safeMax(xValues);

  const step = (maxX - minX) / (numPoints - 1);
  const points: Point[] = [];

  for (let i = 0; i < numPoints; i++) {
    const x = minX + i * step;
    const y = predict(x);
    if (isFinite(y)) {
      points.push({ x, y });
    }
  }

  return points;
}

/**
 * Round number for display in equation.
 */
function roundCoef(value: number, precision: number): string {
  if (Math.abs(value) < Math.pow(10, -precision)) return '0';
  return value.toPrecision(precision);
}

// =============================================================================
// Linear Regression
// =============================================================================

/**
 * Linear regression: y = mx + b
 *
 * Uses the least squares method to find the best-fit line.
 *
 * @param data - Array of {x, y} points
 * @param options - Configuration options
 * @returns Regression result with predict function, coefficients [b, m], and R^2
 *
 * @example
 * const data = [{x: 1, y: 2}, {x: 2, y: 4}, {x: 3, y: 5}];
 * const result = linearRegression(data);
 * result.predict(4); // Predicts y for x=4
 */
export function linearRegression(data: Point[], options: RegressionOptions = {}): RegressionResult {
  const { precision = 4 } = options;

  if (data.length === 0) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'linear',
      equation: 'y = NaN',
    };
  }

  if (data.length === 1) {
    const b = data[0].y;
    return {
      predict: () => b,
      coefficients: [b, 0],
      rSquared: 1,
      points: [data[0]],
      type: 'linear',
      equation: `y = ${roundCoef(b, precision)}`,
    };
  }

  const n = data.length;
  const sumX = sum(data.map((p) => p.x));
  const sumY = sum(data.map((p) => p.y));
  const sumXY = sum(data.map((p) => p.x * p.y));
  const sumX2 = sum(data.map((p) => p.x * p.x));

  const denominator = n * sumX2 - sumX * sumX;

  // Handle degenerate case (all x values are the same)
  if (denominator === 0) {
    const avgY = sumY / n;
    return {
      predict: () => avgY,
      coefficients: [avgY, 0],
      rSquared: 0,
      points: data.map((p) => ({ x: p.x, y: avgY })),
      type: 'linear',
      equation: `y = ${roundCoef(avgY, precision)}`,
    };
  }

  // Calculate slope (m) and intercept (b)
  const m = (n * sumXY - sumX * sumY) / denominator;
  const b = (sumY - m * sumX) / n;

  const predict = (x: number): number => m * x + b;
  const rSquared = calculateRSquared(data, predict);
  const points = generatePoints(data, predict, options);

  // Build equation string
  const mStr = roundCoef(m, precision);
  const bStr = roundCoef(Math.abs(b), precision);
  const sign = b >= 0 ? '+' : '-';
  const equation = b === 0 ? `y = ${mStr}x` : `y = ${mStr}x ${sign} ${bStr}`;

  return {
    predict,
    coefficients: [b, m], // [intercept, slope]
    rSquared,
    points,
    type: 'linear',
    equation,
  };
}

// =============================================================================
// Polynomial Regression
// =============================================================================

/**
 * Solve a system of linear equations using Gaussian elimination with partial pivoting.
 * Solves Ax = b for x.
 */
function gaussianElimination(A: number[][], b: number[]): number[] | null {
  const n = A.length;

  // Create augmented matrix
  const augmented: number[][] = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
        maxRow = row;
      }
    }

    // Swap rows
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];

    // Check for singular matrix - return null instead of silently continuing
    if (Math.abs(augmented[col][col]) < 1e-10) {
      return null;
    }

    // Eliminate column
    for (let row = col + 1; row < n; row++) {
      const factor = augmented[row][col] / augmented[col][col];
      for (let j = col; j <= n; j++) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = augmented[row][n];
    for (let col = row + 1; col < n; col++) {
      sum -= augmented[row][col] * x[col];
    }
    if (Math.abs(augmented[row][row]) < 1e-10) {
      return null;
    }
    x[row] = sum / augmented[row][row];
  }

  return x;
}

/**
 * Polynomial regression: y = a0 + a1*x + a2*x^2 + ... + an*x^n
 *
 * Uses the normal equations method to fit a polynomial of specified degree.
 *
 * @param data - Array of {x, y} points
 * @param degree - Polynomial degree (1 = linear, 2 = quadratic, etc.)
 * @param options - Configuration options
 * @returns Regression result with coefficients [a0, a1, ..., an]
 *
 * @example
 * const data = [{x: 1, y: 1}, {x: 2, y: 4}, {x: 3, y: 9}];
 * const result = polynomialRegression(data, 2);
 * result.predict(4); // Predicts y for x=4
 */
export function polynomialRegression(
  data: Point[],
  degree: number,
  options: RegressionOptions = {},
): RegressionResult {
  const { precision = 4 } = options;

  if (degree < 1) {
    throw new Error('Polynomial degree must be at least 1');
  }

  // For degree 1, use optimized linear regression
  if (degree === 1) {
    return linearRegression(data, options);
  }

  // Clamp polynomial order to [2, 6] for Excel compatibility
  const clampedDegree = Math.max(2, Math.min(6, degree));

  if (data.length === 0) {
    return {
      predict: () => NaN,
      coefficients: new Array(clampedDegree + 1).fill(NaN),
      rSquared: NaN,
      points: [],
      type: `polynomial-${clampedDegree}`,
      equation: 'y = NaN',
    };
  }

  const n = data.length;
  const numCoeffs = clampedDegree + 1;

  // Need at least as many points as coefficients
  if (n < numCoeffs) {
    throw new Error(
      `Need at least ${numCoeffs} data points for degree ${clampedDegree} polynomial`,
    );
  }

  // Build the Vandermonde matrix and solve normal equations
  // X^T * X * a = X^T * y

  // Build X^T * X matrix
  const XTX: number[][] = [];
  for (let i = 0; i < numCoeffs; i++) {
    XTX[i] = [];
    for (let j = 0; j < numCoeffs; j++) {
      let sumVal = 0;
      for (const point of data) {
        sumVal += Math.pow(point.x, i + j);
      }
      XTX[i][j] = sumVal;
    }
  }

  // Build X^T * y vector
  const XTy: number[] = [];
  for (let i = 0; i < numCoeffs; i++) {
    let sumVal = 0;
    for (const point of data) {
      sumVal += Math.pow(point.x, i) * point.y;
    }
    XTy[i] = sumVal;
  }

  // Solve the system
  const coefficients = gaussianElimination(XTX, XTy);

  // Handle singular matrix (e.g., collinear data)
  if (coefficients === null) {
    const avgY = mean(data.map((p) => p.y));
    return {
      predict: () => avgY,
      coefficients: new Array(degree + 1).fill(0),
      rSquared: 0,
      points: data.map((p) => ({ x: p.x, y: avgY })),
      type: `polynomial-${degree}`,
      equation: `y = ${roundCoef(avgY, precision)}`,
    };
  }

  // Create prediction function
  const predict = (x: number): number => {
    let y = 0;
    for (let i = 0; i < coefficients.length; i++) {
      y += coefficients[i] * Math.pow(x, i);
    }
    return y;
  };

  const rSquared = calculateRSquared(data, predict);
  const points = generatePoints(data, predict, options);

  // Build equation string
  const terms: string[] = [];
  for (let i = coefficients.length - 1; i >= 0; i--) {
    const coef = coefficients[i];
    if (Math.abs(coef) < 1e-10) continue;

    const coefStr = roundCoef(Math.abs(coef), precision);
    const sign = coef >= 0 ? '+' : '-';

    if (i === 0) {
      terms.push(`${sign} ${coefStr}`);
    } else if (i === 1) {
      terms.push(`${sign} ${coefStr}x`);
    } else {
      terms.push(`${sign} ${coefStr}x^${i}`);
    }
  }

  let equation = 'y = ' + terms.join(' ').replace(/^\+ /, '');
  if (equation === 'y = ') equation = 'y = 0';

  return {
    predict,
    coefficients,
    rSquared,
    points,
    type: `polynomial-${clampedDegree}`,
    equation,
  };
}

// =============================================================================
// Exponential Regression
// =============================================================================

/**
 * Exponential regression: y = a * e^(b*x)
 *
 * Linearizes by taking log(y) = log(a) + b*x, then uses linear regression.
 * Note: All y values must be positive.
 *
 * @param data - Array of {x, y} points (y must be positive)
 * @param options - Configuration options
 * @returns Regression result with coefficients [a, b]
 */
export function exponentialRegression(
  data: Point[],
  options: RegressionOptions = {},
): RegressionResult {
  const { precision = 4 } = options;

  if (data.length === 0) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'exponential',
      equation: 'y = NaN',
    };
  }

  // Filter out non-positive y values
  const validData = data.filter((p) => p.y > 0);
  if (validData.length < 2) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'exponential',
      equation: 'y = NaN (requires positive y values)',
    };
  }

  // Transform: ln(y) = ln(a) + b*x
  const transformedData = validData.map((p) => ({
    x: p.x,
    y: Math.log(p.y),
  }));

  // Linear regression on transformed data
  const linearResult = linearRegression(transformedData);
  const lnA = linearResult.coefficients[0]; // intercept = ln(a)
  const b = linearResult.coefficients[1]; // slope = b

  const a = Math.exp(lnA);

  const predict = (x: number): number => a * Math.exp(b * x);

  // Calculate R^2 on original scale
  const rSquared = calculateRSquared(data, predict);
  const points = generatePoints(data, predict, options);

  // Build equation string
  const aStr = roundCoef(a, precision);
  const bStr = roundCoef(b, precision);
  const equation = `y = ${aStr} * e^(${bStr}x)`;

  return {
    predict,
    coefficients: [a, b],
    rSquared,
    points,
    type: 'exponential',
    equation,
  };
}

// =============================================================================
// Logarithmic Regression
// =============================================================================

/**
 * Logarithmic regression: y = a + b * ln(x)
 *
 * Linearizes by substituting ln(x) for x.
 * Note: All x values must be positive.
 *
 * @param data - Array of {x, y} points (x must be positive)
 * @param options - Configuration options
 * @returns Regression result with coefficients [a, b]
 */
export function logarithmicRegression(
  data: Point[],
  options: RegressionOptions = {},
): RegressionResult {
  const { precision = 4 } = options;

  if (data.length === 0) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'logarithmic',
      equation: 'y = NaN',
    };
  }

  // Filter out non-positive x values
  const validData = data.filter((p) => p.x > 0);
  if (validData.length < 2) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'logarithmic',
      equation: 'y = NaN (requires positive x values)',
    };
  }

  // Transform: y = a + b * ln(x) => linear regression with ln(x) as x
  const transformedData = validData.map((p) => ({
    x: Math.log(p.x),
    y: p.y,
  }));

  const linearResult = linearRegression(transformedData);
  const a = linearResult.coefficients[0]; // intercept
  const b = linearResult.coefficients[1]; // slope

  const predict = (x: number): number => {
    if (x <= 0) return NaN;
    return a + b * Math.log(x);
  };

  // Calculate R^2 using only valid data points
  const rSquared = calculateRSquared(validData, predict);

  // Generate points (only for positive x)
  const xValues = data.filter((p) => p.x > 0).map((p) => p.x);
  const minX = options.minX ?? Math.max(0.001, safeMin(xValues));
  const maxX = options.maxX ?? safeMax(xValues);
  const points = generatePoints(data, predict, { ...options, minX, maxX });

  // Build equation string
  const aStr = roundCoef(a, precision);
  const bStr = roundCoef(Math.abs(b), precision);
  const sign = b >= 0 ? '+' : '-';
  const equation = `y = ${aStr} ${sign} ${bStr} * ln(x)`;

  return {
    predict,
    coefficients: [a, b],
    rSquared,
    points,
    type: 'logarithmic',
    equation,
  };
}

// =============================================================================
// Power Regression
// =============================================================================

/**
 * Power regression: y = a * x^b
 *
 * Linearizes by taking log: ln(y) = ln(a) + b*ln(x)
 * Note: All x and y values must be positive.
 *
 * @param data - Array of {x, y} points (x and y must be positive)
 * @param options - Configuration options
 * @returns Regression result with coefficients [a, b]
 */
export function powerRegression(data: Point[], options: RegressionOptions = {}): RegressionResult {
  const { precision = 4 } = options;

  if (data.length === 0) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'power',
      equation: 'y = NaN',
    };
  }

  // Filter out non-positive values
  const validData = data.filter((p) => p.x > 0 && p.y > 0);
  if (validData.length < 2) {
    return {
      predict: () => NaN,
      coefficients: [NaN, NaN],
      rSquared: NaN,
      points: [],
      type: 'power',
      equation: 'y = NaN (requires positive x and y values)',
    };
  }

  // Transform: ln(y) = ln(a) + b*ln(x)
  const transformedData = validData.map((p) => ({
    x: Math.log(p.x),
    y: Math.log(p.y),
  }));

  const linearResult = linearRegression(transformedData);
  const lnA = linearResult.coefficients[0]; // intercept = ln(a)
  const b = linearResult.coefficients[1]; // slope = b

  const a = Math.exp(lnA);

  const predict = (x: number): number => {
    if (x <= 0) return NaN;
    return a * Math.pow(x, b);
  };

  // Calculate R^2 on original scale
  const rSquared = calculateRSquared(data, predict);

  // Generate points (only for positive x)
  const xValues = data.filter((p) => p.x > 0).map((p) => p.x);
  const minX = options.minX ?? Math.max(0.001, safeMin(xValues));
  const maxX = options.maxX ?? safeMax(xValues);
  const points = generatePoints(data, predict, { ...options, minX, maxX });

  // Build equation string
  const aStr = roundCoef(a, precision);
  const bStr = roundCoef(b, precision);
  const equation = `y = ${aStr} * x^${bStr}`;

  return {
    predict,
    coefficients: [a, b],
    rSquared,
    points,
    type: 'power',
    equation,
  };
}

// =============================================================================
// Moving Average
// =============================================================================

/**
 * Moving average result.
 */
export interface MovingAverageResult {
  /** Points representing the moving average */
  points: Point[];
  /** Type identifier */
  type: string;
}

/**
 * Simple Moving Average (SMA).
 *
 * @param data - Array of {x, y} points (must be sorted by x)
 * @param period - Number of points to average
 * @returns Moving average result
 */
export function movingAverage(data: Point[], period: number): MovingAverageResult {
  if (data.length < period || period < 1) {
    return { points: [], type: 'moving-average' };
  }

  const points: Point[] = [];

  for (let i = period - 1; i < data.length; i++) {
    let sumY = 0;
    for (let j = 0; j < period; j++) {
      sumY += data[i - j].y;
    }
    // Use trailing x (the last/current point's x) for Excel compatibility
    points.push({
      x: data[i].x,
      y: sumY / period,
    });
  }

  return { points, type: 'moving-average' };
}

// =============================================================================
// Regression Type Selection
// =============================================================================

/**
 * Supported regression types.
 */
export type RegressionType = 'linear' | 'polynomial' | 'exponential' | 'logarithmic' | 'power';

/**
 * Create a regression based on type string.
 *
 * @param data - Array of {x, y} points
 * @param type - Type of regression
 * @param degree - Polynomial degree (only for polynomial type)
 * @param options - Regression options
 */
export function createRegression(
  data: Point[],
  type: RegressionType,
  degree: number = 2,
  options: RegressionOptions = {},
): RegressionResult {
  switch (type) {
    case 'linear':
      return linearRegression(data, options);
    case 'polynomial':
      return polynomialRegression(data, degree, options);
    case 'exponential':
      return exponentialRegression(data, options);
    case 'logarithmic':
      return logarithmicRegression(data, options);
    case 'power':
      return powerRegression(data, options);
    default:
      throw new Error(`Unknown regression type: ${type}`);
  }
}
