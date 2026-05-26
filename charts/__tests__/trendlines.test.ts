/**
 * Tests for Trendline Calculations
 *
 * Each trendline type is tested against known datasets with verified results.
 * The tests ensure:
 * 1. Coefficients are computed correctly
 * 2. R² values match expected precision
 * 3. Generated points produce correct predictions
 * 4. Edge cases are handled gracefully
 */

import {
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
} from '../src/math/trendlines';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Assert that two numbers are approximately equal
 */
function expectApprox(actual: number, expected: number, tolerance = 0.001): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

/**
 * Generate test points from a known function
 */
function generateTestPoints(fn: (x: number) => number, xValues: number[]): [number, number][] {
  return xValues.map((x) => [x, fn(x)] as [number, number]);
}

// =============================================================================
// Linear Regression Tests
// =============================================================================

describe('Linear Regression', () => {
  it('should calculate perfect linear fit', () => {
    // y = 2x + 3 (perfect data)
    const points: [number, number][] = [
      [1, 5],
      [2, 7],
      [3, 9],
      [4, 11],
      [5, 13],
    ];

    const { slope, intercept, r2 } = calculateLinearRegression(points);

    expectApprox(slope, 2);
    expectApprox(intercept, 3);
    expectApprox(r2, 1.0); // Perfect fit
  });

  it('should calculate linear fit with noise', () => {
    // y ≈ 1.5x + 2 (with some noise)
    const points: [number, number][] = [
      [1, 3.6],
      [2, 5.1],
      [3, 6.4],
      [4, 8.0],
      [5, 9.5],
    ];

    const { slope, intercept, r2 } = calculateLinearRegression(points);

    expectApprox(slope, 1.5, 0.1);
    expectApprox(intercept, 2, 0.2);
    expect(r2).toBeGreaterThan(0.99); // Very good fit
  });

  it('should handle horizontal line', () => {
    const points: [number, number][] = [
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
    ];

    const { slope, intercept, r2 } = calculateLinearRegression(points);

    expectApprox(slope, 0);
    expectApprox(intercept, 5);
    // R² is 1 when all values are the same (no variance to explain)
    expectApprox(r2, 1);
  });

  it('should handle two points exactly', () => {
    const points: [number, number][] = [
      [0, 0],
      [10, 20],
    ];

    const { slope, intercept, r2 } = calculateLinearRegression(points);

    expectApprox(slope, 2);
    expectApprox(intercept, 0);
    expectApprox(r2, 1.0); // Perfect fit with 2 points
  });

  it('should handle negative slope', () => {
    const points: [number, number][] = [
      [0, 10],
      [5, 0],
      [10, -10],
    ];

    const { slope, intercept } = calculateLinearRegression(points);

    expectApprox(slope, -2);
    expectApprox(intercept, 10);
  });

  it('should return defaults for insufficient points', () => {
    const { slope, intercept, r2 } = calculateLinearRegression([[1, 2]]);

    expect(slope).toBe(0);
    expect(intercept).toBe(0);
    expect(r2).toBe(0);
  });

  it('should generate trendline points', () => {
    const points: [number, number][] = [
      [1, 3],
      [2, 5],
      [3, 7],
    ];

    const result = generateLinearTrendline(points);

    expect(result.points.length).toBe(2);
    expect(result.equation).toContain('y =');
    expect(result.coefficients.type).toBe('linear');
  });
});

// =============================================================================
// Exponential Regression Tests
// =============================================================================

