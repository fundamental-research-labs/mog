/**
 * Tests for number format locale utilities.
 *
 * Covers LCID extraction, locale-aware format resolution (GET path),
 * locale-specific format encoding (SET path), and round-trip behavior.
 */

import {
  extractLCID,
  getNumberFormatLocal,
  setNumberFormatLocal,
  getLocaleInfoForLCID,
  getLCIDForLocale,
} from '../../../src/api/internal/number-format-locale';

// =============================================================================
// extractLCID
// =============================================================================

describe('extractLCID', () => {
  it('extracts LCID from en-US format', () => {
    expect(extractLCID('[$-409]#,##0.00')).toBe('409');
  });

  it('extracts LCID with leading zeros', () => {
    expect(extractLCID('[$-0409]#,##0.00')).toBe('0409');
  });

  it('extracts LCID from de-DE format', () => {
    expect(extractLCID('[$-407]#.##0,00')).toBe('407');
  });

  it('extracts LCID from fr-FR format', () => {
    expect(extractLCID('[$-40C]# ##0,00')).toBe('40C');
  });

  it('returns undefined for format without LCID', () => {
    expect(extractLCID('#,##0.00')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractLCID('')).toBeUndefined();
  });

  it('returns undefined for General format', () => {
    expect(extractLCID('General')).toBeUndefined();
  });

  it('extracts LCID from zh-CN format', () => {
    expect(extractLCID('[$-804]#,##0.00')).toBe('804');
  });
});

// =============================================================================
// getNumberFormatLocal — GET path
// =============================================================================

describe('getNumberFormatLocal', () => {
  it('returns format unchanged when no LCID token', () => {
    expect(getNumberFormatLocal('#,##0.00')).toBe('#,##0.00');
  });

  it('returns empty string for empty input', () => {
    expect(getNumberFormatLocal('')).toBe('');
  });

  it('resolves en-US format (no separator change needed)', () => {
    // en-US uses . for decimal, , for thousands — same as internal
    expect(getNumberFormatLocal('[$-409]#,##0.00')).toBe('#,##0.00');
  });

  it('resolves en-GB format (same separators as en-US)', () => {
    expect(getNumberFormatLocal('[$-809]#,##0.00')).toBe('#,##0.00');
  });

  it('resolves de-DE format (swapped separators)', () => {
    // Internal: #,##0.00  →  de-DE: #.##0,00
    expect(getNumberFormatLocal('[$-407]#,##0.00')).toBe('#.##0,00');
  });

  it('resolves fr-FR format (comma decimal, space thousands)', () => {
    // Internal: #,##0.00  →  fr-FR: # ##0,00 (non-breaking space)
    const result = getNumberFormatLocal('[$-40C]#,##0.00');
    expect(result).toBe('#\u00A0##0,00');
  });

  it('resolves it-IT format (swapped separators)', () => {
    expect(getNumberFormatLocal('[$-410]#,##0.00')).toBe('#.##0,00');
  });

  it('resolves es-ES format (swapped separators)', () => {
    expect(getNumberFormatLocal('[$-C0A]#,##0.00')).toBe('#.##0,00');
  });

  it('resolves pt-BR format (swapped separators)', () => {
    expect(getNumberFormatLocal('[$-416]#,##0.00')).toBe('#.##0,00');
  });

  it('resolves ja-JP format (same separators as en-US)', () => {
    expect(getNumberFormatLocal('[$-411]#,##0')).toBe('#,##0');
  });

  it('resolves ko-KR format (same separators as en-US)', () => {
    expect(getNumberFormatLocal('[$-412]#,##0')).toBe('#,##0');
  });

  it('resolves zh-CN format (same separators as en-US)', () => {
    expect(getNumberFormatLocal('[$-804]#,##0.00')).toBe('#,##0.00');
  });

  it('strips unknown LCID and returns raw format (graceful fallback)', () => {
    expect(getNumberFormatLocal('[$-999]#,##0.00')).toBe('#,##0.00');
  });

  it('handles LCID with leading zeros (0407 → 407)', () => {
    expect(getNumberFormatLocal('[$-0407]#,##0.00')).toBe('#.##0,00');
  });

  it('preserves quoted text', () => {
    expect(getNumberFormatLocal('[$-407]#,##0.00" EUR"')).toBe('#.##0,00" EUR"');
  });

  it('preserves bracketed color codes', () => {
    expect(getNumberFormatLocal('[$-407][Red]#,##0.00')).toBe('[Red]#.##0,00');
  });

  it('handles percentage format', () => {
    expect(getNumberFormatLocal('[$-407]0.00%')).toBe('0,00%');
  });

  it('handles format with no decimal or thousands separator', () => {
    expect(getNumberFormatLocal('[$-407]0')).toBe('0');
  });
});

// =============================================================================
// setNumberFormatLocal — SET path
// =============================================================================

