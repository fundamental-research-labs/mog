import { KernelError } from '../../errors';
import { resolveCell } from '../internal/address-resolver';
import { calendarPartsInTz, parseIsoDate } from './operations/calendar-tz';

export type DateWriteParts = {
  row: number;
  col: number;
  year: number;
  month: number;
  day: number;
};

export type TimeWriteParts = {
  row: number;
  col: number;
  hours: number;
  minutes: number;
  seconds: number;
};

/**
 * Decode the overloaded `setDateValue` argument list into a normalized
 * `{ row, col, year, month, day }` shape. Routes any `Date` instant through
 * `calendarPartsInTz` against the explicit `tz` option (when provided) or
 * the session's `userTimezone` — never host-local.
 */
export function resolveDateWriteArgs(
  userTimezone: string,
  a: string | number,
  b: string | number | Date,
  c?: number | Date | string | { tz?: string },
  d?: number | { tz?: string },
  e?: number,
): DateWriteParts {
  // Resolve row/col from the first 1-2 args; track how many positional slots
  // were consumed so the remaining args can be interpreted unambiguously.
  let row: number, col: number;
  let rest: [unknown, unknown, unknown, unknown];
  if (typeof a === 'string') {
    const pos = resolveCell(a);
    row = pos.row;
    col = pos.col;
    rest = [b, c, d, e];
  } else {
    row = a;
    col = b as number;
    rest = [c, d, e, undefined];
  }

  const [r0, r1, r2] = rest;

  // Form 1: parts (year, month, day)
  if (typeof r0 === 'number' && typeof r1 === 'number' && typeof r2 === 'number') {
    return { row, col, year: r0, month: r1, day: r2 };
  }

  // Form 2: ISO calendar string
  if (typeof r0 === 'string') {
    return { row, col, ...parseIsoDate(r0) };
  }

  // Form 3/4: Date instant (with optional { tz })
  if (r0 instanceof Date) {
    const opts = r1 as { tz?: string } | undefined;
    const tz = opts?.tz ?? userTimezone;
    const parts = calendarPartsInTz(r0, tz);
    return { row, col, year: parts.year, month: parts.month, day: parts.day };
  }

  throw new KernelError(
    'API_INVALID_ARGUMENT',
    'setDateValue: pass parts (year, month, day), an ISO date string ("YYYY-MM-DD"), or a Date instance.',
  );
}

/**
 * Decode the overloaded `setTimeValue` argument list. Mirrors
 * `resolveDateWriteArgs` for hours/minutes/seconds.
 */
export function resolveTimeWriteArgs(
  userTimezone: string,
  a: string | number,
  b: number | Date,
  c?: number | Date | { tz?: string },
  d?: number | { tz?: string },
  e?: number,
): TimeWriteParts {
  let row: number, col: number;
  let rest: [unknown, unknown, unknown, unknown];
  if (typeof a === 'string') {
    const pos = resolveCell(a);
    row = pos.row;
    col = pos.col;
    rest = [b, c, d, e];
  } else {
    row = a;
    col = b as number;
    rest = [c, d, e, undefined];
  }

  const [r0, r1, r2] = rest;

  // Parts: hours, minutes, seconds
  if (typeof r0 === 'number' && typeof r1 === 'number' && typeof r2 === 'number') {
    return { row, col, hours: r0, minutes: r1, seconds: r2 };
  }

  // Date instant
  if (r0 instanceof Date) {
    const opts = r1 as { tz?: string } | undefined;
    const tz = opts?.tz ?? userTimezone;
    const parts = calendarPartsInTz(r0, tz);
    return {
      row,
      col,
      hours: parts.hours,
      minutes: parts.minutes,
      seconds: parts.seconds,
    };
  }

  throw new KernelError(
    'API_INVALID_ARGUMENT',
    'setTimeValue: pass parts (hours, minutes, seconds) or a Date instance.',
  );
}
