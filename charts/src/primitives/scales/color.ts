/**
 * Color Scale Implementation
 *
 * Provides scales for mapping data values to colors:
 * - Sequential: for continuous data (e.g., temperature)
 * - Diverging: for data with a meaningful midpoint (e.g., correlation)
 * - Ordinal: for categorical data (e.g., product categories)
 */

import { interpolateOklab } from '../../utils/colors';
import type {
  ColorInterpolator,
  ColorSchemeName,
  DivergingColorScale,
  OrdinalColorScale,
  SequentialColorScale,
} from './types';

// ============================================================================
// Built-in Color Schemes
// ============================================================================

/**
 * Category10 - 10 distinct colors for categorical data
 */
export const schemeCategory10: string[] = [
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

/**
 * Category20 - 20 distinct colors for categorical data
 */
export const schemeCategory20: string[] = [
  '#1f77b4',
  '#aec7e8',
  '#ff7f0e',
  '#ffbb78',
  '#2ca02c',
  '#98df8a',
  '#d62728',
  '#ff9896',
  '#9467bd',
  '#c5b0d5',
  '#8c564b',
  '#c49c94',
  '#e377c2',
  '#f7b6d2',
  '#7f7f7f',
  '#c7c7c7',
  '#bcbd22',
  '#dbdb8d',
  '#17becf',
  '#9edae5',
];

/**
 * Sequential Blues
 */
export const schemeBlues: string[] = [
  '#f7fbff',
  '#deebf7',
  '#c6dbef',
  '#9ecae1',
  '#6baed6',
  '#4292c6',
  '#2171b5',
  '#08519c',
  '#08306b',
];

/**
 * Sequential Greens
 */
export const schemeGreens: string[] = [
  '#f7fcf5',
  '#e5f5e0',
  '#c7e9c0',
  '#a1d99b',
  '#74c476',
  '#41ab5d',
  '#238b45',
  '#006d2c',
  '#00441b',
];

/**
 * Sequential Greys
 */
export const schemeGreys: string[] = [
  '#ffffff',
  '#f0f0f0',
  '#d9d9d9',
  '#bdbdbd',
  '#969696',
  '#737373',
  '#525252',
  '#252525',
  '#000000',
];

/**
 * Sequential Oranges
 */
export const schemeOranges: string[] = [
  '#fff5eb',
  '#fee6ce',
  '#fdd0a2',
  '#fdae6b',
  '#fd8d3c',
  '#f16913',
  '#d94801',
  '#a63603',
  '#7f2704',
];

/**
 * Sequential Purples
 */
export const schemePurples: string[] = [
  '#fcfbfd',
  '#efedf5',
  '#dadaeb',
  '#bcbddc',
  '#9e9ac8',
  '#807dba',
  '#6a51a3',
  '#54278f',
  '#3f007d',
];

/**
 * Sequential Reds
 */
export const schemeReds: string[] = [
  '#fff5f0',
  '#fee0d2',
  '#fcbba1',
  '#fc9272',
  '#fb6a4a',
  '#ef3b2c',
  '#cb181d',
  '#a50f15',
  '#67000d',
];

/**
 * Viridis color scheme (perceptually uniform)
 */
export const schemeViridis: string[] = [
  '#440154',
  '#482878',
  '#3e4a89',
  '#31688e',
  '#26828e',
  '#1f9e89',
  '#35b779',
  '#6ece58',
  '#b5de2b',
  '#fde725',
];

/**
 * Inferno color scheme
 */
export const schemeInferno: string[] = [
  '#000004',
  '#1b0c41',
  '#4a0c6b',
  '#781c6d',
  '#a52c60',
  '#cf4446',
  '#ed6925',
  '#fb9b06',
  '#f7d13d',
  '#fcffa4',
];

/**
 * Magma color scheme
 */
export const schemeMagma: string[] = [
  '#000004',
  '#180f3d',
  '#440f76',
  '#721f81',
  '#9e2f7f',
  '#cd4071',
  '#f1605d',
  '#fd9668',
  '#fec287',
  '#fcfdbf',
];

/**
 * Plasma color scheme
 */
export const schemePlasma: string[] = [
  '#0d0887',
  '#46039f',
  '#7201a8',
  '#9c179e',
  '#bd3786',
  '#d8576b',
  '#ed7953',
  '#fb9f3a',
  '#fdca26',
  '#f0f921',
];

/**
 * Diverging RdYlGn (Red-Yellow-Green)
 */
export const schemeRdYlGn: string[] = [
  '#a50026',
  '#d73027',
  '#f46d43',
  '#fdae61',
  '#fee08b',
  '#ffffbf',
  '#d9ef8b',
  '#a6d96a',
  '#66bd63',
  '#1a9850',
  '#006837',
];

/**
 * Diverging RdYlBu (Red-Yellow-Blue)
 */
export const schemeRdYlBu: string[] = [
  '#a50026',
  '#d73027',
  '#f46d43',
  '#fdae61',
  '#fee090',
  '#ffffbf',
  '#e0f3f8',
  '#abd9e9',
  '#74add1',
  '#4575b4',
  '#313695',
];

/**
 * Diverging RdGy (Red-Grey)
 */
export const schemeRdGy: string[] = [
  '#67001f',
  '#b2182b',
  '#d6604d',
  '#f4a582',
  '#fddbc7',
  '#ffffff',
  '#e0e0e0',
  '#bababa',
  '#878787',
  '#4d4d4d',
  '#1a1a1a',
];

/**
 * Diverging PiYG (Pink-Yellow-Green)
 */
export const schemePiYG: string[] = [
  '#8e0152',
  '#c51b7d',
  '#de77ae',
  '#f1b6da',
  '#fde0ef',
  '#f7f7f7',
  '#e6f5d0',
  '#b8e186',
  '#7fbc41',
  '#4d9221',
  '#276419',
];

/**
 * Diverging PRGn (Purple-Green)
 */
export const schemePRGn: string[] = [
  '#40004b',
  '#762a83',
  '#9970ab',
  '#c2a5cf',
  '#e7d4e8',
  '#f7f7f7',
  '#d9f0d3',
  '#a6dba0',
  '#5aae61',
  '#1b7837',
  '#00441b',
];

/**
 * Diverging BrBG (Brown-Blue-Green)
 */
export const schemeBrBG: string[] = [
  '#543005',
  '#8c510a',
  '#bf812d',
  '#dfc27d',
  '#f6e8c3',
  '#f5f5f5',
  '#c7eae5',
  '#80cdc1',
  '#35978f',
  '#01665e',
  '#003c30',
];

/**
 * Warm color scheme
 */
export const schemeWarm: string[] = [
  '#6e40aa',
  '#963db3',
  '#bf3caf',
  '#e4419d',
  '#fe4b83',
  '#ff5e63',
  '#ff7847',
  '#fb9633',
  '#e2b72f',
  '#c6d63c',
];

/**
 * Cool color scheme
 */
export const schemeCool: string[] = [
  '#6e40aa',
  '#5854c0',
  '#4069cf',
  '#277dd5',
  '#1190d3',
  '#17a2c9',
  '#26b3b8',
  '#3bc2a2',
  '#54cf88',
  '#73d86c',
];

/**
 * Spectral (diverging rainbow)
 */
export const schemeSpectral: string[] = [
  '#9e0142',
  '#d53e4f',
  '#f46d43',
  '#fdae61',
  '#fee08b',
  '#ffffbf',
  '#e6f598',
  '#abdda4',
  '#66c2a5',
  '#3288bd',
  '#5e4fa2',
];

// ============================================================================
// Color Scheme Registry
// ============================================================================

const colorSchemes: Record<ColorSchemeName, string[]> = {
  category10: schemeCategory10,
  category20: schemeCategory20,
  blues: schemeBlues,
  greens: schemeGreens,
  greys: schemeGreys,
  oranges: schemeOranges,
  purples: schemePurples,
  reds: schemeReds,
  viridis: schemeViridis,
  inferno: schemeInferno,
  magma: schemeMagma,
  plasma: schemePlasma,
  warm: schemeWarm,
  cool: schemeCool,
  spectral: schemeSpectral,
  rdylgn: schemeRdYlGn,
  rdylbu: schemeRdYlBu,
  rdgy: schemeRdGy,
  piyg: schemePiYG,
  prgn: schemePRGn,
  brbg: schemeBrBG,
};

/**
 * Get a color scheme by name
 */
export function getColorScheme(name: ColorSchemeName): string[] {
  return colorSchemes[name] || schemeCategory10;
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Parse a hex color to RGB components
 */
export function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return [0, 0, 0];
  }
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

/**
 * Convert RGB components to hex color
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) =>
    Math.round(Math.max(0, Math.min(255, c)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Interpolate between two colors in perceptually uniform OKLab space.
 * Falls back to naive RGB if OKLab conversion fails (e.g., invalid hex).
 */
export function interpolateColor(color1: string, color2: string, t: number): string {
  const result = interpolateOklab(color1, color2, t);
  if (result !== null) {
    return result;
  }
  // Fallback to naive RGB interpolation for non-hex color formats
  const [r1, g1, b1] = hexToRgb(color1);
  const [r2, g2, b2] = hexToRgb(color2);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/**
 * Create an interpolator function from a color array
 */
export function interpolateColors(colors: string[]): ColorInterpolator {
  if (colors.length === 0) {
    return () => '#000000';
  }
  if (colors.length === 1) {
    return () => colors[0];
  }

  return (t: number) => {
    // Clamp t to [0, 1]
    t = Math.max(0, Math.min(1, t));

    // Find the two colors to interpolate between
    const scaledT = t * (colors.length - 1);
    const i = Math.min(Math.floor(scaledT), colors.length - 2);
    const localT = scaledT - i;

    return interpolateColor(colors[i], colors[i + 1], localT);
  };
}

// ============================================================================
// Sequential Color Scale
// ============================================================================

/**
 * Create a sequential color scale
 *
 * @example
 * const color = scaleSequential([0, 100], interpolateViridis);
 * color(50); // => middle color
 *
 * // Or use a built-in scheme name
 * const color2 = scaleSequential([0, 100], 'blues');
 */
export function scaleSequential(
  domain?: [number, number],
  interpolatorOrScheme?: ColorInterpolator | ColorSchemeName,
): SequentialColorScale {
  let _domain: [number, number] = domain || [0, 1];
  let _interpolator: ColorInterpolator;

  // Handle scheme name or interpolator
  if (typeof interpolatorOrScheme === 'string') {
    const scheme = getColorScheme(interpolatorOrScheme as ColorSchemeName);
    _interpolator = interpolateColors(scheme);
  } else if (typeof interpolatorOrScheme === 'function') {
    _interpolator = interpolatorOrScheme;
  } else {
    _interpolator = interpolateColors(schemeViridis);
  }

  function scale(value: number): string {
    const [d0, d1] = _domain;

    if (d0 === d1) {
      return _interpolator(0.5);
    }

    const t = (value - d0) / (d1 - d0);
    return _interpolator(Math.max(0, Math.min(1, t)));
  }

  scale.domain = function (values?: [number, number]): [number, number] | typeof scale {
    if (values === undefined) {
      return [..._domain] as [number, number];
    }
    _domain = [+values[0], +values[1]];
    return scale;
  } as SequentialColorScale['domain'];

  scale.interpolator = function (
    interpolator?: ColorInterpolator,
  ): ColorInterpolator | typeof scale {
    if (interpolator === undefined) {
      return _interpolator;
    }
    _interpolator = interpolator;
    return scale;
  } as SequentialColorScale['interpolator'];

  scale.copy = function (): SequentialColorScale {
    return scaleSequential([..._domain] as [number, number], _interpolator);
  };

  return scale as SequentialColorScale;
}

// ============================================================================
// Diverging Color Scale
// ============================================================================

/**
 * Create a diverging color scale
 *
 * @example
 * const color = scaleDiverging([-1, 0, 1], interpolateRdYlGn);
 * color(-1);  // => red
 * color(0);   // => yellow
 * color(1);   // => green
 */
export function scaleDiverging(
  domain?: [number, number, number],
  interpolatorOrScheme?: ColorInterpolator | ColorSchemeName,
): DivergingColorScale {
  let _domain: [number, number, number] = domain || [0, 0.5, 1];
  let _interpolator: ColorInterpolator;

  // Handle scheme name or interpolator
  if (typeof interpolatorOrScheme === 'string') {
    const scheme = getColorScheme(interpolatorOrScheme as ColorSchemeName);
    _interpolator = interpolateColors(scheme);
  } else if (typeof interpolatorOrScheme === 'function') {
    _interpolator = interpolatorOrScheme;
  } else {
    _interpolator = interpolateColors(schemeRdYlBu);
  }

  function scale(value: number): string {
    const [d0, d1, d2] = _domain;

    let t: number;
    if (value < d1) {
      // Left side of midpoint
      t = d0 === d1 ? 0 : 0.5 * ((value - d0) / (d1 - d0));
    } else {
      // Right side of midpoint
      t = d1 === d2 ? 1 : 0.5 + 0.5 * ((value - d1) / (d2 - d1));
    }

    return _interpolator(Math.max(0, Math.min(1, t)));
  }

  scale.domain = function (
    values?: [number, number, number],
  ): [number, number, number] | typeof scale {
    if (values === undefined) {
      return [..._domain] as [number, number, number];
    }
    _domain = [+values[0], +values[1], +values[2]];
    return scale;
  } as DivergingColorScale['domain'];

  scale.interpolator = function (
    interpolator?: ColorInterpolator,
  ): ColorInterpolator | typeof scale {
    if (interpolator === undefined) {
      return _interpolator;
    }
    _interpolator = interpolator;
    return scale;
  } as DivergingColorScale['interpolator'];

  scale.copy = function (): DivergingColorScale {
    return scaleDiverging([..._domain] as [number, number, number], _interpolator);
  };

  return scale as DivergingColorScale;
}

// ============================================================================
// Ordinal Color Scale
// ============================================================================

/**
 * Create an ordinal color scale for categorical data
 *
 * @example
 * const color = scaleOrdinal(['cat', 'dog', 'bird'], schemeCategory10);
 * color('cat'); // => '#1f77b4'
 * color('dog'); // => '#ff7f0e'
 *
 * // Or use a scheme name
 * const color2 = scaleOrdinal(['A', 'B', 'C'], 'category10');
 */
export function scaleOrdinal(
  domain?: string[],
  rangeOrScheme?: string[] | ColorSchemeName,
): OrdinalColorScale {
  let _domain: string[] = domain || [];
  let _range: string[];
  let _unknown: string | undefined = undefined;
  let _domainIndex = new Map<string, number>();

  // Handle scheme name or color array
  if (typeof rangeOrScheme === 'string') {
    _range = getColorScheme(rangeOrScheme as ColorSchemeName);
  } else if (Array.isArray(rangeOrScheme)) {
    _range = [...rangeOrScheme];
  } else {
    _range = [...schemeCategory10];
  }

  function rebuildIndex(): void {
    _domainIndex = new Map();
    _domain.forEach((d, i) => {
      if (!_domainIndex.has(d)) {
        _domainIndex.set(d, i);
      }
    });
  }

  rebuildIndex();

  function scale(value: string): string {
    let index = _domainIndex.get(value);

    // Implicit domain extension
    if (index === undefined) {
      if (_unknown !== undefined) {
        return _unknown;
      }
      // Add to domain
      index = _domain.length;
      _domain.push(value);
      _domainIndex.set(value, index);
    }

    // Cycle through range
    return _range[index % _range.length];
  }

  scale.domain = function (values?: string[]): string[] | typeof scale {
    if (values === undefined) {
      return [..._domain];
    }
    _domain = [...values];
    rebuildIndex();
    return scale;
  } as OrdinalColorScale['domain'];

  scale.range = function (colors?: string[]): string[] | typeof scale {
    if (colors === undefined) {
      return [..._range];
    }
    _range = [...colors];
    return scale;
  } as OrdinalColorScale['range'];

  scale.unknown = function (color?: string | undefined): (string | undefined) | typeof scale {
    if (arguments.length === 0) {
      return _unknown;
    }
    _unknown = color;
    return scale;
  } as OrdinalColorScale['unknown'];

  scale.copy = function (): OrdinalColorScale {
    const s = scaleOrdinal([..._domain], [..._range]);
    s.unknown(_unknown);
    return s;
  };

  return scale as OrdinalColorScale;
}

// ============================================================================
// Pre-built Interpolators
// ============================================================================

/** Interpolator for Blues scheme */
export const interpolateBlues = interpolateColors(schemeBlues);

/** Interpolator for Greens scheme */
export const interpolateGreens = interpolateColors(schemeGreens);

/** Interpolator for Greys scheme */
export const interpolateGreys = interpolateColors(schemeGreys);

/** Interpolator for Oranges scheme */
export const interpolateOranges = interpolateColors(schemeOranges);

/** Interpolator for Purples scheme */
export const interpolatePurples = interpolateColors(schemePurples);

/** Interpolator for Reds scheme */
export const interpolateReds = interpolateColors(schemeReds);

/** Interpolator for Viridis scheme */
export const interpolateViridis = interpolateColors(schemeViridis);

/** Interpolator for Inferno scheme */
export const interpolateInferno = interpolateColors(schemeInferno);

/** Interpolator for Magma scheme */
export const interpolateMagma = interpolateColors(schemeMagma);

/** Interpolator for Plasma scheme */
export const interpolatePlasma = interpolateColors(schemePlasma);

/** Interpolator for Warm scheme */
export const interpolateWarm = interpolateColors(schemeWarm);

/** Interpolator for Cool scheme */
export const interpolateCool = interpolateColors(schemeCool);

/** Interpolator for Spectral scheme */
export const interpolateSpectral = interpolateColors(schemeSpectral);

/** Interpolator for RdYlGn scheme */
export const interpolateRdYlGn = interpolateColors(schemeRdYlGn);

/** Interpolator for RdYlBu scheme */
export const interpolateRdYlBu = interpolateColors(schemeRdYlBu);

/** Interpolator for RdGy scheme */
export const interpolateRdGy = interpolateColors(schemeRdGy);

/** Interpolator for PiYG scheme */
export const interpolatePiYG = interpolateColors(schemePiYG);

/** Interpolator for PRGn scheme */
export const interpolatePRGn = interpolateColors(schemePRGn);

/** Interpolator for BrBG scheme */
export const interpolateBrBG = interpolateColors(schemeBrBG);
