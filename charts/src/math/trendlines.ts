/**
 * Trendline Calculations
 *
 * Thin adapter over math/regression.ts that provides the Excel-compatible
 * trendline API using [number, number][] tuple format.
 *
 * All actual regression math is implemented in regression.ts.
 * This module converts between tuple format and Point format,
 * and preserves the original equation formatting and point generation.
 *
 * Supported types:
 * - Linear: y = mx + b
 * - Exponential: y = ae^(bx)
 * - Logarithmic: y = a + b*ln(x)
 * - Polynomial: y = a₀ + a₁x + a₂x² + ... + aₙxⁿ (degree 2-6)
 * - Power: y = ax^b
 * - Moving Average: rolling window average
 *
 * @module math/trendlines
 */

import type { TrendlineConfig } from '../types';
import { linearRegression, movingAverage, polynomialRegression, type Point } from './regression';

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

export interface TrendlineResult {
  /** Generated points for rendering */
  points: [number, number][];
  /** Coefficient of determination (0-1, higher is better fit) */
  r2: number;
  /** Human-readable equation string */
  equation: string;
  /** Regression coefficients (type-specific) */
  coefficients: TrendlineCoefficients;
}

export type TrendlineCoefficients =
  | LinearCoefficients
  | ExponentialCoefficients
  | LogarithmicCoefficients
  | PolynomialCoefficients
  | PowerCoefficients
  | MovingAverageCoefficients;

export interface LinearCoefficients {
  type: 'linear';
  slope: number;
  intercept: number;
}

export interface ExponentialCoefficients {
  type: 'exponential';
  a: number; // Multiplier
  b: number; // Exponent coefficient
}

export interface LogarithmicCoefficients {
  type: 'logarithmic';
  a: number; // Intercept
  b: number; // ln(x) coefficient
}

export interface PolynomialCoefficients {
  type: 'polynomial';
  coefficients: number[]; // [a₀, a₁, a₂, ..., aₙ]
  order: number;
}

export interface PowerCoefficients {
  type: 'power';
  a: number; // Multiplier
  b: number; // Exponent
}

export interface MovingAverageCoefficients {
  type: 'moving-average';
  period: number;
}

// =============================================================================
// Conversion Helpers
// =============================================================================

/** Convert [number, number][] tuples to Point[] objects */
function tuplesToPoints(tuples: [number, number][]): Point[] {
  return tuples.map(([x, y]) => ({ x, y }));
}

// =============================================================================
// Linear Regression (y = mx + b)
// =============================================================================

/**
 * Calculate linear regression: y = mx + b
 * Uses least squares method via regression.ts.
 */
export function calculateLinearRegression(points: [number, number][]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

  const result = linearRegression(tuplesToPoints(points));

  const slope = result.coefficients[1]; // [intercept, slope]
  const intercept = result.coefficients[0];

  // Calculate R² using original method for consistency
  const r2 = calculateR2(points, (x) => slope * x + intercept);

  return { slope, intercept, r2 };
}

/**
 * Generate linear trendline points.
 */
export function generateLinearTrendline(points: [number, number][]): TrendlineResult {
  if (points.length < 2) {
    return {
      points: [],
      r2: 0,
      equation: 'y = 0',
      coefficients: { type: 'linear', slope: 0, intercept: 0 },
    };
  }

  const { slope, intercept, r2 } = calculateLinearRegression(points);

  const xValues = points.map((p) => p[0]);
  const minX = safeMin(xValues);
  const maxX = safeMax(xValues);

  const trendlinePoints: [number, number][] = [
    [minX, slope * minX + intercept],
    [maxX, slope * maxX + intercept],
  ];

  const equation = formatLinearEquation(slope, intercept);

  return {
    points: trendlinePoints,
    r2,
    equation,
    coefficients: { type: 'linear', slope, intercept },
  };
}

// =============================================================================
// Exponential Regression (y = ae^(bx))
// =============================================================================

/**
 * Calculate exponential regression: y = ae^(bx)
 * Requires all y > 0.
 */