describe('Exponential Regression', () => {
  it('should calculate exponential fit for y = 2e^(0.5x)', () => {
    // y = 2 * e^(0.5x)
    const fn = (x: number) => 2 * Math.exp(0.5 * x);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = calculateExponentialRegression(points);

    expect(result).not.toBeNull();
    expectApprox(result!.a, 2, 0.01);
    expectApprox(result!.b, 0.5, 0.01);
    expectApprox(result!.r2, 1.0);
  });

  it('should handle growth data', () => {
    // Typical exponential growth pattern
    const points: [number, number][] = [
      [0, 100],
      [1, 150],
      [2, 225],
      [3, 337.5],
      [4, 506.25],
    ];

    const result = calculateExponentialRegression(points);

    expect(result).not.toBeNull();
    expect(result!.a).toBeGreaterThan(90);
    expect(result!.b).toBeGreaterThan(0.3);
    expect(result!.r2).toBeGreaterThan(0.99);
  });

  it('should reject data with non-positive y values', () => {
    const points: [number, number][] = [
      [1, -5],
      [2, 0],
      [3, 5],
    ];

    const result = calculateExponentialRegression(points);

    // Only one valid point (y=5), not enough for regression
    expect(result).toBeNull();
  });

  it('should generate exponential trendline points', () => {
    const points: [number, number][] = [
      [1, 2.7],
      [2, 7.4],
      [3, 20.1],
      [4, 54.6],
    ];

    const result = generateExponentialTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.points.length).toBeGreaterThan(2);
    expect(result!.equation).toContain('e^');
    expect(result!.coefficients.type).toBe('exponential');
  });
});

// =============================================================================
// Logarithmic Regression Tests
// =============================================================================

describe('Logarithmic Regression', () => {
  it('should calculate logarithmic fit for y = 2 + 3*ln(x)', () => {
    // y = 2 + 3*ln(x)
    const fn = (x: number) => 2 + 3 * Math.log(x);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5, 10, 20]);

    const result = calculateLogarithmicRegression(points);

    expect(result).not.toBeNull();
    expectApprox(result!.a, 2, 0.01);
    expectApprox(result!.b, 3, 0.01);
    expectApprox(result!.r2, 1.0);
  });

  it('should handle diminishing returns data', () => {
    // Typical logarithmic pattern (fast initial growth, then slowing)
    const points: [number, number][] = [
      [1, 0],
      [2, 2.1],
      [4, 4.2],
      [8, 6.3],
      [16, 8.3],
    ];

    const result = calculateLogarithmicRegression(points);

    expect(result).not.toBeNull();
    expect(result!.b).toBeGreaterThan(2); // ln(x) coefficient
    expect(result!.r2).toBeGreaterThan(0.99);
  });

  it('should reject data with non-positive x values', () => {
    const points: [number, number][] = [
      [-1, 5],
      [0, 3],
      [1, 1],
    ];

    const result = calculateLogarithmicRegression(points);

    // Only one valid point, not enough
    expect(result).toBeNull();
  });

  it('should generate logarithmic trendline points', () => {
    const fn = (x: number) => 1 + 2 * Math.log(x);
    const points = generateTestPoints(fn, [1, 2, 5, 10]);

    const result = generateLogarithmicTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.points.length).toBeGreaterThan(2);
    expect(result!.equation).toContain('ln(x)');
    expect(result!.coefficients.type).toBe('logarithmic');
  });
});

// =============================================================================
// Polynomial Regression Tests
// =============================================================================

