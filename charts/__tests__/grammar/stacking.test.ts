/**
 * Tests for stacking logic in the Grammar Compiler.
 *
 * Covers: stacked bars (positive/negative accumulators, percent normalization),
 * grouped bars (side-by-side with xOffset), stacked areas, and edge cases.
 */

import { compile, type ChartSpec, type CompileResult } from '../../src/grammar';
import type { PathMark, RectMark } from '../../src/primitives/types';

// =============================================================================
// Helpers
// =============================================================================

/** Extract rect marks (bars) from a compile result. */
function rectMarks(result: CompileResult): RectMark[] {
  return result.marks.filter((m): m is RectMark => m.type === 'rect');
}

/** Extract path marks (lines/areas) from a compile result. */
function pathMarks(result: CompileResult): PathMark[] {
  return result.marks.filter((m): m is PathMark => m.type === 'path');
}

/**
 * Build a standard vertical stacked bar spec.
 * Categories on x, values on y, series on color, with config.stack.
 */
function stackedBarSpec(
  data: Record<string, unknown>[],
  stackMode: 'zero' | 'normalize' | 'center' = 'zero',
): ChartSpec {
  return {
    mark: 'bar',
    data: { values: data },
    encoding: {
      x: { field: 'cat', type: 'ordinal' },
      y: { field: 'val', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
    width: 400,
    height: 300,
    config: { stack: stackMode },
  };
}

/**
 * Build a grouped (non-stacked) bar spec.
 * Categories on x, values on y, series on color, stack disabled.
 */
function groupedBarSpec(data: Record<string, unknown>[]): ChartSpec {
  return {
    mark: 'bar',
    data: { values: data },
    encoding: {
      x: { field: 'cat', type: 'ordinal' },
      y: { field: 'val', type: 'quantitative' },
      color: { field: 'series', type: 'nominal' },
    },
    width: 400,
    height: 300,
    // No config.stack -- bars are grouped by default when color is present
  };
}

// =============================================================================
// Shared test data
// =============================================================================

/** 3 categories, 2 series -- the baseline dataset for most stacking tests. */
const twoSeriesData = [
  { cat: 'A', series: 'S1', val: 10 },
  { cat: 'A', series: 'S2', val: 20 },
  { cat: 'B', series: 'S1', val: 15 },
  { cat: 'B', series: 'S2', val: 25 },
  { cat: 'C', series: 'S1', val: 5 },
  { cat: 'C', series: 'S2', val: 35 },
];

// =============================================================================
// 1. Basic stacking
// =============================================================================

describe('Basic stacking (stack: zero)', () => {
  it('produces one rect mark per data row', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'zero'));
    expect(rectMarks(result)).toHaveLength(6);
  });

  it('stacks S2 bars on top of S1 bars within each category', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'zero'));
    const bars = rectMarks(result);

    // Group bars by category
    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [cat, catBars] of byCategory) {
      expect(catBars).toHaveLength(2);
      // All bars in a category share the same x position (they are stacked, not side-by-side)
      expect(catBars[0].x).toBeCloseTo(catBars[1].x, 0);

      // Stacked bars should not overlap: one bar's visual top should meet the other's visual bottom.
      // In screen coordinates (y increases downward), the S1 bar sits lower (closer to baseline)
      // and S2 sits above it. The union of their heights should equal the total stack height.
      const totalHeight = catBars.reduce((s, b) => s + b.height, 0);
      expect(totalHeight).toBeGreaterThan(0);

      // Verify the bars tile without gap: sort by y (ascending), then the end
      // of the upper bar should meet the start of the lower bar.
      const sorted = [...catBars].sort((a, b) => a.y - b.y);
      const upperEnd = sorted[0].y + sorted[0].height;
      const lowerStart = sorted[1].y;
      expect(upperEnd).toBeCloseTo(lowerStart, 1);
    }
  });

  it('all bars have positive width and height', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'zero'));
    for (const bar of rectMarks(result)) {
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.height).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// 2. Negative value stacking
// =============================================================================

