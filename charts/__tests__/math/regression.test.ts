/**
 * Unit tests for regression.ts math utilities
 *
 * Tests cover:
 * - Linear regression
 * - Polynomial regression
 * - Exponential regression
 * - Logarithmic regression
 * - Power regression
 * - Moving average
 */

import {
  createRegression,
  exponentialRegression,
  linearRegression,
  logarithmicRegression,
  movingAverage,
  polynomialRegression,
  powerRegression,
  type Point,
} from '../../src/math/regression';

describe('Linear Regression', () => {
  it('should fit a perfect linear relationship', () => {
    // y = 2x + 1
    const data: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
      { x: 4, y: 9 },
    ];

    const result = linearRegression(data);

    // Should have R^2 = 1 for perfect fit
    expect(result.rSquared).toBeCloseTo(1, 10);

    // Coefficients: [intercept, slope] = [1, 2]
    expect(result.coefficients[0]).toBeCloseTo(1, 10);
    expect(result.coefficients[1]).toBeCloseTo(2, 10);

    // Predict function should work
    expect(result.predict(5)).toBeCloseTo(11, 10);
    expect(result.predict(10)).toBeCloseTo(21, 10);
  });

  it('should handle noisy data', () => {
    // Noisy data around y = x
    const data: Point[] = [
      { x: 1, y: 1.1 },
      { x: 2, y: 1.9 },
      { x: 3, y: 3.2 },
      { x: 4, y: 3.8 },
      { x: 5, y: 5.1 },
    ];

    const result = linearRegression(data);

    // Should still find a reasonable fit
    expect(result.rSquared).toBeGreaterThan(0.9);
    expect(result.coefficients[1]).toBeCloseTo(1, 0.5); // Slope near 1
  });

  it('should handle empty data', () => {
    const result = linearRegression([]);
    expect(result.rSquared).toBeNaN();
    expect(result.predict(5)).toBeNaN();
  });

  it('should handle single point', () => {
    const result = linearRegression([{ x: 5, y: 10 }]);
    expect(result.predict(5)).toBe(10);
    expect(result.rSquared).toBe(1);
  });

  it('should handle horizontal line (constant y)', () => {
    const data: Point[] = [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
    ];

    const result = linearRegression(data);
    expect(result.coefficients[1]).toBeCloseTo(0, 10); // Slope = 0
    expect(result.predict(100)).toBeCloseTo(5, 10);
  });

  it('should handle vertical-ish data (constant x)', () => {
    const data: Point[] = [
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 3 },
      { x: 5, y: 4 },
    ];

    const result = linearRegression(data);
    // Should handle degenerate case
    expect(result.coefficients).toBeDefined();
    expect(result.predict(5)).toBe(2.5); // Average y
  });

  it('should generate points for rendering', () => {
    const data: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];

    const result = linearRegression(data, { numPoints: 10 });
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    expect(result.points[0].x).toBeCloseTo(0, 5);
  });

  it('should provide equation string', () => {
    const data: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
    ];

    const result = linearRegression(data);
    expect(result.equation).toContain('y =');
    expect(result.type).toBe('linear');
  });
});

describe('Polynomial Regression', () => {
  it('should fit a quadratic (degree 2)', () => {
    // y = x^2
    const data: Point[] = [
      { x: -2, y: 4 },
      { x: -1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 4 },
    ];

    const result = polynomialRegression(data, 2);

    // Should have perfect fit
    expect(result.rSquared).toBeCloseTo(1, 5);

    // Predict function should work
    expect(result.predict(3)).toBeCloseTo(9, 1);
    expect(result.predict(-3)).toBeCloseTo(9, 1);
  });

  it('should fit cubic (degree 3)', () => {
    // y = x^3
    const data: Point[] = [
      { x: -2, y: -8 },
      { x: -1, y: -1 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 8 },
    ];

    const result = polynomialRegression(data, 3);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.predict(3)).toBeCloseTo(27, 1);
  });

  it('should fall back to linear for degree 1', () => {
    const data: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ];

    const polyResult = polynomialRegression(data, 1);
    const linearResult = linearRegression(data);

    expect(polyResult.predict(5)).toBeCloseTo(linearResult.predict(5), 5);
  });

  it('should throw for degree < 1', () => {
    const data: Point[] = [{ x: 0, y: 0 }];
    expect(() => polynomialRegression(data, 0)).toThrow();
  });

  it('should throw for insufficient data points', () => {
    const data: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(() => polynomialRegression(data, 3)).toThrow();
  });
});

