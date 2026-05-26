/**
 * Time Scale Implementation
 *
 * Maps a Date domain to a numeric range. Internally works with
 * milliseconds since epoch for linear interpolation.
 */

import type { TimeScale } from './types';

/**
 * Time unit constants in milliseconds
 */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY; // Approximate
const YEAR = 365.25 * DAY; // Approximate (accounts for leap years)

/**
 * Time interval definitions for tick generation
 */
interface TimeInterval {
  duration: number;
  step: number;
  floor: (date: Date) => Date;
  offset: (date: Date, step: number) => Date;
  format: string;
}

const timeIntervals: TimeInterval[] = [
  {
    duration: SECOND,
    step: 1,
    floor: (d) => new Date(Math.floor(d.getTime() / SECOND) * SECOND),
    offset: (d, n) => new Date(d.getTime() + n * SECOND),
    format: ':ss',
  },
  {
    duration: SECOND,
    step: 5,
    floor: (d) => new Date(Math.floor(d.getTime() / (5 * SECOND)) * 5 * SECOND),
    offset: (d, n) => new Date(d.getTime() + n * 5 * SECOND),
    format: ':ss',
  },
  {
    duration: SECOND,
    step: 15,
    floor: (d) => new Date(Math.floor(d.getTime() / (15 * SECOND)) * 15 * SECOND),
    offset: (d, n) => new Date(d.getTime() + n * 15 * SECOND),
    format: ':ss',
  },
  {
    duration: SECOND,
    step: 30,
    floor: (d) => new Date(Math.floor(d.getTime() / (30 * SECOND)) * 30 * SECOND),
    offset: (d, n) => new Date(d.getTime() + n * 30 * SECOND),
    format: ':ss',
  },
  {
    duration: MINUTE,
    step: 1,
    floor: (d) => new Date(Math.floor(d.getTime() / MINUTE) * MINUTE),
    offset: (d, n) => new Date(d.getTime() + n * MINUTE),
    format: 'HH:mm',
  },
  {
    duration: MINUTE,
    step: 5,
    floor: (d) => new Date(Math.floor(d.getTime() / (5 * MINUTE)) * 5 * MINUTE),
    offset: (d, n) => new Date(d.getTime() + n * 5 * MINUTE),
    format: 'HH:mm',
  },
  {
    duration: MINUTE,
    step: 15,
    floor: (d) => new Date(Math.floor(d.getTime() / (15 * MINUTE)) * 15 * MINUTE),
    offset: (d, n) => new Date(d.getTime() + n * 15 * MINUTE),
    format: 'HH:mm',
  },
  {
    duration: MINUTE,
    step: 30,
    floor: (d) => new Date(Math.floor(d.getTime() / (30 * MINUTE)) * 30 * MINUTE),
    offset: (d, n) => new Date(d.getTime() + n * 30 * MINUTE),
    format: 'HH:mm',
  },
  {
    duration: HOUR,
    step: 1,
    floor: (d) => new Date(Math.floor(d.getTime() / HOUR) * HOUR),
    offset: (d, n) => new Date(d.getTime() + n * HOUR),
    format: 'HH:mm',
  },
  {
    duration: HOUR,
    step: 3,
    floor: (d) => new Date(Math.floor(d.getTime() / (3 * HOUR)) * 3 * HOUR),
    offset: (d, n) => new Date(d.getTime() + n * 3 * HOUR),
    format: 'HH:mm',
  },
  {
    duration: HOUR,
    step: 6,
    floor: (d) => new Date(Math.floor(d.getTime() / (6 * HOUR)) * 6 * HOUR),
    offset: (d, n) => new Date(d.getTime() + n * 6 * HOUR),
    format: 'HH:mm',
  },
  {
    duration: HOUR,
    step: 12,
    floor: (d) => new Date(Math.floor(d.getTime() / (12 * HOUR)) * 12 * HOUR),
    offset: (d, n) => new Date(d.getTime() + n * 12 * HOUR),
    format: 'MMM d HH:mm',
  },
  {
    duration: DAY,
    step: 1,
    floor: (d) => {
      const result = new Date(d);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setDate(result.getDate() + n);
      return result;
    },
    format: 'MMM d',
  },
  {
    duration: WEEK,
    step: 1,
    floor: (d) => {
      const result = new Date(d);
      result.setHours(0, 0, 0, 0);
      result.setDate(result.getDate() - result.getDay());
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setDate(result.getDate() + n * 7);
      return result;
    },
    format: 'MMM d',
  },
  {
    duration: MONTH,
    step: 1,
    floor: (d) => {
      const result = new Date(d);
      result.setDate(1);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setMonth(result.getMonth() + n);
      return result;
    },
    format: 'MMM yyyy',
  },
  {
    duration: MONTH,
    step: 3,
    floor: (d) => {
      const result = new Date(d);
      result.setMonth(Math.floor(result.getMonth() / 3) * 3);
      result.setDate(1);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setMonth(result.getMonth() + n * 3);
      return result;
    },
    format: 'MMM yyyy',
  },
  {
    duration: YEAR,
    step: 1,
    floor: (d) => {
      const result = new Date(d);
      result.setMonth(0, 1);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setFullYear(result.getFullYear() + n);
      return result;
    },
    format: 'yyyy',
  },
  {
    duration: YEAR,
    step: 5,
    floor: (d) => {
      const result = new Date(d);
      result.setFullYear(Math.floor(result.getFullYear() / 5) * 5);
      result.setMonth(0, 1);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setFullYear(result.getFullYear() + n * 5);
      return result;
    },
    format: 'yyyy',
  },
  {
    duration: YEAR,
    step: 10,
    floor: (d) => {
      const result = new Date(d);
      result.setFullYear(Math.floor(result.getFullYear() / 10) * 10);
      result.setMonth(0, 1);
      result.setHours(0, 0, 0, 0);
      return result;
    },
    offset: (d, n) => {
      const result = new Date(d);
      result.setFullYear(result.getFullYear() + n * 10);
      return result;
    },
    format: 'yyyy',
  },
];

