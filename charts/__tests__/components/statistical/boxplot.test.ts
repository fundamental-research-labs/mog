/**
 * Unit tests for BoxPlot statistical chart component
 */

import {
  BoxPlot,
  calculateBoxStats,
  calculateGroupedStats,
  generateBoxPlotMarks,
  type BoxPlotDataRow,
  type BoxPlotEncoding,
  type BoxPlotLayout,
  type BoxPlotScales,
} from '../../../src/components/statistical/boxplot';

describe('BoxPlot Builder', () => {
  it('should create a basic spec', () => {
    const spec = BoxPlot()
      .data([{ value: 1 }, { value: 2 }, { value: 3 }])
      .values('value')
      .toSpec();

    expect(spec.mark).toBe('boxplot');
    expect(spec.encoding.y?.field).toBe('value');
    expect(spec.data.values).toHaveLength(3);
  });

  it('should support category grouping', () => {
    const spec = BoxPlot()
      .data([
        { value: 1, group: 'A' },
        { value: 2, group: 'B' },
      ])
      .values('value')
      .category('group')
      .toSpec();

    expect(spec.encoding.x?.field).toBe('group');
  });

  it('should support configuration options', () => {
    const spec = BoxPlot()
      .data([{ value: 1 }])
      .values('value')
      .boxWidth(0.8)
      .showOutliers(false)
      .whiskerMultiplier(3)
      .notched(true)
      .toSpec();

    expect(spec.config?.boxWidth).toBe(0.8);
    expect(spec.config?.showOutliers).toBe(false);
    expect(spec.config?.whiskerMultiplier).toBe(3);
    expect(spec.config?.notched).toBe(true);
  });

  it('should support horizontal orientation', () => {
    const spec = BoxPlot()
      .data([{ value: 1 }])
      .values('value')
      .horizontal()
      .toSpec();

    expect(spec.config?.orientation).toBe('horizontal');
  });
});

describe('calculateBoxStats', () => {
  it('should calculate correct statistics for known data', () => {
    // Data: 1, 2, 3, 4, 5, 6, 7, 8, 9 (n=9)
    // R-7 method: index = (n-1)*p
    // q1: index = 8*0.25 = 2, q1 = sorted[2] = 3
    // median: index = 8*0.5 = 4, median = sorted[4] = 5
    // q3: index = 8*0.75 = 6, q3 = sorted[6] = 7
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const stats = calculateBoxStats(values);

    expect(stats.median).toBe(5);
    expect(stats.q1).toBe(3);
    expect(stats.q3).toBe(7);
  });

  it('should detect outliers', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const stats = calculateBoxStats(values);

    expect(stats.outliers).toContain(100);
    expect(stats.upperWhisker).toBeLessThan(100);
  });

  it('should handle empty array', () => {
    const stats = calculateBoxStats([]);
    expect(stats.median).toBeNaN();
    expect(stats.outliers).toHaveLength(0);
  });

  it('should handle single value', () => {
    const stats = calculateBoxStats([5]);
    expect(stats.median).toBe(5);
    expect(stats.q1).toBe(5);
    expect(stats.q3).toBe(5);
  });

  it('should include category if provided', () => {
    const stats = calculateBoxStats([1, 2, 3], 1.5, 'Group A');
    expect(stats.category).toBe('Group A');
  });

  it('should filter non-finite values', () => {
    const values = [1, 2, NaN, 4, Infinity, 6];
    const stats = calculateBoxStats(values);
    // Should only use finite values: 1, 2, 4, 6
    expect(stats.median).toBeCloseTo(3, 1);
  });
});