describe('Exponential Regression', () => {
  it('should fit exponential growth', () => {
    // y = 2 * e^(0.5x)
    const data: Point[] = [];
    for (let x = 0; x <= 4; x++) {
      data.push({ x, y: 2 * Math.exp(0.5 * x) });
    }

    const result = exponentialRegression(data);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.coefficients[0]).toBeCloseTo(2, 1); // a
    expect(result.coefficients[1]).toBeCloseTo(0.5, 1); // b
  });

  it('should handle exponential decay', () => {
    // y = 10 * e^(-0.3x)
    const data: Point[] = [];
    for (let x = 0; x <= 5; x++) {
      data.push({ x, y: 10 * Math.exp(-0.3 * x) });
    }

    const result = exponentialRegression(data);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.coefficients[0]).toBeCloseTo(10, 1); // a
    expect(result.coefficients[1]).toBeCloseTo(-0.3, 1); // b
  });

  it('should return NaN for non-positive y values', () => {
    const data: Point[] = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ];

    const result = exponentialRegression(data);
    expect(result.rSquared).toBeNaN();
  });

  it('should filter out non-positive y values', () => {
    const data: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: -5 }, // Will be filtered
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 5 },
    ];

    const result = exponentialRegression(data);
    expect(result.rSquared).not.toBeNaN();
  });
});

describe('Logarithmic Regression', () => {
  it('should fit logarithmic relationship', () => {
    // y = 2 + 3*ln(x)
    const data: Point[] = [];
    for (let x = 1; x <= 10; x++) {
      data.push({ x, y: 2 + 3 * Math.log(x) });
    }

    const result = logarithmicRegression(data);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.coefficients[0]).toBeCloseTo(2, 1); // a
    expect(result.coefficients[1]).toBeCloseTo(3, 1); // b
  });

  it('should return NaN for x <= 0', () => {
    const result = logarithmicRegression([
      { x: -1, y: 1 },
      { x: 0, y: 2 },
    ]);
    expect(result.rSquared).toBeNaN();
  });

  it('should handle data with some invalid x values', () => {
    // More data points so we have enough after filtering
    const data: Point[] = [
      { x: -1, y: 0 }, // Invalid - will be filtered
      { x: 0, y: -1 }, // Invalid - will be filtered
      { x: 1, y: 0 },
      { x: 2, y: 0.69 },
      { x: 3, y: 1.1 },
      { x: 4, y: 1.39 },
      { x: 5, y: 1.61 },
    ];

    const result = logarithmicRegression(data);
    expect(result.rSquared).not.toBeNaN();
  });

  it('should predict NaN for x <= 0', () => {
    const data: Point[] = [
      { x: 1, y: 0 },
      { x: 2, y: 0.69 },
      { x: 3, y: 1.1 },
    ];

    const result = logarithmicRegression(data);
    expect(result.predict(-1)).toBeNaN();
    expect(result.predict(0)).toBeNaN();
    expect(result.predict(1)).not.toBeNaN();
  });
});

describe('Power Regression', () => {
  it('should fit power relationship', () => {
    // y = 2 * x^3
    const data: Point[] = [];
    for (let x = 1; x <= 5; x++) {
      data.push({ x, y: 2 * Math.pow(x, 3) });
    }

    const result = powerRegression(data);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.coefficients[0]).toBeCloseTo(2, 1); // a
    expect(result.coefficients[1]).toBeCloseTo(3, 1); // b
  });

  it('should fit inverse square law', () => {
    // y = 100 * x^(-2)
    const data: Point[] = [];
    for (let x = 1; x <= 10; x++) {
      data.push({ x, y: 100 / (x * x) });
    }

    const result = powerRegression(data);

    expect(result.rSquared).toBeCloseTo(1, 5);
    expect(result.coefficients[1]).toBeCloseTo(-2, 1); // b
  });

  it('should return NaN for non-positive values', () => {
    const result = powerRegression([
      { x: -1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: -1 },
    ]);
    expect(result.rSquared).toBeNaN();
  });
});