describe('setNumberFormatLocal', () => {
  it('returns format unchanged for unknown locale', () => {
    expect(setNumberFormatLocal('#,##0.00', 'xx-YY')).toBe('#,##0.00');
  });

  it('returns empty string for empty input', () => {
    expect(setNumberFormatLocal('', 'en-US')).toBe('');
  });

  it('encodes en-US format with LCID prefix', () => {
    expect(setNumberFormatLocal('#,##0.00', 'en-US')).toBe('[$-409]#,##0.00');
  });

  it('encodes de-DE format (swaps separators back to en-US)', () => {
    // de-DE input: #.##0,00  →  internal: [$-407]#,##0.00
    expect(setNumberFormatLocal('#.##0,00', 'de-DE')).toBe('[$-407]#,##0.00');
  });

  it('encodes fr-FR format (space thousands, comma decimal)', () => {
    const result = setNumberFormatLocal('#\u00A0##0,00', 'fr-FR');
    expect(result).toBe('[$-40c]#,##0.00');
  });

  it('encodes it-IT format', () => {
    expect(setNumberFormatLocal('#.##0,00', 'it-IT')).toBe('[$-410]#,##0.00');
  });

  it('encodes es-ES format', () => {
    expect(setNumberFormatLocal('#.##0,00', 'es-ES')).toBe('[$-c0a]#,##0.00');
  });

  it('encodes pt-BR format', () => {
    expect(setNumberFormatLocal('#.##0,00', 'pt-BR')).toBe('[$-416]#,##0.00');
  });

  it('encodes ja-JP format', () => {
    expect(setNumberFormatLocal('#,##0', 'ja-JP')).toBe('[$-411]#,##0');
  });

  it('handles case-insensitive locale matching', () => {
    expect(setNumberFormatLocal('#,##0.00', 'EN-US')).toBe('[$-409]#,##0.00');
    expect(setNumberFormatLocal('#.##0,00', 'De-De')).toBe('[$-407]#,##0.00');
  });

  it('encodes percentage format for de-DE', () => {
    expect(setNumberFormatLocal('0,00%', 'de-DE')).toBe('[$-407]0.00%');
  });
});

// =============================================================================
// Round-trip: set → get
// =============================================================================

describe('round-trip (set → get)', () => {
  it('en-US round-trip preserves format', () => {
    const localFormat = '#,##0.00';
    const stored = setNumberFormatLocal(localFormat, 'en-US');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('de-DE round-trip preserves format', () => {
    const localFormat = '#.##0,00';
    const stored = setNumberFormatLocal(localFormat, 'de-DE');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('fr-FR round-trip preserves format', () => {
    const localFormat = '#\u00A0##0,00';
    const stored = setNumberFormatLocal(localFormat, 'fr-FR');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('it-IT round-trip preserves format', () => {
    const localFormat = '#.##0,00';
    const stored = setNumberFormatLocal(localFormat, 'it-IT');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('es-ES round-trip preserves format', () => {
    const localFormat = '#.##0,00';
    const stored = setNumberFormatLocal(localFormat, 'es-ES');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('pt-BR round-trip preserves format', () => {
    const localFormat = '#.##0,00';
    const stored = setNumberFormatLocal(localFormat, 'pt-BR');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('ja-JP round-trip preserves format', () => {
    const localFormat = '#,##0';
    const stored = setNumberFormatLocal(localFormat, 'ja-JP');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('ko-KR round-trip preserves format', () => {
    const localFormat = '#,##0';
    const stored = setNumberFormatLocal(localFormat, 'ko-KR');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });

  it('zh-CN round-trip preserves format', () => {
    const localFormat = '#,##0.00';
    const stored = setNumberFormatLocal(localFormat, 'zh-CN');
    const resolved = getNumberFormatLocal(stored);
    expect(resolved).toBe(localFormat);
  });
});

// =============================================================================
// Helper lookups
// =============================================================================

describe('getLocaleInfoForLCID', () => {
  it('returns locale info for known LCID', () => {
    const info = getLocaleInfoForLCID('409');
    expect(info).toBeDefined();
    expect(info!.locale).toBe('en-US');
    expect(info!.decimalSep).toBe('.');
    expect(info!.thousandsSep).toBe(',');
  });

  it('handles leading zeros', () => {
    const info = getLocaleInfoForLCID('0407');
    expect(info).toBeDefined();
    expect(info!.locale).toBe('de-DE');
  });

  it('handles uppercase hex', () => {
    const info = getLocaleInfoForLCID('40C');
    expect(info).toBeDefined();
    expect(info!.locale).toBe('fr-FR');
  });

  it('returns undefined for unknown LCID', () => {
    expect(getLocaleInfoForLCID('999')).toBeUndefined();
  });
});

describe('getLCIDForLocale', () => {
  it('returns LCID for known locale', () => {
    expect(getLCIDForLocale('en-US')).toBe('409');
  });

  it('handles case-insensitive lookup', () => {
    expect(getLCIDForLocale('EN-US')).toBe('409');
    expect(getLCIDForLocale('de-de')).toBe('407');
  });

  it('returns undefined for unknown locale', () => {
    expect(getLCIDForLocale('xx-YY')).toBeUndefined();
  });
});
