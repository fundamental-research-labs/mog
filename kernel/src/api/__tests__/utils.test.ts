import {
  addressToA1,
  colToLetter,
  createRange,
  getRangeDimensions,
  isAddressInRange,
  isValidAddress,
  isValidRange,
  letterToCol,
  normalizeRange,
  parseCellAddress,
  parseCellRange,
  rangeToA1,
  toA1,
} from '../internal/utils';

// ============================================================================
// parseCellAddress
// ============================================================================

describe('parseCellAddress', () => {
  it('parses "A1" to {row: 0, col: 0}', () => {
    expect(parseCellAddress('A1')).toEqual({ row: 0, col: 0 });
  });

  it('parses "B2" to {row: 1, col: 1}', () => {
    expect(parseCellAddress('B2')).toEqual({ row: 1, col: 1 });
  });

  it('parses "Z1" to {row: 0, col: 25}', () => {
    expect(parseCellAddress('Z1')).toEqual({ row: 0, col: 25 });
  });

  it('parses "AA1" to {row: 0, col: 26}', () => {
    expect(parseCellAddress('AA1')).toEqual({ row: 0, col: 26 });
  });

  it('parses "AA10" to {row: 9, col: 26}', () => {
    expect(parseCellAddress('AA10')).toEqual({ row: 9, col: 26 });
  });

  it('is case insensitive: "a1" parses to {row: 0, col: 0}', () => {
    expect(parseCellAddress('a1')).toEqual({ row: 0, col: 0 });
  });

  it('parses "Sheet1!A1" with sheetName', () => {
    expect(parseCellAddress('Sheet1!A1')).toEqual({ row: 0, col: 0, sheetName: 'Sheet1' });
  });

  it('parses quoted sheet name "\'My Sheet\'!B2"', () => {
    expect(parseCellAddress("'My Sheet'!B2")).toEqual({ row: 1, col: 1, sheetName: 'My Sheet' });
  });

  it('parses quoted sheet name "\'My Sheet\'!B3"', () => {
    expect(parseCellAddress("'My Sheet'!B3")).toEqual({ row: 2, col: 1, sheetName: 'My Sheet' });
  });

  it('returns null for "invalid"', () => {
    expect(parseCellAddress('invalid')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCellAddress('')).toBeNull();
  });

  it('returns null for "A" (no row number)', () => {
    expect(parseCellAddress('A')).toBeNull();
  });

  it('returns null for "1" (no column letter)', () => {
    expect(parseCellAddress('1')).toBeNull();
  });

  it('parses "A0" to row -1 (does not validate)', () => {
    const result = parseCellAddress('A0');
    expect(result).toEqual({ row: -1, col: 0 });
  });
});

// ============================================================================
// parseCellRange
// ============================================================================

describe('parseCellRange', () => {
  it('parses "A1:B2"', () => {
    expect(parseCellRange('A1:B2')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });
  });

  it('parses "A1:A10" (single column range)', () => {
    expect(parseCellRange('A1:A10')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 0,
    });
  });

  it('parses "Z1:AA2" (cross multi-letter boundary)', () => {
    expect(parseCellRange('Z1:AA2')).toEqual({
      startRow: 0,
      startCol: 25,
      endRow: 1,
      endCol: 26,
    });
  });

  it('parses "Sheet1!A1:B2" with sheetName', () => {
    expect(parseCellRange('Sheet1!A1:B2')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
      sheetName: 'Sheet1',
    });
  });

  it('parses "Sheet1!A1:C10" with sheetName', () => {
    expect(parseCellRange('Sheet1!A1:C10')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 9,
      endCol: 2,
      sheetName: 'Sheet1',
    });
  });

  it('parses quoted sheet name "\'My Sheet\'!A1:C3"', () => {
    expect(parseCellRange("'My Sheet'!A1:C3")).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 2,
      endCol: 2,
      sheetName: 'My Sheet',
    });
  });

  it('parses "\'My Sheet\'!A1:A1" as single cell range', () => {
    expect(parseCellRange("'My Sheet'!A1:A1")).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
      sheetName: 'My Sheet',
    });
  });

  it('returns null for "invalid"', () => {
    expect(parseCellRange('invalid')).toBeNull();
  });

  it('treats "A1" as a single-cell range', () => {
    expect(parseCellRange('A1')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    });
  });

  it('returns null for empty string', () => {
    expect(parseCellRange('')).toBeNull();
  });
});

