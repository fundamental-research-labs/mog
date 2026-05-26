import {
  countByField,
  groupBy,
  groupByAccessor,
  groupByFields,
  uniqueValues,
} from '../../src/algebra/group-by';
import type { DataRow } from '../../src/grammar/spec';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const fruits: DataRow[] = [
  { category: 'Apple', color: 'red', count: 10 },
  { category: 'Banana', color: 'yellow', count: 5 },
  { category: 'Apple', color: 'green', count: 7 },
  { category: 'Cherry', color: 'red', count: 3 },
  { category: 'Banana', color: 'yellow', count: 8 },
];

// ---------------------------------------------------------------------------
// groupBy — single field
// ---------------------------------------------------------------------------

describe('groupBy', () => {
  it('groups rows by a single field', () => {
    const result = groupBy(fruits, 'category');

    expect(result.size).toBe(3);
    expect(result.get('Apple')).toHaveLength(2);
    expect(result.get('Banana')).toHaveLength(2);
    expect(result.get('Cherry')).toHaveLength(1);
  });

  it('preserves insertion (first-seen) order', () => {
    const keys = [...groupBy(fruits, 'category').keys()];
    expect(keys).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('returns rows in their original order within each group', () => {
    const apples = groupBy(fruits, 'category').get('Apple')!;
    expect(apples[0]).toEqual({ category: 'Apple', color: 'red', count: 10 });
    expect(apples[1]).toEqual({ category: 'Apple', color: 'green', count: 7 });
  });

  it('returns an empty Map for empty data', () => {
    const result = groupBy([], 'category');
    expect(result.size).toBe(0);
  });

  it('handles a single row', () => {
    const result = groupBy([{ x: 1 }], 'x');
    expect(result.size).toBe(1);
    expect(result.get('1')).toEqual([{ x: 1 }]);
  });

  it('handles missing field values (undefined key)', () => {
    const data: DataRow[] = [{ category: 'A' }, { other: 'B' }, { category: 'A' }];
    const result = groupBy(data, 'category');

    expect(result.size).toBe(2);
    expect(result.get('A')).toHaveLength(2);
    expect(result.get('undefined')).toHaveLength(1);
  });

  it('handles null field values', () => {
    const data: DataRow[] = [{ category: null }, { category: 'A' }, { category: null }];
    const result = groupBy(data, 'category');

    expect(result.size).toBe(2);
    expect(result.get('null')).toHaveLength(2);
    expect(result.get('A')).toHaveLength(1);
  });

  it('stringifies numeric field values', () => {
    const data: DataRow[] = [
      { year: 2020, val: 1 },
      { year: 2021, val: 2 },
      { year: 2020, val: 3 },
    ];
    const result = groupBy(data, 'year');

    expect(result.size).toBe(2);
    expect(result.get('2020')).toHaveLength(2);
    expect(result.get('2021')).toHaveLength(1);
  });

  it('stringifies boolean field values', () => {
    const data: DataRow[] = [
      { active: true, name: 'a' },
      { active: false, name: 'b' },
      { active: true, name: 'c' },
    ];
    const result = groupBy(data, 'active');

    expect(result.size).toBe(2);
    expect(result.get('true')).toHaveLength(2);
    expect(result.get('false')).toHaveLength(1);
  });

  it('places all rows in one group when every row has the same value', () => {
    const data: DataRow[] = [
      { type: 'X', v: 1 },
      { type: 'X', v: 2 },
      { type: 'X', v: 3 },
    ];
    const result = groupBy(data, 'type');

    expect(result.size).toBe(1);
    expect(result.get('X')).toHaveLength(3);
  });

  it('creates a separate group per row when all values are unique', () => {
    const data: DataRow[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = groupBy(data, 'id');

    expect(result.size).toBe(3);
    for (const group of result.values()) {
      expect(group).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// groupByFields — composite key
// ---------------------------------------------------------------------------

describe('groupByFields', () => {
  it('groups by multiple fields using composite key', () => {
    const result = groupByFields(fruits, ['category', 'color']);

    // Apple-red, Banana-yellow, Apple-green, Cherry-red
    expect(result.size).toBe(4);
    expect(result.get(JSON.stringify(['Apple', 'red']))).toHaveLength(1);
    expect(result.get(JSON.stringify(['Banana', 'yellow']))).toHaveLength(2);
  });

  it('preserves insertion order for composite keys', () => {
    const keys = [...groupByFields(fruits, ['category', 'color']).keys()];
    expect(keys).toEqual([
      JSON.stringify(['Apple', 'red']),
      JSON.stringify(['Banana', 'yellow']),
      JSON.stringify(['Apple', 'green']),
      JSON.stringify(['Cherry', 'red']),
    ]);
  });

  it('returns an empty Map for empty data', () => {
    expect(groupByFields([], ['a', 'b']).size).toBe(0);
  });

  it('handles missing fields in composite key', () => {
    const data: DataRow[] = [{ a: 1 }, { a: 1, b: 2 }];
    const result = groupByFields(data, ['a', 'b']);

    expect(result.size).toBe(2);
    expect(result.get(JSON.stringify([1, undefined]))).toHaveLength(1);
    expect(result.get(JSON.stringify([1, 2]))).toHaveLength(1);
  });

  it('degenerates to single-field grouping with one field', () => {
    const result = groupByFields(fruits, ['category']);

    expect(result.size).toBe(3);
    expect(result.get(JSON.stringify(['Apple']))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// groupByAccessor — custom function
// ---------------------------------------------------------------------------

describe('groupByAccessor', () => {
  it('groups using a custom accessor function', () => {
    const accessor = (row: DataRow) => ((row.count as number) > 5 ? 'high' : 'low');
    const result = groupByAccessor(fruits, accessor);

    expect(result.size).toBe(2);
    expect(result.get('high')).toHaveLength(3); // 10, 7, 8
    expect(result.get('low')).toHaveLength(2); // 5, 3
  });

  it('works with a field-extracting accessor (like ResolvedEncoding.accessor)', () => {
    const accessor = (row: DataRow) => row['category'];
    const result = groupByAccessor(fruits, accessor);

    expect(result.size).toBe(3);
    expect(result.get('Apple')).toHaveLength(2);
  });

  it('stringifies accessor results', () => {
    const accessor = (row: DataRow) => (row.count as number) * 2;
    const result = groupByAccessor(fruits, accessor);

    expect(result.get('20')).toHaveLength(1); // 10*2
    expect(result.get('10')).toHaveLength(1); // 5*2
  });

  it('returns an empty Map for empty data', () => {
    expect(groupByAccessor([], () => 'x').size).toBe(0);
  });

  it('handles accessor returning null/undefined', () => {
    const data: DataRow[] = [{ a: 1 }, { a: 2 }];
    const result = groupByAccessor(data, () => null);

    expect(result.size).toBe(1);
    expect(result.get('null')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// uniqueValues
// ---------------------------------------------------------------------------

describe('uniqueValues', () => {
  it('returns unique field values', () => {
    const result = uniqueValues(fruits, 'category');
    expect(result).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('preserves first-seen order', () => {
    const data: DataRow[] = [{ x: 'c' }, { x: 'a' }, { x: 'b' }, { x: 'a' }, { x: 'c' }];
    expect(uniqueValues(data, 'x')).toEqual(['c', 'a', 'b']);
  });

  it('returns an empty array for empty data', () => {
    expect(uniqueValues([], 'x')).toEqual([]);
  });

  it('stringifies non-string values', () => {
    const data: DataRow[] = [{ v: 1 }, { v: 2 }, { v: 1 }];
    expect(uniqueValues(data, 'v')).toEqual(['1', '2']);
  });

  it('handles undefined field values', () => {
    const data: DataRow[] = [{ a: 1 }, {}];
    expect(uniqueValues(data, 'a')).toEqual(['1', 'undefined']);
  });

  it('handles a single row', () => {
    expect(uniqueValues([{ x: 'only' }], 'x')).toEqual(['only']);
  });

  it('returns one entry when all values are the same', () => {
    const data: DataRow[] = [{ x: 'same' }, { x: 'same' }, { x: 'same' }];
    expect(uniqueValues(data, 'x')).toEqual(['same']);
  });

  it('returns one entry per row when all values differ', () => {
    const data: DataRow[] = [{ x: 'a' }, { x: 'b' }, { x: 'c' }];
    expect(uniqueValues(data, 'x')).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// countByField
// ---------------------------------------------------------------------------

describe('countByField', () => {
  it('counts occurrences per field value', () => {
    const result = countByField(fruits, 'category');

    expect(result.get('Apple')).toBe(2);
    expect(result.get('Banana')).toBe(2);
    expect(result.get('Cherry')).toBe(1);
  });

  it('returns an empty Map for empty data', () => {
    expect(countByField([], 'x').size).toBe(0);
  });

  it('handles a single row', () => {
    const result = countByField([{ x: 'a' }], 'x');
    expect(result.get('a')).toBe(1);
  });

  it('stringifies non-string field values', () => {
    const data: DataRow[] = [{ n: 42 }, { n: 42 }, { n: 99 }];
    const result = countByField(data, 'n');

    expect(result.get('42')).toBe(2);
    expect(result.get('99')).toBe(1);
  });

  it('counts undefined field values', () => {
    const data: DataRow[] = [{ a: 1 }, {}, {}];
    const result = countByField(data, 'a');

    expect(result.get('1')).toBe(1);
    expect(result.get('undefined')).toBe(2);
  });

  it('preserves insertion order', () => {
    const data: DataRow[] = [{ x: 'c' }, { x: 'a' }, { x: 'b' }, { x: 'a' }];
    const keys = [...countByField(data, 'x').keys()];
    expect(keys).toEqual(['c', 'a', 'b']);
  });
});
