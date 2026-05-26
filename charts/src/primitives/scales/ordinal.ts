/**
 * Ordinal and Band Scale Implementation
 *
 * Maps discrete string categories to positions in a continuous range.
 * Band scales provide bandwidth for bar widths; point scales place
 * categories at single points.
 */

import type { BandScale, PointScale } from './types';

/**
 * Internal state for a band scale
 */
interface BandScaleState {
  domain: string[];
  range: [number, number];
  paddingInner: number;
  paddingOuter: number;
  align: number;
  round: boolean;
}

/**
 * Create a band scale for categorical data
 *
 * @example
 * const y = scaleBand()
 *   .domain(['A', 'B', 'C'])
 *   .range([0, 300])
 *   .padding(0.1);
 * y('B');        // => 100 + offset
 * y.bandwidth(); // => bar width
 */
export function scaleBand(): BandScale {
  const state: BandScaleState = {
    domain: [],
    range: [0, 1],
    paddingInner: 0,
    paddingOuter: 0,
    align: 0.5,
    round: false,
  };

  // Index map for O(1) lookups
  let domainIndex = new Map<string, number>();

  // Computed values
  let computedBandwidth = 0;
  let computedStep = 0;

  function rescale(): void {
    const n = state.domain.length;

    if (n === 0) {
      computedBandwidth = 0;
      computedStep = 0;
      return;
    }

    const [r0, r1] = state.range;
    const rangeSpan = r1 - r0;

    // Calculate step and bandwidth
    // Total width = n * step - paddingInner * step + 2 * paddingOuter * step
    // rangeSpan = (n + paddingOuter * 2 - paddingInner) * step
    // step = rangeSpan / (n + paddingOuter * 2 - paddingInner)
    const divisor = Math.max(1, n - state.paddingInner + state.paddingOuter * 2);
    computedStep = rangeSpan / divisor;
    computedBandwidth = computedStep * (1 - state.paddingInner);

    if (state.round) {
      computedStep = Math.floor(computedStep);
      computedBandwidth = Math.floor(computedBandwidth);
    }

    // Rebuild index
    domainIndex = new Map();
    state.domain.forEach((d, i) => {
      domainIndex.set(d, i);
    });
  }

  // The scale function
  function scale(value: string): number {
    const index = domainIndex.get(value);
    if (index === undefined) {
      return NaN;
    }

    const [r0] = state.range;
    const start = r0 + state.paddingOuter * computedStep;

    let position = start + index * computedStep;

    if (state.round) {
      position = Math.round(position);
    }

    return position;
  }

  // Domain getter/setter
  scale.domain = function (values?: string[]): string[] | typeof scale {
    if (values === undefined) {
      return [...state.domain];
    }
    state.domain = [...values];
    rescale();
    return scale;
  } as BandScale['domain'];

  // Range getter/setter
  scale.range = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.range];
    }
    state.range = [+values[0], +values[values.length - 1]];
    rescale();
    return scale;
  } as BandScale['range'];

  // Range round (sets range and rounds)
  scale.rangeRound = function (values: number[]): BandScale {
    state.range = [+values[0], +values[values.length - 1]];
    state.round = true;
    rescale();
    return scale;
  };

  // Get bandwidth
  scale.bandwidth = function (): number {
    return computedBandwidth;
  };

  // Get step
  scale.step = function (): number {
    return computedStep;
  };

  // Padding getter/setter (sets both inner and outer)
  scale.padding = function (padding?: number): number | typeof scale {
    if (padding === undefined) {
      return state.paddingInner;
    }
    state.paddingInner = Math.max(0, Math.min(1, +padding));
    state.paddingOuter = state.paddingInner;
    rescale();
    return scale;
  } as BandScale['padding'];

  // Inner padding getter/setter
  scale.paddingInner = function (padding?: number): number | typeof scale {
    if (padding === undefined) {
      return state.paddingInner;
    }
    state.paddingInner = Math.max(0, Math.min(1, +padding));
    rescale();
    return scale;
  } as BandScale['paddingInner'];

  // Outer padding getter/setter
  scale.paddingOuter = function (padding?: number): number | typeof scale {
    if (padding === undefined) {
      return state.paddingOuter;
    }
    state.paddingOuter = Math.max(0, +padding);
    rescale();
    return scale;
  } as BandScale['paddingOuter'];

  // Align getter/setter
  scale.align = function (align?: number): number | typeof scale {
    if (align === undefined) {
      return state.align;
    }
    state.align = Math.max(0, Math.min(1, +align));
    rescale();
    return scale;
  } as BandScale['align'];

  // Round getter/setter
  scale.round = function (round?: boolean): boolean | typeof scale {
    if (round === undefined) {
      return state.round;
    }
    state.round = !!round;
    rescale();
    return scale;
  } as BandScale['round'];

  // Copy the scale
  scale.copy = function (): BandScale {
    return scaleBand()
      .domain([...state.domain])
      .range([...state.range])
      .paddingInner(state.paddingInner)
      .paddingOuter(state.paddingOuter)
      .align(state.align)
      .round(state.round);
  };

  return scale as BandScale;
}

/**
 * Internal state for a point scale
 */
interface PointScaleState {
  domain: string[];
  range: [number, number];
  padding: number;
  align: number;
  round: boolean;
}

