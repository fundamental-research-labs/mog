import {
  getAllCultures,
  getCulture,
  getDefaultCulture,
  getSupportedCultures,
  isCultureSupported,
} from '../registry';

describe('getCulture', () => {
  it('returns en-US for "en-US"', () => {
    const culture = getCulture('en-US');
    expect(culture.name).toBe('en-US');
    expect(culture.decimalSeparator).toBe('.');
  });

  it('returns de-DE for "de-DE"', () => {
    const culture = getCulture('de-DE');
    expect(culture.name).toBe('de-DE');
    expect(culture.decimalSeparator).toBe(',');
    expect(culture.thousandsSeparator).toBe('.');
  });

  it('falls back to en-US for unknown culture', () => {
    const culture = getCulture('xx-XX');
    expect(culture.name).toBe('en-US');
  });

  it('falls back to en-US for empty string', () => {
    expect(getCulture('').name).toBe('en-US');
  });
});

describe('getDefaultCulture', () => {
  it('returns en-US', () => {
    expect(getDefaultCulture().name).toBe('en-US');
  });
});

describe('getSupportedCultures', () => {
  it('returns 10 cultures', () => {
    expect(getSupportedCultures()).toHaveLength(10);
  });

  it('is derived from the map (includes en-US)', () => {
    expect(getSupportedCultures()).toContain('en-US');
    expect(getSupportedCultures()).toContain('de-DE');
    expect(getSupportedCultures()).toContain('ja-JP');
  });
});

describe('isCultureSupported', () => {
  it('returns true for supported cultures', () => {
    expect(isCultureSupported('en-US')).toBe(true);
    expect(isCultureSupported('ko-KR')).toBe(true);
  });

  it('returns false for unsupported cultures', () => {
    expect(isCultureSupported('xx-XX')).toBe(false);
  });
});

describe('getAllCultures', () => {
  it('returns all 10 cultures sorted by displayName', () => {
    const all = getAllCultures();
    expect(all).toHaveLength(10);

    // Verify sorted
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].displayName.localeCompare(all[i].displayName)).toBeLessThanOrEqual(0);
    }
  });
});
