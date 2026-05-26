/**
 * Tests for compare.ts — canonical value comparison and identity utilities.
 *
 * Covers: cellValuesEqual, isBlank, isCellError, getCellErrorValue,
 *         cellValueKey, typeRank, formatCellDisplay
 *
 * Type guards (isCellError, getCellErrorValue, isBlank, typeRank) stay in TS
 * and need no mock. Computation functions delegate to WASM and are mocked here.
 */

import type { CellValue } from '../types';

// ---------------------------------------------------------------------------
// WASM mock — faithful replica of original TS compare.ts logic
// ---------------------------------------------------------------------------

const ERROR_DISPLAY_MAP: Record<string, string> = {
  Null: '#NULL!',
  Div0: '#DIV/0!',
  Value: '#VALUE!',
  Ref: '#REF!',
  Name: '#NAME?',
  Num: '#NUM!',
  Na: '#N/A',
  GettingData: '#GETTING_DATA',
  Spill: '#SPILL!',
  Calc: '#CALC!',
  Circ: '#REF!',
};

const ERROR_SORT_ORDER: Record<string, number> = {
  Null: 0,
  Div0: 1,
  Value: 2,
  Ref: 3,
  Name: 4,
  Num: 5,
  Na: 6,
  GettingData: 7,
  Spill: 8,
  Calc: 9,
  Circ: 3,
};

function mockIsCellError(v: CellValue): boolean {
  return (
    typeof v === 'object' && v !== null && 'type' in v && (v as { type: string }).type === 'error'
  );
}

function mockGetCellErrorValue(v: CellValue): string | null {
  if (mockIsCellError(v)) return (v as { value: string }).value;
  return null;
}

function mockIsBlank(v: CellValue): boolean {
  return v === null || v === undefined;
}

function mockTypeRank(v: CellValue): number {
  if (v === null || v === undefined) return 4;
  if (mockIsCellError(v)) return 3;
  if (typeof v === 'boolean') return 2;
  if (typeof v === 'string') return 1;
  return 0;
}

const mockWasm = {
  table_compare_values(a: CellValue, b: CellValue): number {
    const rankA = mockTypeRank(a);
    const rankB = mockTypeRank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === 4) return 0;
    if (rankA === 3) {
      const errA = mockGetCellErrorValue(a)!;
      const errB = mockGetCellErrorValue(b)!;
      const orderA = ERROR_SORT_ORDER[errA] ?? 99;
      const orderB = ERROR_SORT_ORDER[errB] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return errA < errB ? -1 : errA > errB ? 1 : 0;
    }
    if (rankA === 2) {
      const bA = a as boolean;
      const bB = b as boolean;
      if (bA === bB) return 0;
      return bA ? 1 : -1;
    }
    if (rankA === 1) {
      return (a as string).toLowerCase().localeCompare((b as string).toLowerCase());
    }
    const nA = a as number;
    const nB = b as number;
    if (Number.isNaN(nA)) return Number.isNaN(nB) ? 0 : 1;
    if (Number.isNaN(nB)) return -1;
    return nA < nB ? -1 : nA > nB ? 1 : 0;
  },

  table_cell_value_key(value: CellValue): string {
    if (value === null || value === undefined) return '__NULL__';
    if (mockIsCellError(value)) return `__ERR__:${mockGetCellErrorValue(value)}`;
    if (typeof value === 'boolean') return `__BOOL__:${value}`;
    if (typeof value === 'number') return `__NUM__:${value}`;
    if (typeof value === 'string') return `__STR__:${value.toLowerCase()}`;
    return `__UNK__:${String(value)}`;
  },

  table_cell_values_equal(a: CellValue, b: CellValue): boolean {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))
      return true;
    if (mockIsBlank(a) && mockIsBlank(b)) return true;
    if (mockIsBlank(a) || mockIsBlank(b)) return false;
    if (mockIsCellError(a) && mockIsCellError(b))
      return mockGetCellErrorValue(a) === mockGetCellErrorValue(b);
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return false;
  },

  table_value_in_list(value: CellValue, list: readonly CellValue[]): boolean {
    if (value === null || value === undefined) {
      return list.some((v) => v === null || v === undefined);
    }
    if (mockIsCellError(value)) {
      const errorVal = mockGetCellErrorValue(value);
      return list.some((v) => mockIsCellError(v) && mockGetCellErrorValue(v) === errorVal);
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      return list.some((v) => typeof v === 'string' && v.toLowerCase() === lower);
    }
    if (typeof value === 'number' && Number.isNaN(value)) {
      return list.some((v) => typeof v === 'number' && Number.isNaN(v));
    }
    return list.some((v) => v === value);
  },

  table_format_cell_display(value: CellValue): string {
    if (value === null || value === undefined) return '(Blank)';
    if (mockIsCellError(value)) {
      const variant = mockGetCellErrorValue(value)!;
      return ERROR_DISPLAY_MAP[variant] ?? '#CALC!';
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
  },
};

