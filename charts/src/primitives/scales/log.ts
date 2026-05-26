/**
 * Logarithmic Scale Implementation
 *
 * Maps a continuous numeric domain to a continuous numeric range
 * using logarithmic interpolation. Useful for data spanning multiple
 * orders of magnitude.
 */

import type { LogScale } from './types';

/**
 * Internal state for a logarithmic scale
 */
interface LogScaleState {
  domain: [number, number];
  range: [number, number];
  base: number;
  clamp: boolean;
}

/**
 * Create a logarithmic scale
 *
 * @example
 * const x = scaleLog().domain([1, 1000]).range([0, 300]);
 * x(10);    // => 100
 * x(100);   // => 200
 * x.invert(150); // => ~31.62
 */
export function scaleLog(): LogScale {
  const state: LogScaleState = {
    domain: [1, 10],
    range: [0, 1],
    base: 10,
    clamp: false,
  };

  // Log function using the configured base
  function log(x: number): number {
    return Math.log(x) / Math.log(state.base);
  }

  // Inverse log (exponentiation)
  function pow(x: number): number {
    return Math.pow(state.base, x);
  }

  // Reflect for negative domain support
  function reflect(f: (x: number) => number): (x: number) => number {
    return (x: number) => -f(-x);
  }

  // Handle zero and negative values gracefully
  function safeLog(x: number): number {
    if (x <= 0) {
      // Return a very negative number to indicate out-of-bounds
      return -Infinity;
    }
    return log(x);
  }

  // The scale function
  function scale(value: number): number {
    const [d0, d1] = state.domain;
    const [r0, r1] = state.range;

    // Handle negative domain (reflection)
    const negative = d0 < 0;
    const logFn = negative ? reflect(safeLog) : safeLog;

    const logD0 = logFn(Math.abs(d0));
    const logD1 = logFn(Math.abs(d1));
    const logV = logFn(negative ? -value : value);

    // Handle degenerate case
    if (!isFinite(logD0) || !isFinite(logD1) || logD0 === logD1) {
      return (r0 + r1) / 2;
    }

    // Linear interpolation in log space
    const t = (logV - logD0) / (logD1 - logD0);
    let result = r0 + t * (r1 - r0);

    if (state.clamp) {
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

    const d0 = +values[0];
    const d1 = +values[values.length - 1];

    // Validate: domain values must be non-zero and have the same sign
    if (d0 === 0 || d1 === 0) {
      console.warn('Log scale domain cannot include zero. Using 1 instead.');
      state.domain = [d0 === 0 ? 1 : d0, d1 === 0 ? 1 : d1];
    } else if (d0 < 0 !== d1 < 0) {
      console.warn('Log scale domain values must have the same sign. Using absolute values.');
      state.domain = [Math.abs(d0), Math.abs(d1)];
    } else {
      state.domain = [d0, d1];
    }

    return scale;
  } as LogScale['domain'];

  // Range getter/setter
  scale.range = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.range];
    }
    state.range = [+values[0], +values[values.length - 1]];
    return scale;
  } as LogScale['range'];

  // Base getter/setter
  scale.base = function (base?: number): number | typeof scale {
    if (base === undefined) {
      return state.base;
    }
    if (base <= 0 || base === 1) {
      console.warn('Log base must be positive and not equal to 1. Using 10.');
      state.base = 10;
    } else {
      state.base = +base;
    }
    return scale;
  } as LogScale['base'];

  // Invert: range value to domain value
  scale.invert = function (value: number): number {
    const [d0, d1] = state.domain;
    const [r0, r1] = state.range;

    // Handle degenerate case
    if (r0 === r1) {
      return Math.sqrt(d0 * d1);
    }

    const negative = d0 < 0;
    const logFn = negative ? reflect(log) : log;

    const logD0 = logFn(Math.abs(d0));
    const logD1 = logFn(Math.abs(d1));

    // Inverse linear interpolation
    const t = (value - r0) / (r1 - r0);
    const logResult = logD0 + t * (logD1 - logD0);

    let result = pow(logResult);
    if (negative) {
      result = -result;
    }

    if (state.clamp) {
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
  } as LogScale['clamp'];

  // Generate tick values (powers of base)
  scale.ticks = function (count: number = 10): number[] {
    const [d0, d1] = state.domain;

    // Get the min and max in positive space
    const min = Math.min(Math.abs(d0), Math.abs(d1));
    const max = Math.max(Math.abs(d0), Math.abs(d1));

    if (min <= 0 || max <= 0) {
      return [];
    }

    const logMin = log(min);
    const logMax = log(max);

    const ticks: number[] = [];

    // Generate ticks at powers of the base
    const startPow = Math.floor(logMin);
    const endPow = Math.ceil(logMax);

    for (let p = startPow; p <= endPow; p++) {
      const tick = pow(p);
      if (tick >= min && tick <= max) {
        ticks.push(d0 < 0 ? -tick : tick);
      }

      // Add intermediate ticks if count is high enough
      if (count > (endPow - startPow + 1) * 2) {
        const intermediates = [2, 5];
        for (const mult of intermediates) {
          const intermediateTick = tick * mult;
          if (intermediateTick >= min && intermediateTick <= max) {
            ticks.push(d0 < 0 ? -intermediateTick : intermediateTick);
          }
        }
      }
    }

    // Sort and limit to count
    ticks.sort((a, b) => Math.abs(a) - Math.abs(b));
    if (ticks.length > count) {
      // Evenly sample ticks
      const step = Math.ceil(ticks.length / count);
      return ticks.filter((_, i) => i % step === 0);
    }

    return ticks;
  };

  // Get tick formatter
  scale.tickFormat = function (_count: number = 10, specifier?: string): (n: number) => string {
    if (specifier) {
      const precisionMatch = specifier.match(/\.(\d+)/);
      if (precisionMatch) {
        const precision = parseInt(precisionMatch[1], 10);
        return (n: number) => n.toFixed(precision);
      }
    }

    // Default: show powers of base nicely
    return (n: number) => {
      const absN = Math.abs(n);
      const logN = log(absN);
      const roundedLog = Math.round(logN);

      // If it's close to a power of base, show it cleanly
      if (Math.abs(logN - roundedLog) < 0.01) {
        return String(n);
      }

      // Otherwise use exponential notation
      return n.toExponential(1);
    };
  };

  // Extend domain to nice round values (powers of base)
  scale.nice = function (_count?: number): LogScale {
    const [d0, d1] = state.domain;
    const negative = d0 < 0;

    const min = Math.min(Math.abs(d0), Math.abs(d1));
    const max = Math.max(Math.abs(d0), Math.abs(d1));

    const niceMin = pow(Math.floor(log(min)));
    const niceMax = pow(Math.ceil(log(max)));

    if (negative) {
      state.domain = d0 < d1 ? [-niceMax, -niceMin] : [-niceMin, -niceMax];
    } else {
      state.domain = d0 < d1 ? [niceMin, niceMax] : [niceMax, niceMin];
    }

    return scale;
  };

  // Copy the scale
  scale.copy = function (): LogScale {
    return scaleLog()
      .domain([...state.domain])
      .range([...state.range])
      .base(state.base)
      .clamp(state.clamp);
  };

  return scale as LogScale;
}