// ============================================================================
// colToLetter
// ============================================================================

describe('colToLetter', () => {
  it('converts 0 to "A"', () => {
    expect(colToLetter(0)).toBe('A');
  });

  it('converts 1 to "B"', () => {
    expect(colToLetter(1)).toBe('B');
  });

  it('converts 25 to "Z"', () => {
    expect(colToLetter(25)).toBe('Z');
  });

  it('converts 26 to "AA"', () => {
    expect(colToLetter(26)).toBe('AA');
  });

  it('converts 27 to "AB"', () => {
    expect(colToLetter(27)).toBe('AB');
  });

  it('converts 51 to "AZ"', () => {
    expect(colToLetter(51)).toBe('AZ');
  });

  it('converts 52 to "BA"', () => {
    expect(colToLetter(52)).toBe('BA');
  });

  it('converts 701 to "ZZ"', () => {
    expect(colToLetter(701)).toBe('ZZ');
  });

  it('converts 702 to "AAA"', () => {
    expect(colToLetter(702)).toBe('AAA');
  });

  it('throws on negative input', () => {
    expect(() => colToLetter(-1)).toThrow('Column number must be >= 0');
  });
});

// ============================================================================
// letterToCol
// ============================================================================

describe('letterToCol', () => {
  it('converts "A" to 0', () => {
    expect(letterToCol('A')).toBe(0);
  });

  it('converts "B" to 1', () => {
    expect(letterToCol('B')).toBe(1);
  });

  it('converts "Z" to 25', () => {
    expect(letterToCol('Z')).toBe(25);
  });

  it('converts "AA" to 26', () => {
    expect(letterToCol('AA')).toBe(26);
  });

  it('converts "AB" to 27', () => {
    expect(letterToCol('AB')).toBe(27);
  });

  it('converts "AZ" to 51', () => {
    expect(letterToCol('AZ')).toBe(51);
  });

  it('converts "BA" to 52', () => {
    expect(letterToCol('BA')).toBe(52);
  });

  it('converts "ZZ" to 701', () => {
    expect(letterToCol('ZZ')).toBe(701);
  });

  it('converts "AAA" to 702', () => {
    expect(letterToCol('AAA')).toBe(702);
  });

  it('is case insensitive: "a" converts to 0', () => {
    expect(letterToCol('a')).toBe(0);
  });

  it('is case insensitive: "aa" converts to 26', () => {
    expect(letterToCol('aa')).toBe(26);
  });
});

// ============================================================================
// toA1
// ============================================================================

describe('toA1', () => {
  it('converts (0, 0) to "A1"', () => {
    expect(toA1(0, 0)).toBe('A1');
  });

  it('converts (1, 1) to "B2"', () => {
    expect(toA1(1, 1)).toBe('B2');
  });

  it('converts (9, 26) to "AA10"', () => {
    expect(toA1(9, 26)).toBe('AA10');
  });

  it('converts (0, 25) to "Z1"', () => {
    expect(toA1(0, 25)).toBe('Z1');
  });
});

// ============================================================================
// addressToA1
// ============================================================================