export function calculateExponentialRegression(points: [number, number][]): {
  a: number;
  b: number;
  r2: number;
} | null {
  // Filter out points where y <= 0 (can't take ln)
  const validPoints = points.filter(([, y]) => y > 0);
  if (validPoints.length < 2) return null;

  // Use linearRegression on transformed data to match original behavior:
  // Transform: ln(y) = ln(a) + bx
  const transformedPoints = validPoints.map(([x, y]) => ({ x, y: Math.log(y) }));
  const linResult = linearRegression(transformedPoints);

  const b = linResult.coefficients[1]; // slope
  const lnA = linResult.coefficients[0]; // intercept
  const a = Math.exp(lnA);

  // Calculate R² on original scale using only valid points
  const r2 = calculateR2(validPoints, (x) => a * Math.exp(b * x));

  return { a, b, r2 };
}

/**
 * Generate exponential trendline points.
 */
export function generateExponentialTrendline(
  points: [number, number][],
  numPoints: number = 50,
): TrendlineResult | null {
  const result = calculateExponentialRegression(points);
  if (!result) return null;

  const { a, b, r2 } = result;

  const xValues = points.map((p) => p[0]);
  const minX = safeMin(xValues);
  const maxX = safeMax(xValues);

  const trendlinePoints = generateCurvePoints(minX, maxX, numPoints, (x) => a * Math.exp(b * x));

  const equation = formatExponentialEquation(a, b);

  return {
    points: trendlinePoints,
    r2,
    equation,
    coefficients: { type: 'exponential', a, b },
  };
}

// =============================================================================
// Logarithmic Regression (y = a + b*ln(x))
// =============================================================================

/**
 * Calculate logarithmic regression: y = a + b*ln(x)
 * Requires all x > 0.
 */
export function calculateLogarithmicRegression(points: [number, number][]): {
  a: number;
  b: number;
  r2: number;
} | null {
  // Filter out points where x <= 0 (can't take ln)
  const validPoints = points.filter(([x]) => x > 0);
  if (validPoints.length < 2) return null;

  // Use linearRegression on transformed data to match original behavior:
  // Transform: X = ln(x)
  const transformedPoints = validPoints.map(([x, y]) => ({ x: Math.log(x), y }));
  const linResult = linearRegression(transformedPoints);

  const b = linResult.coefficients[1]; // slope
  const a = linResult.coefficients[0]; // intercept

  // Calculate R² on original scale
  const r2 = calculateR2(validPoints, (x) => a + b * Math.log(x));

  return { a, b, r2 };
}

/**
 * Generate logarithmic trendline points.
 */
export function generateLogarithmicTrendline(
  points: [number, number][],
  numPoints: number = 50,
): TrendlineResult | null {
  const result = calculateLogarithmicRegression(points);
  if (!result) return null;

  const { a, b, r2 } = result;

  // Only use positive x values
  const validPoints = points.filter(([x]) => x > 0);
  const xValues = validPoints.map((p) => p[0]);
  const minX = Math.max(safeMin(xValues), 0.001); // Avoid ln(0)
  const maxX = safeMax(xValues);

  const trendlinePoints = generateCurvePoints(minX, maxX, numPoints, (x) => a + b * Math.log(x));

  const equation = formatLogarithmicEquation(a, b);

  return {
    points: trendlinePoints,
    r2,
    equation,
    coefficients: { type: 'logarithmic', a, b },
  };
}

// =============================================================================
// Polynomial Regression (y = a₀ + a₁x + a₂x² + ... + aₙxⁿ)
// =============================================================================

/**
 * Calculate polynomial regression using normal equations via regression.ts.
 *
 * @param points - Data points
 * @param order - Polynomial degree (2-6)
 */
export function calculatePolynomialRegression(
  points: [number, number][],
  order: number,
): {
  coefficients: number[];
  r2: number;
} | null {
  const n = points.length;
  // Need at least order+1 points to fit a polynomial of given order
  if (n < order + 1) return null;

  // Clamp order to valid range (Excel supports 2-6)
  const clampedOrder = Math.max(2, Math.min(6, order));

  try {
    const result = polynomialRegression(tuplesToPoints(points), clampedOrder);
    const coefficients = result.coefficients;

    // Calculate R² using original method for consistency
    const predictFn = (x: number) => {
      let val = 0;
      for (let i = 0; i <= clampedOrder; i++) {
        val += coefficients[i] * Math.pow(x, i);
      }
      return val;
    };
    const r2 = calculateR2(points, predictFn);

    return { coefficients, r2 };
  } catch {
    return null;
  }
}