describe('Polynomial Regression', () => {
  it('should calculate quadratic fit for y = x² + 2x + 1', () => {
    // y = x² + 2x + 1 = (x + 1)²
    const fn = (x: number) => x * x + 2 * x + 1;
    const points = generateTestPoints(fn, [0, 1, 2, 3, 4, 5]);

    const result = calculatePolynomialRegression(points, 2);

    expect(result).not.toBeNull();
    expectApprox(result!.coefficients[0], 1, 0.01); // a₀
    expectApprox(result!.coefficients[1], 2, 0.01); // a₁
    expectApprox(result!.coefficients[2], 1, 0.01); // a₂
    expectApprox(result!.r2, 1.0);
  });

  it('should calculate cubic fit', () => {
    // y = x³ - 3x² + 2x + 1
    const fn = (x: number) => x * x * x - 3 * x * x + 2 * x + 1;
    const points = generateTestPoints(fn, [-2, -1, 0, 1, 2, 3, 4]);

    const result = calculatePolynomialRegression(points, 3);

    expect(result).not.toBeNull();
    expectApprox(result!.coefficients[0], 1, 0.1); // constant
    expectApprox(result!.coefficients[1], 2, 0.1); // x coefficient
    expectApprox(result!.coefficients[2], -3, 0.1); // x² coefficient
    expectApprox(result!.coefficients[3], 1, 0.1); // x³ coefficient
    expect(result!.r2).toBeGreaterThan(0.99);
  });

  it('should clamp order to valid range', () => {
    const points: [number, number][] = [
      [1, 1],
      [2, 4],
      [3, 9],
      [4, 16],
    ];

    // Order 1 should be clamped to 2
    const result = calculatePolynomialRegression(points, 1);

    expect(result).not.toBeNull();
    expect(result!.coefficients.length).toBe(3); // order 2 = 3 coefficients
  });

  it('should reject insufficient points', () => {
    // Need at least order+1 points
    const points: [number, number][] = [
      [1, 1],
      [2, 4],
    ];

    // Order 2 needs 3 points minimum
    const result = calculatePolynomialRegression(points, 2);

    expect(result).toBeNull();
  });

  it('should generate polynomial trendline points', () => {
    const fn = (x: number) => x * x - 4 * x + 4;
    const points = generateTestPoints(fn, [0, 1, 2, 3, 4, 5]);

    const result = generatePolynomialTrendline(points, 2);

    expect(result).not.toBeNull();
    expect(result!.points.length).toBeGreaterThan(2);
    expect(result!.equation).toContain('x^2');
    expect(result!.coefficients.type).toBe('polynomial');
  });

  it('should handle higher degree polynomials', () => {
    // y = x⁴ (degree 4)
    const fn = (x: number) => Math.pow(x, 4);
    const points = generateTestPoints(fn, [0, 1, 2, 3, 4, 5, 6]);

    const result = calculatePolynomialRegression(points, 4);

    expect(result).not.toBeNull();
    expect(result!.r2).toBeGreaterThan(0.99);
  });
});

// =============================================================================
// Power Regression Tests
// =============================================================================

describe('Power Regression', () => {
  it('should calculate power fit for y = 2x^3', () => {
    // y = 2 * x^3
    const fn = (x: number) => 2 * Math.pow(x, 3);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = calculatePowerRegression(points);

    expect(result).not.toBeNull();
    expectApprox(result!.a, 2, 0.01);
    expectApprox(result!.b, 3, 0.01);
    expectApprox(result!.r2, 1.0);
  });

  it('should calculate square root fit (power 0.5)', () => {
    // y = 4 * x^0.5 = 4 * sqrt(x)
    const fn = (x: number) => 4 * Math.sqrt(x);
    const points = generateTestPoints(fn, [1, 4, 9, 16, 25]);

    const result = calculatePowerRegression(points);

    expect(result).not.toBeNull();
    expectApprox(result!.a, 4, 0.1);
    expectApprox(result!.b, 0.5, 0.01);
    expect(result!.r2).toBeGreaterThan(0.99);
  });

  it('should handle inverse relationship (negative exponent)', () => {
    // y = 100 * x^(-2) = 100/x²
    const fn = (x: number) => 100 / (x * x);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = calculatePowerRegression(points);

    expect(result).not.toBeNull();
    expectApprox(result!.a, 100, 0.1);
    expectApprox(result!.b, -2, 0.01);
    expect(result!.r2).toBeGreaterThan(0.99);
  });

  it('should reject data with non-positive values', () => {
    const points: [number, number][] = [
      [0, 5],
      [1, 2],
      [2, -1],
    ];

    const result = calculatePowerRegression(points);

    // Not enough valid points
    expect(result).toBeNull();
  });

  it('should generate power trendline points', () => {
    const fn = (x: number) => 3 * Math.pow(x, 2);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = generatePowerTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.points.length).toBeGreaterThan(2);
    expect(result!.equation).toContain('x^');
    expect(result!.coefficients.type).toBe('power');
  });
});