describe('Negative value stacking', () => {
  const mixedData = [
    { cat: 'A', series: 'S1', val: 10 },
    { cat: 'A', series: 'S2', val: -5 },
    { cat: 'B', series: 'S1', val: -8 },
    { cat: 'B', series: 'S2', val: 12 },
  ];

  it('produces one bar per data row', () => {
    const result = compile(stackedBarSpec(mixedData, 'zero'));
    expect(rectMarks(result)).toHaveLength(4);
  });

  it('positive and negative bars extend in opposite directions from baseline', () => {
    const result = compile(stackedBarSpec(mixedData, 'zero'));
    const bars = rectMarks(result);
    const layout = result.layout;

    // Compute the zero baseline: scale(0) for the y-axis
    const yScale = result.scales.y!;
    const baseline = (yScale as any)(0) as number;

    // Category A: S1=10 (positive), S2=-5 (negative)
    const catABars = bars.filter((b) => String((b.datum as Record<string, unknown>).cat) === 'A');
    const posBarA = catABars.find((b) => (b.datum as Record<string, unknown>).val === 10)!;
    const negBarA = catABars.find((b) => (b.datum as Record<string, unknown>).val === -5)!;

    // Positive bar should have its bottom at or above the baseline pixel position
    // (remember: y increases downward, so "above" means smaller y)
    expect(posBarA.y).toBeLessThanOrEqual(baseline + 1);

    // Negative bar should extend below the baseline
    expect(negBarA.y + negBarA.height).toBeGreaterThanOrEqual(baseline - 1);
  });

  it('all bars have non-negative dimensions', () => {
    const result = compile(stackedBarSpec(mixedData, 'zero'));
    for (const bar of rectMarks(result)) {
      expect(bar.width).toBeGreaterThanOrEqual(0);
      expect(bar.height).toBeGreaterThanOrEqual(0);
    }
  });
});

// =============================================================================
// 3. Percent-stacked bars (normalize)
// =============================================================================

describe('Percent-stacked bars (stack: normalize)', () => {
  it('bars in the same category fill the full plot height', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'normalize'));
    const bars = rectMarks(result);
    const plotHeight = result.layout.plotArea.height;

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      const totalHeight = catBars.reduce((s, b) => s + b.height, 0);
      // The combined bar heights should equal the full plot height
      // (since all values are positive, they should fill 100%)
      expect(totalHeight).toBeCloseTo(plotHeight, 0);
    }
  });

  it('proportions are correct within a category', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'normalize'));
    const bars = rectMarks(result);

    // Category A: S1=10, S2=20 => proportions 1/3, 2/3
    const catABars = bars.filter((b) => String((b.datum as Record<string, unknown>).cat) === 'A');
    expect(catABars).toHaveLength(2);

    const s1Bar = catABars.find((b) => (b.datum as Record<string, unknown>).series === 'S1')!;
    const s2Bar = catABars.find((b) => (b.datum as Record<string, unknown>).series === 'S2')!;

    const totalH = s1Bar.height + s2Bar.height;
    // S1 should be ~33% of total
    expect(s1Bar.height / totalH).toBeCloseTo(1 / 3, 1);
    // S2 should be ~67% of total
    expect(s2Bar.height / totalH).toBeCloseTo(2 / 3, 1);
  });

  it('all categories have the same total bar height', () => {
    const result = compile(stackedBarSpec(twoSeriesData, 'normalize'));
    const bars = rectMarks(result);

    const byCategory = new Map<string, number>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      byCategory.set(cat, (byCategory.get(cat) || 0) + bar.height);
    }

    const heights = [...byCategory.values()];
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeCloseTo(heights[0], 0);
    }
  });
});

// =============================================================================
// 4. Grouped bars (no stacking)
// =============================================================================

describe('Grouped bars (side-by-side)', () => {
  it('bars in the same category are placed side by side, not stacked', () => {
    const result = compile(groupedBarSpec(twoSeriesData));
    const bars = rectMarks(result);

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      expect(catBars).toHaveLength(2);
      // Grouped bars should have different x positions
      expect(catBars[0].x).not.toBeCloseTo(catBars[1].x, 0);
    }
  });

  it('grouped bars are narrower than ungrouped bars', () => {
    // Single series (no grouping needed)
    const singleSeriesSpec: ChartSpec = {
      mark: 'bar',
      data: {
        values: [
          { cat: 'A', val: 10 },
          { cat: 'B', val: 20 },
        ],
      },
      encoding: {
        x: { field: 'cat', type: 'ordinal' },
        y: { field: 'val', type: 'quantitative' },
      },
      width: 400,
      height: 300,
    };

    const singleResult = compile(singleSeriesSpec);
    const singleBarWidth = rectMarks(singleResult)[0].width;

    // Two series grouped
    const groupedResult = compile(groupedBarSpec(twoSeriesData));
    const groupedBarWidth = rectMarks(groupedResult)[0].width;

    // Each grouped bar should be narrower than a single-series bar
    expect(groupedBarWidth).toBeLessThan(singleBarWidth);
  });

  it('grouped bars within a category share the same band and do not overlap', () => {
    const result = compile(groupedBarSpec(twoSeriesData));
    const bars = rectMarks(result);

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      const sorted = [...catBars].sort((a, b) => a.x - b.x);
      // Each bar's right edge should be at or before the next bar's left edge
      for (let i = 0; i < sorted.length - 1; i++) {
        const rightEdge = sorted[i].x + sorted[i].width;
        const nextLeft = sorted[i + 1].x;
        expect(rightEdge).toBeLessThanOrEqual(nextLeft + 0.5);
      }
    }
  });
});

