/**
 * Default Font Metrics Provider
 *
 * Ships pre-computed metric tables extracted from Computer Modern font data
 * (the same source data that KaTeX uses). Provides reasonable TeX-quality
 * glyph measurements without requiring a browser or canvas.
 *
 * All metric values are em-relative (multiply by fontSize to get absolute).
 *
 * Sources: cmmi10 (math italic), cmsy10 (math symbol), cmex10 (math extension)
 */

import type { FontMetricsProvider, FontParameters, GlyphMetrics, GlyphStyle } from './types';

// Per-character metrics: [width, height, depth, italic, skew]

// Math Italic (cmmi10) -- for variables (a-z, A-Z, Greek lowercase)
const MATH_ITALIC: Record<string, [number, number, number, number, number]> = {
  // Lowercase Latin
  a: [0.529, 0.431, 0.0, 0.0, 0.0],
  b: [0.429, 0.694, 0.0, 0.0, 0.0],
  c: [0.433, 0.431, 0.0, 0.0, 0.0],
  d: [0.52, 0.694, 0.0, 0.0, 0.0],
  e: [0.466, 0.431, 0.0, 0.0, 0.0],
  f: [0.49, 0.694, 0.194, 0.108, 0.0],
  g: [0.477, 0.431, 0.194, 0.0, 0.0],
  h: [0.576, 0.694, 0.0, 0.0, 0.0],
  i: [0.345, 0.66, 0.0, 0.0, 0.0],
  j: [0.412, 0.66, 0.194, 0.0, 0.0],
  k: [0.521, 0.694, 0.0, 0.0, 0.0],
  l: [0.298, 0.694, 0.0, 0.0, 0.0],
  m: [0.878, 0.431, 0.0, 0.0, 0.0],
  n: [0.6, 0.431, 0.0, 0.0, 0.0],
  o: [0.485, 0.431, 0.0, 0.0, 0.0],
  p: [0.503, 0.431, 0.194, 0.0, 0.0],
  q: [0.446, 0.431, 0.194, 0.0, 0.0],
  r: [0.451, 0.431, 0.0, 0.0, 0.0],
  s: [0.469, 0.431, 0.0, 0.0, 0.0],
  t: [0.361, 0.615, 0.0, 0.0, 0.0],
  u: [0.572, 0.431, 0.0, 0.0, 0.0],
  v: [0.485, 0.431, 0.0, 0.0, 0.0],
  w: [0.716, 0.431, 0.0, 0.0, 0.0],
  x: [0.572, 0.431, 0.0, 0.0, 0.0],
  y: [0.49, 0.431, 0.194, 0.0, 0.0],
  z: [0.465, 0.431, 0.0, 0.0, 0.0],

  // Uppercase Latin
  A: [0.75, 0.683, 0.0, 0.0, 0.139],
  B: [0.759, 0.683, 0.0, 0.0, 0.0],
  C: [0.715, 0.683, 0.0, 0.0, 0.0],
  D: [0.828, 0.683, 0.0, 0.0, 0.0],
  E: [0.738, 0.683, 0.0, 0.0, 0.0],
  F: [0.643, 0.683, 0.0, 0.0, 0.0],
  G: [0.786, 0.683, 0.0, 0.0, 0.0],
  H: [0.831, 0.683, 0.0, 0.0, 0.0],
  I: [0.44, 0.683, 0.0, 0.0, 0.0],
  J: [0.555, 0.683, 0.0, 0.0, 0.0],
  K: [0.849, 0.683, 0.0, 0.0, 0.0],
  L: [0.681, 0.683, 0.0, 0.0, 0.0],
  M: [0.97, 0.683, 0.0, 0.0, 0.0],
  N: [0.803, 0.683, 0.0, 0.0, 0.0],
  O: [0.763, 0.683, 0.0, 0.0, 0.0],
  P: [0.642, 0.683, 0.0, 0.0, 0.0],
  Q: [0.791, 0.683, 0.194, 0.0, 0.0],
  R: [0.759, 0.683, 0.0, 0.0, 0.0],
  S: [0.613, 0.683, 0.0, 0.0, 0.0],
  T: [0.584, 0.683, 0.0, 0.0, 0.0],
  U: [0.683, 0.683, 0.0, 0.0, 0.0],
  V: [0.583, 0.683, 0.0, 0.0, 0.0],
  W: [0.944, 0.683, 0.0, 0.0, 0.0],
  X: [0.828, 0.683, 0.0, 0.0, 0.0],
  Y: [0.581, 0.683, 0.0, 0.0, 0.0],
  Z: [0.683, 0.683, 0.0, 0.0, 0.0],

  // Greek lowercase
  '\u03B1': [0.64, 0.431, 0.0, 0.0, 0.0], // alpha
  '\u03B2': [0.564, 0.694, 0.194, 0.0, 0.0], // beta
  '\u03B3': [0.518, 0.431, 0.194, 0.0, 0.0], // gamma
  '\u03B4': [0.444, 0.694, 0.0, 0.0, 0.0], // delta
  '\u03B5': [0.406, 0.431, 0.0, 0.0, 0.0], // epsilon
  '\u03B6': [0.438, 0.694, 0.194, 0.0, 0.0], // zeta
  '\u03B7': [0.52, 0.431, 0.194, 0.0, 0.0], // eta
  '\u03B8': [0.496, 0.694, 0.0, 0.0, 0.0], // theta
  '\u03B9': [0.354, 0.431, 0.0, 0.0, 0.0], // iota
  '\u03BA': [0.576, 0.431, 0.0, 0.0, 0.0], // kappa
  '\u03BB': [0.583, 0.694, 0.0, 0.0, 0.0], // lambda
  '\u03BC': [0.603, 0.431, 0.194, 0.0, 0.0], // mu
  '\u03BD': [0.494, 0.431, 0.0, 0.0, 0.0], // nu
  '\u03BE': [0.438, 0.694, 0.194, 0.0, 0.0], // xi
  '\u03C0': [0.572, 0.431, 0.0, 0.0, 0.0], // pi
  '\u03C1': [0.503, 0.431, 0.194, 0.0, 0.0], // rho
  '\u03C3': [0.571, 0.431, 0.0, 0.0, 0.0], // sigma
  '\u03C4': [0.437, 0.431, 0.0, 0.0, 0.0], // tau
  '\u03C5': [0.54, 0.431, 0.0, 0.0, 0.0], // upsilon
  '\u03C6': [0.596, 0.431, 0.194, 0.0, 0.0], // phi
  '\u03C7': [0.519, 0.431, 0.194, 0.0, 0.0], // chi
  '\u03C8': [0.686, 0.694, 0.194, 0.0, 0.0], // psi
  '\u03C9': [0.735, 0.431, 0.0, 0.0, 0.0], // omega
};

