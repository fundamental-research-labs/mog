/**
 * convert.ts — Comprehensive tests.
 *
 * Covers:
 * - convertContractsFilter: ColumnFilterCriteria -> FilterCriteria | null
 * - Value filters (type: 'value' -> ValueFilter)
 * - Condition filters (type: 'condition' -> ConditionFilter / DynamicFilter)
 * - TopBottom filters (type: 'top10' -> TopBottomFilter)
 * - Color filters -> null
 * - Unknown types -> null
 * - Operator mapping (startsWith -> beginsWith, etc.)
 * - Edge cases (empty conditions, unsupported operators)
 */

import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';

import type { ConditionFilter, DynamicFilter, TopBottomFilter, ValueFilter } from '../types';

import { convertContractsFilter } from '../convert';

// =============================================================================
// Value Filter Tests
// =============================================================================

describe('convertContractsFilter — Value Filters', () => {
  test('converts value filter with mixed values (numbers and strings)', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [1, 'hello', 42, 'world'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('values');
    const vf = result as ValueFilter;
    expect(vf.included).toEqual([1, 'hello', 42, 'world']);
    expect(vf.includeBlanks).toBe(false);
  });

  test('converts value filter with null values -> includeBlanks: true, null stripped from included', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [1, null, 2],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.type).toBe('values');
    // null is stripped from included (covered by includeBlanks)
    expect(vf.included).toEqual([1, 2]);
    expect(vf.includeBlanks).toBe(true);
  });

  test('converts value filter with empty string values -> includeBlanks: true', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [1, '', 2],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
  });

  test('converts value filter with both null and empty string -> includeBlanks: true, blanks stripped', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, ''],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual([]);
  });

  test('converts value filter with no blank values -> includeBlanks: false', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [10, 20, 'text'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(false);
  });

  test('converts value filter with empty values array', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.type).toBe('values');
    expect(vf.included).toEqual([]);
    expect(vf.includeBlanks).toBe(false);
  });

  test('converts value filter with undefined values (defaults to empty array)', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      // values is undefined
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.type).toBe('values');
    expect(vf.included).toEqual([]);
    expect(vf.includeBlanks).toBe(false);
  });

  test('converts value filter with boolean values', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [true, false],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.included).toEqual([true, false]);
    expect(vf.includeBlanks).toBe(false);
  });
});

// =============================================================================
// Condition Filter Tests
// =============================================================================

describe('convertContractsFilter — Condition Filters', () => {
  test('converts single equals condition', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'equals', value: 42 }],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const cf = result as ConditionFilter;
    expect(cf.type).toBe('condition');
    expect(cf.conditions).toHaveLength(1);
    expect(cf.conditions[0].operator).toBe('equals');
    expect(cf.conditions[0].value).toBe(42);
  });

  test('converts single greaterThan condition', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'greaterThan', value: 100 }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('greaterThan');
    expect(cf.conditions[0].value).toBe(100);
  });

  test('converts single contains condition', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'contains', value: 'test' }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('contains');
    expect(cf.conditions[0].value).toBe('test');
  });

  test('converts all standard operators correctly', () => {
    const operators = [
      ['equals', 'equals'],
      ['notEquals', 'notEquals'],
      ['greaterThan', 'greaterThan'],
      ['greaterThanOrEqual', 'greaterThanOrEqual'],
      ['lessThan', 'lessThan'],
      ['lessThanOrEqual', 'lessThanOrEqual'],
      ['contains', 'contains'],
      ['notContains', 'notContains'],
      ['endsWith', 'endsWith'],
      ['between', 'between'],
      ['notBetween', 'notBetween'],
      ['startsWith', 'beginsWith'],
      ['isBlank', 'isBlank'],
      ['isNotBlank', 'isNotBlank'],
    ] as const;

    for (const [input, expected] of operators) {
      const criteria: ColumnFilterCriteria = {
        type: 'condition',
        conditions: [{ operator: input, value: 'x' }],
      };
      const result = convertContractsFilter(criteria);
      expect(result).not.toBeNull();
      const cf = result as ConditionFilter;
      expect(cf.conditions[0].operator).toBe(expected);
    }
  });

  test('converts startsWith to beginsWith', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'startsWith', value: 'abc' }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('beginsWith');
    expect(cf.conditions[0].value).toBe('abc');
  });

  test('converts multiple conditions with and logic', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'greaterThan', value: 10 },
        { operator: 'lessThan', value: 50 },
      ],
      conditionLogic: 'and',
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.type).toBe('condition');
    expect(cf.conditions).toHaveLength(2);
    expect(cf.conditions[0].operator).toBe('greaterThan');
    expect(cf.conditions[0].value).toBe(10);
    expect(cf.conditions[1].operator).toBe('lessThan');
    expect(cf.conditions[1].value).toBe(50);
    expect(cf.logic).toBe('and');
  });

  test('converts multiple conditions with or logic', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'equals', value: 'A' },
        { operator: 'equals', value: 'B' },
      ],
      conditionLogic: 'or',
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions).toHaveLength(2);
    expect(cf.logic).toBe('or');
  });

  test('defaults logic to and when conditionLogic is not specified', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'greaterThan', value: 0 },
        { operator: 'lessThan', value: 100 },
      ],
      // conditionLogic not set
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.logic).toBe('and');
  });

  test('converts between condition with value2', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'between', value: 5, value2: 15 }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('between');
    expect(cf.conditions[0].value).toBe(5);
    expect(cf.conditions[0].value2).toBe(15);
  });

  test('converts notBetween condition with value2', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'notBetween', value: 10, value2: 20 }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('notBetween');
    expect(cf.conditions[0].value).toBe(10);
    expect(cf.conditions[0].value2).toBe(20);
  });

  test('omits value2 from result when not present in source', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'equals', value: 42 }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0]).not.toHaveProperty('value2');
  });

  test('converts isBlank operator', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'isBlank' }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('isBlank');
    expect(cf.conditions[0].value).toBeNull();
  });

  test('converts isNotBlank operator', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'isNotBlank' }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('isNotBlank');
    expect(cf.conditions[0].value).toBeNull();
  });

  test('condition with undefined value maps to null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'equals' }],
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].value).toBeNull();
  });
});

