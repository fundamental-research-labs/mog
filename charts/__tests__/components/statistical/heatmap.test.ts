/**
 * Unit tests for Heatmap statistical chart component
 */

import {
  Heatmap,
  calculateDomain,
  createColorScale,
  createCorrelationMatrix,
  extractCategories,
  generateHeatmapMarks,
  processHeatmapData,
  type HeatmapDataRow,
  type HeatmapEncoding,
  type HeatmapLayout,
  type HeatmapScales,
} from '../../../src/components/statistical/heatmap';
import type { RectMark, TextMark } from '../../../src/primitives/types';

describe('Heatmap Builder', () => {
  it('should create a basic spec', () => {
    const spec = Heatmap()
      .data([
        { row: 'A', col: 'X', value: 10 },
        { row: 'B', col: 'Y', value: 20 },
      ])
      .x('col')
      .y('row')
      .color('value')
      .toSpec();

    expect(spec.mark).toBe('rect');
    expect(spec.encoding.x?.field).toBe('col');
    expect(spec.encoding.y?.field).toBe('row');
    expect(spec.encoding.color?.field).toBe('value');
  });

  it('should support color scheme', () => {
    const spec = Heatmap()
      .data([{ row: 'A', col: 'X', value: 10 }])
      .x('col')
      .y('row')
      .color('value')
      .colorScheme('viridis')
      .toSpec();

    expect(spec.encoding.color?.scale?.scheme).toBe('viridis');
  });

  it('should support diverging scale', () => {
    const spec = Heatmap()
      .data([{ row: 'A', col: 'X', value: 0 }])
      .x('col')
      .y('row')
      .color('value')
      .divergingScale(-1, 0, 1)
      .toSpec();

    expect(spec.encoding.color?.scale?.type).toBe('diverging');
    expect(spec.encoding.color?.scale?.domain).toEqual([-1, 0, 1]);
  });

  it('should support configuration options', () => {
    const spec = Heatmap()
      .data([{ row: 'A', col: 'X', value: 10 }])
      .x('col')
      .y('row')
      .color('value')
      .showLabels(true)
      .labelFormat('.2f')
      .cellGap(0.05)
      .cellRadius(4)
      .correlationMatrix(true)
      .toSpec();

    expect(spec.config?.showLabels).toBe(true);
    expect(spec.config?.labelFormat).toBe('.2f');
    expect(spec.config?.cellGap).toBe(0.05);
    expect(spec.config?.cellRadius).toBe(4);
    expect(spec.config?.correlationMatrix).toBe(true);
  });
});

describe('createColorScale', () => {
  it('should create sequential scale', () => {
    const scale = createColorScale([0, 100], 'blues', 'sequential');

    expect(typeof scale(0)).toBe('string');
    expect(typeof scale(50)).toBe('string');
    expect(typeof scale(100)).toBe('string');
  });

  it('should create diverging scale', () => {
    const scale = createColorScale([-1, 0, 1], 'rdbu', 'diverging');

    const negativeColor = scale(-1);
    const zeroColor = scale(0);
    const positiveColor = scale(1);

    // Colors should be different at extremes
    expect(negativeColor).not.toBe(positiveColor);
    // Middle should be different from extremes
    expect(zeroColor).not.toBe(negativeColor);
    expect(zeroColor).not.toBe(positiveColor);
  });

  it('should handle values at domain boundaries', () => {
    const scale = createColorScale([0, 100], 'blues');

    // Values at or beyond boundaries should return boundary colors
    const colorAtMin = scale(0);
    const colorBelowMin = scale(-10);
    expect(colorAtMin).toBe(colorBelowMin);

    const colorAtMax = scale(100);
    const colorAboveMax = scale(110);
    expect(colorAtMax).toBe(colorAboveMax);
  });
});

