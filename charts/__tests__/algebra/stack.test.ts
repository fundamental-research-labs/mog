/**
 * Tests for algebra/stack — universal stacking module.
 */
import {
  categoryTotals,
  computeStack,
  dataToStackInputs,
  type StackInput,
} from '../../src/algebra/stack';

// =============================================================================
// Helpers
// =============================================================================

/** Round a number to 6 decimal places to avoid floating-point noise in assertions. */
function r(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Round start/end in a StackOutput array for easy assertion. */
function roundOutputs(outputs: ReturnType<typeof computeStack>) {
  return outputs.map((o) => ({
    ...o,
    start: r(o.start),
    end: r(o.end),
  }));
}

// =============================================================================
// 'zero' mode
// =============================================================================

describe("computeStack — mode: 'zero'", () => {
  it('stacks all positive values upward from 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'A', value: 20, group: 'g2' },
      { category: 'A', value: 30, group: 'g3' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 10, start: 0, end: 10 },
      { category: 'A', group: 'g2', value: 20, start: 10, end: 30 },
      { category: 'A', group: 'g3', value: 30, start: 30, end: 60 },
    ]);
  });

  it('stacks positive and negative values in opposite directions', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'A', value: -5, group: 'g2' },
      { category: 'A', value: 20, group: 'g3' },
      { category: 'A', value: -15, group: 'g4' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 10, start: 0, end: 10 },
      { category: 'A', group: 'g2', value: -5, start: 0, end: -5 },
      { category: 'A', group: 'g3', value: 20, start: 10, end: 30 },
      { category: 'A', group: 'g4', value: -15, start: -5, end: -20 },
    ]);
  });

  it('handles multiple categories independently', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'B', value: 5, group: 'g1' },
      { category: 'A', value: 20, group: 'g2' },
      { category: 'B', value: 15, group: 'g2' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 10, start: 0, end: 10 },
      { category: 'B', group: 'g1', value: 5, start: 0, end: 5 },
      { category: 'A', group: 'g2', value: 20, start: 10, end: 30 },
      { category: 'B', group: 'g2', value: 15, start: 5, end: 20 },
    ]);
  });

  it('handles multiple groups per category', () => {
    const inputs: StackInput[] = [
      { category: 'Jan', value: 100, group: 'Sales' },
      { category: 'Jan', value: 200, group: 'Revenue' },
      { category: 'Jan', value: 50, group: 'Profit' },
      { category: 'Feb', value: 150, group: 'Sales' },
      { category: 'Feb', value: 250, group: 'Revenue' },
      { category: 'Feb', value: 75, group: 'Profit' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });

    // Jan: 0->100->300->350
    expect(result[0]).toEqual({ category: 'Jan', group: 'Sales', value: 100, start: 0, end: 100 });
    expect(result[1]).toEqual({
      category: 'Jan',
      group: 'Revenue',
      value: 200,
      start: 100,
      end: 300,
    });
    expect(result[2]).toEqual({
      category: 'Jan',
      group: 'Profit',
      value: 50,
      start: 300,
      end: 350,
    });

    // Feb: 0->150->400->475
    expect(result[3]).toEqual({ category: 'Feb', group: 'Sales', value: 150, start: 0, end: 150 });
    expect(result[4]).toEqual({
      category: 'Feb',
      group: 'Revenue',
      value: 250,
      start: 150,
      end: 400,
    });
    expect(result[5]).toEqual({
      category: 'Feb',
      group: 'Profit',
      value: 75,
      start: 400,
      end: 475,
    });
  });

  it('works with a single group (positions still computed)', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'only' },
      { category: 'B', value: 20, group: 'only' },
      { category: 'C', value: 30, group: 'only' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });

    // Each category is independent, so each starts at 0
    expect(result).toEqual([
      { category: 'A', group: 'only', value: 10, start: 0, end: 10 },
      { category: 'B', group: 'only', value: 20, start: 0, end: 20 },
      { category: 'C', group: 'only', value: 30, start: 0, end: 30 },
    ]);
  });
});

// =============================================================================
// 'normalize' mode
// =============================================================================

