/**
 * Color utilities for charts
 *
 * Includes OKLab perceptually uniform color space conversions for
 * high-quality gradients and lightness adjustments.
 */

// ---------------------------------------------------------------------------
// OKLab color space types
// ---------------------------------------------------------------------------

export interface OklabColor {
  L: number; // perceptual lightness [0, 1]
  a: number; // green-red axis (roughly -0.4 to 0.4)
  b: number; // blue-yellow axis (roughly -0.4 to 0.4)
}

// ---------------------------------------------------------------------------
// Default palettes (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Default categorical color palette (similar to D3 category10).
 *
 * Canonical home for the default chart palette. `DEFAULT_CHART_COLORS`
 * (in `../types/chart-types`) aliases this constant, and
 * `grammar/encoding-resolver` re-exports it for its existing consumers.
 * Lives in `utils/colors` to keep the palette dependency-free so both
 * grammar code and chart-config types can consume it without forming a
 * cycle via the `types/` barrel.
 */
export const DEFAULT_CATEGORY_COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
];

// ---------------------------------------------------------------------------
// Colorblind-safe palette (Wong / IBM Design Library)
// ---------------------------------------------------------------------------

/**
 * 8-color qualitative palette that is distinguishable under protanopia,
 * deuteranopia, and tritanopia.  Based on Bang Wong's palette
 * (Nature Methods 8, 441, 2011).
 */
export const COLORBLIND_SAFE_PALETTE: readonly string[] = [
  '#000000', // black
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
] as const;

// ---------------------------------------------------------------------------
// Basic RGB / Hex utilities
// ---------------------------------------------------------------------------

/**
 * Get a color from the default palette by index
 */
export function getDefaultColor(index: number): string {
  return DEFAULT_CATEGORY_COLORS[index % DEFAULT_CATEGORY_COLORS.length];
}

/**
 * Parse a hex color to RGB values.
 * Supports 3-digit (#RGB), 6-digit (#RRGGBB), and 8-digit (#RRGGBBAA) hex
 * strings, with or without a leading '#'.  For 8-digit hex the alpha channel
 * is silently discarded so the return type stays {r, g, b}.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // 3-digit hex (#RGB or RGB)
  const short = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }

  // 6-digit hex (#RRGGBB or RRGGBB)
  const full = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    };
  }

  // 8-digit hex (#RRGGBBAA or RRGGBBAA) -- alpha discarded
  const withAlpha = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})[a-f\d]{2}$/i.exec(hex);
  if (withAlpha) {
    return {
      r: parseInt(withAlpha[1], 16),
      g: parseInt(withAlpha[2], 16),
      b: parseInt(withAlpha[3], 16),
    };
  }

  return null;
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ---------------------------------------------------------------------------
// sRGB <-> linear RGB helpers
// ---------------------------------------------------------------------------

/** Convert a single sRGB channel [0,255] to linear [0,1] */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Convert a single linear channel [0,1] to sRGB [0,255] */
function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, s)) * 255);
}

// ---------------------------------------------------------------------------
// OKLab conversions  (Bjorn Ottosson, 2020)
// Pipeline: sRGB [0-255] -> linear RGB -> LMS (cube root) -> OKLab
// ---------------------------------------------------------------------------

/**
 * Convert sRGB (0-255 per channel) to OKLab.
 */
export function rgbToOklab(r: number, g: number, b: number): OklabColor {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // Linear RGB -> LMS (approximate, Ottosson's M1 matrix)
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // Cube root
  const lCbrt = Math.cbrt(l);
  const mCbrt = Math.cbrt(m);
  const sCbrt = Math.cbrt(s);

  // LMS -> OKLab (Ottosson's M2 matrix)
  return {
    L: 0.2104542553 * lCbrt + 0.793617785 * mCbrt - 0.0040720468 * sCbrt,
    a: 1.9779984951 * lCbrt - 2.428592205 * mCbrt + 0.4505937099 * sCbrt,
    b: 0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.808675766 * sCbrt,
  };
}

