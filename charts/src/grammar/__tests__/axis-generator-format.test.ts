import { formatTickValue } from '../axis-generator';

describe('axis tick formatting', () => {
  it('preserves Excel accounting currency labels', () => {
    const format = '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)';

    expect(formatTickValue(0, format)).toBe('$-');
    expect(formatTickValue(1000000, format)).toBe('$1,000,000');
    expect(formatTickValue(-1000000, format)).toBe('($1,000,000)');
  });

  it('uses the shared Excel formatter for common axis number formats', () => {
    expect(formatTickValue(0.125, '0.0%')).toBe('12.5%');
    expect(formatTickValue(12345, '0.00E+00')).toBe('1.23E+04');
    expect(formatTickValue(1.25, '# ?/?')).toBe('1 1/4');
    expect(formatTickValue(45292, 'mmm-yy')).toBe('Jan-24');
  });
});