/**
 * Generate polynomial trendline points.
 */
export function generatePolynomialTrendline(
  points: [number, number][],
  order: number = 2,
  numPoints: number = 50,
): TrendlineResult | null {
  const result = calculatePolynomialRegression(points, order);
  if (!result) return null;

  const { coefficients, r2 } = result;
  const clampedOrder = Math.max(2, Math.min(6, order));

  const xValues = points.map((p) => p[0]);
  const minX = safeMin(xValues);
  const maxX = safeMax(xValues);

  const predictFn = (x: number) => {
    let val = 0;
    for (let i = 0; i <= clampedOrder; i++) {
      val += coefficients[i] * Math.pow(x, i);
    }
    return val;
  };

  const trendlinePoints = generateCurvePoints(minX, maxX, numPoints, predictFn);

  const equation = formatPolynomialEquation(coefficients);

  return {
    points: trendlinePoints,
    r2,
    equation,
    coefficients: { type: 'polynomial', coefficients, order: clampedOrder },
  };
}

// =============================================================================
// Power Regression (y = ax^b)
// =============================================================================

/**
 * Calculate power regression: y = ax^b
 * Requires all x > 0 and y > 0.
 */
export function calculatePowerRegression(points: [number, number][]): {
  a: number;
  b: number;
  r2: number;
} | null {
  // Filter out points where x <= 0 or y <= 0
  const validPoints = points.filter(([x, y]) => x > 0 && y > 0);
  if (validPoints.length < 2) return null;

  // Use linearRegression on transformed data to match original behavior:
  // Transform: ln(y) = ln(a) + b*ln(x)
  const transformedPoints = validPoints.map(([x, y]) => ({
    x: Math.log(x),
    y: Math.log(y),
  }));
  const linResult = linearRegression(transformedPoints);

  const b = linResult.coefficients[1]; // slope
  const lnA = linResult.coefficients[0]; // intercept
  const a = Math.exp(lnA);

  // Calculate R² on original scale
  const r2 = calculateR2(validPoints, (x) => a * Math.pow(x, b));

  return { a, b, r2 };
}

/**
 * Generate power trendline points.
 */
export function generatePowerTrendline(
  points: [number, number][],
  numPoints: number = 50,
): TrendlineResult | null {
  const result = calculatePowerRegression(points);
  if (!result) return null;

  const { a, b, r2 } = result;

  // Only use positive x values
  const validPoints = points.filter(([x]) => x > 0);
  const xValues = validPoints.map((p) => p[0]);
  const minX = Math.max(safeMin(xValues), 0.001); // Avoid x^b issues at 0
  const maxX = safeMax(xValues);

  const trendlinePoints = generateCurvePoints(minX, maxX, numPoints, (x) => a * Math.pow(x, b));

  const equation = formatPowerEquation(a, b);

  return {
    points: trendlinePoints,
    r2,
    equation,
    coefficients: { type: 'power', a, b },
  };
}

// =============================================================================
// Moving Average
// =============================================================================

/**
 * Calculate moving average trendline.
 *
 * @param points - Data points (sorted by x recommended)
 * @param period - Window size for averaging
 */