// Math Symbol (cmsy10) -- for operators, relations, arrows
const MATH_SYMBOL: Record<string, [number, number, number, number, number]> = {
  '+': [0.778, 0.583, 0.083, 0.0, 0.0],
  '-': [0.778, 0.583, 0.083, 0.0, 0.0], // actually \u2212 minus
  '=': [0.778, 0.367, 0.0, 0.0, 0.0],
  '<': [0.778, 0.54, 0.04, 0.0, 0.0],
  '>': [0.778, 0.54, 0.04, 0.0, 0.0],
  '\u00D7': [0.778, 0.491, 0.0, 0.0, 0.0], // times
  '\u00F7': [0.778, 0.583, 0.083, 0.0, 0.0], // div
  '\u00B1': [0.778, 0.583, 0.083, 0.0, 0.0], // pm
  '\u2264': [0.778, 0.636, 0.136, 0.0, 0.0], // leq
  '\u2265': [0.778, 0.636, 0.136, 0.0, 0.0], // geq
  '\u2260': [0.778, 0.716, 0.216, 0.0, 0.0], // neq
  '\u2248': [0.778, 0.483, 0.0, 0.0, 0.0], // approx
  '\u2261': [0.778, 0.483, 0.0, 0.0, 0.0], // equiv
  '\u2192': [1.0, 0.511, 0.011, 0.0, 0.0], // rightarrow
  '\u2190': [1.0, 0.511, 0.011, 0.0, 0.0], // leftarrow
  '\u21D2': [1.0, 0.525, 0.024, 0.0, 0.0], // Rightarrow
  '\u2208': [0.778, 0.54, 0.04, 0.0, 0.0], // in
  '\u2282': [0.778, 0.54, 0.04, 0.0, 0.0], // subset
  '\u222A': [0.778, 0.603, 0.0, 0.0, 0.0], // cup
  '\u2229': [0.778, 0.603, 0.0, 0.0, 0.0], // cap
  '\u2205': [0.5, 0.694, 0.0, 0.0, 0.0], // emptyset
  '\u221E': [1.0, 0.431, 0.0, 0.0, 0.0], // infty
  '\u2202': [0.494, 0.694, 0.0, 0.0, 0.0], // partial
  '\u2207': [0.833, 0.683, 0.0, 0.0, 0.0], // nabla
  '\u2200': [0.611, 0.694, 0.0, 0.0, 0.0], // forall
  '\u2203': [0.556, 0.694, 0.0, 0.0, 0.0], // exists
  '\u22C5': [0.278, 0.31, 0.0, 0.0, 0.0], // cdot

  // Uppercase Greek (in cmsy for math)
  '\u0393': [0.625, 0.683, 0.0, 0.0, 0.0], // Gamma
  '\u0394': [0.833, 0.683, 0.0, 0.0, 0.0], // Delta
  '\u0398': [0.778, 0.683, 0.0, 0.0, 0.0], // Theta
  '\u039B': [0.694, 0.683, 0.0, 0.0, 0.0], // Lambda
  '\u039E': [0.667, 0.683, 0.0, 0.0, 0.0], // Xi
  '\u03A0': [0.75, 0.683, 0.0, 0.0, 0.0], // Pi
  '\u03A3': [0.722, 0.683, 0.0, 0.0, 0.0], // Sigma
  '\u03A5': [0.778, 0.683, 0.0, 0.0, 0.0], // Upsilon
  '\u03A6': [0.722, 0.683, 0.0, 0.0, 0.0], // Phi
  '\u03A8': [0.778, 0.683, 0.0, 0.0, 0.0], // Psi
  '\u03A9': [0.722, 0.683, 0.0, 0.0, 0.0], // Omega
};

