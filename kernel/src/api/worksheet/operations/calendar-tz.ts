/**
 * Calendar-parts resolver for the date-entry pipeline.
 *
 * The single place in the kernel where a JS `Date` instant is decomposed into
 * year/month/day/hour/minute/second components. The frame of reference is
 * always an explicit IANA timezone — never the host process's local time.
 *
 * Used by `setDateValue(Date)`, `setTimeValue(Date)`, `setCell(Date)` and
 * `setCells({value: Date})` to honor the session's `userTimezone`.
 *
 */

import { KernelError } from '../../../errors';

export interface CalendarParts {
  year: number;
  /** 1-12 (note: Excel-friendly, NOT zero-indexed like Date.prototype.getMonth) */
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMATTER_CACHE.get(tz);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch (cause) {
      throw new KernelError(
        'CONFIG_INVALID_USER_TIMEZONE',
        `"${tz}" is not a valid IANA timezone name.`,
        { cause, context: { tz } },
      );
    }
    PARTS_FORMATTER_CACHE.set(tz, fmt);
  }
  return fmt;
}

/**
 * Parse a strict `YYYY-MM-DD` ISO calendar string into year/month/day parts.
 *
 * The string represents a calendar date, not a Date instant. No timezone
 * conversion happens — the parts ARE the value. Rejects anything that isn't
 * exactly four-two-two digits separated by hyphens, with a calendar-valid day.
 *
 * @throws `API_INVALID_ARGUMENT` if `iso` is not a strict YYYY-MM-DD value.
 */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `Expected ISO date "YYYY-MM-DD"; got ${JSON.stringify(iso)}.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      `ISO date ${JSON.stringify(iso)} is not a valid calendar date.`,
    );
  }
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  // month is 1-12 here.
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Decompose a `Date` instant into calendar parts in the given IANA timezone.
 *
 * @param date  the Date instant to decompose.
 * @param tz    IANA timezone name (e.g. `'America/Los_Angeles'`, `'UTC'`).
 * @throws `CONFIG_INVALID_USER_TIMEZONE` if `tz` is not a valid IANA name.
 * @throws `API_INVALID_ARGUMENT` if `date` is not a finite Date.
 */
export function calendarPartsInTz(date: Date, tz: string): CalendarParts {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new KernelError(
      'API_INVALID_ARGUMENT',
      'calendarPartsInTz requires a finite Date instance.',
    );
  }

  const parts = getFormatter(tz).formatToParts(date);
  let year = NaN,
    month = NaN,
    day = NaN,
    hours = 0,
    minutes = 0,
    seconds = 0;

  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        // Intl in en-US returns "24" at midnight under hour12:false; normalize to 0.
        hours = Number(part.value) % 24;
        break;
      case 'minute':
        minutes = Number(part.value);
        break;
      case 'second':
        seconds = Number(part.value);
        break;
    }
  }

  return { year, month, day, hours, minutes, seconds };
}