// =============================================================================
// 5. Stacked area charts
// =============================================================================

describe('Stacked area charts', () => {
  const areaData = [
    { x: 'Jan', series: 'S1', y: 10 },
    { x: 'Feb', series: 'S1', y: 20 },
    { x: 'Mar', series: 'S1', y: 15 },
    { x: 'Jan', series: 'S2', y: 5 },
    { x: 'Feb', series: 'S2', y: 10 },
    { x: 'Mar', series: 'S2', y: 8 },
  ];

  function stackedAreaSpec(data: Record<string, unknown>[]): ChartSpec {
    return {
      mark: 'area',
      data: { values: data },
      encoding: {
        x: { field: 'x', type: 'ordinal' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'series', type: 'nominal' },
      },
      width: 400,
      height: 300,
      config: { stack: 'zero' },
    };
  }

  it('produces one path mark per series', () => {
    const result = compile(stackedAreaSpec(areaData));
    const paths = pathMarks(result);
    expect(paths).toHaveLength(2);
  });

  it('each area path is a closed shape (ends with Z)', () => {
    const result = compile(stackedAreaSpec(areaData));
    for (const path of pathMarks(result)) {
      expect(path.path.trim()).toMatch(/Z$/);
    }
  });

  it('second series baseline sits on top of first series', () => {
    const result = compile(stackedAreaSpec(areaData));
    const paths = pathMarks(result);
    const layout = result.layout;
    const chartBottom = layout.plotArea.y + layout.plotArea.height;

    // First series path should touch the chart baseline
    const firstPath = paths[0].path;
    // The first path should reference the chartBottom y-coordinate in its path
    // (it starts from the baseline or ends at the baseline).
    expect(firstPath).toContain(String(chartBottom));

    // Second series should NOT touch the chart baseline (it sits on top of first)
    const secondPath = paths[1].path;
    // Extract all y-coordinates from the second path's move/line commands
    const yCoords = [...secondPath.matchAll(/[MLV]\s*[\d.]+,?([\d.]+)/g)].map((m) =>
      parseFloat(m[1]),
    );
    // At least some y coordinates should be above (less than) the chartBottom
    expect(yCoords.some((y) => y < chartBottom - 1)).toBe(true);
  });
});

// =============================================================================
// 6. Single series stacking
// =============================================================================

describe('Single series stacking', () => {
  const singleSeriesData = [
    { cat: 'A', series: 'S1', val: 10 },
    { cat: 'B', series: 'S1', val: 20 },
    { cat: 'C', series: 'S1', val: 30 },
  ];

  it('produces correct bar count with single series', () => {
    const result = compile(stackedBarSpec(singleSeriesData, 'zero'));
    expect(rectMarks(result)).toHaveLength(3);
  });

  it('single series bars each start from the baseline', () => {
    const result = compile(stackedBarSpec(singleSeriesData, 'zero'));
    const bars = rectMarks(result);
    const yScale = result.scales.y!;
    const baseline = (yScale as any)(0) as number;

    for (const bar of bars) {
      // Each bar should touch the baseline: bar.y + bar.height should be close to baseline
      // (for positive values the bar sits above the baseline)
      const barBottom = bar.y + bar.height;
      expect(barBottom).toBeCloseTo(baseline, 0);
    }
  });

  it('bars have heights proportional to values', () => {
    const result = compile(stackedBarSpec(singleSeriesData, 'zero'));
    const bars = rectMarks(result);

    // Find bars for each category by datum
    const barA = bars.find((b) => (b.datum as any).val === 10)!;
    const barB = bars.find((b) => (b.datum as any).val === 20)!;
    const barC = bars.find((b) => (b.datum as any).val === 30)!;

    // Bar B (20) should be ~2x the height of Bar A (10)
    expect(barB.height / barA.height).toBeCloseTo(2.0, 1);
    // Bar C (30) should be ~3x the height of Bar A (10)
    expect(barC.height / barA.height).toBeCloseTo(3.0, 1);
  });
});

