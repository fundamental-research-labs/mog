/**
 * Tests for color utilities
 */
import { DEFAULT_CHART_COLORS } from '../src/types';
import {
  COLORBLIND_SAFE_PALETTE,
  darkenColor,
  generateGradient,
  getDefaultColor,
  hexToRgb,
  interpolateOklab,
  lightenColor,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  withOpacity,
} from '../src/utils/colors';

describe('getDefaultColor', () => {
  it('returns colors from the default palette', () => {
    expect(getDefaultColor(0)).toBe(DEFAULT_CHART_COLORS[0]);
    expect(getDefaultColor(1)).toBe(DEFAULT_CHART_COLORS[1]);
  });

  it('wraps around for indices beyond palette length', () => {
    const paletteLength = DEFAULT_CHART_COLORS.length;
    expect(getDefaultColor(paletteLength)).toBe(DEFAULT_CHART_COLORS[0]);
    expect(getDefaultColor(paletteLength + 1)).toBe(DEFAULT_CHART_COLORS[1]);
  });
});

describe('hexToRgb', () => {
  it('converts 6-digit hex to RGB', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('handles hex without hash', () => {
    expect(hexToRgb('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('handles lowercase', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('converts 3-digit hex (#RGB) to RGB', () => {
    expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#0F0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#00F')).toEqual({ r: 0, g: 0, b: 255 });
    expect(hexToRgb('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('ABC')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('converts 8-digit hex (#RRGGBBAA) to RGB, discarding alpha', () => {
    expect(hexToRgb('#FF000080')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00FF00FF')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('0000FFCC')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('invalid')).toBeNull();
    expect(hexToRgb('#GGG')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull(); // 5 digits is invalid
  });
});

describe('rgbToHex', () => {
  it('converts RGB to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('handles intermediate values', () => {
    expect(rgbToHex(128, 128, 128)).toBe('#808080');
  });
});

// ---------------------------------------------------------------------------
// OKLab conversion tests
// ---------------------------------------------------------------------------

describe('rgbToOklab / oklabToRgb', () => {
  it('roundtrips black', () => {
    const lab = rgbToOklab(0, 0, 0);
    expect(lab.L).toBeCloseTo(0, 3);
    const rgb = oklabToRgb(lab.L, lab.a, lab.b);
    expect(rgb).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('roundtrips white', () => {
    const lab = rgbToOklab(255, 255, 255);
    expect(lab.L).toBeCloseTo(1, 3);
    const rgb = oklabToRgb(lab.L, lab.a, lab.b);
    expect(rgb).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('roundtrips primary colors within tolerance', () => {
    const testColors = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 128, g: 64, b: 196 },
      { r: 10, g: 200, b: 150 },
    ];

    for (const color of testColors) {
      const lab = rgbToOklab(color.r, color.g, color.b);
      const rgb = oklabToRgb(lab.L, lab.a, lab.b);
      // Allow +/- 1 due to floating-point -> integer rounding
      expect(rgb.r).toBeGreaterThanOrEqual(color.r - 1);
      expect(rgb.r).toBeLessThanOrEqual(color.r + 1);
      expect(rgb.g).toBeGreaterThanOrEqual(color.g - 1);
      expect(rgb.g).toBeLessThanOrEqual(color.g + 1);
      expect(rgb.b).toBeGreaterThanOrEqual(color.b - 1);
      expect(rgb.b).toBeLessThanOrEqual(color.b + 1);
    }
  });

  it('pure red has positive a and near-zero b', () => {
    const lab = rgbToOklab(255, 0, 0);
    expect(lab.a).toBeGreaterThan(0.1);
    // b can be slightly positive for red; just check it is less than a
    expect(Math.abs(lab.b)).toBeLessThan(Math.abs(lab.a));
  });
});

// ---------------------------------------------------------------------------
// OKLab interpolation tests
// ---------------------------------------------------------------------------

describe('interpolateOklab', () => {
  it('returns color1 at t=0 and color2 at t=1', () => {
    const c0 = interpolateOklab('#FF0000', '#0000FF', 0);
    const c1 = interpolateOklab('#FF0000', '#0000FF', 1);
    expect(c0).toBe('#ff0000');
    expect(c1).toBe('#0000ff');
  });

  it('returns a valid midpoint color', () => {
    const mid = interpolateOklab('#FF0000', '#0000FF', 0.5);
    expect(mid).not.toBeNull();
    expect(hexToRgb(mid!)).not.toBeNull();
  });

  it('produces different midpoints than naive RGB interpolation', () => {
    const oklabMid = interpolateOklab('#FF0000', '#00FF00', 0.5);
    // Naive RGB midpoint of red and green
    const naiveRgbMid = rgbToHex(128, 128, 0); // #808000
    // OKLab should produce a more vibrant / different intermediate color
    expect(oklabMid).not.toBe(naiveRgbMid);
  });

  it('returns null for invalid input', () => {
    expect(interpolateOklab('invalid', '#0000FF', 0.5)).toBeNull();
    expect(interpolateOklab('#FF0000', 'invalid', 0.5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lighten / darken (OKLab-based)
// ---------------------------------------------------------------------------

describe('lightenColor', () => {
  it('lightens a color - result is brighter than original', () => {
    const lightened = lightenColor('#336699', 50);
    const origLab = rgbToOklab(0x33, 0x66, 0x99);
    const lightenedRgb = hexToRgb(lightened)!;
    const lightenedLab = rgbToOklab(lightenedRgb.r, lightenedRgb.g, lightenedRgb.b);
    expect(lightenedLab.L).toBeGreaterThan(origLab.L);
  });

  it('white stays white when lightened', () => {
    const lightened = lightenColor('#FFFFFF', 50);
    expect(hexToRgb(lightened)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('black lightened by 100% becomes white', () => {
    const lightened = lightenColor('#000000', 100);
    expect(hexToRgb(lightened)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('preserves hue when lightening', () => {
    // A saturated blue
    const hex = '#0044CC';
    const origRgb = hexToRgb(hex)!;
    const origLab = rgbToOklab(origRgb.r, origRgb.g, origRgb.b);
    const origHue = Math.atan2(origLab.b, origLab.a);

    const lightened = lightenColor(hex, 30);
    const lightenedRgb = hexToRgb(lightened)!;
    const lightenedLab = rgbToOklab(lightenedRgb.r, lightenedRgb.g, lightenedRgb.b);
    const lightenedHue = Math.atan2(lightenedLab.b, lightenedLab.a);

    // Hue should be within ~0.1 radians (about 6 degrees)
    expect(Math.abs(origHue - lightenedHue)).toBeLessThan(0.15);
  });

  it('returns original for invalid hex', () => {
    expect(lightenColor('invalid', 50)).toBe('invalid');
  });
});

describe('darkenColor', () => {
  it('darkens a color - result is darker than original', () => {
    const darkened = darkenColor('#336699', 50);
    const origLab = rgbToOklab(0x33, 0x66, 0x99);
    const darkenedRgb = hexToRgb(darkened)!;
    const darkenedLab = rgbToOklab(darkenedRgb.r, darkenedRgb.g, darkenedRgb.b);
    expect(darkenedLab.L).toBeLessThan(origLab.L);
  });

  it('black stays black when darkened', () => {
    const darkened = darkenColor('#000000', 50);
    expect(hexToRgb(darkened)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('white darkened by 100% becomes black', () => {
    const darkened = darkenColor('#FFFFFF', 100);
    expect(hexToRgb(darkened)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('preserves hue when darkening', () => {
    // A mid-saturation blue (avoids gamut-clipping artifacts at extremes)
    const hex = '#4488CC';
    const origRgb = hexToRgb(hex)!;
    const origLab = rgbToOklab(origRgb.r, origRgb.g, origRgb.b);
    const origHue = Math.atan2(origLab.b, origLab.a);

    const darkened = darkenColor(hex, 30);
    const darkenedRgb = hexToRgb(darkened)!;
    const darkenedLab = rgbToOklab(darkenedRgb.r, darkenedRgb.g, darkenedRgb.b);
    const darkenedHue = Math.atan2(darkenedLab.b, darkenedLab.a);

    // Hue should be approximately constant; allow for rounding from
    // float -> int RGB channels. 0.15 radians ~ 8.6 degrees.
    expect(Math.abs(origHue - darkenedHue)).toBeLessThan(0.15);
  });

  it('returns original for invalid hex', () => {
    expect(darkenColor('invalid', 50)).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// Gradient generation (OKLab-based)
// ---------------------------------------------------------------------------

describe('generateGradient', () => {
  it('generates gradient between two colors', () => {
    const gradient = generateGradient('#000000', '#FFFFFF', 3);
    expect(gradient).toHaveLength(3);
    expect(gradient[0]).toBe('#000000');
    expect(gradient[2]).toBe('#ffffff');
  });

  it('OKLab gradient midpoint differs from naive RGB midpoint', () => {
    // Red to blue gradient - OKLab should produce different intermediates
    const gradient = generateGradient('#FF0000', '#00FF00', 3);
    const oklabMid = gradient[1];
    const naiveRgbMid = rgbToHex(128, 128, 0); // naive RGB would give #808000
    expect(oklabMid).not.toBe(naiveRgbMid);
  });

  it('handles single step', () => {
    const gradient = generateGradient('#FF0000', '#0000FF', 1);
    expect(gradient).toHaveLength(1);
  });

  it('returns start color for invalid input', () => {
    const gradient = generateGradient('invalid', '#FFFFFF', 3);
    expect(gradient).toEqual(['invalid']);
  });
});

// ---------------------------------------------------------------------------
// Colorblind-safe palette
// ---------------------------------------------------------------------------

describe('COLORBLIND_SAFE_PALETTE', () => {
  it('has 8 colors', () => {
    expect(COLORBLIND_SAFE_PALETTE).toHaveLength(8);
  });

  it('all entries are valid hex colors', () => {
    for (const color of COLORBLIND_SAFE_PALETTE) {
      expect(hexToRgb(color)).not.toBeNull();
    }
  });

  it('all entries are unique', () => {
    const unique = new Set(COLORBLIND_SAFE_PALETTE.map((c) => c.toUpperCase()));
    expect(unique.size).toBe(COLORBLIND_SAFE_PALETTE.length);
  });
});

// ---------------------------------------------------------------------------
// withOpacity (unchanged behavior)
// ---------------------------------------------------------------------------

describe('withOpacity', () => {
  it('returns rgba string', () => {
    expect(withOpacity('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(withOpacity('#00FF00', 0.8)).toBe('rgba(0, 255, 0, 0.8)');
  });

  it('returns original for invalid hex', () => {
    expect(withOpacity('invalid', 0.5)).toBe('invalid');
  });
});