/**
 * Create a point scale for categorical data
 *
 * Like a band scale but with zero bandwidth - each category
 * maps to a single point position.
 *
 * @example
 * const x = scalePoint()
 *   .domain(['A', 'B', 'C'])
 *   .range([0, 300])
 *   .padding(0.5);
 * x('B'); // => 150
 */
export function scalePoint(): PointScale {
  const state: PointScaleState = {
    domain: [],
    range: [0, 1],
    padding: 0,
    align: 0.5,
    round: false,
  };

  // Index map for O(1) lookups
  let domainIndex = new Map<string, number>();

  // Computed step
  let computedStep = 0;

  function rescale(): void {
    const n = state.domain.length;

    if (n === 0) {
      computedStep = 0;
      return;
    }

    const [r0, r1] = state.range;
    const rangeSpan = r1 - r0;

    // With n points and padding, the step is:
    // rangeSpan = (n - 1 + padding * 2) * step
    // (n-1 steps between points, plus padding on each end)
    const divisor = Math.max(1, n - 1 + state.padding * 2);
    computedStep = rangeSpan / divisor;

    if (state.round) {
      computedStep = Math.floor(computedStep);
    }

    // Rebuild index
    domainIndex = new Map();
    state.domain.forEach((d, i) => {
      domainIndex.set(d, i);
    });
  }

  // The scale function
  function scale(value: string): number {
    const index = domainIndex.get(value);
    if (index === undefined) {
      return NaN;
    }

    const [r0] = state.range;
    const start = r0 + state.padding * computedStep;

    let position = start + index * computedStep;

    if (state.round) {
      position = Math.round(position);
    }

    return position;
  }

  // Domain getter/setter
  scale.domain = function (values?: string[]): string[] | typeof scale {
    if (values === undefined) {
      return [...state.domain];
    }
    state.domain = [...values];
    rescale();
    return scale;
  } as PointScale['domain'];

  // Range getter/setter
  scale.range = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.range];
    }
    state.range = [+values[0], +values[values.length - 1]];
    rescale();
    return scale;
  } as PointScale['range'];

  // Get step
  scale.step = function (): number {
    return computedStep;
  };

  // Padding getter/setter
  scale.padding = function (padding?: number): number | typeof scale {
    if (padding === undefined) {
      return state.padding;
    }
    state.padding = Math.max(0, +padding);
    rescale();
    return scale;
  } as PointScale['padding'];

  // Align getter/setter
  scale.align = function (align?: number): number | typeof scale {
    if (align === undefined) {
      return state.align;
    }
    state.align = Math.max(0, Math.min(1, +align));
    rescale();
    return scale;
  } as PointScale['align'];

  // Round getter/setter
  scale.round = function (round?: boolean): boolean | typeof scale {
    if (round === undefined) {
      return state.round;
    }
    state.round = !!round;
    rescale();
    return scale;
  } as PointScale['round'];

  // Copy the scale
  scale.copy = function (): PointScale {
    return scalePoint()
      .domain([...state.domain])
      .range([...state.range])
      .padding(state.padding)
      .align(state.align)
      .round(state.round);
  };

  return scale as PointScale;
}

/**
 * Simple ordinal scale that maps categories to arbitrary values
 *
 * Unlike band/point scales, this maps to any output type, not just positions.
 *
 * @example
 * const color = scaleOrdinalGeneric<string, string>()
 *   .domain(['A', 'B', 'C'])
 *   .range(['red', 'green', 'blue']);
 * color('B'); // => 'green'
 */
/** Return type for scaleOrdinalGeneric */
interface OrdinalGenericScale<T> {
  (value: string): T | undefined;
  domain(): string[];
  domain(values: string[]): OrdinalGenericScale<T>;
  range(): T[];
  range(values: T[]): OrdinalGenericScale<T>;
  unknown(): T | undefined;
  unknown(value: T | undefined): OrdinalGenericScale<T>;
  copy(): OrdinalGenericScale<T>;
}

export function scaleOrdinalGeneric<T>(): OrdinalGenericScale<T> {
  let domainValues: string[] = [];
  let rangeValues: T[] = [];
  let unknownValue: T | undefined = undefined;
  let domainIndex = new Map<string, number>();

  function scale(value: string): T | undefined {
    const index = domainIndex.get(value);
    if (index === undefined) {
      return unknownValue;
    }
    // Cycle through range if domain is larger
    return rangeValues[index % rangeValues.length];
  }

  scale.domain = function (values?: string[]): string[] | typeof scale {
    if (values === undefined) {
      return [...domainValues];
    }
    domainValues = [...values];
    domainIndex = new Map();
    domainValues.forEach((d, i) => {
      if (!domainIndex.has(d)) {
        domainIndex.set(d, i);
      }
    });
    return scale;
  } as OrdinalGenericScale<T>['domain'];

  scale.range = function (values?: T[]): T[] | typeof scale {
    if (values === undefined) {
      return [...rangeValues];
    }
    rangeValues = [...values];
    return scale;
  } as OrdinalGenericScale<T>['range'];

  scale.unknown = function (value?: T | undefined): (T | undefined) | typeof scale {
    if (arguments.length === 0) {
      return unknownValue;
    }
    unknownValue = value;
    return scale;
  } as OrdinalGenericScale<T>['unknown'];

  scale.copy = function (): OrdinalGenericScale<T> {
    return scaleOrdinalGeneric<T>().domain(domainValues).range(rangeValues).unknown(unknownValue);
  };

  return scale as OrdinalGenericScale<T>;
}