/**
 * Convert OKLab to sRGB (0-255 per channel, clamped).
 */
export function oklabToRgb(L: number, a: number, b: number): { r: number; g: number; b: number } {
  // OKLab -> LMS (inverse of M2)
  const lCbrt = L + 0.3963377774 * a + 0.2158037573 * b;
  const mCbrt = L - 0.1055613458 * a - 0.0638541728 * b;
  const sCbrt = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube
  const l = lCbrt * lCbrt * lCbrt;
  const m = mCbrt * mCbrt * mCbrt;
  const s = sCbrt * sCbrt * sCbrt;

  // LMS -> linear RGB (inverse of M1)
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return {
    r: linearToSrgb(lr),
    g: linearToSrgb(lg),
    b: linearToSrgb(lb),
  };
}

// ---------------------------------------------------------------------------
// OKLab interpolation
// ---------------------------------------------------------------------------

/**
 * Interpolate between two hex colors in OKLab space.
 * `t` ranges from 0 (color1) to 1 (color2).
 * Returns a hex string.
 */
export function interpolateOklab(color1Hex: string, color2Hex: string, t: number): string | null {
  const rgb1 = hexToRgb(color1Hex);
  const rgb2 = hexToRgb(color2Hex);
  if (!rgb1 || !rgb2) return null;

  const lab1 = rgbToOklab(rgb1.r, rgb1.g, rgb1.b);
  const lab2 = rgbToOklab(rgb2.r, rgb2.g, rgb2.b);

  const L = lab1.L + (lab2.L - lab1.L) * t;
  const a = lab1.a + (lab2.a - lab1.a) * t;
  const b = lab1.b + (lab2.b - lab1.b) * t;

  const rgb = oklabToRgb(L, a, b);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

// ---------------------------------------------------------------------------
// Lighten / darken (OKLab-based)
// ---------------------------------------------------------------------------

/**
 * Lighten a color by a percentage, working in OKLab space.
 * Adjusts the perceptual lightness (L) channel towards 1 (white).
 * Percent is in [0, 100].
 */
export function lightenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
  // Move L towards 1.0 by the given fraction
  lab.L = lab.L + (1 - lab.L) * (percent / 100);
  const out = oklabToRgb(lab.L, lab.a, lab.b);
  return rgbToHex(out.r, out.g, out.b);
}

/**
 * Darken a color by a percentage, working in OKLab space.
 * Adjusts the perceptual lightness (L) channel towards 0 (black).
 * Percent is in [0, 100].
 */
export function darkenColor(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const lab = rgbToOklab(rgb.r, rgb.g, rgb.b);
  // Move L towards 0.0 by the given fraction
  lab.L = lab.L * (1 - percent / 100);
  const out = oklabToRgb(lab.L, lab.a, lab.b);
  return rgbToHex(out.r, out.g, out.b);
}

// ---------------------------------------------------------------------------
// Gradient generation (OKLab-based)
// ---------------------------------------------------------------------------

/**
 * Generate a gradient of colors between start and end, interpolated in
 * the perceptually uniform OKLab color space.
 */
export function generateGradient(startHex: string, endHex: string, steps: number): string[] {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  if (!start || !end) return [startHex];

  if (steps === 1) {
    // With a single step, ratio = 0/0 = NaN. Just return the start color.
    return [rgbToHex(start.r, start.g, start.b)];
  }

  const lab1 = rgbToOklab(start.r, start.g, start.b);
  const lab2 = rgbToOklab(end.r, end.g, end.b);

  const colors: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const L = lab1.L + (lab2.L - lab1.L) * t;
    const a = lab1.a + (lab2.a - lab1.a) * t;
    const b = lab1.b + (lab2.b - lab1.b) * t;
    const rgb = oklabToRgb(L, a, b);
    colors.push(rgbToHex(rgb.r, rgb.g, rgb.b));
  }

  return colors;
}

// ---------------------------------------------------------------------------
// Opacity helper
// ---------------------------------------------------------------------------

/**
 * Get color with opacity as rgba string
 */
export function withOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}
