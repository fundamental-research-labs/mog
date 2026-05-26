/**
 * Unit tests for ViolinPlot statistical chart component
 */

import {
  ViolinPlot,
  calculateGroupedViolinStats,
  calculateViolinStats,
  generateViolinPlotMarks,
  type ViolinPlotDataRow,
  type ViolinPlotEncoding,
  type ViolinPlotLayout,
  type ViolinPlotScales,
} from '../../../src/components/statistical/violin';

describe('ViolinPlot Builder', () => {
  it('should create a basic spec', () => {
    const spec = ViolinPlot()
      .data([{ score: 85 }, { score: 90 }, { score: 78 }])
      .values('score')
      .toSpec();

    expect(spec.mark).toBe('violin');
    expect(spec.encoding.y?.field).toBe('score');
    expect(spec.data.values).toHaveLength(3);
  });

  it('should support category grouping', () => {
    const spec = ViolinPlot()
      .data([
        { score: 85, class: 'A' },
        { score: 90, class: 'B' },
      ])
      .values('score')
      .category('class')
      .toSpec();

    expect(spec.encoding.x?.field).toBe('class');
  });

  it('should support configuration options', () => {
    const spec = ViolinPlot()
      .data([{ score: 85 }])
      .values('score')
      .violinWidth(0.9)
      .showBox(true)
      .showMedian(true)
      .showPoints(true)
      .bandwidth(0.5)
      .kdePoints(200)
      .kernel('epanechnikov')
      .toSpec();

    expect(spec.config?.violinWidth).toBe(0.9);
    expect(spec.config?.showBox).toBe(true);
    expect(spec.config?.showMedian).toBe(true);
    expect(spec.config?.showPoints).toBe(true);
    expect(spec.config?.bandwidth).toBe(0.5);
    expect(spec.config?.kdePoints).toBe(200);
    expect(spec.config?.kernel).toBe('epanechnikov');
  });

  it('should support horizontal orientation', () => {
    const spec = ViolinPlot()
      .data([{ score: 85 }])
      .values('score')
      .horizontal()
      .toSpec();

    expect(spec.config?.orientation).toBe('horizontal');
  });
});

describe('calculateViolinStats', () => {
  it('should calculate KDE and quartiles', () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 4, 5];
    const stats = calculateViolinStats(values);

    expect(stats.kde.x.length).toBeGreaterThan(0);
    expect(stats.kde.y.length).toBeGreaterThan(0);
    expect(stats.kde.x.length).toBe(stats.kde.y.length);
    expect(stats.median).toBe(3);
  });

  it('should use specified KDE options', () => {
    const values = [1, 2, 3, 4, 5];
    const stats = calculateViolinStats(values, undefined, 50, 'epanechnikov');

    expect(stats.kde.x).toHaveLength(50);
  });

  it('should handle empty array', () => {
    const stats = calculateViolinStats([]);
    expect(stats.kde.x).toHaveLength(0);
    expect(stats.median).toBeNaN();
  });

  it('should include all original values', () => {
    const values = [1, 2, 3, 4, 5];
    const stats = calculateViolinStats(values);
    expect(stats.values).toEqual(values);
  });

  it('should include category if provided', () => {
    const stats = calculateViolinStats([1, 2, 3], undefined, 100, 'gaussian', 'Group A');
    expect(stats.category).toBe('Group A');
  });
});

describe('calculateGroupedViolinStats', () => {
  it('should group data by category', () => {
    const data: ViolinPlotDataRow[] = [
      { score: 80, class: 'A' },
      { score: 85, class: 'A' },
      { score: 90, class: 'B' },
      { score: 95, class: 'B' },
    ];

    const stats = calculateGroupedViolinStats(data, 'score', 'class');

    expect(stats).toHaveLength(2);
    const classA = stats.find((s) => s.category === 'A');
    const classB = stats.find((s) => s.category === 'B');

    expect(classA?.median).toBe(82.5);
    expect(classB?.median).toBe(92.5);
  });

  it('should return single group when no category field', () => {
    const data: ViolinPlotDataRow[] = [{ score: 80 }, { score: 85 }, { score: 90 }];

    const stats = calculateGroupedViolinStats(data, 'score');
    expect(stats).toHaveLength(1);
    expect(stats[0].category).toBeUndefined();
  });
});

describe('generateViolinPlotMarks', () => {
  const mockScales: ViolinPlotScales = {
    x: (value: string | number) => {
      const categories: Record<string, number> = { A: 50, B: 150 };
      return categories[String(value)] ?? 0;
    },
    y: (value: number) => 200 - value * 2,
    xBandwidth: () => 80,
  };

  const mockLayout: ViolinPlotLayout = {
    chartArea: { x: 0, y: 0, width: 300, height: 200 },
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const encoding: ViolinPlotEncoding = {
    y: { field: 'score' },
    x: { field: 'class' },
  };

  it('should generate marks for violin plot', () => {
    const data: ViolinPlotDataRow[] = [
      { score: 70, class: 'A' },
      { score: 75, class: 'A' },
      { score: 80, class: 'A' },
      { score: 85, class: 'A' },
      { score: 90, class: 'A' },
    ];

    const marks = generateViolinPlotMarks(data, encoding, mockScales, mockLayout);

    expect(marks.length).toBeGreaterThan(0);

    // Check for path mark (violin shape)
    const pathMarks = marks.filter((m) => m.type === 'path');
    expect(pathMarks.length).toBeGreaterThan(0);
  });

  it('should include inner box when showBox is true', () => {
    const data: ViolinPlotDataRow[] = [
      { score: 70, class: 'A' },
      { score: 80, class: 'A' },
      { score: 90, class: 'A' },
    ];

    const marks = generateViolinPlotMarks(data, encoding, mockScales, mockLayout, {
      showBox: true,
    });

    const rectMarks = marks.filter((m) => m.type === 'rect');
    expect(rectMarks.length).toBeGreaterThan(0);
  });

  it('should include median marker when showMedian is true', () => {
    const data: ViolinPlotDataRow[] = [
      { score: 70, class: 'A' },
      { score: 80, class: 'A' },
      { score: 90, class: 'A' },
    ];

    const marks = generateViolinPlotMarks(data, encoding, mockScales, mockLayout, {
      showMedian: true,
    });

    const symbolMarks = marks.filter((m) => m.type === 'symbol');
    expect(symbolMarks.some((m) => (m.datum as any)?.type === 'median')).toBe(true);
  });

  it('should include individual points when showPoints is true', () => {
    const data: ViolinPlotDataRow[] = [
      { score: 70, class: 'A' },
      { score: 80, class: 'A' },
      { score: 90, class: 'A' },
    ];

    const marks = generateViolinPlotMarks(data, encoding, mockScales, mockLayout, {
      showPoints: true,
    });

    const pointMarks = marks.filter(
      (m) => m.type === 'symbol' && (m.datum as any)?.type === 'point',
    );
    expect(pointMarks).toHaveLength(3);
  });

  it('should return empty for no value field', () => {
    const marks = generateViolinPlotMarks([{ score: 80 }], {}, mockScales, mockLayout);
    expect(marks).toHaveLength(0);
  });
});
