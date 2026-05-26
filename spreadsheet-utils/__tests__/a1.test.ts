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
});
