/**
 * Scale Interfaces for Chart Primitives
 *
 * Scales map data values (domain) to visual values (range).
 * These are pure functions with no side effects.
 */

/**
 * Base scale interface - maps values from domain to range
 */
export interface Scale<Domain, Range> {
  /** Map a domain value to a range value */
  (value: Domain): Range;

  /** Get or set the domain */
  domain(): Domain[];
  domain(values: Domain[]): this;

  /** Get or set the range */
  range(): Range[];
  range(values: Range[]): this;

  /** Inverse mapping (range to domain) - not all scales support this */
  invert?(value: Range): Domain;

  /** Create a copy of this scale */
  copy(): Scale<Domain, Range>;
}

/**
 * Continuous scale for numeric data
 * Maps a continuous numeric domain to a continuous numeric range
 */
export interface ContinuousScale extends Scale<number, number> {
  /** Map a range value back to a domain value */
  invert(value: number): number;

  /** Generate tick values for axis display */
  ticks(count?: number): number[];

  /** Get a formatter function for tick labels */
  tickFormat(count?: number, specifier?: string): (n: number) => string;

  /** Extend the domain to nice round values */
  nice(count?: number): this;

  /** Enable or disable clamping to the range */
  clamp(): boolean;
  clamp(clamp: boolean): this;

  /** Create a copy of this scale */
  copy(): ContinuousScale;
}

/**
 * Logarithmic scale interface
 * Extends continuous scale with base configuration
 */
export interface LogScale extends ContinuousScale {
  /** Get or set the logarithm base */
  base(): number;
  base(base: number): this;

  /** Create a copy of this scale */
  copy(): LogScale;
}

/**
 * Time scale interface
 * Maps Date domain to numeric range
 */
export interface TimeScale extends Scale<Date, number> {
  /** Map a range value back to a Date */
  invert(value: number): Date;

  /** Generate tick values as Date objects */
  ticks(count?: number): Date[];

  /** Get a formatter function for tick labels */
  tickFormat(count?: number, specifier?: string): (d: Date) => string;

  /** Extend the domain to nice time boundaries */
  nice(count?: number): this;

  /** Enable or disable clamping to the range */
  clamp(): boolean;
  clamp(clamp: boolean): this;

  /** Create a copy of this scale */
  copy(): TimeScale;
}

/**
 * Band scale for categorical data
 * Maps discrete categories to continuous positions with bandwidth
 */
export interface BandScale extends Scale<string, number> {
  /** Get the width of each band */
  bandwidth(): number;

  /** Get the distance between band starts */
  step(): number;

  /** Set both inner and outer padding (0 to 1) */
  padding(): number;
  padding(padding: number): this;

  /** Set padding between bands (0 to 1) */
  paddingInner(): number;
  paddingInner(padding: number): this;

  /** Set padding at the edges (0 to 1) */
  paddingOuter(): number;
  paddingOuter(padding: number): this;

  /** Align bands within the range (0 to 1) */
  align(): number;
  align(align: number): this;

  /** Round outputs to integers */
  round(): boolean;
  round(round: boolean): this;

  /** Create a copy of this scale */
  copy(): BandScale;
}

/**
 * Point scale for categorical data (no bandwidth)
 * Like band scale but with zero bandwidth
 */
export interface PointScale extends Scale<string, number> {
  /** Get the distance between points */
  step(): number;

  /** Set padding at the edges (0 to 1) */
  padding(): number;
  padding(padding: number): this;

  /** Align points within the range (0 to 1) */
  align(): number;
  align(align: number): this;

  /** Round outputs to integers */
  round(): boolean;
  round(round: boolean): this;

  /** Create a copy of this scale */
  copy(): PointScale;
}

/**
 * Color scale interface for mapping values to colors
 */
export interface ColorScale {
  /** Map a value to a color string */
  (value: number | string): string;

  /** Get or set the domain */
  domain(): (number | string)[];
  domain(values: (number | string)[]): this;

  /** Get or set the color range */
  range?(): string[];
  range?(colors: string[]): this;

  /** Create a copy of this scale */
  copy(): ColorScale;
}

/**
 * Sequential color scale for continuous numeric data
 */