// =============================================================================
// Moving Average Tests
// =============================================================================

describe('Moving Average', () => {
  it('should calculate 2-period moving average', () => {
    const points: [number, number][] = [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
      [5, 50],
    ];

    const result = generateMovingAverageTrendline(points, 2);

    expect(result.points.length).toBe(4); // 5 - 2 + 1 = 4
    expectApprox(result.points[0][1], 15); // (10 + 20) / 2
    expectApprox(result.points[1][1], 25); // (20 + 30) / 2
    expectApprox(result.points[2][1], 35); // (30 + 40) / 2
    expectApprox(result.points[3][1], 45); // (40 + 50) / 2
  });

  it('should calculate 3-period moving average', () => {
    const points: [number, number][] = [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
      [5, 50],
    ];

    const result = generateMovingAverageTrendline(points, 3);

    expect(result.points.length).toBe(3); // 5 - 3 + 1 = 3
    expectApprox(result.points[0][1], 20); // (10 + 20 + 30) / 3
    expectApprox(result.points[1][1], 30); // (20 + 30 + 40) / 3
    expectApprox(result.points[2][1], 40); // (30 + 40 + 50) / 3
  });

  it('should sort points by x value', () => {
    const points: [number, number][] = [
      [3, 30],
      [1, 10],
      [5, 50],
      [2, 20],
      [4, 40],
    ];

    const result = generateMovingAverageTrendline(points, 2);

    // Should still produce correct averages
    expect(result.points.length).toBe(4);
    expectApprox(result.points[0][1], 15);
    expectApprox(result.points[3][1], 45);
  });

  it('should clamp period to data length', () => {
    const points: [number, number][] = [
      [1, 10],
      [2, 20],
    ];

    const result = generateMovingAverageTrendline(points, 10);

    // Period clamped to 2
    expect(result.points.length).toBe(1);
    expect(result.coefficients.type).toBe('moving-average');
  });

  it('should return equation describing the period', () => {
    const points: [number, number][] = [
      [1, 10],
      [2, 20],
      [3, 30],
    ];

    const result = generateMovingAverageTrendline(points, 3);

    expect(result.equation).toContain('3-period');
  });
});

// =============================================================================
// Main Entry Point Tests
// =============================================================================

describe('generateTrendlinePoints', () => {
  const testPoints: [number, number][] = [
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 8],
    [5, 10],
  ];

  it('should route to linear trendline', () => {
    const result = generateTrendlinePoints(testPoints, { show: true, type: 'linear' });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('linear');
  });

  it('should route to exponential trendline', () => {
    const expPoints: [number, number][] = [
      [1, Math.exp(1)],
      [2, Math.exp(2)],
      [3, Math.exp(3)],
    ];
    const result = generateTrendlinePoints(expPoints, { show: true, type: 'exponential' });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('exponential');
  });

  it('should route to logarithmic trendline', () => {
    const logPoints: [number, number][] = [
      [1, 0],
      [Math.E, 1],
      [Math.E * Math.E, 2],
    ];
    const result = generateTrendlinePoints(logPoints, { show: true, type: 'logarithmic' });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('logarithmic');
  });

  it('should route to polynomial trendline with order', () => {
    const quadPoints: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 4],
      [3, 9],
    ];
    const result = generateTrendlinePoints(quadPoints, {
      show: true,
      type: 'polynomial',
      order: 2,
    });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('polynomial');
  });

  it('should route to power trendline', () => {
    const powerPoints: [number, number][] = [
      [1, 1],
      [2, 8],
      [3, 27],
      [4, 64],
    ];
    const result = generateTrendlinePoints(powerPoints, { show: true, type: 'power' });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('power');
  });

  it('should route to moving average trendline', () => {
    const result = generateTrendlinePoints(testPoints, {
      show: true,
      type: 'moving-average',
      period: 2,
    });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('moving-average');
  });

  it('should return null for insufficient points', () => {
    const result = generateTrendlinePoints([[1, 2]], { show: true, type: 'linear' });

    expect(result).toBeNull();
  });

  it('should fallback to linear for unknown type', () => {
    const result = generateTrendlinePoints(testPoints, {
      show: true,
      type: 'unknown' as any,
    });

    expect(result).not.toBeNull();
    expect(result!.coefficients.type).toBe('linear');
  });
});

