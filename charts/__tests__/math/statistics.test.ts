/**
 * Unit tests for statistics.ts math utilities
 *
 * Tests cover:
 * - Descriptive statistics (mean, median, variance, stdDev)
 * - Quantiles and quartiles
 * - Outlier detection
 * - Kernel Density Estimation (KDE)
 * - Binning for histograms
 * - Correlation
 */

import {
  bin,
  correlation,
  covariance,
  epanechnikovKernel,
  freedmanDiaconisBins,
  gaussianKernel,
  iqr,
  kde,
  max,
  mean,
  median,
  min,
  normalize,
  outlierBounds,
  outliers,
  quantile,
  quartiles,
  range,
  removeOutliers,
  sampleStdDev,
  sampleVariance,
  scottBandwidth,
  silvermanBandwidth,
  stdDev,
  sturgesBins,
  sum,
  variance,
  zScores,
} from '../../src/math/statistics';

describe('Descriptive Statistics', () => {
  describe('mean', () => {
    it('should calculate the mean of an array', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
      expect(mean([10, 20, 30])).toBe(20);
    });

    it('should return NaN for empty array', () => {
      expect(mean([])).toBeNaN();
    });

    it('should handle single element', () => {
      expect(mean([42])).toBe(42);
    });

    it('should handle negative numbers', () => {
      expect(mean([-2, -1, 0, 1, 2])).toBe(0);
    });

    it('should handle decimals', () => {
      expect(mean([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 10);
    });
  });

  describe('median', () => {
    it('should calculate median for odd length array', () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
      expect(median([5, 1, 3])).toBe(3);
    });

    it('should calculate median for even length array', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
      expect(median([1, 2, 3, 4, 5, 6])).toBe(3.5);
    });

    it('should return NaN for empty array', () => {
      expect(median([])).toBeNaN();
    });

    it('should handle single element', () => {
      expect(median([42])).toBe(42);
    });
  });

  describe('variance and stdDev', () => {
    it('should calculate population variance', () => {
      // Variance of [1, 2, 3, 4, 5] = 2
      expect(variance([1, 2, 3, 4, 5])).toBe(2);
    });

    it('should calculate sample variance', () => {
      // Sample variance = population variance * n/(n-1) = 2 * 5/4 = 2.5
      expect(sampleVariance([1, 2, 3, 4, 5])).toBe(2.5);
    });

    it('should calculate population standard deviation', () => {
      expect(stdDev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2), 10);
    });

    it('should calculate sample standard deviation', () => {
      expect(sampleStdDev([1, 2, 3, 4, 5])).toBeCloseTo(Math.sqrt(2.5), 10);
    });

    it('should return NaN for empty or single element (sample)', () => {
      expect(sampleVariance([])).toBeNaN();
      expect(sampleVariance([1])).toBeNaN();
    });

    it('should return 0 for constant values', () => {
      expect(variance([5, 5, 5, 5])).toBe(0);
      expect(stdDev([5, 5, 5, 5])).toBe(0);
    });
  });

  describe('min, max, range, sum', () => {
    it('should find minimum', () => {
      expect(min([3, 1, 4, 1, 5, 9])).toBe(1);
      expect(min([-5, 0, 5])).toBe(-5);
    });

    it('should find maximum', () => {
      expect(max([3, 1, 4, 1, 5, 9])).toBe(9);
      expect(max([-5, 0, 5])).toBe(5);
    });

    it('should calculate range', () => {
      expect(range([1, 5, 3, 2, 4])).toBe(4);
      expect(range([-10, 10])).toBe(20);
    });

    it('should calculate sum', () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
      expect(sum([])).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(min([])).toBe(Infinity);
      expect(max([])).toBe(-Infinity);
      expect(range([])).toBeNaN();
    });

    it('should handle large arrays (100k+ elements) without stack overflow', () => {
      const size = 150_000;
      const largeArray = Array.from({ length: size }, (_, i) => i);

      expect(min(largeArray)).toBe(0);
      expect(max(largeArray)).toBe(size - 1);
      expect(range(largeArray)).toBe(size - 1);
    });
  });
});