// =============================================================================
// Condition Filter -> DynamicFilter (aboveAverage / belowAverage)
// =============================================================================

describe('convertContractsFilter — Dynamic Filters (aboveAverage / belowAverage)', () => {
  test('single aboveAverage condition converts to DynamicFilter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'aboveAverage' }],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const df = result as DynamicFilter;
    expect(df.type).toBe('dynamic');
    expect(df.rule).toBe('aboveAverage');
  });

  test('single belowAverage condition converts to DynamicFilter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'belowAverage' }],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const df = result as DynamicFilter;
    expect(df.type).toBe('dynamic');
    expect(df.rule).toBe('belowAverage');
  });

  test('aboveAverage with multiple conditions does NOT convert to DynamicFilter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'aboveAverage' }, { operator: 'greaterThan', value: 10 }],
    };
    const result = convertContractsFilter(criteria);

    // aboveAverage is not a valid table-engine operator, so it gets filtered out
    // only the greaterThan condition remains -> ConditionFilter
    expect(result).not.toBeNull();
    const cf = result as ConditionFilter;
    expect(cf.type).toBe('condition');
    expect(cf.conditions).toHaveLength(1);
    expect(cf.conditions[0].operator).toBe('greaterThan');
  });
});

// =============================================================================
// Condition Filter — Unsupported Operators
// =============================================================================

describe('convertContractsFilter — Unsupported Operators', () => {
  test('condition with unsupported operator returns null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'aboveAverage' as any, value: 10 }],
      conditionLogic: 'and',
    };
    // aboveAverage by itself with length 1 -> DynamicFilter
    // But let's test an operator not in the mapping at all:
    const criteria2: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [{ operator: 'unknownOperator' as any, value: 10 }],
    };
    const result = convertContractsFilter(criteria2);

    // The single condition has an unsupported operator, gets filtered out,
    // conditions.length === 0 -> returns null
    expect(result).toBeNull();
  });

  test('mix of supported and unsupported operators filters out unsupported', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'unknownOp' as any, value: 1 },
        { operator: 'equals', value: 42 },
      ],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const cf = result as ConditionFilter;
    expect(cf.conditions).toHaveLength(1);
    expect(cf.conditions[0].operator).toBe('equals');
    expect(cf.conditions[0].value).toBe(42);
  });

  test('empty conditions array returns null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [],
    };
    const result = convertContractsFilter(criteria);

    expect(result).toBeNull();
  });

  test('undefined conditions array returns null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      // conditions is undefined
    };
    const result = convertContractsFilter(criteria);

    expect(result).toBeNull();
  });
});

// =============================================================================
// TopBottom Filter Tests
// =============================================================================

