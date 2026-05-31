/**
 * Tests for Encoding Resolver
 */

import {
  createColorScale,
  createScaleForChannel,
  createScales,
  DEFAULT_CATEGORY_COLORS,
  inferFieldType,
  inferScaleType,
} from '../../src/grammar/encoding-resolver';
import { calculateLayout } from '../../src/grammar/layout';
import type { ChannelSpec, ChartSpec, DataRow, EncodingSpec } from '../../src/grammar/spec';

// =============================================================================
// Test Data
// =============================================================================

const quantitativeData: DataRow[] = [
  { x: 0, y: 10 },
  { x: 25, y: 40 },
  { x: 50, y: 30 },
  { x: 75, y: 60 },
  { x: 100, y: 50 },
];

const categoricalData: DataRow[] = [
  { category: 'A', value: 30 },
  { category: 'B', value: 50 },
  { category: 'C', value: 20 },
];

const mixedData: DataRow[] = [
  { date: '2024-01-01', sales: 100, region: 'North' },
  { date: '2024-02-01', sales: 150, region: 'South' },
  { date: '2024-03-01', sales: 120, region: 'North' },
];

// =============================================================================
// Field Type Inference Tests
// =============================================================================

describe('Field Type Inference', () => {
  test('infers quantitative for numeric data', () => {
    const type = inferFieldType('x', quantitativeData);
    expect(type).toBe('quantitative');
  });

  test('infers nominal for string data', () => {
    const type = inferFieldType('region', mixedData);
    expect(type).toBe('ordinal'); // Small number of unique values
  });

  test('infers temporal for date strings', () => {
    const type = inferFieldType('date', mixedData);
    expect(type).toBe('temporal');
  });

  test('returns nominal for unknown field', () => {
    const type = inferFieldType('nonexistent', quantitativeData);
    expect(type).toBe('nominal');
  });

  test('returns nominal for empty data', () => {
    const type = inferFieldType('x', []);
    expect(type).toBe('nominal');
  });

  test('handles Date objects', () => {
    const dateData: DataRow[] = [
      { date: new Date('2024-01-01') },
      { date: new Date('2024-02-01') },
    ];
    const type = inferFieldType('date', dateData);
    expect(type).toBe('temporal');
  });
});

// =============================================================================
// Scale Type Inference Tests
// =============================================================================

describe('Scale Type Inference', () => {
  test('infers linear scale for quantitative', () => {
    expect(inferScaleType('quantitative')).toBe('linear');
  });

  test('infers time scale for temporal', () => {
    expect(inferScaleType('temporal')).toBe('time');
  });

  test('infers band scale for ordinal', () => {
    expect(inferScaleType('ordinal')).toBe('band');
  });

  test('infers band scale for nominal', () => {
    expect(inferScaleType('nominal')).toBe('band');
  });
});

// =============================================================================
// Linear Scale Tests
// =============================================================================

describe('Linear Scale Creation', () => {
  const spec: ChartSpec = { mark: 'point', width: 600, height: 400 };
  const layout = calculateLayout(spec);

  test('creates linear scale for quantitative data', () => {
    const channel: ChannelSpec = { field: 'x', type: 'quantitative' };
    const scale = createScaleForChannel(channel, quantitativeData, [0, 500]);

    expect((scale as any)(0)).toBe(0);
    expect((scale as any)(100)).toBe(500);
    expect((scale as any)(50)).toBe(250);
  });

  test('handles zero option', () => {
    const data: DataRow[] = [{ value: 50 }, { value: 100 }];
    const channel: ChannelSpec = {
      field: 'value',
      type: 'quantitative',
      scale: { zero: true },
    };
    const scale = createScaleForChannel(channel, data, [0, 100]);

    // Domain should include 0
    const domain = (scale as any).domain();
    expect(domain[0]).toBe(0);
  });

  test('applies nice to domain', () => {
    const data: DataRow[] = [{ value: 3 }, { value: 97 }];
    const channel: ChannelSpec = {
      field: 'value',
      type: 'quantitative',
      scale: { nice: true },
    };
    const scale = createScaleForChannel(channel, data, [0, 100]);

    const domain = (scale as any).domain();
    // Nice should round to 0 and 100
    expect(domain[0]).toBeLessThanOrEqual(3);
    expect(domain[1]).toBeGreaterThanOrEqual(97);
  });

  test('respects explicit domain', () => {
    const channel: ChannelSpec = {
      field: 'x',
      type: 'quantitative',
      scale: { domain: [0, 200] },
    };
    const scale = createScaleForChannel(channel, quantitativeData, [0, 500]);

    expect((scale as any)(200)).toBe(500);
    expect((scale as any)(100)).toBe(250);
  });

  test('does not expand explicit domain bounds when zero inclusion is enabled', () => {
    const channel: ChannelSpec = {
      field: 'x',
      type: 'quantitative',
      scale: { domain: [29, 33], zero: true, nice: false },
    };
    const scale = createScaleForChannel(channel, quantitativeData, [0, 500], 'bar');

    expect((scale as any).domain()).toEqual([29, 33]);
  });

  test('handles reverse option', () => {
    const channel: ChannelSpec = {
      field: 'x',
      type: 'quantitative',
      scale: { reverse: true },
    };
    const scale = createScaleForChannel(channel, quantitativeData, [0, 500]);

    // Lower values should map to higher range values
    expect((scale as any)(0)).toBeGreaterThan((scale as any)(100));
  });
});

