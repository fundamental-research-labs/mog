import { formatTickValue } from '../axis-generator';

describe('axis tick formatting', () => {
  it('preserves Excel accounting currency labels', () => {
    const format = '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)';

    expect(formatTickValue(0, format)).toBe('$-');
    expect(formatTickValue(1000000, format)).toBe('$1,000,000');
    expect(formatTickValue(-1000000, format)).toBe('($1,000,000)');
  });
});