// =============================================================================
// 7. Empty/missing category in one series
// =============================================================================

describe('Missing data points in one series', () => {
  // S2 is missing from category C
  const sparseData = [
    { cat: 'A', series: 'S1', val: 10 },
    { cat: 'A', series: 'S2', val: 20 },
    { cat: 'B', series: 'S1', val: 15 },
    { cat: 'B', series: 'S2', val: 25 },
    { cat: 'C', series: 'S1', val: 5 },
  ];

  it('does not crash with a missing data point in one series', () => {
    expect(() => compile(stackedBarSpec(sparseData, 'zero'))).not.toThrow();
  });

  it('produces the correct number of bars (one per data row)', () => {
    const result = compile(stackedBarSpec(sparseData, 'zero'));
    expect(rectMarks(result)).toHaveLength(5);
  });

  it('category C has only one bar (from S1)', () => {
    const result = compile(stackedBarSpec(sparseData, 'zero'));
    const bars = rectMarks(result);
    const catCBars = bars.filter((b) => String((b.datum as Record<string, unknown>).cat) === 'C');
    expect(catCBars).toHaveLength(1);
    expect((catCBars[0].datum as any).series).toBe('S1');
  });

  it('categories with both series still stack correctly', () => {
    const result = compile(stackedBarSpec(sparseData, 'zero'));
    const bars = rectMarks(result);
    const catABars = bars.filter((b) => String((b.datum as Record<string, unknown>).cat) === 'A');
    expect(catABars).toHaveLength(2);
    // They should share the same x position (stacked)
    expect(catABars[0].x).toBeCloseTo(catABars[1].x, 0);
  });
});

// =============================================================================
// 8. All-zero values (percent-stacked edge case)
// =============================================================================

