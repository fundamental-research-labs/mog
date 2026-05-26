/**
 * Scale Functions for Chart Primitives
 *
 * Scales map data values (domain) to visual values (range).
 * All scales are pure functions with fluent APIs for configuration.
 *
 * @example
 * // Linear scale for numeric data
 * const x = scaleLinear().domain([0, 100]).range([0, 800]);
 * x(50); // => 400
 *
 * // Band scale for categorical data
 * const y = scaleBand().domain(['A', 'B', 'C']).range([0, 300]).padding(0.1);
 * y('B'); // => position
 * y.bandwidth(); // => bar width
 *
 * // Color scale for categorical data
 * const color = scaleOrdinal(['cat', 'dog'], 'category10');
 * color('cat'); // => '#1f77b4'
 */

// Types
export type {
  BandScale,
  ColorInterpolator,
  ColorScale,
  ColorSchemeName,
  ContinuousScale,
  DivergingColorScale,
  LogScale,
  OrdinalColorScale,
  PointScale,
  Scale,
  SequentialColorScale,
  TimeScale,
} from './types';

// Linear scale
export { createTickFormatter, generateTicks, niceLinear, scaleLinear, tickStep } from './linear';

// Logarithmic scale
export { scaleLog } from './log';

// Time scale
export { formatDate, scaleTime } from './time';

// Ordinal/band scales
export { scaleBand, scaleOrdinalGeneric, scalePoint } from './ordinal';

// Color scales
export {
  // Color utilities
  getColorScheme,
  hexToRgb,
  // Pre-built interpolators
  interpolateBlues,
  interpolateBrBG,
  interpolateColor,
  interpolateColors,
  interpolateCool,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolatePRGn,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePurples,
  interpolateRdGy,
  interpolateRdYlBu,
  interpolateRdYlGn,
  interpolateReds,
  interpolateSpectral,
  interpolateViridis,
  interpolateWarm,
  rgbToHex,
  scaleDiverging,
  scaleOrdinal,
  // Scale factory functions
  scaleSequential,
  schemeBlues,
  schemeBrBG,
  // Color schemes
  schemeCategory10,
  schemeCategory20,
  schemeCool,
  schemeGreens,
  schemeGreys,
  schemeInferno,
  schemeMagma,
  schemeOranges,
  schemePRGn,
  schemePiYG,
  schemePlasma,
  schemePurples,
  schemeRdGy,
  schemeRdYlBu,
  schemeRdYlGn,
  schemeReds,
  schemeSpectral,
  schemeViridis,
  schemeWarm,
} from './color';
