/**
 * Regression Transform
 *
 * Computes regression/trendline for data.
 * Supports linear, polynomial, exponential, logarithmic, and power regression.
 *
 * Pure functions - no side effects.
 */

import type { DataRow, RegressionSpec } from '../spec';

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
 * Regression result with coefficients.
 */
export interface RegressionResult {
  /** Type of regression */
  method: string;
  /** Polynomial order (if applicable) */
  order?: number;
  /** Regression coefficients */
  coefficients: number[];
  /** R-squared value */
  rSquared: number;
  /** Prediction function */
  predict: (x: number) => number;
}

// =============================================================================
// Regression Transform
// =============================================================================

/**
 * Apply a regression transform to data.
 *
 * @param data - Input data rows
 * @param spec - Regression specification
 * @returns Data rows with regression points
 */
export function applyRegression(data: DataRow[], spec: RegressionSpec): DataRow[] {
  const {
    regression: xField,
    on: yField,
    method = 'linear',
    order = 2,
    as = [xField, yField],
  } = spec;

  // Extract x and y values
  const points = data
    .map((d) => ({
      x: d[xField] as number,
      y: d[yField] as number,
    }))
    .filter(
      (p) => typeof p.x === 'number' && typeof p.y === 'number' && !isNaN(p.x) && !isNaN(p.y),
    );

  if (points.length < 2) {
    return [];
  }

  // Compute regression
  const result = computeRegression(
    points.map((p) => p.x),
    points.map((p) => p.y),
    method,
    order,
  );

  // Generate regression line points
  const xValues = points.map((p) => p.x);
  const xMin = safeMin(xValues);
  const xMax = safeMax(xValues);

  // Generate points along the regression line
  const numPoints = 100;
  const step = (xMax - xMin) / (numPoints - 1);

  const regressionData: DataRow[] = [];

  for (let i = 0; i < numPoints; i++) {
    const x = xMin + i * step;
    const y = result.predict(x);

    regressionData.push({
      [as[0]]: x,
      [as[1]]: y,
    });
  }

  return regressionData;
}

/**
 * Compute regression coefficients and prediction function.
 */
export function computeRegression(
  x: number[],
  y: number[],
  method: string,
  order: number = 2,
): RegressionResult {
  switch (method) {
    case 'linear':
      return linearRegression(x, y);
    case 'poly':
    case 'polynomial':
    case 'quad':
      return polynomialRegression(x, y, method === 'quad' ? 2 : order);
    case 'exp':
    case 'exponential':
      return exponentialRegression(x, y);
    case 'log':
    case 'logarithmic':
      return logarithmicRegression(x, y);
    case 'pow':
    case 'power':
      return powerRegression(x, y);
    default:
      return linearRegression(x, y);
  }
}

// =============================================================================
// Linear Regression
// =============================================================================

/**
 * Compute linear regression: y = mx + b
 */
export function linearRegression(x: number[], y: number[]): RegressionResult {
  const n = x.length;

  if (n < 2) {
    return {
      method: 'linear',
      coefficients: [0, y[0] || 0],
      rSquared: 0,
      predict: () => y[0] || 0,
    };
  }

  // Calculate means
  const xMean = x.reduce((sum, v) => sum + v, 0) / n;
  const yMean = y.reduce((sum, v) => sum + v, 0) / n;

  // Calculate slope (m) and intercept (b)
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean);
    denominator += (x[i] - xMean) ** 2;
  }

  const m = denominator !== 0 ? numerator / denominator : 0;
  const b = yMean - m * xMean;

  // Calculate R-squared
  const rSquared = calculateRSquared(x, y, (xi) => m * xi + b);

  return {
    method: 'linear',
    coefficients: [m, b],
    rSquared,
    predict: (xi) => m * xi + b,
  };
}

// =============================================================================
// Polynomial Regression
// =============================================================================

/**
 * Compute polynomial regression: y = a0 + a1*x + a2*x^2 + ... + an*x^n
 */
export function polynomialRegression(
  x: number[],
  y: number[],
  order: number = 2,
): RegressionResult {
  const n = x.length;

  if (n < order + 1) {
    return linearRegression(x, y);
  }

  // Build Vandermonde matrix
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j <= order; j++) {
      row.push(Math.pow(x[i], j));
    }
    X.push(row);
  }

  // Solve using normal equations: (X'X)^-1 * X'y
  const coefficients = solveNormalEquations(X, y);

  const predict = (xi: number): number => {
    let result = 0;
    for (let j = 0; j < coefficients.length; j++) {
      result += coefficients[j] * Math.pow(xi, j);
    }
    return result;
  };

  const rSquared = calculateRSquared(x, y, predict);

  return {
    method: 'polynomial',
    order,
    coefficients,
    rSquared,
    predict,
  };
}

/**
 * Solve normal equations using Gaussian elimination.
 */
function solveNormalEquations(X: number[][], y: number[]): number[] {
  const n = X.length;
  const m = X[0].length;

  // Compute X'X
  const XtX: number[][] = Array(m)
    .fill(null)
    .map(() => Array(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < n; k++) {
        XtX[i][j] += X[k][i] * X[k][j];
      }
    }
  }

  // Compute X'y
  const Xty: number[] = Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < n; k++) {
      Xty[i] += X[k][i] * y[k];
    }
  }

  // Solve using Gaussian elimination with partial pivoting
  const augmented = XtX.map((row, i) => [...row, Xty[i]]);

  // Forward elimination
  for (let i = 0; i < m; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < m; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }

    // Swap rows
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    // Eliminate below
    for (let k = i + 1; k < m; k++) {
      if (augmented[i][i] !== 0) {
        const factor = augmented[k][i] / augmented[i][i];
        for (let j = i; j <= m; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }
  }

  // Back substitution
  const result = Array(m).fill(0);
  for (let i = m - 1; i >= 0; i--) {
    let sum = augmented[i][m];
    for (let j = i + 1; j < m; j++) {
      sum -= augmented[i][j] * result[j];
    }
    result[i] = augmented[i][i] !== 0 ? sum / augmented[i][i] : 0;
  }

  return result;
}