export function generateMovingAverageTrendline(
  points: [number, number][],
  period: number = 2,
): TrendlineResult {
  const effectivePeriod = Math.max(2, Math.min(period, points.length));

  // Sort by x value
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const sortedPointObjs = tuplesToPoints(sorted);

  const maResult = movingAverage(sortedPointObjs, effectivePeriod);
  const trendlinePoints: [number, number][] = maResult.points.map((p) => [p.x, p.y]);

  // R² for moving average isn't as meaningful, but we can compute it
  const r2 = trendlinePoints.length > 0 ? calculateMovingAverageR2(sorted, trendlinePoints) : 0;

  return {
    points: trendlinePoints,
    r2,
    equation: `${effectivePeriod}-period moving average`,
    coefficients: { type: 'moving-average', period: effectivePeriod },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Generate trendline points based on configuration.
 * This is the main entry point used by the chart renderer.
 */
export function generateTrendlinePoints(
  points: [number, number][],
  config: TrendlineConfig,
): TrendlineResult | null {
  if (points.length < 2) return null;

  const type = config.type;
  let result: TrendlineResult | null;

  switch (type) {
    case 'linear':
      result =
        config.intercept !== undefined
          ? generateLinearTrendlineWithIntercept(points, config.intercept)
          : generateLinearTrendline(points);
      break;

    case 'exponential':
      result = generateExponentialTrendline(points);
      break;

    case 'logarithmic':
      result = generateLogarithmicTrendline(points);
      break;

    case 'polynomial':
      result = generatePolynomialTrendline(points, config.order ?? 2);
      break;

    case 'power':
      result = generatePowerTrendline(points);
      break;

    case 'moving-average':
      result = generateMovingAverageTrendline(points, config.period ?? 2);
      break;

    default:
      // Fallback to linear for unknown types
      result = generateLinearTrendline(points);
  }

  return result ? applyTrendlineProjection(result, points, config) : null;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate R² (coefficient of determination).
 */
function calculateR2(points: [number, number][], predictFn: (x: number) => number): number {
  const n = points.length;
  if (n === 0) return 0;

  const yValues = points.map((p) => p[1]);
  const meanY = yValues.reduce((a, b) => a + b, 0) / n;

  let ssTotal = 0;
  let ssResidual = 0;

  for (const [x, y] of points) {
    const predicted = predictFn(x);
    ssTotal += (y - meanY) ** 2;
    ssResidual += (y - predicted) ** 2;
  }

  // Avoid division by zero
  if (ssTotal === 0) return 1; // Perfect prediction when all y values are the same

  return Math.max(0, 1 - ssResidual / ssTotal);
}

function generateLinearTrendlineWithIntercept(
  points: [number, number][],
  intercept: number,
): TrendlineResult {
  const denominator = points.reduce((sum, [x]) => sum + x * x, 0);
  const slope =
    denominator === 0
      ? 0
      : points.reduce((sum, [x, y]) => sum + x * (y - intercept), 0) / denominator;
  const r2 = calculateR2(points, (x) => slope * x + intercept);
  const xValues = points.map((p) => p[0]);
  const minX = safeMin(xValues);
  const maxX = safeMax(xValues);

  return {
    points: [
      [minX, slope * minX + intercept],
      [maxX, slope * maxX + intercept],
    ],
    r2,
    equation: formatLinearEquation(slope, intercept),
    coefficients: { type: 'linear', slope, intercept },
  };
}

function applyTrendlineProjection(
  result: TrendlineResult,
  sourcePoints: [number, number][],
  config: TrendlineConfig,
): TrendlineResult {
  if (result.coefficients.type === 'moving-average') return result;

  const forward = finiteProjection(config.forward ?? config.forwardPeriod);
  const backward = finiteProjection(config.backward ?? config.backwardPeriod);
  if (forward === 0 && backward === 0) return result;

  const xValues = sourcePoints.map((p) => p[0]).filter(Number.isFinite);
  if (xValues.length === 0) return result;

  let minX = safeMin(xValues) - backward;
  let maxX = safeMax(xValues) + forward;
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX >= maxX) return result;

  if (result.coefficients.type === 'logarithmic' || result.coefficients.type === 'power') {
    minX = Math.max(minX, 0.001);
    if (minX >= maxX) return result;
  }

  const pointCount = result.coefficients.type === 'linear' ? 2 : Math.max(2, result.points.length);
  const projected = generateCurvePoints(minX, maxX, pointCount, (x) =>
    predictTrendline(result.coefficients, x),
  );
  return projected.length > 0 ? { ...result, points: projected } : result;
}

function finiteProjection(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function predictTrendline(coefficients: TrendlineCoefficients, x: number): number {
  switch (coefficients.type) {
    case 'linear':
      return coefficients.slope * x + coefficients.intercept;
    case 'exponential':
      return coefficients.a * Math.exp(coefficients.b * x);
    case 'logarithmic':
      return x > 0 ? coefficients.a + coefficients.b * Math.log(x) : Number.NaN;
    case 'polynomial':
      return coefficients.coefficients.reduce(
        (sum, coefficient, power) => sum + coefficient * Math.pow(x, power),
        0,
      );
    case 'power':
      return x > 0 ? coefficients.a * Math.pow(x, coefficients.b) : Number.NaN;
    case 'moving-average':
      return Number.NaN;
  }
}

/**
 * Calculate R² for moving average.
 */
function calculateMovingAverageR2(
  original: [number, number][],
  maPoints: [number, number][],
): number {
  if (maPoints.length === 0) return 0;

  // Create a map from x to MA value
  const maMap = new Map<number, number>();
  for (const [x, y] of maPoints) {
    maMap.set(x, y);
  }

  // Only consider original points that have a corresponding MA value
  const matchedPoints = original.filter(([x]) => maMap.has(x));
  if (matchedPoints.length === 0) return 0;

  const yValues = matchedPoints.map((p) => p[1]);
  const meanY = yValues.reduce((a, b) => a + b, 0) / yValues.length;

  let ssTotal = 0;
  let ssResidual = 0;

  for (const [x, y] of matchedPoints) {
    const predicted = maMap.get(x)!;
    ssTotal += (y - meanY) ** 2;
    ssResidual += (y - predicted) ** 2;
  }

  if (ssTotal === 0) return 1;

  return Math.max(0, 1 - ssResidual / ssTotal);
}

/**
 * Generate evenly-spaced curve points.
 */
function generateCurvePoints(
  minX: number,
  maxX: number,
  numPoints: number,
  fn: (x: number) => number,
): [number, number][] {
  const points: [number, number][] = [];
  const step = (maxX - minX) / (numPoints - 1);

  for (let i = 0; i < numPoints; i++) {
    const x = minX + i * step;
    const y = fn(x);
    // Skip NaN or Infinity values
    if (Number.isFinite(y)) {
      points.push([x, y]);
    }
  }

  return points;
}

// =============================================================================
// Equation Formatters
// =============================================================================

/**
 * Format linear equation: y = mx + b
 */
function formatLinearEquation(slope: number, intercept: number): string {
  const m = formatNumber(slope);
  const b = formatNumber(Math.abs(intercept));
  const sign = intercept >= 0 ? '+' : '-';
  return `y = ${m}x ${sign} ${b}`;
}

/**
 * Format exponential equation: y = ae^(bx)
 */
function formatExponentialEquation(a: number, b: number): string {
  return `y = ${formatNumber(a)}e^(${formatNumber(b)}x)`;
}

/**
 * Format logarithmic equation: y = a + b*ln(x)
 */
function formatLogarithmicEquation(a: number, b: number): string {
  const aStr = formatNumber(a);
  const bStr = formatNumber(Math.abs(b));
  const sign = b >= 0 ? '+' : '-';
  return `y = ${aStr} ${sign} ${bStr}ln(x)`;
}

/**
 * Format polynomial equation: y = a₀ + a₁x + a₂x² + ...
 */
function formatPolynomialEquation(coefficients: number[]): string {
  const terms: string[] = [];

  for (let i = coefficients.length - 1; i >= 0; i--) {
    const coef = coefficients[i];
    if (Math.abs(coef) < 1e-10) continue;

    const absCoef = Math.abs(coef);
    const sign = coef >= 0 ? (terms.length > 0 ? ' + ' : '') : ' - ';

    if (i === 0) {
      terms.push(`${sign}${formatNumber(absCoef)}`);
    } else if (i === 1) {
      if (Math.abs(absCoef - 1) < 1e-10) {
        terms.push(`${sign}x`);
      } else {
        terms.push(`${sign}${formatNumber(absCoef)}x`);
      }
    } else {
      if (Math.abs(absCoef - 1) < 1e-10) {
        terms.push(`${sign}x^${i}`);
      } else {
        terms.push(`${sign}${formatNumber(absCoef)}x^${i}`);
      }
    }
  }

  return `y = ${terms.join('').trim() || '0'}`;
}

/**
 * Format power equation: y = ax^b
 */
function formatPowerEquation(a: number, b: number): string {
  return `y = ${formatNumber(a)}x^${formatNumber(b)}`;
}

/**
 * Format number to reasonable precision.
 */
function formatNumber(n: number): string {
  // Use fixed notation for small numbers, scientific for large
  if (Math.abs(n) < 0.0001 || Math.abs(n) > 100000) {
    return n.toExponential(3);
  }
  // Round to 4 significant figures
  return parseFloat(n.toPrecision(4)).toString();
}
