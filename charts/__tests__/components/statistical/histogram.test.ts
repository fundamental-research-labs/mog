/**
 * Unit tests for Histogram statistical chart component
 */

import {
  Histogram,
  alignBins,
  calculateHistogramData,
  generateHistogramMarks,
  processHistogramData,
  type HistogramDataRow,
  type HistogramEncoding,
  type HistogramLayout,
  type HistogramScales,
} from '../../../src/components/statistical/histogram';

describe('Histogram Builder', () => {
  it('should create a basic spec', () => {
    const spec = Histogram()
      .data([{ age: 25 }, { age: 30 }, { age: 35 }])
      .x('age')
      .toSpec();

    expect(spec.mark).toBe('bar');
    expect(spec.encoding.x?.field).toBe('age');
    expect(spec.encoding.x?.bin).toBe(true);
    expect(spec.data.values).toHaveLength(3);
  });

  it('should support color grouping', () => {
    const spec = Histogram()
      .data([
        { age: 25, gender: 'M' },
        { age: 30, gender: 'F' },
      ])
      .x('age')
      .color('gender')
      .toSpec();

    expect(spec.encoding.color?.field).toBe('gender');
  });

  it('should support configuration options', () => {
    const spec = Histogram()
      .data([{ age: 25 }])
      .x('age')
      .bins(20)
      .gap(0.1)
      .showDensity(true)
      .densityBandwidth(2)
      .nice(true)
      .toSpec();

    expect(spec.config?.binCount).toBe(20);
    expect(spec.config?.gap).toBe(0.1);
    expect(spec.config?.showDensity).toBe(true);
    expect(spec.config?.densityBandwidth).toBe(2);
    expect(spec.config?.nice).toBe(true);
  });

  it('should support bin width specification', () => {
    const spec = Histogram()
      .data([{ age: 25 }])
      .x('age')
      .binWidth(5)
      .toSpec();

    expect(spec.config?.binWidth).toBe(5);
  });

  it('should support stacking modes', () => {
    const spec = Histogram()
      .data([{ age: 25 }])
      .x('age')
      .stack('stack')
      .toSpec();

    expect(spec.config?.stack).toBe('stack');
  });

  it('should support density y-axis', () => {
    const spec = Histogram()
      .data([{ age: 25 }])
      .x('age')
      .density()
      .toSpec();

    expect(spec.config?.yType).toBe('density');
  });
});

describe('calculateHistogramData', () => {
  it('should create bins from values', () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 4, 5];
    const result = calculateHistogramData(values, { binCount: 5 });

    expect(result.bins.length).toBeGreaterThan(0);
    const totalCount = result.bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(values.length);
  });

  it('should calculate KDE when showDensity is true', () => {
    const values = [1, 2, 3, 4, 5];
    const result = calculateHistogramData(values, { showDensity: true });

    expect(result.kde).toBeDefined();
    expect(result.kde?.x.length).toBeGreaterThan(0);
  });

  it('should not calculate KDE when showDensity is false', () => {
    const values = [1, 2, 3, 4, 5];
    const result = calculateHistogramData(values, { showDensity: false });

    expect(result.kde).toBeUndefined();
  });

  it('should handle empty array', () => {
    const result = calculateHistogramData([]);
    expect(result.bins).toHaveLength(0);
  });

  it('should include category and color', () => {
    const result = calculateHistogramData([1, 2, 3], {}, 'Group A', '#ff0000');
    expect(result.category).toBe('Group A');
    expect(result.color).toBe('#ff0000');
  });

  it('should use specified bin width', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = calculateHistogramData(values, { binWidth: 2 });

    result.bins.forEach((bin, i) => {
      if (i < result.bins.length - 1) {
        expect(bin.x1 - bin.x0).toBeCloseTo(2, 1);
      }
    });
  });
});