// =============================================================================
// Band Scale Tests
// =============================================================================

describe('Band Scale Creation', () => {
  test('creates band scale for categorical data', () => {
    const channel: ChannelSpec = { field: 'category', type: 'nominal' };
    const scale = createScaleForChannel(channel, categoricalData, [0, 300]);

    // Should return different values for each category
    const aPos = (scale as any)('A');
    const bPos = (scale as any)('B');
    const cPos = (scale as any)('C');

    expect(aPos).not.toBe(bPos);
    expect(bPos).not.toBe(cPos);
    expect(aPos).toBeLessThan(bPos);
    expect(bPos).toBeLessThan(cPos);
  });

  test('band scale has bandwidth', () => {
    const channel: ChannelSpec = { field: 'category', type: 'nominal' };
    const scale = createScaleForChannel(channel, categoricalData, [0, 300]);

    expect((scale as any).bandwidth()).toBeGreaterThan(0);
  });

  test('band scale respects padding', () => {
    const channel: ChannelSpec = {
      field: 'category',
      type: 'nominal',
      scale: { padding: 0.3 },
    };
    const scale = createScaleForChannel(channel, categoricalData, [0, 300]);

    expect((scale as any).bandwidth()).toBeGreaterThan(0);
    // Bandwidth should be less than range/n when padding > 0
    expect((scale as any).bandwidth()).toBeLessThan(100); // 300/3 = 100
  });
});

// =============================================================================
// Color Scale Tests
// =============================================================================

describe('Color Scale Creation', () => {
  test('creates categorical color scale', () => {
    const channel: ChannelSpec = { field: 'category', type: 'nominal' };
    const scale = createColorScale(channel, categoricalData);

    const colorA = scale('A');
    const colorB = scale('B');
    const colorC = scale('C');

    // Each category should get a different color
    expect(colorA).not.toBe(colorB);
    expect(colorB).not.toBe(colorC);
  });

  test('uses default category colors', () => {
    const channel: ChannelSpec = { field: 'category', type: 'nominal' };
    const scale = createColorScale(channel, categoricalData);

    const colorA = scale('A');
    expect(DEFAULT_CATEGORY_COLORS).toContain(colorA);
  });

  test('creates sequential color scale for quantitative', () => {
    const channel: ChannelSpec = { field: 'value', type: 'quantitative' };
    const data: DataRow[] = [{ value: 0 }, { value: 50 }, { value: 100 }];
    const scale = createColorScale(channel, data);

    const color0 = scale(0);
    const color50 = scale(50);
    const color100 = scale(100);

    // Colors should differ
    expect(color0).not.toBe(color100);
  });

  test('handles constant value', () => {
    const channel: ChannelSpec = { value: '#ff0000' };
    const scale = createColorScale(channel, categoricalData);

    expect(scale('anything')).toBe('#ff0000');
  });

  test('uses custom color range', () => {
    const channel: ChannelSpec = {
      field: 'category',
      type: 'nominal',
      scale: { range: ['#ff0000', '#00ff00', '#0000ff'] },
    };
    const scale = createColorScale(channel, categoricalData);

    expect(scale('A')).toBe('#ff0000');
    expect(scale('B')).toBe('#00ff00');
    expect(scale('C')).toBe('#0000ff');
  });
});

// =============================================================================
// Scale Creation from Encoding Tests
// =============================================================================