/**
 * Internal state for a time scale
 */
interface TimeScaleState {
  domain: [Date, Date];
  range: [number, number];
  clamp: boolean;
}

/**
 * Create a time scale
 *
 * @example
 * const x = scaleTime()
 *   .domain([new Date(2020, 0, 1), new Date(2020, 11, 31)])
 *   .range([0, 800]);
 * x(new Date(2020, 6, 1)); // => ~400
 */
export function scaleTime(): TimeScale {
  const now = new Date();
  const state: TimeScaleState = {
    domain: [now, new Date(now.getTime() + DAY)],
    range: [0, 1],
    clamp: false,
  };

  // The scale function
  function scale(value: Date): number {
    const [d0, d1] = state.domain;
    const [r0, r1] = state.range;

    const t0 = d0.getTime();
    const t1 = d1.getTime();
    const tv = value.getTime();

    // Handle degenerate case
    if (t0 === t1) {
      return (r0 + r1) / 2;
    }

    // Linear interpolation
    const t = (tv - t0) / (t1 - t0);
    let result = r0 + t * (r1 - r0);

    if (state.clamp) {
      const min = Math.min(r0, r1);
      const max = Math.max(r0, r1);
      result = Math.max(min, Math.min(max, result));
    }

    return result;
  }

  // Domain getter/setter
  scale.domain = function (values?: Date[]): Date[] | typeof scale {
    if (values === undefined) {
      return [new Date(state.domain[0]), new Date(state.domain[1])];
    }
    state.domain = [new Date(values[0]), new Date(values[values.length - 1])];
    return scale;
  } as TimeScale['domain'];

  // Range getter/setter
  scale.range = function (values?: number[]): number[] | typeof scale {
    if (values === undefined) {
      return [...state.range];
    }
    state.range = [+values[0], +values[values.length - 1]];
    return scale;
  } as TimeScale['range'];

  // Invert: range value to Date
  scale.invert = function (value: number): Date {
    const [d0, d1] = state.domain;
    const [r0, r1] = state.range;

    // Handle degenerate case
    if (r0 === r1) {
      return new Date((d0.getTime() + d1.getTime()) / 2);
    }

    const t0 = d0.getTime();
    const t1 = d1.getTime();

    // Inverse linear interpolation
    const t = (value - r0) / (r1 - r0);
    let result = t0 + t * (t1 - t0);

    if (state.clamp) {
      const min = Math.min(t0, t1);
      const max = Math.max(t0, t1);
      result = Math.max(min, Math.min(max, result));
    }

    return new Date(result);
  };

  // Clamp getter/setter
  scale.clamp = function (clamp?: boolean): boolean | typeof scale {
    if (clamp === undefined) {
      return state.clamp;
    }
    state.clamp = !!clamp;
    return scale;
  } as TimeScale['clamp'];

  // Generate tick values as Date objects
  scale.ticks = function (count: number = 10): Date[] {
    const [d0, d1] = state.domain;
    const t0 = d0.getTime();
    const t1 = d1.getTime();

    const span = Math.abs(t1 - t0);
    if (span === 0) {
      return [new Date(t0)];
    }

    // Find the best time interval
    const targetStep = span / count;
    let bestInterval = timeIntervals[0];
    for (const interval of timeIntervals) {
      const effectiveDuration = interval.duration * interval.step;
      if (effectiveDuration <= targetStep) {
        bestInterval = interval;
      } else {
        break;
      }
    }

    // Generate ticks using the interval
    const ticks: Date[] = [];
    const start = new Date(Math.min(t0, t1));
    const end = new Date(Math.max(t0, t1));

    let current = bestInterval.floor(start);

    // Make sure we start at or before the domain start
    while (current.getTime() > start.getTime()) {
      current = bestInterval.offset(current, -1);
    }

    // Generate ticks
    while (current.getTime() <= end.getTime()) {
      if (current.getTime() >= start.getTime()) {
        ticks.push(new Date(current));
      }
      current = bestInterval.offset(current, 1);

      // Safety limit
      if (ticks.length > count * 2) break;
    }

    return ticks;
  };

  // Get tick formatter
  scale.tickFormat = function (_count: number = 10, specifier?: string): (d: Date) => string {
    if (specifier) {
      return (d: Date) => formatDate(d, specifier);
    }

    // Auto-detect appropriate format based on domain span
    const [d0, d1] = state.domain;
    const span = Math.abs(d1.getTime() - d0.getTime());

    if (span < MINUTE) {
      return (d) => formatDate(d, 'HH:mm:ss');
    } else if (span < HOUR) {
      return (d) => formatDate(d, 'HH:mm');
    } else if (span < DAY) {
      return (d) => formatDate(d, 'HH:mm');
    } else if (span < MONTH) {
      return (d) => formatDate(d, 'MMM d');
    } else if (span < YEAR) {
      return (d) => formatDate(d, 'MMM d');
    } else {
      return (d) => formatDate(d, 'MMM yyyy');
    }
  };

  // Extend domain to nice time boundaries
  scale.nice = function (count: number = 10): TimeScale {
    const [d0, d1] = state.domain;
    const t0 = d0.getTime();
    const t1 = d1.getTime();

    const span = Math.abs(t1 - t0);
    const targetStep = span / count;

    // Find the best interval for nice boundaries
    let bestInterval = timeIntervals[0];
    for (const interval of timeIntervals) {
      const effectiveDuration = interval.duration * interval.step;
      if (effectiveDuration <= targetStep * 1.5) {
        bestInterval = interval;
      }
    }

    // Floor the start, ceil the end
    const niceStart = bestInterval.floor(new Date(Math.min(t0, t1)));
    let niceEnd = bestInterval.floor(new Date(Math.max(t0, t1)));

    // Make sure end is extended to include the original end
    if (niceEnd.getTime() < Math.max(t0, t1)) {
      niceEnd = bestInterval.offset(niceEnd, 1);
    }

    if (t0 < t1) {
      state.domain = [niceStart, niceEnd];
    } else {
      state.domain = [niceEnd, niceStart];
    }

    return scale;
  };

  // Copy the scale
  scale.copy = function (): TimeScale {
    return scaleTime()
      .domain([...state.domain])
      .range([...state.range])
      .clamp(state.clamp);
  };

  return scale as TimeScale;
}

/**
 * Simple date formatter
 * Supports: yyyy, MMM, MM, dd, d, HH, mm, ss
 * Note: Order matters - MMM must be replaced before MM, dd before d
 */
export function formatDate(date: Date, format: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const pad = (n: number): string => String(n).padStart(2, '0');

  // Order matters: longer patterns first to avoid partial matches
  return format
    .replace('yyyy', String(date.getFullYear()))
    .replace('MMM', months[date.getMonth()])
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()))
    .replace(/\bd\b/g, String(date.getDate())) // word boundary to avoid matching 'd' in other tokens
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()));
}
