/**
 * Tests for Transform Discriminated Union Types and Type Guards
 *
 * Verifies that:
 * 1. Transforms with required `type` discriminant work through applyTransforms()
 * 2. Each type guard function correctly identifies its variant
 */

import type { Transform } from '../../src/grammar/spec';
import {
  isAggregateTransform,
  isBinTransform,
  isCalculateTransform,
  isDensityTransform,
  isFilterTransform,
  isFoldTransform,
  isRegressionTransform,
  isSortTransform,
} from '../../src/grammar/spec';
import { applyTransform, applyTransforms } from '../../src/grammar/transforms';

// =============================================================================
// Type Guard Tests
// =============================================================================

describe('Transform Type Guards', () => {
  test('isFilterTransform identifies filter transforms', () => {
    const t: Transform = { type: 'filter', filter: { field: 'x', equal: 1 } };

    expect(isFilterTransform(t)).toBe(true);
    expect(isFilterTransform({ type: 'sort', sort: [{ field: 'x' }] })).toBe(false);
  });

  test('isAggregateTransform identifies aggregate transforms', () => {
    const spec = {
      groupby: ['category'],
      aggregate: [{ op: 'sum' as const, field: 'value', as: 'total' }],
    };
    const t: Transform = { type: 'aggregate', aggregate: [spec] };

    expect(isAggregateTransform(t)).toBe(true);
    expect(isAggregateTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isBinTransform identifies bin transforms', () => {
    const t: Transform = { type: 'bin', bin: { field: 'value', as: 'binned' } };

    expect(isBinTransform(t)).toBe(true);
    expect(isBinTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isSortTransform identifies sort transforms', () => {
    const t: Transform = { type: 'sort', sort: [{ field: 'x', order: 'ascending' }] };

    expect(isSortTransform(t)).toBe(true);
    expect(isSortTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isCalculateTransform identifies calculate transforms', () => {
    const t: Transform = { type: 'calculate', calculate: 'datum.x * 2', as: 'doubled' };

    expect(isCalculateTransform(t)).toBe(true);
    expect(isCalculateTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isFoldTransform identifies fold transforms', () => {
    const t: Transform = { type: 'fold', fold: ['a', 'b'], as: ['key', 'value'] };

    expect(isFoldTransform(t)).toBe(true);
    expect(isFoldTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isRegressionTransform identifies regression transforms', () => {
    const t: Transform = { type: 'regression', regression: 'y', on: 'x' };

    expect(isRegressionTransform(t)).toBe(true);
    expect(isRegressionTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });

  test('isDensityTransform identifies density transforms', () => {
    const t: Transform = { type: 'density', density: 'value' };

    expect(isDensityTransform(t)).toBe(true);
    expect(isDensityTransform({ type: 'filter', filter: { field: 'x', equal: 1 } })).toBe(false);
  });
});

// =============================================================================
// Discriminated Transforms through applyTransforms()
// =============================================================================

describe('Transforms with explicit type discriminant', () => {
  const testData = [
    { category: 'A', value: 10, status: 'active' },
    { category: 'A', value: 20, status: 'active' },
    { category: 'B', value: 15, status: 'inactive' },
    { category: 'B', value: 25, status: 'active' },
    { category: 'A', value: 30, status: 'inactive' },
  ];

  test('filter transform with type discriminant', () => {
    const result = applyTransform(
      { type: 'filter', filter: { field: 'status', equal: 'active' } },
      testData,
    );
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.status === 'active')).toBe(true);
  });

  test('aggregate transform with type discriminant', () => {
    const result = applyTransform(
      {
        type: 'aggregate',
        aggregate: [
          { groupby: ['category'], aggregate: [{ op: 'sum', field: 'value', as: 'total' }] },
        ],
      },
      testData,
    );
    expect(result).toHaveLength(2);
    const catA = result.find((r) => r.category === 'A');
    expect(catA?.total).toBe(60);
  });

  test('sort transform with type discriminant', () => {
    const result = applyTransform(
      { type: 'sort', sort: [{ field: 'value', order: 'descending' }] },
      testData,
    );
    expect(result[0].value).toBe(30);
    expect(result[result.length - 1].value).toBe(10);
  });

  test('calculate transform with type discriminant', () => {
    const result = applyTransform(
      { type: 'calculate', calculate: 'value * 2', as: 'doubled' },
      testData,
    );
    expect(result).toHaveLength(5);
    expect(result[0].doubled).toBe(20);
    expect(result[1].doubled).toBe(40);
  });

  test('fold transform with type discriminant', () => {
    const wideData = [
      { name: 'Alice', q1: 100, q2: 200 },
      { name: 'Bob', q1: 150, q2: 250 },
    ];
    const result = applyTransform(
      { type: 'fold', fold: ['q1', 'q2'], as: ['quarter', 'sales'] },
      wideData,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ name: 'Alice', quarter: 'q1', sales: 100 });
    expect(result[1]).toEqual({ name: 'Alice', quarter: 'q2', sales: 200 });
  });

  test('bin transform with type discriminant', () => {
    const numData = [{ v: 5 }, { v: 15 }, { v: 25 }, { v: 35 }];
    const result = applyTransform(
      { type: 'bin', bin: { field: 'v', as: 'binned', maxbins: 2 } },
      numData,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toHaveProperty('binned');
    expect(result[0]).toHaveProperty('binned_end');
  });

  test('pipeline of transforms with type discriminants', () => {
    const result = applyTransforms(
      [
        { type: 'filter', filter: { field: 'status', equal: 'active' } },
        {
          type: 'aggregate',
          aggregate: [
            { groupby: ['category'], aggregate: [{ op: 'sum', field: 'value', as: 'total' }] },
          ],
        },
        { type: 'sort', sort: [{ field: 'total', order: 'descending' }] },
      ],
      testData,
    );

    expect(result).toHaveLength(2);
    // Active: A has 10+20=30, B has 25. Descending: A first.
    expect(result[0].category).toBe('A');
    expect(result[0].total).toBe(30);
    expect(result[1].category).toBe('B');
    expect(result[1].total).toBe(25);
  });
});

// =============================================================================
// All transforms with required type discriminant
// =============================================================================

describe('All transforms with required type discriminant', () => {
  const testData = [
    { category: 'A', value: 10, status: 'active' },
    { category: 'A', value: 20, status: 'active' },
    { category: 'B', value: 15, status: 'inactive' },
    { category: 'B', value: 25, status: 'active' },
    { category: 'A', value: 30, status: 'inactive' },
  ];

  test('filter transform with type field', () => {
    const result = applyTransform(
      { type: 'filter', filter: { field: 'status', equal: 'active' } },
      testData,
    );
    expect(result).toHaveLength(3);
  });

  test('aggregate transform with type field', () => {
    const result = applyTransform(
      {
        type: 'aggregate',
        aggregate: [
          { groupby: ['category'], aggregate: [{ op: 'sum', field: 'value', as: 'total' }] },
        ],
      },
      testData,
    );
    expect(result).toHaveLength(2);
  });

  test('sort transform with type field', () => {
    const result = applyTransform(
      { type: 'sort', sort: [{ field: 'value', order: 'ascending' }] },
      testData,
    );
    expect(result[0].value).toBe(10);
  });

  test('calculate transform with type field', () => {
    const result = applyTransform(
      { type: 'calculate', calculate: 'value * 2', as: 'doubled' },
      testData,
    );
    expect(result[0].doubled).toBe(20);
  });

  test('fold transform with type field', () => {
    const wideData = [{ name: 'Alice', q1: 100, q2: 200 }];
    const result = applyTransform(
      { type: 'fold', fold: ['q1', 'q2'], as: ['quarter', 'sales'] },
      wideData,
    );
    expect(result).toHaveLength(2);
  });

  test('pipeline of transforms all with type field', () => {
    const result = applyTransforms(
      [
        { type: 'filter', filter: { field: 'status', equal: 'active' } },
        {
          type: 'aggregate',
          aggregate: [
            { groupby: ['category'], aggregate: [{ op: 'sum', field: 'value', as: 'total' }] },
          ],
        },
        { type: 'sort', sort: [{ field: 'total', order: 'descending' }] },
      ],
      testData,
    );

    expect(result).toHaveLength(2);
    expect(result[0].category).toBe('A');
  });
});
