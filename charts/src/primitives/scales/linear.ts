/**
 * Linear Scale Implementation
 *
 * Maps a continuous numeric domain to a continuous numeric range
 * using linear interpolation.
 */

import type { ContinuousScale } from './types';

/**
 * Internal state for a linear scale
 */
interface LinearScaleState {
  domain: [number, number];
  range: [number, number];
  clamp: boolean;
}

/**
 * Create a linear scale
 *
 * @example
 * const x = scaleLinear().domain([0, 100]).range([0, 800]);
 * x(50); // => 400
 * x.invert(400); // => 50
 */
export function scaleLinear(): ContinuousScale {
  const state: LinearScaleState = {
    domain: [0, 1],
    range: [0, 1],
    clamp: false,
  };

  // Calculate scale and offset for linear mapping
  function rescale(): { scale: number; offset: number } {
    const [d0, d1] = state.domain;
    const [r0, r1] = state.range;
    const domainSpan = d1 - d0;
    const rangeSpan = r1 - r0;

    if (domainSpan === 0) {
      // Degenerate case: all domain values map to the midpoint of range
      return { scale: 0, offset: (r0 + r1) / 2 };
    }

    return {
      scale: rangeSpan / domainSpan,
      offset: r0 - d0 * (rangeSpan / domainSpan),
    };
  }

  // The scale function
  function scale(value: number): number {
    const { scale: s, offset } = rescale();
    let result = value * s + offset;

    if (state.clamp) {
      const [r0, r1] = state.range;
      const min = Math.min(r0, r1);
      const max = Math.max(r0, r1);
      result = Math.max(min, Math.min(max, result));
    }

    return result;
  }

  // Domain getter/setter
  scale.domain = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.domain];
    }
    state.domain = [+values[0], +values[values.length - 1]];
    return scale;
  } as ContinuousScale['domain'];

  // Range getter/setter
  scale.range = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.range];
    }
    state.range = [+values[0], +values[values.length - 1]];
    return scale;
  } as ContinuousScale['range'];

  // Invert: range value to domain value
  scale.invert = function (value: number): number {
    const { scale: s, offset } = rescale();

    if (s === 0) {
      // Degenerate case
      return (state.domain[0] + state.domain[1]) / 2;
    }

    let result = (value - offset) / s;

    if (state.clamp) {
      const [d0, d1] = state.domain;
      const min = Math.min(d0, d1);
      const max = Math.max(d0, d1);
      result = Math.max(min, Math.min(max, result));
    }

    return result;
  };

  // Clamp getter/setter
  scale.clamp = function (clamp?: boolean): boolean | typeof scale {
    if (clamp === undefined) {
      return state.clamp;
    }
    state.clamp = !!clamp;
    return scale;
  } as ContinuousScale['clamp'];

  // Generate tick values
  scale.ticks = function (count: number = 10): number[] {
    const [d0, d1] = state.domain;
    return generateTicks(d0, d1, count);
  };

  // Get tick formatter
  scale.tickFormat = function (count: number = 10, specifier?: string): (n: number) => string {
    const [d0, d1] = state.domain;
    return createTickFormatter(d0, d1, count, specifier);
  };

  // Extend domain to nice round values
  scale.nice = function (count: number = 10): ContinuousScale {
    const [d0, d1] = state.domain;
    const [niceD0, niceD1] = niceLinear(d0, d1, count);
    state.domain = [niceD0, niceD1];
    return scale;
  };

  // Copy the scale
  scale.copy = function (): ContinuousScale {
    return scaleLinear()
      .domain([...state.domain])
      .range([...state.range])
      .clamp(state.clamp);
  };

  return scale as ContinuousScale;
}

/**
 * Generate tick values for a range.
 *
 * Uses the D3 tick-step algorithm which guarantees that the step size is
 * always 1, 2, 5, or 10 times a power of 10 (a "nice" number). Since ticks
 * are generated at exact multiples of the step, every tick value is also nice
 * and the spacing between adjacent ticks is always a nice number.
 */
export function generateTicks(start: number, stop: number, count: number = 10): number[] {
  if (count <= 0) return [];
  if (start === stop) return [start];

  const ascending = start <= stop;
  const lo = ascending ? start : stop;
  const hi = ascending ? stop : start;

  const step = tickStep(lo, hi, count);
  if (!isFinite(step) || step === 0) return [];

  // Generate evenly-spaced ticks at multiples of step
  const epsilon = Math.abs(step) * 1e-10;
  const tickStart = Math.ceil((lo - epsilon) / step) * step;
  const tickStop = Math.floor((hi + epsilon) / step) * step;
  const n = Math.round((tickStop - tickStart) / step) + 1;
  const ticks: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    ticks[i] = parseFloat((tickStart + i * step).toPrecision(12));
  }

  return ascending ? ticks : ticks.slice().reverse();
}

/**
 * Calculate a nice tick step
 */
export function tickStep(start: number, stop: number, count: number): number {
  const step0 = Math.abs(stop - start) / Math.max(0, count);
  let step1 = Math.pow(10, Math.floor(Math.log10(step0)));
  const error = step0 / step1;

  // Choose multiplier based on error ratio
  if (error >= Math.sqrt(50)) {
    step1 *= 10;
  } else if (error >= Math.sqrt(10)) {
    step1 *= 5;
  } else if (error >= Math.sqrt(2)) {
    step1 *= 2;
  }

  return stop < start ? -step1 : step1;
}

/**
 * Extend domain to nice round numbers
 */
export function niceLinear(start: number, stop: number, count: number = 10): [number, number] {
  let prestep: number = NaN;
  let step = tickStep(start, stop, count);

  // Iterate to refine the step
  let iterations = 0;
  while (step !== prestep && iterations++ < 10) {
    prestep = step;
    const newStart = Math.floor(start / step) * step;
    const newStop = Math.ceil(stop / step) * step;
    step = tickStep(newStart, newStop, count);
  }

  if (step > 0) {
    return [Math.floor(start / step) * step, Math.ceil(stop / step) * step];
  } else if (step < 0) {
    return [Math.ceil(start * step) / step, Math.floor(stop * step) / step];
  }

  return [start, stop];
}

/**
 * Create a tick formatter function
 */
export function createTickFormatter(
  _start: number,
  _stop: number,
  _count: number = 10,
  specifier?: string,
): (n: number) => string {
  // Determine precision based on step size
  if (specifier) {
    // Parse specifier for precision
    const precisionMatch = specifier.match(/\.(\d+)/);
    if (precisionMatch) {
      const precision = parseInt(precisionMatch[1], 10);
      return (n: number) => n.toFixed(precision);
    }

    // Handle percentage specifier
    if (specifier.includes('%')) {
      const precision = specifier.match(/\.(\d+)%/)?.[1];
      const decimals = precision ? parseInt(precision, 10) : 0;
      return (n: number) => (n * 100).toFixed(decimals) + '%';
    }

    // Handle exponential specifier
    if (specifier.toLowerCase().includes('e')) {
      const precision = specifier.match(/\.(\d+)/)?.[1];
      const decimals = precision ? parseInt(precision, 10) : 6;
      return (n: number) => n.toExponential(decimals);
    }
  }

  // Default formatter with automatic precision
  return (n: number) => {
    if (Number.isInteger(n) || Math.abs(n) >= 1000) {
      return String(n);
    }
    // Use toPrecision for small decimals
    const str = n.toPrecision(6);
    // Remove trailing zeros
    return parseFloat(str).toString();
  };
}