// =============================================================================
// Exponential Regression
// =============================================================================

/**
 * Compute exponential regression: y = a * e^(b*x)
 * Uses log transformation: ln(y) = ln(a) + b*x
 */
export function exponentialRegression(x: number[], y: number[]): RegressionResult {
  // Filter positive y values for log transformation
  const validPoints = x.map((xi, i) => ({ x: xi, y: y[i] })).filter((p) => p.y > 0);

  if (validPoints.length < 2) {
    return {
      method: 'exponential',
      coefficients: [1, 0],
      rSquared: 0,
      predict: () => 1,
    };
  }

  const xValid = validPoints.map((p) => p.x);
  const yLog = validPoints.map((p) => Math.log(p.y));

  const linear = linearRegression(xValid, yLog);
  const [b, lnA] = linear.coefficients;
  const a = Math.exp(lnA);

  const predict = (xi: number): number => a * Math.exp(b * xi);
  const rSquared = calculateRSquared(x, y, predict);

  return {
    method: 'exponential',
    coefficients: [a, b],
    rSquared,
    predict,
  };
}

// =============================================================================
// Logarithmic Regression
// =============================================================================

/**
 * Compute logarithmic regression: y = a + b * ln(x)
 */
export function logarithmicRegression(x: number[], y: number[]): RegressionResult {
  // Filter positive x values for log transformation
  const validPoints = x.map((xi, i) => ({ x: xi, y: y[i] })).filter((p) => p.x > 0);

  if (validPoints.length < 2) {
    return {
      method: 'logarithmic',
      coefficients: [y[0] || 0, 0],
      rSquared: 0,
      predict: () => y[0] || 0,
    };
  }

  const xLog = validPoints.map((p) => Math.log(p.x));
  const yValid = validPoints.map((p) => p.y);

  const linear = linearRegression(xLog, yValid);
  const [b, a] = linear.coefficients;

  const predict = (xi: number): number => (xi > 0 ? a + b * Math.log(xi) : a);
  const rSquared = calculateRSquared(x, y, predict);

  return {
    method: 'logarithmic',
    coefficients: [a, b],
    rSquared,
    predict,
  };
}

// =============================================================================
// Power Regression
// =============================================================================

/**
 * Compute power regression: y = a * x^b
 * Uses log transformation: ln(y) = ln(a) + b * ln(x)
 */
export function powerRegression(x: number[], y: number[]): RegressionResult {
  // Filter positive values for log transformation
  const validPoints = x.map((xi, i) => ({ x: xi, y: y[i] })).filter((p) => p.x > 0 && p.y > 0);

  if (validPoints.length < 2) {
    return {
      method: 'power',
      coefficients: [1, 1],
      rSquared: 0,
      predict: (xi) => xi,
    };
  }

  const xLog = validPoints.map((p) => Math.log(p.x));
  const yLog = validPoints.map((p) => Math.log(p.y));

  const linear = linearRegression(xLog, yLog);
  const [b, lnA] = linear.coefficients;
  const a = Math.exp(lnA);

  const predict = (xi: number): number => (xi > 0 ? a * Math.pow(xi, b) : 0);
  const rSquared = calculateRSquared(x, y, predict);

  return {
    method: 'power',
    coefficients: [a, b],
    rSquared,
    predict,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate R-squared (coefficient of determination).
 */
function calculateRSquared(x: number[], y: number[], predict: (x: number) => number): number {
  const n = y.length;
  if (n < 2) return 0;

  const yMean = y.reduce((sum, v) => sum + v, 0) / n;

  let ssTot = 0;
  let ssRes = 0;

  for (let i = 0; i < n; i++) {
    const predicted = predict(x[i]);
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - predicted) ** 2;
  }

  return ssTot !== 0 ? 1 - ssRes / ssTot : 0;
}

/**
 * Generate trendline points.
 */
export function generateTrendline(
  result: RegressionResult,
  xMin: number,
  xMax: number,
  numPoints: number = 100,
): Array<{ x: number; y: number }> {
  const step = (xMax - xMin) / (numPoints - 1);
  const points: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < numPoints; i++) {
    const x = xMin + i * step;
    const y = result.predict(x);
    points.push({ x, y });
  }

  return points;
}

/**
 * Get regression equation string.
 */
export function getRegressionEquation(result: RegressionResult): string {
  const { method, coefficients } = result;

  switch (method) {
    case 'linear':
      return `y = ${coefficients[0].toFixed(3)}x + ${coefficients[1].toFixed(3)}`;
    case 'polynomial':
      return coefficients
        .map((c, i) => {
          if (i === 0) return c.toFixed(3);
          if (i === 1) return `${c.toFixed(3)}x`;
          return `${c.toFixed(3)}x^${i}`;
        })
        .reverse()
        .join(' + ');
    case 'exponential':
      return `y = ${coefficients[0].toFixed(3)} * e^(${coefficients[1].toFixed(3)}x)`;
    case 'logarithmic':
      return `y = ${coefficients[0].toFixed(3)} + ${coefficients[1].toFixed(3)} * ln(x)`;
    case 'power':
      return `y = ${coefficients[0].toFixed(3)} * x^${coefficients[1].toFixed(3)}`;
    default:
      return 'Unknown regression';
  }
}