describe('All-zero values with percent-stacked', () => {
  const allZeroData = [
    { cat: 'A', series: 'S1', val: 0 },
    { cat: 'A', series: 'S2', val: 0 },
    { cat: 'B', series: 'S1', val: 0 },
    { cat: 'B', series: 'S2', val: 0 },
  ];

  it('does not crash or produce NaN with all-zero values', () => {
    expect(() => compile(stackedBarSpec(allZeroData, 'normalize'))).not.toThrow();

    const result = compile(stackedBarSpec(allZeroData, 'normalize'));
    const bars = rectMarks(result);
    expect(bars).toHaveLength(4);

    for (const bar of bars) {
      expect(isFinite(bar.x)).toBe(true);
      expect(isFinite(bar.y)).toBe(true);
      expect(isFinite(bar.width)).toBe(true);
      expect(isFinite(bar.height)).toBe(true);
    }
  });

  it('zero-value bars have zero or near-zero height', () => {
    const result = compile(stackedBarSpec(allZeroData, 'normalize'));
    const bars = rectMarks(result);
    for (const bar of bars) {
      // With all zeros, normalization gives 0/0 => bars should have minimal or zero height
      expect(bar.height).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// 9. Three series stacking (deeper stack)
// =============================================================================

describe('Three series stacking', () => {
  const threeSeriesData = [
    { cat: 'A', series: 'S1', val: 10 },
    { cat: 'A', series: 'S2', val: 20 },
    { cat: 'A', series: 'S3', val: 30 },
    { cat: 'B', series: 'S1', val: 5 },
    { cat: 'B', series: 'S2', val: 15 },
    { cat: 'B', series: 'S3', val: 25 },
  ];

  it('all three segments tile without gaps', () => {
    const result = compile(stackedBarSpec(threeSeriesData, 'zero'));
    const bars = rectMarks(result);

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      expect(catBars).toHaveLength(3);
      // Sort by y ascending (top of screen)
      const sorted = [...catBars].sort((a, b) => a.y - b.y);
      // Each segment's bottom should meet the next segment's top
      for (let i = 0; i < sorted.length - 1; i++) {
        const bottom = sorted[i].y + sorted[i].height;
        const nextTop = sorted[i + 1].y;
        expect(bottom).toBeCloseTo(nextTop, 1);
      }
    }
  });
});

// =============================================================================
// 10. Horizontal stacked bars
// =============================================================================

describe('Horizontal stacked bars', () => {
  const horizontalData = [
    { cat: 'A', series: 'S1', val: 10 },
    { cat: 'A', series: 'S2', val: 20 },
    { cat: 'B', series: 'S1', val: 15 },
    { cat: 'B', series: 'S2', val: 25 },
  ];

  function horizontalStackedSpec(): ChartSpec {
    return {
      mark: 'bar',
      data: { values: horizontalData },
      encoding: {
        x: { field: 'val', type: 'quantitative' },
        y: { field: 'cat', type: 'ordinal' },
        color: { field: 'series', type: 'nominal' },
      },
      width: 400,
      height: 300,
      config: { stack: 'zero' },
    };
  }

  it('produces one bar per data row', () => {
    const result = compile(horizontalStackedSpec());
    expect(rectMarks(result)).toHaveLength(4);
  });

  it('bars in same category share the same y position (horizontal stacking)', () => {
    const result = compile(horizontalStackedSpec());
    const bars = rectMarks(result);

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      expect(catBars).toHaveLength(2);
      // Horizontal stacked bars share the same y
      expect(catBars[0].y).toBeCloseTo(catBars[1].y, 0);
    }
  });

  it('horizontal stacked bars tile left-to-right without gaps', () => {
    const result = compile(horizontalStackedSpec());
    const bars = rectMarks(result);

    const byCategory = new Map<string, RectMark[]>();
    for (const bar of bars) {
      const cat = String((bar.datum as Record<string, unknown>).cat);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(bar);
    }

    for (const [_cat, catBars] of byCategory) {
      const sorted = [...catBars].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length - 1; i++) {
        const rightEdge = sorted[i].x + sorted[i].width;
        const nextLeft = sorted[i + 1].x;
        expect(rightEdge).toBeCloseTo(nextLeft, 1);
      }
    }
  });
});

// =============================================================================
// 11. Percent-stacked area
// =============================================================================

describe('Percent-stacked area (stack: normalize)', () => {
  const areaData = [
    { x: 'Jan', series: 'S1', y: 30 },
    { x: 'Feb', series: 'S1', y: 40 },
    { x: 'Jan', series: 'S2', y: 70 },
    { x: 'Feb', series: 'S2', y: 60 },
  ];

  it('does not crash', () => {
    const spec: ChartSpec = {
      mark: 'area',
      data: { values: areaData },
      encoding: {
        x: { field: 'x', type: 'ordinal' },
        y: { field: 'y', type: 'quantitative' },
        color: { field: 'series', type: 'nominal' },
      },
      width: 400,
      height: 300,
      config: { stack: 'normalize' },
    };

    expect(() => compile(spec)).not.toThrow();
    const result = compile(spec);
    const paths = pathMarks(result);
    expect(paths).toHaveLength(2);
  });
});

// =============================================================================
// 12. Large values (numerical stability)
// =============================================================================

describe('Large value stacking', () => {
  const largeData = [
    { cat: 'A', series: 'S1', val: 1_000_000 },
    { cat: 'A', series: 'S2', val: 2_000_000 },
    { cat: 'B', series: 'S1', val: 500_000 },
    { cat: 'B', series: 'S2', val: 1_500_000 },
  ];

  it('produces finite coordinates with large values', () => {
    const result = compile(stackedBarSpec(largeData, 'zero'));
    for (const bar of rectMarks(result)) {
      expect(isFinite(bar.x)).toBe(true);
      expect(isFinite(bar.y)).toBe(true);
      expect(isFinite(bar.width)).toBe(true);
      expect(isFinite(bar.height)).toBe(true);
    }
  });

  it('stacked bars tile correctly with large values', () => {
    const result = compile(stackedBarSpec(largeData, 'zero'));
    const bars = rectMarks(result);

    const catABars = bars.filter((b) => String((b.datum as Record<string, unknown>).cat) === 'A');
    const sorted = [...catABars].sort((a, b) => a.y - b.y);
    const bottom = sorted[0].y + sorted[0].height;
    const nextTop = sorted[1].y;
    expect(bottom).toBeCloseTo(nextTop, 1);
  });
});