describe("computeStack — mode: 'normalize'", () => {
  it('normalizes values to percentages summing to 100 per category', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 25, group: 'g1' },
      { category: 'A', value: 75, group: 'g2' },
    ];

    const result = roundOutputs(computeStack(inputs, { mode: 'normalize' }));

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 25, start: 0, end: 25 },
      { category: 'A', group: 'g2', value: 75, start: 25, end: 100 },
    ]);
  });

  it('normalizes mixed positive values correctly', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'A', value: 20, group: 'g2' },
      { category: 'A', value: 70, group: 'g3' },
    ];

    const result = roundOutputs(computeStack(inputs, { mode: 'normalize' }));

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 10, start: 0, end: 10 },
      { category: 'A', group: 'g2', value: 20, start: 10, end: 30 },
      { category: 'A', group: 'g3', value: 70, start: 30, end: 100 },
    ]);
  });

  it('handles category with zero total (avoid divide by zero)', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 0, group: 'g1' },
      { category: 'A', value: 0, group: 'g2' },
    ];

    const result = computeStack(inputs, { mode: 'normalize' });

    // Zero total: all segments have zero size
    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 0, start: 0, end: 0 },
      { category: 'A', group: 'g2', value: 0, start: 0, end: 0 },
    ]);
  });

  it('produces cumulative percentage start/end values', () => {
    const inputs: StackInput[] = [
      { category: 'X', value: 1, group: 'a' },
      { category: 'X', value: 1, group: 'b' },
      { category: 'X', value: 1, group: 'c' },
      { category: 'X', value: 1, group: 'd' },
    ];

    const result = roundOutputs(computeStack(inputs, { mode: 'normalize' }));

    // 4 equal values: each should be 25%
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(25);
    expect(result[1].start).toBe(25);
    expect(result[1].end).toBe(50);
    expect(result[2].start).toBe(50);
    expect(result[2].end).toBe(75);
    expect(result[3].start).toBe(75);
    expect(result[3].end).toBe(100);
  });

  it('uses absolute values for normalization (negative values treated as positive magnitude)', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 30, group: 'g1' },
      { category: 'A', value: -70, group: 'g2' },
    ];

    const result = roundOutputs(computeStack(inputs, { mode: 'normalize' }));

    // Total abs = 100, so 30 -> 30%, 70 -> 70%
    expect(result[0]).toEqual({ category: 'A', group: 'g1', value: 30, start: 0, end: 30 });
    expect(result[1]).toEqual({ category: 'A', group: 'g2', value: -70, start: 30, end: 100 });
  });
});

// =============================================================================
// 'center' mode
// =============================================================================

describe("computeStack — mode: 'center'", () => {
  it('centers values symmetrically around 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 20, group: 'g1' },
      { category: 'A', value: 30, group: 'g2' },
      { category: 'A', value: 50, group: 'g3' },
    ];

    const result = computeStack(inputs, { mode: 'center' });

    // Total = 100, offset = -50
    // g1: start=-50, end=-30
    // g2: start=-30, end=0
    // g3: start=0, end=50
    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 20, start: -50, end: -30 },
      { category: 'A', group: 'g2', value: 30, start: -30, end: 0 },
      { category: 'A', group: 'g3', value: 50, start: 0, end: 50 },
    ]);
  });

  it('offsets are -(total/2) per category', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 40, group: 'g1' },
      { category: 'B', value: 60, group: 'g1' },
      { category: 'A', value: 60, group: 'g2' },
      { category: 'B', value: 40, group: 'g2' },
    ];

    const result = computeStack(inputs, { mode: 'center' });

    // Category A: total=100, offset=-50
    // Category B: total=100, offset=-50
    expect(result[0]).toEqual({ category: 'A', group: 'g1', value: 40, start: -50, end: -10 });
    expect(result[1]).toEqual({ category: 'B', group: 'g1', value: 60, start: -50, end: 10 });
    expect(result[2]).toEqual({ category: 'A', group: 'g2', value: 60, start: -10, end: 50 });
    expect(result[3]).toEqual({ category: 'B', group: 'g2', value: 40, start: 10, end: 50 });
  });
});

// =============================================================================
// false mode (no stacking)
// =============================================================================