jest.mock('../wasm-backend', () => ({
  getWasm: () => mockWasm,
  initTableWasm: jest.fn(),
  hasWasm: () => true,
}));

import {
  cellValueKey,
  cellValuesEqual,
  compareValues,
  formatCellDisplay,
  getCellErrorValue,
  isBlank,
  isCellError,
  typeRank,
  valueInList,
} from '../compare';

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/** Convenience helper to create a CellError value. */
function cellError(value: string): CellValue {
  return { type: 'error', value } as unknown as CellValue;
}

/** Cast undefined to CellValue for defensive-behavior tests. */
const UNDEF = undefined as unknown as CellValue;

// ═══════════════════════════════════════════
//  cellValuesEqual
// ═══════════════════════════════════════════

describe('cellValuesEqual', () => {
  it('null === undefined (both blank)', () => {
    expect(cellValuesEqual(null, UNDEF)).toBe(true);
  });

  it('null === null', () => {
    expect(cellValuesEqual(null, null)).toBe(true);
  });

  it('NaN === NaN', () => {
    expect(cellValuesEqual(NaN, NaN)).toBe(true);
  });

  it('strings are case-insensitive: "Hello" === "hello"', () => {
    expect(cellValuesEqual('Hello', 'hello')).toBe(true);
  });

  it('different strings: "Hello" !== "world"', () => {
    expect(cellValuesEqual('Hello', 'world')).toBe(false);
  });

  it('same numbers: 42 === 42', () => {
    expect(cellValuesEqual(42, 42)).toBe(true);
  });

  it('different numbers: 42 !== 43', () => {
    expect(cellValuesEqual(42, 43)).toBe(false);
  });

  it('same booleans: true === true', () => {
    expect(cellValuesEqual(true, true)).toBe(true);
  });

  it('different booleans: true !== false', () => {
    expect(cellValuesEqual(true, false)).toBe(false);
  });

  it('same errors: error("Na") === error("Na")', () => {
    expect(cellValuesEqual(cellError('Na'), cellError('Na'))).toBe(true);
  });

  it('different errors: error("Na") !== error("Ref")', () => {
    expect(cellValuesEqual(cellError('Na'), cellError('Ref'))).toBe(false);
  });

  it('cross-type: 42 !== "42"', () => {
    expect(cellValuesEqual(42, '42')).toBe(false);
  });

  it('cross-type: null !== 0', () => {
    expect(cellValuesEqual(null, 0)).toBe(false);
  });

  it('cross-type: null !== ""', () => {
    expect(cellValuesEqual(null, '')).toBe(false);
  });

  it('empty strings are equal: "" === ""', () => {
    expect(cellValuesEqual('', '')).toBe(true);
  });
});

// ═══════════════════════════════════════════
//  isBlank
// ═══════════════════════════════════════════