// N-ary operators (large symbols from cmex10)
const MATH_EXTENSION: Record<string, [number, number, number, number, number]> = {
  '\u2211': [0.75, 0.75, 0.25, 0.0, 0.0], // sum (display)
  '\u220F': [0.75, 0.75, 0.25, 0.0, 0.0], // prod (display)
  '\u222B': [0.417, 0.75, 0.25, 0.0, 0.0], // int (display)
  '\u222C': [0.7, 0.75, 0.25, 0.0, 0.0], // iint
  '\u222D': [0.95, 0.75, 0.25, 0.0, 0.0], // iiint
  '\u222E': [0.472, 0.75, 0.25, 0.0, 0.0], // oint
  '\u22C3': [0.75, 0.75, 0.25, 0.0, 0.0], // bigcup
  '\u22C2': [0.75, 0.75, 0.25, 0.0, 0.0], // bigcap
  '\u2A01': [0.917, 0.75, 0.25, 0.0, 0.0], // bigoplus
  '\u2A02': [0.917, 0.75, 0.25, 0.0, 0.0], // bigotimes
  '\u22C1': [0.75, 0.75, 0.25, 0.0, 0.0], // bigvee
  '\u22C0': [0.75, 0.75, 0.25, 0.0, 0.0], // bigwedge
};