describe('calculateGroupedStats', () => {
  it('should group data by category', () => {
    const data: BoxPlotDataRow[] = [
      { value: 1, group: 'A' },
      { value: 2, group: 'A' },
      { value: 3, group: 'A' },
      { value: 10, group: 'B' },
      { value: 20, group: 'B' },
      { value: 30, group: 'B' },
    ];

    const stats = calculateGroupedStats(data, 'value', 'group');

    expect(stats).toHaveLength(2);
    const groupA = stats.find((s) => s.category === 'A');
    const groupB = stats.find((s) => s.category === 'B');

    expect(groupA?.median).toBe(2);
    expect(groupB?.median).toBe(20);
  });

  it('should return single group when no category field', () => {
    const data: BoxPlotDataRow[] = [{ value: 1 }, { value: 2 }, { value: 3 }];

    const stats = calculateGroupedStats(data, 'value');
    expect(stats).toHaveLength(1);
    expect(stats[0].category).toBeUndefined();
  });

  it('should handle non-numeric values', () => {
    const data: BoxPlotDataRow[] = [{ value: 1 }, { value: 'not a number' }, { value: 3 }];

    const stats = calculateGroupedStats(data, 'value');
    // Should only include numeric values
    expect(stats[0].median).toBeCloseTo(2, 1);
  });
});

describe('generateBoxPlotMarks', () => {
  const mockScales: BoxPlotScales = {
    x: (value: string | number) => {
      const categories: Record<string, number> = { A: 50, B: 150 };
      return categories[String(value)] ?? 0;
    },
    y: (value: number) => 200 - value * 10,
    xBandwidth: () => 80,
  };

  const mockLayout: BoxPlotLayout = {
    chartArea: { x: 0, y: 0, width: 300, height: 200 },
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const encoding: BoxPlotEncoding = {
    y: { field: 'value' },
    x: { field: 'group' },
  };

  it('should generate marks for box plot', () => {
    const data: BoxPlotDataRow[] = [
      { value: 1, group: 'A' },
      { value: 2, group: 'A' },
      { value: 3, group: 'A' },
      { value: 4, group: 'A' },
      { value: 5, group: 'A' },
    ];

    const marks = generateBoxPlotMarks(data, encoding, mockScales, mockLayout);

    // Should have: box rect, median line, whiskers, caps
    expect(marks.length).toBeGreaterThan(0);

    // Check for rect mark (box)
    const rectMarks = marks.filter((m) => m.type === 'rect');
    expect(rectMarks.length).toBeGreaterThan(0);

    // Check for path marks (median, whiskers)
    const pathMarks = marks.filter((m) => m.type === 'path');
    expect(pathMarks.length).toBeGreaterThan(0);
  });

  it('should generate outlier marks when enabled', () => {
    const data: BoxPlotDataRow[] = [
      { value: 1, group: 'A' },
      { value: 2, group: 'A' },
      { value: 3, group: 'A' },
      { value: 4, group: 'A' },
      { value: 100, group: 'A' }, // Outlier
    ];

    const marks = generateBoxPlotMarks(data, encoding, mockScales, mockLayout, {
      showOutliers: true,
    });

    const symbolMarks = marks.filter((m) => m.type === 'symbol');
    expect(symbolMarks.length).toBeGreaterThan(0);
  });

  it('should not generate outlier marks when disabled', () => {
    const data: BoxPlotDataRow[] = [
      { value: 1, group: 'A' },
      { value: 2, group: 'A' },
      { value: 3, group: 'A' },
      { value: 100, group: 'A' }, // Outlier
    ];

    const marks = generateBoxPlotMarks(data, encoding, mockScales, mockLayout, {
      showOutliers: false,
    });

    const symbolMarks = marks.filter((m) => m.type === 'symbol');
    expect(symbolMarks).toHaveLength(0);
  });

  it('should return empty for no value field', () => {
    const marks = generateBoxPlotMarks([{ value: 1 }], {}, mockScales, mockLayout);
    expect(marks).toHaveLength(0);
  });

  it('should apply custom styles', () => {
    const data: BoxPlotDataRow[] = [
      { value: 1, group: 'A' },
      { value: 2, group: 'A' },
      { value: 3, group: 'A' },
    ];

    const marks = generateBoxPlotMarks(
      data,
      encoding,
      mockScales,
      mockLayout,
      {},
      {
        box: { fill: '#ff0000' },
      },
    );

    const rectMark = marks.find((m) => m.type === 'rect');
    expect(rectMark?.style?.fill).toBe('#ff0000');
  });
});