describe('Quantiles', () => {
  describe('quantile', () => {
    it('should calculate specific quantiles', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(quantile(data, 0)).toBe(1);
      expect(quantile(data, 1)).toBe(10);
      expect(quantile(data, 0.5)).toBe(5.5);
    });

    it('should throw for invalid p values', () => {
      expect(() => quantile([1, 2, 3], -0.1)).toThrow();
      expect(() => quantile([1, 2, 3], 1.1)).toThrow();
    });

    it('should return NaN for empty array', () => {
      expect(quantile([], 0.5)).toBeNaN();
    });

    it('should use linear interpolation', () => {
      // R-7 method: for p=0.25 on [1,2,3,4], index = (4-1)*0.25 = 0.75
      // result = 1*(1-0.75) + 2*0.75 = 1.75
      expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    });
  });

  describe('quartiles', () => {
    it('should calculate all quartiles', () => {
      // R-7 method for n=12: index = (n-1)*p
      // q1: index = 11*0.25 = 2.75, q1 = 3*0.25 + 4*0.75 = 3.75
      // median: index = 11*0.5 = 5.5, median = 6*0.5 + 7*0.5 = 6.5
      // q3: index = 11*0.75 = 8.25, q3 = 9*0.75 + 10*0.25 = 9.25
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      const q = quartiles(data);
      expect(q.q1).toBe(3.75);
      expect(q.median).toBe(6.5);
      expect(q.q3).toBe(9.25);
    });

    it('should handle small arrays', () => {
      // R-7 method for n=3: index = (n-1)*p
      // q1: index = 2*0.25 = 0.5, q1 = 1*0.5 + 2*0.5 = 1.5
      // median: index = 2*0.5 = 1, median = 2
      // q3: index = 2*0.75 = 1.5, q3 = 2*0.5 + 3*0.5 = 2.5
      const q = quartiles([1, 2, 3]);
      expect(q.q1).toBe(1.5);
      expect(q.median).toBe(2);
      expect(q.q3).toBe(2.5);
    });
  });

  describe('iqr', () => {
    it('should calculate interquartile range', () => {
      // R-7 method: Q3 - Q1 = 9.25 - 3.75 = 5.5
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      expect(iqr(data)).toBe(5.5);
    });

    it('should return NaN for empty array', () => {
      expect(iqr([])).toBeNaN();
    });
  });
});

describe('Outlier Detection', () => {
  describe('outlierBounds', () => {
    it('should calculate Tukey bounds with default multiplier', () => {
      // Known dataset: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100] (sorted)
      // n = 11
      // R-7 method: q1 index = 10*0.25 = 2.5, q1 = 3*0.5 + 4*0.5 = 3.5
      // q3 index = 10*0.75 = 7.5, q3 = 8*0.5 + 9*0.5 = 8.5
      // IQR = 8.5 - 3.5 = 5
      // Lower = 3.5 - 1.5*5 = -4
      // Upper = 8.5 + 1.5*5 = 16
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
      const bounds = outlierBounds(data);
      expect(bounds.lower).toBeCloseTo(-4, 1);
      expect(bounds.upper).toBeCloseTo(16, 1);
    });

    it('should support custom multiplier', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bounds = outlierBounds(data, 3);
      // With 3x multiplier, bounds are wider
      expect(bounds.lower).toBeLessThan(outlierBounds(data).lower);
      expect(bounds.upper).toBeGreaterThan(outlierBounds(data).upper);
    });
  });

  describe('outliers', () => {
    it('should identify outliers', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
      const o = outliers(data);
      expect(o).toContain(100);
      expect(o).not.toContain(5);
    });

    it('should return empty array when no outliers', () => {
      const data = [1, 2, 3, 4, 5];
      expect(outliers(data)).toHaveLength(0);
    });

    it('should detect both low and high outliers', () => {
      const data = [-100, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
      const o = outliers(data);
      expect(o).toContain(-100);
      expect(o).toContain(100);
    });
  });

  describe('removeOutliers', () => {
    it('should remove outliers from data', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
      const clean = removeOutliers(data);
      expect(clean).not.toContain(100);
      expect(clean.length).toBeLessThan(data.length);
    });
  });
});

describe('Kernel Density Estimation', () => {
  describe('kernels', () => {
    it('should compute Gaussian kernel', () => {
      expect(gaussianKernel(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 10);
      expect(gaussianKernel(1)).toBeCloseTo(Math.exp(-0.5) / Math.sqrt(2 * Math.PI), 10);
    });

    it('should compute Epanechnikov kernel', () => {
      expect(epanechnikovKernel(0)).toBe(0.75);
      expect(epanechnikovKernel(1)).toBe(0);
      expect(epanechnikovKernel(-1)).toBe(0);
      expect(epanechnikovKernel(0.5)).toBeCloseTo(0.75 * (1 - 0.25), 10);
    });
  });

  describe('bandwidth', () => {
    it('should calculate Silverman bandwidth', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bw = silvermanBandwidth(data);
      expect(bw).toBeGreaterThan(0);
      expect(bw).toBeLessThan(10); // Reasonable range for this data
    });

    it('should calculate Scott bandwidth', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bw = scottBandwidth(data);
      expect(bw).toBeGreaterThan(0);
      // Scott and Silverman should be similar
      expect(Math.abs(bw - silvermanBandwidth(data))).toBeLessThan(1);
    });

    it('should handle constant data', () => {
      const bw = silvermanBandwidth([5, 5, 5, 5, 5]);
      expect(bw).toBe(1); // Falls back to default
    });
  });

  describe('kde', () => {
    it('should return empty result for empty data', () => {
      const result = kde([]);
      expect(result.x).toHaveLength(0);
      expect(result.y).toHaveLength(0);
    });

    it('should generate specified number of points', () => {
      const data = [1, 2, 3, 4, 5];
      const result = kde(data, { points: 50 });
      expect(result.x).toHaveLength(50);
      expect(result.y).toHaveLength(50);
    });

    it('should have peak near the data center', () => {
      const data = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]; // All values at 5
      const result = kde(data, { points: 100 });

      // Find the x value with maximum density
      const maxIndex = result.y.indexOf(Math.max(...result.y));
      expect(result.x[maxIndex]).toBeCloseTo(5, 0);
    });

    it('should produce non-negative density values', () => {
      const data = [1, 2, 3, 4, 5];
      const result = kde(data);
      result.y.forEach((y) => {
        expect(y).toBeGreaterThanOrEqual(0);
      });
    });

    it('should support Epanechnikov kernel', () => {
      const data = [1, 2, 3, 4, 5];
      const gaussianResult = kde(data, { kernel: 'gaussian' });
      const epanResult = kde(data, { kernel: 'epanechnikov' });

      // Both should produce valid results
      expect(gaussianResult.y.every((y) => y >= 0)).toBe(true);
      expect(epanResult.y.every((y) => y >= 0)).toBe(true);
    });
  });
});