describe('createCorrelationMatrix', () => {
  it('should create correlation matrix from columnar data', () => {
    const data: HeatmapDataRow[] = [
      { a: 1, b: 2, c: 3 },
      { a: 2, b: 4, c: 6 },
      { a: 3, b: 6, c: 9 },
    ];

    const matrix = createCorrelationMatrix(data, ['a', 'b', 'c']);

    expect(matrix).toHaveLength(9); // 3x3

    // Diagonal should be 1 (self-correlation)
    const diagonals = matrix.filter((cell) => cell.x === cell.y);
    diagonals.forEach((cell) => {
      expect(cell.value).toBeCloseTo(1, 5);
    });

    // a and b are perfectly correlated (b = 2a)
    const abCorr = matrix.find((c) => c.x === 'a' && c.y === 'b');
    expect(abCorr?.value).toBeCloseTo(1, 5);
  });

  it('should handle missing values', () => {
    const data: HeatmapDataRow[] = [
      { a: 1, b: 2 },
      { a: 2 }, // missing b
      { a: 3, b: 6 },
    ];

    const matrix = createCorrelationMatrix(data, ['a', 'b']);

    // Should still produce correlation values
    expect(matrix).toHaveLength(4);
  });
});

describe('processHeatmapData', () => {
  it('should process data into cells', () => {
    const data: HeatmapDataRow[] = [
      { row: 'A', col: 'X', value: 10 },
      { row: 'B', col: 'Y', value: 20 },
    ];

    const encoding: HeatmapEncoding = {
      x: { field: 'col' },
      y: { field: 'row' },
      color: { field: 'value' },
    };

    const colorScale = createColorScale([0, 100], 'blues');
    const cells = processHeatmapData(data, encoding, colorScale);

    expect(cells).toHaveLength(2);
    expect(cells[0].x).toBe('X');
    expect(cells[0].y).toBe('A');
    expect(cells[0].value).toBe(10);
    expect(cells[0].color).toBeDefined();
  });

  it('should filter non-numeric values', () => {
    const data: HeatmapDataRow[] = [
      { row: 'A', col: 'X', value: 10 },
      { row: 'B', col: 'Y', value: 'not a number' },
    ];

    const encoding: HeatmapEncoding = {
      x: { field: 'col' },
      y: { field: 'row' },
      color: { field: 'value' },
    };

    const colorScale = createColorScale([0, 100], 'blues');
    const cells = processHeatmapData(data, encoding, colorScale);

    expect(cells).toHaveLength(1);
  });

  it('should return empty for missing encoding fields', () => {
    const cells = processHeatmapData([{ value: 10 }], {}, createColorScale([0, 100], 'blues'));
    expect(cells).toHaveLength(0);
  });
});

describe('extractCategories', () => {
  it('should extract unique categories', () => {
    const data: HeatmapDataRow[] = [
      { category: 'A' },
      { category: 'B' },
      { category: 'A' },
      { category: 'C' },
    ];

    const categories = extractCategories(data, 'category');
    expect(categories).toHaveLength(3);
    expect(categories).toContain('A');
    expect(categories).toContain('B');
    expect(categories).toContain('C');
  });

  it('should handle numeric categories', () => {
    const data: HeatmapDataRow[] = [{ num: 1 }, { num: 2 }, { num: 1 }];

    const categories = extractCategories(data, 'num');
    expect(categories).toHaveLength(2);
    expect(categories).toContain('1');
    expect(categories).toContain('2');
  });

  it('should return sorted categories', () => {
    const data: HeatmapDataRow[] = [{ cat: 'C' }, { cat: 'A' }, { cat: 'B' }];

    const categories = extractCategories(data, 'cat');
    expect(categories).toEqual(['A', 'B', 'C']);
  });
});

