import { formatSelectionRefersTo, toAbsoluteA1 } from './refers-to-format';

describe('refers-to formatting', () => {
  it('formats a single selected cell with absolute coordinates', () => {
    expect(
      formatSelectionRefersTo('Sheet1', {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      }),
    ).toBe('=Sheet1!$A$1');
  });

  it('formats a selected range with absolute coordinates', () => {
    expect(
      formatSelectionRefersTo('Sheet1', {
        startRow: 1,
        startCol: 1,
        endRow: 2,
        endCol: 2,
      }),
    ).toBe('=Sheet1!$B$2:$C$3');
  });

  it('quotes sheet names using Excel A1 rules', () => {
    expect(
      formatSelectionRefersTo("Bob's Sheet", {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      }),
    ).toBe("='Bob''s Sheet'!$A$1");
  });

  it('does not emit malformed Promise or dollar-sign strings', () => {
    const value = formatSelectionRefersTo('Sheet1', {
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0,
    });

    expect(value).not.toContain('[object Promise]');
    expect(value).not.toContain('$$');
    expect(toAbsoluteA1(0, 0)).toBe('$A$1');
  });
});