describe('addressToA1', () => {
  it('converts a basic address without sheet', () => {
    expect(addressToA1({ row: 0, col: 0, sheetId: 'Sheet1' })).toBe('A1');
  });

  it('converts an address with includeSheet=true', () => {
    expect(addressToA1({ row: 0, col: 0, sheetId: 'Sheet1' }, true)).toBe('Sheet1!A1');
  });

  it('quotes sheet name with spaces when includeSheet=true', () => {
    expect(addressToA1({ row: 1, col: 1, sheetId: 'My Sheet' }, true)).toBe("'My Sheet'!B2");
  });

  it('does not include sheet prefix when includeSheet is false', () => {
    expect(addressToA1({ row: 2, col: 2, sheetId: 'Sheet1' }, false)).toBe('C3');
  });

  it('handles address without sheetId and includeSheet=true', () => {
    expect(addressToA1({ row: 0, col: 0, sheetId: '' })).toBe('A1');
  });
});

// ============================================================================
// rangeToA1
// ============================================================================

describe('rangeToA1', () => {
  it('converts a basic range without sheet', () => {
    expect(rangeToA1({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 })).toBe('A1:B2');
  });

  it('converts a range with includeSheet=true to "Sheet1!A1:B2"', () => {
    expect(
      rangeToA1({ startRow: 0, startCol: 0, endRow: 1, endCol: 1, sheetId: 'Sheet1' }, true),
    ).toBe('Sheet1!A1:B2');
  });

  it('converts a range with includeSheet=true to "Sheet1!A1:C10"', () => {
    expect(
      rangeToA1({ startRow: 0, startCol: 0, endRow: 9, endCol: 2, sheetId: 'Sheet1' }, true),
    ).toBe('Sheet1!A1:C10');
  });

  it('quotes sheet name with spaces when includeSheet=true', () => {
    expect(
      rangeToA1({ startRow: 0, startCol: 0, endRow: 2, endCol: 2, sheetId: 'My Sheet' }, true),
    ).toBe("'My Sheet'!A1:C3");
  });

  it('does not include sheet prefix when includeSheet is false', () => {
    expect(
      rangeToA1({ startRow: 0, startCol: 0, endRow: 1, endCol: 1, sheetId: 'Sheet1' }, false),
    ).toBe('A1:B2');
  });
});

// ============================================================================
// isValidAddress
// ============================================================================

describe('isValidAddress', () => {
  it('returns true for (0, 0)', () => {
    expect(isValidAddress(0, 0)).toBe(true);
  });

  it('returns true for (5, 3)', () => {
    expect(isValidAddress(5, 3)).toBe(true);
  });

  it('returns false for negative row', () => {
    expect(isValidAddress(-1, 0)).toBe(false);
  });

  it('returns false for negative col', () => {
    expect(isValidAddress(0, -1)).toBe(false);
  });

  it('returns false for non-integer row', () => {
    expect(isValidAddress(1.5, 0)).toBe(false);
  });

  it('returns false for non-integer col', () => {
    expect(isValidAddress(0, 2.7)).toBe(false);
  });
});

// ============================================================================
// isValidRange
// ============================================================================

describe('isValidRange', () => {
  it('returns true for a valid range', () => {
    expect(isValidRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 })).toBe(true);
  });

  it('returns false when start > end (reversed)', () => {
    expect(isValidRange({ startRow: 1, startCol: 1, endRow: 0, endCol: 0 })).toBe(false);
  });

  it('returns false for negative startRow', () => {
    expect(isValidRange({ startRow: -1, startCol: 0, endRow: 1, endCol: 1 })).toBe(false);
  });

  it('returns false when startRow > endRow', () => {
    expect(isValidRange({ startRow: 2, startCol: 0, endRow: 1, endCol: 1 })).toBe(false);
  });

  it('returns false when startCol > endCol', () => {
    expect(isValidRange({ startRow: 0, startCol: 2, endRow: 1, endCol: 1 })).toBe(false);
  });

  it('returns true for a single-cell range', () => {
    expect(isValidRange({ startRow: 3, startCol: 3, endRow: 3, endCol: 3 })).toBe(true);
  });
});

// ============================================================================
// normalizeRange
// ============================================================================