// =============================================================================
// Equation Formatting Tests
// =============================================================================

describe('Equation Formatting', () => {
  it('should format linear equation correctly', () => {
    const points: [number, number][] = [
      [0, 3],
      [1, 5],
      [2, 7],
    ];

    const result = generateLinearTrendline(points);

    expect(result.equation).toMatch(/y\s*=\s*2.*x.*\+.*3/);
  });

  it('should format polynomial equation with correct terms', () => {
    const fn = (x: number) => x * x + x + 1;
    const points = generateTestPoints(fn, [0, 1, 2, 3, 4]);

    const result = generatePolynomialTrendline(points, 2);

    expect(result).not.toBeNull();
    expect(result!.equation).toContain('x^2');
    expect(result!.equation).toContain('y =');
  });

  it('should format exponential equation', () => {
    const fn = (x: number) => 2 * Math.exp(0.5 * x);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = generateExponentialTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.equation).toContain('e^');
  });

  it('should format logarithmic equation', () => {
    const fn = (x: number) => 1 + 2 * Math.log(x);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = generateLogarithmicTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.equation).toContain('ln(x)');
  });

  it('should format power equation', () => {
    const fn = (x: number) => 3 * Math.pow(x, 2);
    const points = generateTestPoints(fn, [1, 2, 3, 4, 5]);

    const result = generatePowerTrendline(points);

    expect(result).not.toBeNull();
    expect(result!.equation).toContain('x^');
  });
});

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Edge Cases', () => {
  it('should handle empty arrays', () => {
    expect(generateLinearTrendline([]).points).toEqual([]);
    expect(generateExponentialTrendline([])).toBeNull();
    expect(generateLogarithmicTrendline([])).toBeNull();
    expect(generatePolynomialTrendline([], 2)).toBeNull();
    expect(generatePowerTrendline([])).toBeNull();
    expect(generateMovingAverageTrendline([]).points.length).toBe(0);
  });

  it('should handle single point', () => {
    const single: [number, number][] = [[1, 2]];

    expect(generateLinearTrendline(single).points).toEqual([]);
    expect(generateExponentialTrendline(single)).toBeNull();
  });

  it('should handle all same y values', () => {
    const points: [number, number][] = [
      [1, 5],
      [2, 5],
      [3, 5],
    ];

    const result = generateLinearTrendline(points);
    expect(result.coefficients.type).toBe('linear');
    if (result.coefficients.type === 'linear') {
      expectApprox(result.coefficients.slope, 0);
    }
    // R² is 1 because there's no variance to explain
    expectApprox(result.r2, 1);
  });

  it('should handle very large numbers', () => {
    const points: [number, number][] = [
      [1e10, 1e10],
      [2e10, 2e10],
      [3e10, 3e10],
    ];

    const result = calculateLinearRegression(points);
    expectApprox(result.slope, 1);
    expect(result.r2).toBeGreaterThan(0.99);
  });

  it('should handle very small numbers', () => {
    // Use small but not too extreme numbers to avoid floating point issues
    const points: [number, number][] = [
      [0.001, 0.002],
      [0.002, 0.004],
      [0.003, 0.006],
    ];

    const result = calculateLinearRegression(points);
    expectApprox(result.slope, 2);
    expect(result.r2).toBeGreaterThan(0.99);
  });

  it('should handle negative values correctly', () => {
    const points: [number, number][] = [
      [-3, -6],
      [-2, -4],
      [-1, -2],
      [0, 0],
      [1, 2],
    ];

    const result = calculateLinearRegression(points);
    expectApprox(result.slope, 2);
    expectApprox(result.intercept, 0);
  });

  it('should skip NaN/Infinity in curve generation', () => {
    // Logarithmic near zero could produce Infinity
    const result = generateLogarithmicTrendline([
      [0.001, 1],
      [1, 2],
      [10, 3],
    ]);

    expect(result).not.toBeNull();
    // All points should be finite
    for (const [x, y] of result!.points) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

// =============================================================================
// Real-World Data Tests
// =============================================================================

describe('Real-World Data Scenarios', () => {
  it('should fit population growth (exponential)', () => {
    // Simplified population growth data
    const years: [number, number][] = [
      [0, 100],
      [10, 122],
      [20, 149],
      [30, 182],
      [40, 222],
    ];

    const result = generateExponentialTrendline(years);

    expect(result).not.toBeNull();
    expect(result!.r2).toBeGreaterThan(0.99);
    // Growth rate should be around 2% per year
    expect(result!.coefficients.type).toBe('exponential');
    if (result!.coefficients.type === 'exponential') {
      expect(result!.coefficients.b).toBeGreaterThan(0.01);
      expect(result!.coefficients.b).toBeLessThan(0.03);
    }
  });

  it('should fit learning curve (logarithmic)', () => {
    // Learning curve: performance improves but plateaus
    const trials: [number, number][] = [
      [1, 50],
      [2, 65],
      [5, 75],
      [10, 82],
      [20, 88],
      [50, 93],
    ];

    const result = generateLogarithmicTrendline(trials);

    expect(result).not.toBeNull();
    expect(result!.r2).toBeGreaterThan(0.95);
  });

  it('should fit projectile motion (polynomial)', () => {
    // y = -0.5*g*t² + v₀*t + y₀ where g≈10, v₀=30, y₀=0
    const fn = (t: number) => -5 * t * t + 30 * t;
    const times = generateTestPoints(fn, [0, 1, 2, 3, 4, 5, 6]);

    const result = generatePolynomialTrendline(times, 2);

    expect(result).not.toBeNull();
    expect(result!.r2).toBeGreaterThan(0.99);
    // a₂ should be approximately -5
    expect(result!.coefficients.type).toBe('polynomial');
    if (result!.coefficients.type === 'polynomial') {
      expectApprox(result!.coefficients.coefficients[2], -5, 0.1);
    }
  });

  it("should fit Kepler's law (power)", () => {
    // T² ∝ r³ → T = k*r^1.5
    // Period vs semi-major axis for planets
    const planetData: [number, number][] = [
      [1, 1], // Earth normalized
      [1.52, 1.88], // Mars
      [5.2, 11.86], // Jupiter
      [9.54, 29.46], // Saturn
    ];

    const result = generatePowerTrendline(planetData);

    expect(result).not.toBeNull();
    expect(result!.r2).toBeGreaterThan(0.99);
    // Exponent should be approximately 1.5
    expect(result!.coefficients.type).toBe('power');
    if (result!.coefficients.type === 'power') {
      expectApprox(result!.coefficients.b, 1.5, 0.1);
    }
  });

  it('should smooth stock price data (moving average)', () => {
    // Typical volatile stock data
    const prices: [number, number][] = [
      [1, 100],
      [2, 105],
      [3, 98],
      [4, 110],
      [5, 108],
      [6, 115],
      [7, 112],
      [8, 120],
      [9, 118],
      [10, 125],
    ];

    const result = generateMovingAverageTrendline(prices, 3);

    expect(result.points.length).toBe(8);
    // MA should be smoother than raw data
    // Verify the first MA value
    expectApprox(result.points[0][1], (100 + 105 + 98) / 3);
  });
});