describe('calculateDomain', () => {
  it('should calculate sequential domain', () => {
    const data: HeatmapDataRow[] = [{ value: 10 }, { value: 50 }, { value: 100 }];

    const domain = calculateDomain(data, 'value', 'sequential');
    expect(domain).toEqual([10, 100]);
  });

  it('should calculate diverging domain', () => {
    const data: HeatmapDataRow[] = [{ value: -50 }, { value: 0 }, { value: 100 }];

    const domain = calculateDomain(data, 'value', 'diverging');
    expect(domain).toHaveLength(3);
    expect(domain[1]).toBe(0); // Middle is 0
    expect(Math.abs(domain[0] as number)).toBe(domain[2]); // Symmetric
  });

  it('should handle empty data', () => {
    const domain = calculateDomain([], 'value', 'sequential');
    expect(domain).toEqual([0, 1]);
  });
});

describe('generateHeatmapMarks', () => {
  const mockScales: HeatmapScales = {
    x: (value: string) => {
      const categories: Record<string, number> = { X: 0, Y: 50, Z: 100 };
      return categories[value] ?? 0;
    },
    y: (value: string) => {
      const categories: Record<string, number> = { A: 0, B: 30, C: 60 };
      return categories[value] ?? 0;
    },
    color: createColorScale([0, 100], 'blues'),
    xBandwidth: () => 50,
    yBandwidth: () => 30,
  };

  const mockLayout: HeatmapLayout = {
    chartArea: { x: 0, y: 0, width: 150, height: 90 },
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
  };

  const encoding: HeatmapEncoding = {
    x: { field: 'col' },
    y: { field: 'row' },
    color: { field: 'value' },
  };

  it('should generate rect marks for cells', () => {
    const data: HeatmapDataRow[] = [
      { row: 'A', col: 'X', value: 10 },
      { row: 'A', col: 'Y', value: 50 },
      { row: 'B', col: 'X', value: 30 },
      { row: 'B', col: 'Y', value: 80 },
    ];

    const marks = generateHeatmapMarks(data, encoding, mockScales, mockLayout);

    const rectMarks = marks.filter((m) => m.type === 'rect');
    expect(rectMarks).toHaveLength(4);
  });

  it('should generate text marks when showLabels is true', () => {
    const data: HeatmapDataRow[] = [
      { row: 'A', col: 'X', value: 10 },
      { row: 'A', col: 'Y', value: 50 },
    ];

    const marks = generateHeatmapMarks(data, encoding, mockScales, mockLayout, {
      showLabels: true,
    });

    const textMarks = marks.filter((m) => m.type === 'text');
    expect(textMarks).toHaveLength(2);
  });

  it('should not generate text marks when showLabels is false', () => {
    const data: HeatmapDataRow[] = [{ row: 'A', col: 'X', value: 10 }];

    const marks = generateHeatmapMarks(data, encoding, mockScales, mockLayout, {
      showLabels: false,
    });

    const textMarks = marks.filter((m) => m.type === 'text');
    expect(textMarks).toHaveLength(0);
  });

  it('should apply cell gap', () => {
    const data: HeatmapDataRow[] = [{ row: 'A', col: 'X', value: 10 }];

    const marks = generateHeatmapMarks(data, encoding, mockScales, mockLayout, {
      cellGap: 0.1,
    });

    const rectMark = marks.find((m) => m.type === 'rect') as RectMark | undefined;
    // With gap, cell should be smaller than bandwidth
    expect(rectMark?.width).toBeLessThan(50);
    expect(rectMark?.height).toBeLessThan(30);
  });

  it('should format labels correctly', () => {
    const data: HeatmapDataRow[] = [{ row: 'A', col: 'X', value: 0.12345 }];

    const marks = generateHeatmapMarks(data, encoding, mockScales, mockLayout, {
      showLabels: true,
      labelFormat: '.2f',
    });

    const textMark = marks.find((m) => m.type === 'text') as TextMark | undefined;
    expect(textMark?.text).toBe('0.12');
  });

  it('should return empty for missing encoding fields', () => {
    const marks = generateHeatmapMarks(
      [{ row: 'A', col: 'X', value: 10 }],
      {},
      mockScales,
      mockLayout,
    );
    expect(marks).toHaveLength(0);
  });
});
