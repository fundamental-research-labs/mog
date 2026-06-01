import { formatExcelValue } from '../src/number-formats';

describe('formatExcelValue', () => {
  it('formats multi-section accounting currency formats', () => {
    const format = '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)';

    expect(formatExcelValue(0, format)).toBe('$-');
    expect(formatExcelValue(1000000, format)).toBe('$1,000,000');
    expect(formatExcelValue(-1000000, format)).toBe('($1,000,000)');
  });

  it('formats quoted literals, sections, grouping, and explicit zero labels', () => {
    expect(formatExcelValue('19', '"FY3/"0')).toBe('FY3/19');

    const format = '#,##0_);\\(#,##0\\);\\–_);"–"_)';
    expect(formatExcelValue(200000, format)).toBe('200,000');
    expect(formatExcelValue(-200000, format)).toBe('(200,000)');
    expect(formatExcelValue(0, format)).toBe('–');
  });

  it('formats percent, scientific, fraction, and date/time formats', () => {
    expect(formatExcelValue(0.125, '0.0%')).toBe('12.5%');
    expect(formatExcelValue(12345, '0.00E+00')).toBe('1.23E+04');
    expect(formatExcelValue(1.25, '# ?/?')).toBe('1 1/4');
    expect(formatExcelValue(45292, 'mmm-yy')).toBe('Jan-24');
  });
});
