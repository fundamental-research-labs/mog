import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';

import { parseA1, parseCellAddress, parseCellRange } from '../src/a1';

describe('A1 parsing', () => {
  it('accepts absolute markers in cell addresses', () => {
    expect(parseA1('$D$287')).toEqual({ row: 286, col: 3 });
    expect(parseCellAddress('$A$1')).toEqual({ row: 0, col: 0 });
  });

  it('accepts absolute markers in ranges', () => {
    expect(parseCellRange('$A$1:$B$2')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });
  });

  it('preserves unquoted sheet names on absolute ranges', () => {
    expect(parseCellRange('Formulas!$D$287:$D$289')).toEqual({
      sheetName: 'Formulas',
      startRow: 286,
      startCol: 3,
      endRow: 288,
      endCol: 3,
    });
  });

  it('unescapes quoted sheet names', () => {
    expect(parseCellRange("'Bob''s Sheet'!$A$1:$B$2")).toEqual({
      sheetName: "Bob's Sheet",
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1,
    });
  });

  it('parses compact whole-column ranges', () => {
    expect(parseCellRange('N:N')).toEqual({
      startRow: 0,
      startCol: 13,
      endRow: MAX_ROWS - 1,
      endCol: 13,
      isFullColumn: true,
    });

    expect(parseCellRange('$N:$N')).toEqual({
      startRow: 0,
      startCol: 13,
      endRow: MAX_ROWS - 1,
      endCol: 13,
      isFullColumn: true,
    });

    expect(parseCellRange('A:C')).toEqual({
      startRow: 0,
      startCol: 0,
      endRow: MAX_ROWS - 1,
      endCol: 2,
      isFullColumn: true,
    });
  });

  it('parses sheet-qualified compact whole-column ranges', () => {
    expect(parseCellRange("'Bob''s Sheet'!N:N")).toEqual({
      sheetName: "Bob's Sheet",
      startRow: 0,
      startCol: 13,
      endRow: MAX_ROWS - 1,
      endCol: 13,
      isFullColumn: true,
    });
  });

  it('parses compact whole-row ranges', () => {
    expect(parseCellRange('20:20')).toEqual({
      startRow: 19,
      startCol: 0,
      endRow: 19,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    });

    expect(parseCellRange('$20:$20')).toEqual({
      startRow: 19,
      startCol: 0,
      endRow: 19,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    });

    expect(parseCellRange('2:10')).toEqual({
      startRow: 1,
      startCol: 0,
      endRow: 9,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    });
  });

  it('parses sheet-qualified compact whole-row ranges', () => {
    expect(parseCellRange('Sheet1!20:20')).toEqual({
      sheetName: 'Sheet1',
      startRow: 19,
      startCol: 0,
      endRow: 19,
      endCol: MAX_COLS - 1,
      isFullRow: true,
    });
  });

  it('rejects out-of-bounds compact full-axis ranges', () => {
    expect(parseCellRange('XFE:XFE')).toBeNull();
    expect(parseCellRange('1048577:1048577')).toBeNull();
    expect(parseCellRange('0:0')).toBeNull();
  });
});