describe('computeStack — mode: false', () => {
  it('returns each item starting at 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'A', value: 20, group: 'g2' },
      { category: 'B', value: 30, group: 'g1' },
    ];

    const result = computeStack(inputs, { mode: false });

    expect(result).toEqual([
      { category: 'A', group: 'g1', value: 10, start: 0, end: 10 },
      { category: 'A', group: 'g2', value: 20, start: 0, end: 20 },
      { category: 'B', group: 'g1', value: 30, start: 0, end: 30 },
    ]);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('computeStack — edge cases', () => {
  it('returns empty array for empty inputs', () => {
    expect(computeStack([], { mode: 'zero' })).toEqual([]);
    expect(computeStack([], { mode: 'normalize' })).toEqual([]);
    expect(computeStack([], { mode: 'center' })).toEqual([]);
    expect(computeStack([], { mode: false })).toEqual([]);
  });

  it('handles single input', () => {
    const inputs: StackInput[] = [{ category: 'A', value: 42, group: 'g1' }];

    const zeroResult = computeStack(inputs, { mode: 'zero' });
    expect(zeroResult).toEqual([{ category: 'A', group: 'g1', value: 42, start: 0, end: 42 }]);

    const normResult = computeStack(inputs, { mode: 'normalize' });
    expect(normResult).toEqual([{ category: 'A', group: 'g1', value: 42, start: 0, end: 100 }]);

    const centerResult = computeStack(inputs, { mode: 'center' });
    expect(centerResult).toEqual([{ category: 'A', group: 'g1', value: 42, start: -21, end: 21 }]);

    const falseResult = computeStack(inputs, { mode: false });
    expect(falseResult).toEqual([{ category: 'A', group: 'g1', value: 42, start: 0, end: 42 }]);
  });

  it('handles all values zero', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 0, group: 'g1' },
      { category: 'A', value: 0, group: 'g2' },
      { category: 'B', value: 0, group: 'g1' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });
    for (const item of result) {
      expect(item.start).toBe(0);
      expect(item.end).toBe(0);
    }

    const normResult = computeStack(inputs, { mode: 'normalize' });
    for (const item of normResult) {
      expect(item.start).toBe(0);
      expect(item.end).toBe(0);
    }
  });

  it('treats NaN values as 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: NaN, group: 'g1' },
      { category: 'A', value: 10, group: 'g2' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });
    expect(result[0]).toEqual({ category: 'A', group: 'g1', value: 0, start: 0, end: 0 });
    expect(result[1]).toEqual({ category: 'A', group: 'g2', value: 10, start: 0, end: 10 });
  });

  it('treats Infinity values as 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: Infinity, group: 'g1' },
      { category: 'A', value: -Infinity, group: 'g2' },
      { category: 'A', value: 10, group: 'g3' },
    ];

    const result = computeStack(inputs, { mode: 'zero' });
    expect(result[0]).toEqual({ category: 'A', group: 'g1', value: 0, start: 0, end: 0 });
    expect(result[1]).toEqual({ category: 'A', group: 'g2', value: 0, start: 0, end: 0 });
    expect(result[2]).toEqual({ category: 'A', group: 'g3', value: 10, start: 0, end: 10 });
  });

  it('handles large arrays without error', () => {
    const N = 10_000;
    const inputs: StackInput[] = [];
    for (let i = 0; i < N; i++) {
      inputs.push({ category: `cat${i % 100}`, value: i + 1, group: `g${Math.floor(i / 100)}` });
    }

    const start = performance.now();
    const result = computeStack(inputs, { mode: 'zero' });
    const elapsed = performance.now() - start;

    expect(result.length).toBe(N);
    // Should complete in well under 1 second
    expect(elapsed).toBeLessThan(1000);
  });
});

// =============================================================================
// categoryTotals
// =============================================================================

describe('categoryTotals', () => {
  it('computes absolute value totals per category', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: 10, group: 'g1' },
      { category: 'A', value: -20, group: 'g2' },
      { category: 'B', value: 30, group: 'g1' },
      { category: 'B', value: 40, group: 'g2' },
    ];

    const totals = categoryTotals(inputs);
    expect(totals.get('A')).toBe(30); // |10| + |-20|
    expect(totals.get('B')).toBe(70); // |30| + |40|
  });

  it('returns empty map for empty inputs', () => {
    expect(categoryTotals([]).size).toBe(0);
  });

  it('treats non-finite values as 0', () => {
    const inputs: StackInput[] = [
      { category: 'A', value: NaN, group: 'g1' },
      { category: 'A', value: Infinity, group: 'g2' },
      { category: 'A', value: 10, group: 'g3' },
    ];

    const totals = categoryTotals(inputs);
    expect(totals.get('A')).toBe(10); // 0 + 0 + 10
  });
});

// =============================================================================
// dataToStackInputs
// =============================================================================

describe('dataToStackInputs', () => {
  it('converts DataRow arrays to StackInputs', () => {
    const data = [
      { month: 'Jan', sales: 100, region: 'East' },
      { month: 'Jan', sales: 200, region: 'West' },
      { month: 'Feb', sales: 150, region: 'East' },
    ];

    const result = dataToStackInputs(data, 'month', 'sales', 'region');

    expect(result).toEqual([
      { category: 'Jan', value: 100, group: 'East' },
      { category: 'Jan', value: 200, group: 'West' },
      { category: 'Feb', value: 150, group: 'East' },
    ]);
  });

  it('handles missing fields gracefully', () => {
    const data = [{ x: 'A' }, { x: 'B', y: 'not a number' }, { x: 'C', y: 42 }];

    const result = dataToStackInputs(data, 'x', 'y');

    expect(result).toEqual([
      { category: 'A', value: 0, group: '__default__' },
      { category: 'B', value: 0, group: '__default__' },
      { category: 'C', value: 42, group: '__default__' },
    ]);
  });

  it('uses __default__ group when groupField is omitted', () => {
    const data = [
      { cat: 'A', val: 10 },
      { cat: 'B', val: 20 },
    ];

    const result = dataToStackInputs(data, 'cat', 'val');

    expect(result[0].group).toBe('__default__');
    expect(result[1].group).toBe('__default__');
  });

  it('handles undefined category values (coalesced to empty string)', () => {
    const data = [{ val: 10 }];

    const result = dataToStackInputs(data, 'cat', 'val');

    // undefined ?? '' -> '', consistent with groupBy's String() coercion pattern
    expect(result[0].category).toBe('');
  });

  it('treats NaN/Infinity values in data as 0', () => {
    const data = [
      { cat: 'A', val: NaN },
      { cat: 'B', val: Infinity },
      { cat: 'C', val: -Infinity },
    ];

    const result = dataToStackInputs(data, 'cat', 'val');

    expect(result[0].value).toBe(0);
    expect(result[1].value).toBe(0);
    expect(result[2].value).toBe(0);
  });
});