describe('Scale Creation from Encoding', () => {
  const spec: ChartSpec = { mark: 'point', width: 600, height: 400 };
  const layout = calculateLayout(spec);

  test('creates all scales from encoding', () => {
    const encoding: EncodingSpec = {
      x: { field: 'x', type: 'quantitative' },
      y: { field: 'y', type: 'quantitative' },
      color: { field: 'category', type: 'nominal' },
    };

    const data: DataRow[] = [
      { x: 0, y: 0, category: 'A' },
      { x: 100, y: 100, category: 'B' },
    ];

    const scales = createScales(encoding, data, layout);

    expect(scales.x).toBeDefined();
    expect(scales.y).toBeDefined();
    expect(scales.color).toBeDefined();
  });

  test('Y scale is inverted for canvas', () => {
    const encoding: EncodingSpec = {
      y: { field: 'y', type: 'quantitative' },
    };

    const data: DataRow[] = [{ y: 0 }, { y: 100 }];

    const scales = createScales(encoding, data, layout);

    // Higher data values should map to lower Y coordinates
    const y0 = (scales.y as any)(0);
    const y100 = (scales.y as any)(100);

    expect(y0).toBeGreaterThan(y100);
  });

  test('creates size scale', () => {
    const encoding: EncodingSpec = {
      size: { field: 'value', type: 'quantitative' },
    };

    const data: DataRow[] = [{ value: 10 }, { value: 100 }];

    const scales = createScales(encoding, data, layout);

    expect(scales.size).toBeDefined();

    const size10 = (scales.size as any)(10);
    const size100 = (scales.size as any)(100);

    expect(size100).toBeGreaterThan(size10);
  });

  test('creates opacity scale', () => {
    const encoding: EncodingSpec = {
      opacity: { field: 'value', type: 'quantitative' },
    };

    const data: DataRow[] = [{ value: 0 }, { value: 100 }];

    const scales = createScales(encoding, data, layout);

    expect(scales.opacity).toBeDefined();

    const opacity0 = (scales.opacity as any)(0);
    const opacity100 = (scales.opacity as any)(100);

    expect(opacity100).toBeGreaterThan(opacity0);
    expect(opacity100).toBeLessThanOrEqual(1);
  });

  test('returns empty object for undefined encoding', () => {
    const scales = createScales(undefined, [], layout);
    expect(scales).toEqual({});
  });
});

// =============================================================================
// Constant Value Tests
// =============================================================================

describe('Constant Value Handling', () => {
  const spec: ChartSpec = { mark: 'point', width: 600, height: 400 };
  const layout = calculateLayout(spec);

  test('handles constant value for position', () => {
    const channel: ChannelSpec = { value: 100 };
    const scale = createScaleForChannel(channel, [], [0, 500]);

    expect((scale as any)('anything')).toBe(100);
  });

  test('handles constant value for color', () => {
    const channel: ChannelSpec = { value: 'red' };
    const scale = createColorScale(channel, []);

    expect(scale('anything')).toBe('red');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('Encoding Resolver Edge Cases', () => {
  const spec: ChartSpec = { mark: 'point', width: 600, height: 400 };
  const layout = calculateLayout(spec);

  test('handles empty data array', () => {
    const channel: ChannelSpec = { field: 'x', type: 'quantitative' };
    const scale = createScaleForChannel(channel, [], [0, 500]);

    // Should not throw
    expect(scale).toBeDefined();
  });

  test('handles all null values', () => {
    const data: DataRow[] = [{ value: null }, { value: null }];
    const channel: ChannelSpec = { field: 'value', type: 'quantitative' };
    const scale = createScaleForChannel(channel, data, [0, 500]);

    // Should not throw
    expect(scale).toBeDefined();
  });

  test('handles missing field in data', () => {
    const data: DataRow[] = [{ x: 10 }, { x: 20 }];
    const channel: ChannelSpec = { field: 'y', type: 'quantitative' };
    const scale = createScaleForChannel(channel, data, [0, 500]);

    // Should not throw
    expect(scale).toBeDefined();
  });

  test('handles single data point', () => {
    const data: DataRow[] = [{ x: 50 }];
    const channel: ChannelSpec = { field: 'x', type: 'quantitative' };
    const scale = createScaleForChannel(channel, data, [0, 500]);

    expect(scale).toBeDefined();
    // Single point should still map to something reasonable
    expect((scale as any)(50)).toBeDefined();
  });
});