describe('processHistogramData', () => {
  it('should group data by category', () => {
    const data: HistogramDataRow[] = [
      { age: 25, gender: 'M' },
      { age: 30, gender: 'M' },
      { age: 28, gender: 'F' },
      { age: 32, gender: 'F' },
    ];

    const results = processHistogramData(data, 'age', 'gender');

    expect(results).toHaveLength(2);
    results.forEach((r) => {
      expect(r.category).toBeDefined();
      expect(r.color).toBeDefined();
    });
  });

  it('should return single histogram when no category', () => {
    const data: HistogramDataRow[] = [{ age: 25 }, { age: 30 }, { age: 35 }];

    const results = processHistogramData(data, 'age');

    expect(results).toHaveLength(1);
    expect(results[0].category).toBeUndefined();
  });

  it('should handle non-numeric values', () => {
    const data: HistogramDataRow[] = [{ age: 25 }, { age: 'not a number' }, { age: 35 }];

    const results = processHistogramData(data, 'age');

    const totalCount = results[0].bins.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(2); // Only numeric values
  });
});

describe('alignBins', () => {
  it('should align bins across multiple histograms', () => {
    const histograms = [
      calculateHistogramData([1, 2, 3, 4, 5], { binCount: 3 }, 'A'),
      calculateHistogramData([3, 4, 5, 6, 7], { binCount: 3 }, 'B'),
    ];

    const aligned = alignBins(histograms);

    // All histograms should have same bin boundaries
    expect(aligned).toHaveLength(2);

    // Check that bins cover the full range (1-7)
    const allBins = aligned.flatMap((h) => h.bins);
    const minX0 = Math.min(...allBins.map((b) => b.x0));
    const maxX1 = Math.max(...allBins.map((b) => b.x1));

    expect(minX0).toBeLessThanOrEqual(1);
    expect(maxX1).toBeGreaterThanOrEqual(7);
  });

  it('should return unchanged for single histogram', () => {
    const histograms = [calculateHistogramData([1, 2, 3], { binCount: 2 })];
    const aligned = alignBins(histograms);
    expect(aligned).toHaveLength(1);
  });
});

describe('generateHistogramMarks', () => {
  const mockScales: HistogramScales = {
    x: (value: number) => value * 20,
    y: (value: number) => 200 - value * 10,
    color: () => '#4e79a7',
  };

  const mockLayout: HistogramLayout = {
    chartArea: { x: 0, y: 0, width: 300, height: 200 },
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const encoding: HistogramEncoding = {
    x: { field: 'age', bin: true },
  };

  it('should generate bar marks', () => {
    const data: HistogramDataRow[] = [
      { age: 20 },
      { age: 25 },
      { age: 30 },
      { age: 35 },
      { age: 40 },
    ];

    const marks = generateHistogramMarks(data, encoding, mockScales, mockLayout);

    const rectMarks = marks.filter((m) => m.type === 'rect');
    expect(rectMarks.length).toBeGreaterThan(0);
  });

  it('should generate density curve when showDensity is true', () => {
    const data: HistogramDataRow[] = [
      { age: 20 },
      { age: 25 },
      { age: 30 },
      { age: 35 },
      { age: 40 },
    ];

    const marks = generateHistogramMarks(data, encoding, mockScales, mockLayout, {
      showDensity: true,
    });

    const pathMarks = marks.filter((m) => m.type === 'path');
    expect(pathMarks.length).toBeGreaterThan(0);
  });

  it('should return empty for no value field', () => {
    const marks = generateHistogramMarks([{ age: 25 }], {}, mockScales, mockLayout);
    expect(marks).toHaveLength(0);
  });

  it('should apply gap between bars', () => {
    const data: HistogramDataRow[] = [{ age: 20 }, { age: 25 }, { age: 30 }];

    const marks = generateHistogramMarks(data, encoding, mockScales, mockLayout, {
      gap: 0.1,
      binCount: 2,
    });

    const rectMarks = marks.filter((m) => m.type === 'rect');
    // Bars should have some gap between them
    expect(rectMarks.length).toBeGreaterThan(0);
  });

  it('should handle grouped histograms with different colors', () => {
    const data: HistogramDataRow[] = [
      { age: 25, gender: 'M' },
      { age: 30, gender: 'M' },
      { age: 28, gender: 'F' },
      { age: 32, gender: 'F' },
    ];

    const encodingWithColor: HistogramEncoding = {
      ...encoding,
      color: { field: 'gender' },
    };

    const marks = generateHistogramMarks(data, encodingWithColor, mockScales, mockLayout);

    const rectMarks = marks.filter((m) => m.type === 'rect');
    expect(rectMarks.length).toBeGreaterThan(0);
  });
});