describe('isBlank', () => {
  it('null is blank', () => {
    expect(isBlank(null)).toBe(true);
  });

  it('undefined is blank', () => {
    expect(isBlank(UNDEF)).toBe(true);
  });

  it('empty string is NOT blank (Excel semantics)', () => {
    expect(isBlank('')).toBe(false);
  });

  it('0 is not blank', () => {
    expect(isBlank(0)).toBe(false);
  });

  it('false is not blank', () => {
    expect(isBlank(false)).toBe(false);
  });

  it('NaN is not blank', () => {
    expect(isBlank(NaN)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  isCellError
// ═══════════════════════════════════════════

describe('isCellError', () => {
  it('detects error objects', () => {
    expect(isCellError(cellError('Na'))).toBe(true);
  });

  it('null is not an error', () => {
    expect(isCellError(null)).toBe(false);
  });

  it('number is not an error', () => {
    expect(isCellError(42)).toBe(false);
  });

  it('string is not an error', () => {
    expect(isCellError('hello')).toBe(false);
  });

  it('object with wrong type field is not an error', () => {
    const notError = { type: 'notError' } as unknown as CellValue;
    expect(isCellError(notError)).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  getCellErrorValue
// ═══════════════════════════════════════════

describe('getCellErrorValue', () => {
  it('extracts error string from CellError', () => {
    expect(getCellErrorValue(cellError('Na'))).toBe('Na');
  });

  it('returns null for null', () => {
    expect(getCellErrorValue(null)).toBeNull();
  });

  it('returns null for number', () => {
    expect(getCellErrorValue(42)).toBeNull();
  });

  it('returns null for string', () => {
    expect(getCellErrorValue('hello')).toBeNull();
  });
});

// ═══════════════════════════════════════════
//  cellValueKey
// ═══════════════════════════════════════════

describe('cellValueKey', () => {
  it('null produces a consistent key', () => {
    expect(cellValueKey(null)).toBe('__NULL__');
  });

  it('undefined produces the same key as null', () => {
    expect(cellValueKey(UNDEF)).toBe(cellValueKey(null));
  });

  it('NaN produces a consistent key with NaN indicator', () => {
    const key = cellValueKey(NaN);
    expect(key).toBe('__NUM__:NaN');
  });

  it('strings are case-insensitive: "Hello" and "hello" produce the same key', () => {
    expect(cellValueKey('Hello')).toBe(cellValueKey('hello'));
  });

  it('numbers produce a numeric key', () => {
    expect(cellValueKey(42)).toBe('__NUM__:42');
  });

  it('booleans produce a boolean key', () => {
    expect(cellValueKey(true)).toBe('__BOOL__:true');
    expect(cellValueKey(false)).toBe('__BOOL__:false');
  });

  it('different types with same toString produce different keys (42 vs "42")', () => {
    expect(cellValueKey(42)).not.toBe(cellValueKey('42'));
  });

  it('errors produce an error-prefixed key', () => {
    expect(cellValueKey(cellError('Na'))).toBe('__ERR__:Na');
  });
});

// ═══════════════════════════════════════════
//  typeRank
// ═══════════════════════════════════════════

describe('typeRank', () => {
  it('null has rank 4', () => {
    expect(typeRank(null)).toBe(4);
  });

  it('undefined has rank 4', () => {
    expect(typeRank(UNDEF)).toBe(4);
  });

  it('number has rank 0', () => {
    expect(typeRank(42)).toBe(0);
  });

  it('string has rank 1', () => {
    expect(typeRank('hello')).toBe(1);
  });

  it('boolean has rank 2', () => {
    expect(typeRank(true)).toBe(2);
  });

  it('error has rank 3', () => {
    expect(typeRank(cellError('Na'))).toBe(3);
  });
});

// ═══════════════════════════════════════════
//  formatCellDisplay
// ═══════════════════════════════════════════

describe('formatCellDisplay', () => {
  it('null displays as "(Blank)"', () => {
    expect(formatCellDisplay(null)).toBe('(Blank)');
  });

  it('undefined displays as "(Blank)"', () => {
    expect(formatCellDisplay(UNDEF)).toBe('(Blank)');
  });

  it('number displays as string representation', () => {
    expect(formatCellDisplay(42)).toBe('42');
  });

  it('string displays as-is', () => {
    expect(formatCellDisplay('hello')).toBe('hello');
  });

  it('true displays as "TRUE"', () => {
    expect(formatCellDisplay(true)).toBe('TRUE');
  });

  it('false displays as "FALSE"', () => {
    expect(formatCellDisplay(false)).toBe('FALSE');
  });

  it('error displays as its display string', () => {
    expect(formatCellDisplay(cellError('Na'))).toBe('#N/A');
  });
});

// ═══════════════════════════════════════════
//  valueInList
// ═══════════════════════════════════════════

describe('valueInList', () => {
  it('null found in list containing null', () => {
    expect(valueInList(null, [1, null, 'a'])).toBe(true);
  });

  it('null found in list containing undefined', () => {
    expect(valueInList(null, [1, UNDEF, 'a'])).toBe(true);
  });

  it('undefined found in list containing null', () => {
    expect(valueInList(UNDEF, [1, null, 'a'])).toBe(true);
  });

  it('null not found in list without blanks', () => {
    expect(valueInList(null, [1, 'hello', true])).toBe(false);
  });

  it('error found by error string match', () => {
    expect(valueInList(cellError('Na'), [1, cellError('Na'), 'a'])).toBe(true);
  });

  it('error not found if error string differs', () => {
    expect(valueInList(cellError('Na'), [cellError('Ref'), 'a'])).toBe(false);
  });

  it('strings are case-insensitive', () => {
    expect(valueInList('Hello', ['HELLO', 'world'])).toBe(true);
  });

  it('strings not found when absent', () => {
    expect(valueInList('Hello', ['world', 'foo'])).toBe(false);
  });

  it('NaN found in list containing NaN', () => {
    expect(valueInList(NaN, [1, NaN, 'a'])).toBe(true);
  });

  it('NaN not found in list without NaN', () => {
    expect(valueInList(NaN, [1, 2, 'a'])).toBe(false);
  });

  it('number found by strict equality', () => {
    expect(valueInList(42, [1, 42, 100])).toBe(true);
  });

  it('number not found when absent', () => {
    expect(valueInList(42, [1, 2, 3])).toBe(false);
  });

  it('boolean found by strict equality', () => {
    expect(valueInList(true, [false, true])).toBe(true);
  });

  it('boolean not found when absent', () => {
    expect(valueInList(true, [false, 0, 1])).toBe(false);
  });

  it('empty list always returns false', () => {
    expect(valueInList(null, [])).toBe(false);
    expect(valueInList(42, [])).toBe(false);
    expect(valueInList('hello', [])).toBe(false);
    expect(valueInList(true, [])).toBe(false);
    expect(valueInList(cellError('Na'), [])).toBe(false);
  });
});

// ═══════════════════════════════════════════
//  compareValues — unknown error types
// ═══════════════════════════════════════════

describe('compareValues — unknown errors', () => {
  it('custom error sorts after all known errors (rank 99)', () => {
    // #GETTING_DATA is the last known error with rank 7
    // A custom error like #CUSTOM! should sort after it (rank 99)
    expect(compareValues(cellError('#CUSTOM!'), cellError('GettingData'))).toBeGreaterThan(0);
    expect(compareValues(cellError('GettingData'), cellError('#CUSTOM!'))).toBeLessThan(0);
  });

  it('two unknown errors fall back to alphabetical sort', () => {
    // Both have rank 99, so alphabetical: #AAA < #ZZZ
    expect(compareValues(cellError('#AAA!'), cellError('#ZZZ!'))).toBeLessThan(0);
    expect(compareValues(cellError('#ZZZ!'), cellError('#AAA!'))).toBeGreaterThan(0);
  });

  it('two identical unknown errors compare as equal', () => {
    expect(compareValues(cellError('#CUSTOM!'), cellError('#CUSTOM!'))).toBe(0);
  });
});

// ═══════════════════════════════════════════
//  compareValues — #SPILL! and #CALC! sort order
// ═══════════════════════════════════════════

describe('compareValues — #SPILL! and #CALC! sort order', () => {
  it('#SPILL! sorts after #GETTING_DATA', () => {
    expect(compareValues(cellError('Spill'), cellError('GettingData'))).toBeGreaterThan(0);
  });

  it('#SPILL! sorts before #CALC!', () => {
    expect(compareValues(cellError('Spill'), cellError('Calc'))).toBeLessThan(0);
  });

  it('#CALC! sorts after #SPILL!', () => {
    expect(compareValues(cellError('Calc'), cellError('Spill'))).toBeGreaterThan(0);
  });

  it('#SPILL! sorts after #N/A', () => {
    expect(compareValues(cellError('Spill'), cellError('Na'))).toBeGreaterThan(0);
  });

  it('#CALC! sorts after #N/A', () => {
    expect(compareValues(cellError('Calc'), cellError('Na'))).toBeGreaterThan(0);
  });

  it('#NULL! sorts before #SPILL!', () => {
    expect(compareValues(cellError('Null'), cellError('Spill'))).toBeLessThan(0);
  });

  it('full error sort order: #NULL! < #DIV/0! < #VALUE! < #REF! < #NAME? < #NUM! < #N/A < #GETTING_DATA < #SPILL! < #CALC!', () => {
    const errors = [
      cellError('Calc'),
      cellError('Spill'),
      cellError('GettingData'),
      cellError('Na'),
      cellError('Num'),
      cellError('Name'),
      cellError('Ref'),
      cellError('Value'),
      cellError('Div0'),
      cellError('Null'),
    ];
    const sorted = [...errors].sort(compareValues);
    expect(sorted.map(getCellErrorValue)).toEqual([
      'Null',
      'Div0',
      'Value',
      'Ref',
      'Name',
      'Num',
      'Na',
      'GettingData',
      'Spill',
      'Calc',
    ]);
  });
});