describe('Moving Average', () => {
  it('should calculate simple moving average', () => {
    const data: Point[] = [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
      { x: 4, y: 40 },
      { x: 5, y: 50 },
    ];

    const result = movingAverage(data, 3);

    // 3-period moving average
    expect(result.points).toHaveLength(3);
    // First point: avg of y values 10, 20, 30 = 20
    expect(result.points[0].y).toBe(20);
    // Second point: avg of y values 20, 30, 40 = 30
    expect(result.points[1].y).toBe(30);
  });

  it('should return empty for insufficient data', () => {
    const data: Point[] = [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ];

    const result = movingAverage(data, 5);
    expect(result.points).toHaveLength(0);
  });

  it('should handle period of 1 (no smoothing)', () => {
    const data: Point[] = [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
    ];

    const result = movingAverage(data, 1);
    expect(result.points).toHaveLength(3);
    expect(result.points[0].y).toBe(10);
    expect(result.points[1].y).toBe(20);
    expect(result.points[2].y).toBe(30);
  });
});

describe('createRegression factory', () => {
  const testData: Point[] = [
    { x: 1, y: 2 },
    { x: 2, y: 4 },
    { x: 3, y: 6 },
    { x: 4, y: 8 },
    { x: 5, y: 10 },
  ];

  it('should create linear regression', () => {
    const result = createRegression(testData, 'linear');
    expect(result.type).toBe('linear');
    expect(result.rSquared).toBeCloseTo(1, 5);
  });

  it('should create polynomial regression', () => {
    const result = createRegression(testData, 'polynomial', 2);
    expect(result.type).toBe('polynomial-2');
  });

  it('should create exponential regression', () => {
    const expData: Point[] = [
      { x: 0, y: 1 },
      { x: 1, y: 2.7 },
      { x: 2, y: 7.4 },
    ];
    const result = createRegression(expData, 'exponential');
    expect(result.type).toBe('exponential');
  });

  it('should create logarithmic regression', () => {
    const logData: Point[] = [
      { x: 1, y: 0 },
      { x: 2, y: 0.69 },
      { x: 3, y: 1.1 },
    ];
    const result = createRegression(logData, 'logarithmic');
    expect(result.type).toBe('logarithmic');
  });

  it('should create power regression', () => {
    const powerData: Point[] = [
      { x: 1, y: 1 },
      { x: 2, y: 8 },
      { x: 3, y: 27 },
    ];
    const result = createRegression(powerData, 'power');
    expect(result.type).toBe('power');
  });

  it('should throw for unknown type', () => {
    expect(() => createRegression(testData, 'unknown' as any)).toThrow();
  });
});

describe('Regression R-squared values', () => {
  it('should return R^2 between 0 and 1 for valid fits', () => {
    const noisyData: Point[] = [
      { x: 1, y: 1.1 },
      { x: 2, y: 2.2 },
      { x: 3, y: 2.8 },
      { x: 4, y: 4.1 },
      { x: 5, y: 4.9 },
    ];

    const result = linearRegression(noisyData);
    expect(result.rSquared).toBeGreaterThanOrEqual(0);
    expect(result.rSquared).toBeLessThanOrEqual(1);
  });

  it('should return R^2 = 1 for perfect fit', () => {
    const perfectData: Point[] = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ];

    const result = linearRegression(perfectData);
    expect(result.rSquared).toBeCloseTo(1, 10);
  });

  it('should return low R^2 for poor fit', () => {
    // Random-ish data
    const randomData: Point[] = [
      { x: 1, y: 10 },
      { x: 2, y: 2 },
      { x: 3, y: 8 },
      { x: 4, y: 1 },
      { x: 5, y: 9 },
    ];

    const result = linearRegression(randomData);
    expect(result.rSquared).toBeLessThan(0.5);
  });
});