describe('normalizeRange', () => {
  it('swaps start and end when reversed', () => {
    const result = normalizeRange({ startRow: 1, startCol: 1, endRow: 0, endCol: 0 });
    expect(result).toEqual(
      expect.objectContaining({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }),
    );
  });

  it('returns same values when already normalized', () => {
    const result = normalizeRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 });
    expect(result).toEqual(
      expect.objectContaining({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }),
    );
  });

  it('preserves sheetId', () => {
    const result = normalizeRange({
      startRow: 3,
      startCol: 2,
      endRow: 1,
      endCol: 0,
      sheetId: 'sheet1',
    });
    expect(result.sheetId).toBe('sheet1');
    expect(result.startRow).toBe(1);
    expect(result.startCol).toBe(0);
    expect(result.endRow).toBe(3);
    expect(result.endCol).toBe(2);
  });
});

// ============================================================================
// getRangeDimensions
// ============================================================================

describe('getRangeDimensions', () => {
  it('returns {rows: 2, cols: 2} for A1:B2', () => {
    expect(getRangeDimensions({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 })).toEqual({
      rows: 2,
      cols: 2,
    });
  });

  it('returns correct dimensions for a normal range', () => {
    expect(getRangeDimensions({ startRow: 0, startCol: 0, endRow: 2, endCol: 3 })).toEqual({
      rows: 3,
      cols: 4,
    });
  });

  it('normalizes reversed range before computing dimensions', () => {
    expect(getRangeDimensions({ startRow: 2, startCol: 3, endRow: 0, endCol: 0 })).toEqual({
      rows: 3,
      cols: 4,
    });
  });

  it('returns {rows: 1, cols: 1} for a single-cell range', () => {
    expect(getRangeDimensions({ startRow: 5, startCol: 5, endRow: 5, endCol: 5 })).toEqual({
      rows: 1,
      cols: 1,
    });
  });
});

// ============================================================================
// isAddressInRange
// ============================================================================

describe('isAddressInRange', () => {
  const range = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 };

  it('returns true for address at top-left corner', () => {
    expect(isAddressInRange({ row: 0, col: 0, sheetId: '' }, range)).toBe(true);
  });

  it('returns true for address at bottom-right corner', () => {
    expect(isAddressInRange({ row: 1, col: 1, sheetId: '' }, range)).toBe(true);
  });

  it('returns false for address outside range', () => {
    expect(isAddressInRange({ row: 2, col: 0, sheetId: '' }, range)).toBe(false);
  });

  it('returns false for address outside column range', () => {
    expect(isAddressInRange({ row: 0, col: 2, sheetId: '' }, range)).toBe(false);
  });

  it('returns true for address in the middle of range', () => {
    const largerRange = { startRow: 0, startCol: 0, endRow: 5, endCol: 5 };
    expect(isAddressInRange({ row: 3, col: 3, sheetId: '' }, largerRange)).toBe(true);
  });
});

// ============================================================================
// createRange
// ============================================================================

describe('createRange', () => {
  it('creates a range from (0, 0) with 3 rows and 4 cols', () => {
    expect(createRange(0, 0, 3, 4)).toEqual(
      expect.objectContaining({ startRow: 0, startCol: 0, endRow: 2, endCol: 3 }),
    );
  });

  it('creates a single-cell range', () => {
    expect(createRange(5, 2, 1, 1)).toEqual(
      expect.objectContaining({ startRow: 5, startCol: 2, endRow: 5, endCol: 2 }),
    );
  });

  it('includes sheetId when provided', () => {
    const result = createRange(0, 0, 1, 1, 'sheet1');
    expect(result).toEqual(
      expect.objectContaining({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
        sheetId: 'sheet1',
      }),
    );
  });

  it('has undefined sheetId when not provided', () => {
    const result = createRange(0, 0, 2, 2);
    expect(result.sheetId).toBeUndefined();
  });
});