describe('convertContractsFilter — TopBottom Filters', () => {
  test('converts top10 with explicit values', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      topBottom: {
        type: 'top',
        count: 5,
        by: 'items',
      },
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const tb = result as TopBottomFilter;
    expect(tb.type).toBe('topBottom');
    expect(tb.direction).toBe('top');
    expect(tb.count).toBe(5);
    expect(tb.by).toBe('items');
  });

  test('converts top10 with defaults (top, 10, items)', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      // topBottom is undefined -> defaults applied
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const tb = result as TopBottomFilter;
    expect(tb.type).toBe('topBottom');
    expect(tb.direction).toBe('top');
    expect(tb.count).toBe(10);
    expect(tb.by).toBe('items');
  });

  test('converts bottom percent filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      topBottom: {
        type: 'bottom',
        count: 25,
        by: 'percent',
      },
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const tb = result as TopBottomFilter;
    expect(tb.direction).toBe('bottom');
    expect(tb.count).toBe(25);
    expect(tb.by).toBe('percent');
  });

  test('converts top10 with partial topBottom (only type specified)', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'top10',
      topBottom: {
        type: 'bottom',
        count: undefined as any,
        by: undefined as any,
      },
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const tb = result as TopBottomFilter;
    expect(tb.direction).toBe('bottom');
    expect(tb.count).toBe(10); // default
    expect(tb.by).toBe('items'); // default
  });
});

// =============================================================================
// Special Cases
// =============================================================================

describe('convertContractsFilter — Special Cases', () => {
  test('color filter returns null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'color',
      colorFilter: {
        type: 'background',
        color: '#ff0000',
      },
    };
    const result = convertContractsFilter(criteria);

    expect(result).toBeNull();
  });

  test('unknown filter type returns null', () => {
    const criteria = {
      type: 'somethingElse',
    } as unknown as ColumnFilterCriteria;
    const result = convertContractsFilter(criteria);

    expect(result).toBeNull();
  });

  test('value filter preserves order of included values', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [3, 1, 4, 1, 5],
    };
    const result = convertContractsFilter(criteria);

    const vf = result as ValueFilter;
    expect(vf.included).toEqual([3, 1, 4, 1, 5]);
  });

  test('condition filter preserves order of conditions', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'condition',
      conditions: [
        { operator: 'lessThan', value: 100 },
        { operator: 'greaterThan', value: 0 },
      ],
      conditionLogic: 'and',
    };
    const result = convertContractsFilter(criteria);

    const cf = result as ConditionFilter;
    expect(cf.conditions[0].operator).toBe('lessThan');
    expect(cf.conditions[1].operator).toBe('greaterThan');
  });

  test('value filter with only null -> includeBlanks: true, included is empty', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null],
    };
    const result = convertContractsFilter(criteria);

    const vf = result as ValueFilter;
    // null stripped from included — blank cells matched by includeBlanks
    expect(vf.included).toEqual([]);
    expect(vf.includeBlanks).toBe(true);
  });

  test('value filter with only empty string -> includeBlanks: true', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [''],
    };
    const result = convertContractsFilter(criteria);

    const vf = result as ValueFilter;
    expect(vf.included).toEqual([]);
    expect(vf.includeBlanks).toBe(true);
  });

  test('value filter with 0 is not treated as blank', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [0],
    };
    const result = convertContractsFilter(criteria);

    const vf = result as ValueFilter;
    expect(vf.included).toEqual([0]);
    expect(vf.includeBlanks).toBe(false);
  });

  test('value filter with false is not treated as blank', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [false],
    };
    const result = convertContractsFilter(criteria);

    const vf = result as ValueFilter;
    expect(vf.included).toEqual([false]);
    expect(vf.includeBlanks).toBe(false);
  });
});

// =============================================================================
// Value Filter — includeBlanks / null stripping semantics
// =============================================================================

describe('convertContractsFilter — includeBlanks null stripping', () => {
  test('[null, "hello"] produces includeBlanks: true and included without null', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, 'hello'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual(['hello']);
    // null is NOT in included — blank cells are matched by includeBlanks flag
    expect(vf.included).not.toContain(null);
  });

  test('["", "hello"] produces includeBlanks: true and included without blank text', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: ['', 'hello'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual(['hello']);
    expect(vf.included).not.toContain(null);
  });

  test('[null, "", "hello"] produces includeBlanks: true and included is ["hello"]', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, '', 'hello'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual(['hello']);
  });

  test('multiple nulls in values are all stripped from included', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, 1, null, 2],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual([1, 2]);
  });

  test('explicit includeBlanks true preserves blank-only value filter', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [],
      includeBlanks: true,
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual([]);
  });

  test('explicit includeBlanks false takes precedence over legacy blank values', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: [null, 'A'],
      includeBlanks: false,
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(false);
    expect(vf.included).toEqual(['A']);
  });

  test('legacy whitespace-only values collapse to includeBlanks when explicit flag is omitted', () => {
    const criteria: ColumnFilterCriteria = {
      type: 'value',
      values: ['   ', 'A'],
    };
    const result = convertContractsFilter(criteria);

    expect(result).not.toBeNull();
    const vf = result as ValueFilter;
    expect(vf.includeBlanks).toBe(true);
    expect(vf.included).toEqual(['A']);
  });
});