// Digits and punctuation (Main-Regular / cmr10)
const MAIN_REGULAR: Record<string, [number, number, number, number, number]> = {
  '0': [0.5, 0.644, 0.0, 0.0, 0.0],
  '1': [0.5, 0.644, 0.0, 0.0, 0.0],
  '2': [0.5, 0.644, 0.0, 0.0, 0.0],
  '3': [0.5, 0.644, 0.194, 0.0, 0.0],
  '4': [0.5, 0.644, 0.0, 0.0, 0.0],
  '5': [0.5, 0.644, 0.0, 0.0, 0.0],
  '6': [0.5, 0.644, 0.0, 0.0, 0.0],
  '7': [0.5, 0.644, 0.194, 0.0, 0.0],
  '8': [0.5, 0.644, 0.0, 0.0, 0.0],
  '9': [0.5, 0.644, 0.0, 0.0, 0.0],
  '(': [0.389, 0.75, 0.25, 0.0, 0.0],
  ')': [0.389, 0.75, 0.25, 0.0, 0.0],
  '[': [0.278, 0.75, 0.25, 0.0, 0.0],
  ']': [0.278, 0.75, 0.25, 0.0, 0.0],
  ',': [0.278, 0.106, 0.194, 0.0, 0.0],
  '.': [0.278, 0.106, 0.0, 0.0, 0.0],
  ':': [0.278, 0.431, 0.0, 0.0, 0.0],
  ';': [0.278, 0.431, 0.194, 0.0, 0.0],
  '!': [0.278, 0.694, 0.0, 0.0, 0.0],
  '?': [0.472, 0.694, 0.0, 0.0, 0.0],
  ' ': [0.333, 0.0, 0.0, 0.0, 0.0],
};

/**
 * Font-level parameters for Computer Modern (from TeX's cmsy10/cmex10).
 * Values are em-relative.
 */
export const CM_FONT_PARAMS: FontParameters = {
  axisHeight: 0.25,
  ruleThickness: 0.04,

  // Fraction
  num1: 0.677, // Display numerator shift
  num2: 0.394, // Text numerator shift
  denom1: 0.686, // Display denominator shift
  denom2: 0.345, // Text denominator shift

  // Script
  sup1: 0.413, // Display superscript shift
  sup2: 0.363, // Cramped superscript shift
  sup3: 0.289, // Text superscript shift
  sub1: 0.15, // Subscript shift
  sub2: 0.247, // Subscript shift (with superscript)
  supDrop: 0.386, // Superscript drop
  subDrop: 0.05, // Subscript drop

  // Delimiter
  delimiterShortfall: 0.5,
  nullDelimiterSpace: 0.12,

  // Big operators
  bigOpSpacing1: 0.111,
  bigOpSpacing2: 0.167,
  bigOpSpacing3: 0.2,
  bigOpSpacing4: 0.6,
  bigOpSpacing5: 0.1,
};

/**
 * Default metrics provider using Computer Modern font tables.
 * Falls back to an approximation for characters not in the tables.
 */
export class DefaultMetricsProvider implements FontMetricsProvider {
  measureGlyph(char: string, fontSize: number, style: GlyphStyle): GlyphMetrics {
    // Look up in tables based on character type and style
    const entry = this.lookupChar(char, style);

    if (entry) {
      const boldFactor = style.bold ? 1.05 : 1.0;
      return {
        width: entry[0] * fontSize * boldFactor,
        height: entry[1] * fontSize,
        depth: entry[2] * fontSize,
        italic: entry[3] * fontSize,
        skew: entry[4] * fontSize,
      };
    }

    // Fallback for unmapped characters
    return this.fallbackMetrics(fontSize);
  }

  private lookupChar(
    char: string,
    style: GlyphStyle,
  ): [number, number, number, number, number] | undefined {
    // Check math extension first (large operators) -- style-independent
    if (MATH_EXTENSION[char]) return MATH_EXTENSION[char];

    // Check math symbol (operators, relations, arrows, uppercase Greek) -- style-independent
    if (MATH_SYMBOL[char]) return MATH_SYMBOL[char];

    // For letters: if explicitly non-italic (nor/roman style), prefer MAIN_REGULAR.
    // This handles \text{} and \mathrm{} content.
    const isRoman = style.italic === false;

    if (isRoman && MAIN_REGULAR[char]) return MAIN_REGULAR[char];

    // Main-Regular for digits and punctuation (always upright)
    if (MAIN_REGULAR[char]) return MAIN_REGULAR[char];

    // Math Italic for letters and lowercase Greek (default for variables)
    if (MATH_ITALIC[char]) return MATH_ITALIC[char];

    return undefined;
  }

  private fallbackMetrics(fontSize: number): GlyphMetrics {
    // Reasonable fallback approximation
    return {
      width: fontSize * 0.55,
      height: fontSize * 0.683,
      depth: 0,
      italic: 0,
      skew: 0,
    };
  }
}

/** Get the default font parameters (Computer Modern) */
export function getDefaultFontParams(): FontParameters {
  return CM_FONT_PARAMS;
}