export interface SequentialColorScale extends ColorScale {
  /** Map a numeric value to a color */
  (value: number): string;

  /** Get or set the domain (two values: min, max) */
  domain(): [number, number];
  domain(values: [number, number]): this;

  /** Get or set the interpolator function */
  interpolator(): (t: number) => string;
  interpolator(interpolator: (t: number) => string): this;

  /** Create a copy of this scale */
  copy(): SequentialColorScale;
}

/**
 * Diverging color scale for data with a meaningful midpoint
 */
export interface DivergingColorScale extends ColorScale {
  /** Map a numeric value to a color */
  (value: number): string;

  /** Get or set the domain (three values: min, mid, max) */
  domain(): [number, number, number];
  domain(values: [number, number, number]): this;

  /** Get or set the interpolator function */
  interpolator(): (t: number) => string;
  interpolator(interpolator: (t: number) => string): this;

  /** Create a copy of this scale */
  copy(): DivergingColorScale;
}

/**
 * Ordinal color scale for categorical data
 */
export interface OrdinalColorScale extends ColorScale {
  /** Map a category to a color */
  (value: string): string;

  /** Get or set the domain (categories) */
  domain(): string[];
  domain(values: string[]): this;

  /** Get or set the color range */
  range(): string[];
  range(colors: string[]): this;

  /** Get or set the unknown value color */
  unknown(): string | undefined;
  unknown(color: string | undefined): this;

  /** Create a copy of this scale */
  copy(): OrdinalColorScale;
}

/**
 * Unified chart scale interface for the grammar compiler.
 *
 * This is a callable function that maps domain values to range values,
 * with optional metadata methods attached. It serves as the common type
 * for all scales used in encoding-resolver and compiler, avoiding the
 * need for `as any` casts when invoking scales or accessing their methods.
 *
 * All scales created by the encoding-resolver implement this interface:
 * - ContinuousScale (linear, log, time) -> returns number
 * - BandScale / PointScale -> returns number
 * - ColorScale -> returns string
 * - Simple constant scales -> returns number or string
 */
export interface ChartScale {
  /** Invoke the scale: map a domain value to a range value */
  (value: unknown): number | string;

  /** Get the domain values */
  domain?: () => unknown[];
  /** Get the range values */
  range?: () => unknown[];
  /** Get the bandwidth (band/point scales only) */
  bandwidth?: () => number;
  /** Get the step distance (band/point scales only) */
  step?: () => number;
  /** Generate tick values (continuous scales only) */
  ticks?: (count?: number) => unknown[];
  /** Get a tick format function (continuous scales only) */
  tickFormat?: (...args: unknown[]) => (n: unknown) => string;
  /** Inverse mapping (continuous scales only) */
  invert?: (value: number) => unknown;
  /** Extend domain to nice values (continuous scales only) */
  nice?: (count?: number) => ChartScale;
  /** Get clamping state (continuous scales only) */
  clamp?: (...args: unknown[]) => unknown;
  /** Copy the scale */
  copy?: () => ChartScale;
  /** Get/set padding (band/point scales only) */
  padding?: (...args: unknown[]) => unknown;
  /** Get/set inner padding (band scales only) */
  paddingInner?: (...args: unknown[]) => unknown;
  /** Get/set outer padding (band scales only) */
  paddingOuter?: (...args: unknown[]) => unknown;
  /** Get alignment (band/point scales only) */
  align?: () => number;
  /** Get rounding state (band/point scales only) */
  round?: () => boolean;
}

/**
 * Color interpolator type - maps a normalized value (0-1) to a color string
 */
export type ColorInterpolator = (t: number) => string;

/**
 * Built-in color scheme names
 */
export type ColorSchemeName =
  | 'category10'
  | 'category20'
  | 'blues'
  | 'greens'
  | 'greys'
  | 'oranges'
  | 'purples'
  | 'reds'
  | 'viridis'
  | 'inferno'
  | 'magma'
  | 'plasma'
  | 'warm'
  | 'cool'
  | 'spectral'
  | 'rdylgn'
  | 'rdylbu'
  | 'rdgy'
  | 'piyg'
  | 'prgn'
  | 'brbg';