describe('Binning', () => {
  describe('bin count calculations', () => {
    it('should calculate Sturges bins', () => {
      expect(sturgesBins(100)).toBe(8); // ceil(log2(100) + 1) = ceil(7.64) = 8
      expect(sturgesBins(1000)).toBe(11);
    });

    it('should calculate Freedman-Diaconis bins', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bins = freedmanDiaconisBins(data);
      expect(bins).toBeGreaterThan(0);
      expect(bins).toBeLessThan(100);
    });
  });

  describe('bin', () => {
    it('should create bins from data', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bins = bin(data, { binCount: 5 });

      expect(bins).toHaveLength(5);
      bins.forEach((b) => {
        expect(b.count).toBeGreaterThanOrEqual(0);
        expect(b.x0).toBeLessThanOrEqual(b.x1);
      });
    });

    it('should have total count equal to data length', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bins = bin(data, { binCount: 5 });
      const totalCount = bins.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(data.length);
    });

    it('should support bin width specification', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const bins = bin(data, { binWidth: 2 });
      // Range is 9 (10-1), with width 2, should have ~5 bins
      expect(bins.length).toBeGreaterThanOrEqual(4);
      expect(bins.length).toBeLessThanOrEqual(6);
    });

    it('should handle empty data', () => {
      expect(bin([])).toHaveLength(0);
    });

    it('should handle constant data', () => {
      const bins = bin([5, 5, 5, 5]);
      expect(bins).toHaveLength(1);
      expect(bins[0].count).toBe(4);
    });
  });
});

describe('Correlation', () => {
  describe('covariance', () => {
    it('should calculate population covariance', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10]; // Perfect positive correlation (y = 2x)
      // Cov(x, y) = E[(x - mean(x))(y - mean(y))]
      expect(covariance(x, y)).toBeCloseTo(4, 10);
    });

    it('should return 0 for uncorrelated data', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 5, 5, 5, 5]; // Constant
      expect(covariance(x, y)).toBe(0);
    });

    it('should return NaN for different lengths', () => {
      expect(covariance([1, 2, 3], [1, 2])).toBeNaN();
    });
  });

  describe('correlation', () => {
    it('should return 1 for perfect positive correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 4, 6, 8, 10];
      expect(correlation(x, y)).toBeCloseTo(1, 10);
    });

    it('should return -1 for perfect negative correlation', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 8, 6, 4, 2];
      expect(correlation(x, y)).toBeCloseTo(-1, 10);
    });

    it('should return NaN for constant data', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [5, 5, 5, 5, 5];
      expect(correlation(x, y)).toBeNaN();
    });

    it('should be symmetric', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [2, 3, 5, 7, 11];
      expect(correlation(x, y)).toBeCloseTo(correlation(y, x), 10);
    });
  });
});

describe('Normalization', () => {
  describe('zScores', () => {
    it('should transform to z-scores', () => {
      const data = [1, 2, 3, 4, 5];
      const z = zScores(data);

      // Mean of z-scores should be 0
      expect(mean(z)).toBeCloseTo(0, 10);

      // StdDev of z-scores should be 1
      expect(stdDev(z)).toBeCloseTo(1, 10);
    });

    it('should handle constant data', () => {
      const z = zScores([5, 5, 5]);
      expect(z).toEqual([0, 0, 0]);
    });
  });

  describe('normalize', () => {
    it('should scale to [0, 1] range', () => {
      const data = [10, 20, 30, 40, 50];
      const norm = normalize(data);

      expect(min(norm)).toBe(0);
      expect(max(norm)).toBe(1);
      expect(norm).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });

    it('should handle constant data', () => {
      const norm = normalize([5, 5, 5]);
      expect(norm).toEqual([0.5, 0.5, 0.5]);
    });
  });
});
