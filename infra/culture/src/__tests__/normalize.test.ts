import { normalizeNegative, normalizeNumber } from '../normalize';
import { getCulture, getDefaultCulture } from '../registry';

describe('normalizeNumber', () => {
  it('passes through en-US unchanged', () => {
    const culture = getDefaultCulture();
    expect(normalizeNumber('1,000.50', culture)).toBe('1,000.50');
  });

  it('normalizes de-DE: 1.000,50 → 1000.50', () => {
    const culture = getCulture('de-DE');
    expect(normalizeNumber('1.000,50', culture)).toBe('1000.50');
  });

  it('normalizes de-DE: 1.234.567,89 → 1234567.89', () => {
    const culture = getCulture('de-DE');
    expect(normalizeNumber('1.234.567,89', culture)).toBe('1234567.89');
  });

  it('normalizes fr-FR non-breaking space: 1 000,50 → 1000.50', () => {
    const culture = getCulture('fr-FR');
    expect(normalizeNumber('1\u00A0000,50', culture)).toBe('1000.50');
  });

  it('normalizes fr-FR regular space: 1 000,50 → 1000.50', () => {
    const culture = getCulture('fr-FR');
    expect(normalizeNumber('1 000,50', culture)).toBe('1000.50');
  });

  it('handles simple decimal in European locale: 3,14 → 3.14', () => {
    const culture = getCulture('de-DE');
    expect(normalizeNumber('3,14', culture)).toBe('3.14');
  });

  it('handles no separators', () => {
    const culture = getCulture('de-DE');
    expect(normalizeNumber('42', culture)).toBe('42');
  });
});

describe('normalizeNegative', () => {
  it('converts accounting format: (123) → -123', () => {
    expect(normalizeNegative('(123)')).toBe('-123');
  });

  it('converts trailing minus: 123- → -123', () => {
    expect(normalizeNegative('123-')).toBe('-123');
  });

  it('converts unicode minus: −123 → -123', () => {
    expect(normalizeNegative('\u2212123')).toBe('-123');
  });

  it('passes through standard negative: -123', () => {
    expect(normalizeNegative('-123')).toBe('-123');
  });

  it('passes through positive: 123', () => {
    expect(normalizeNegative('123')).toBe('123');
  });

  it('handles whitespace', () => {
    expect(normalizeNegative(' (456) ')).toBe('-456');
  });
});
