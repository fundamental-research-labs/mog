/**
 * Excel date serial number utilities
 *
 * Excel stores dates as serial numbers (days since a base date).
 * - Windows Excel: Days since January 1, 1900 (with a bug for 1900 leap year)
 * - Mac Excel (pre-2011): Days since January 1, 1904
 *
 * We use the Windows 1900 system for compatibility.
 *
 * Stream G: Culture & Localization
 * - formatDateSerial now accepts optional CultureInfo for localized month/day names
 */

import type { CultureInfo } from '@mog-sdk/contracts/culture';

// ============================================================================
// Constants
// ============================================================================

/**
 * Excel's epoch: January 1, 1900 (but Excel incorrectly treats 1900 as a leap year)
 * The actual epoch in JavaScript terms is December 31, 1899
 * because Excel serial 1 = January 1, 1900
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 31); // December 31, 1899

/**
 * Milliseconds per day
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Excel incorrectly treats February 29, 1900 as a valid date (serial 60).
 * This is a known bug from Lotus 1-2-3 compatibility.
 * Serial numbers 60 and below need adjustment.
 */
const LEAP_YEAR_BUG_CUTOFF = 60;

export type ExcelDateSystem = 'excel1900';

export interface ParsedExcelSerialDate {
  isoDate: string;
  year: number;
  month: number;
  day: number;
}

export interface SafeExcelDateSerialSemantics {
  rawSerial: number;
  displayValue: string;
  parsedDate: ParsedExcelSerialDate | null;
  dateSystem: ExcelDateSystem;
  conversionHelper: {
    kind: 'excelSerialDate';
    dateSystem: ExcelDateSystem;
    lotus1900LeapYearBug: true;
    serial60IsFakeLeapDay: boolean;
    unambiguous: boolean;
  };
}

/**
 * Day names for date formatting (en-US defaults).
 * @deprecated Use CultureInfo.dayNames / CultureInfo.abbreviatedDayNames instead.
 * Kept for backward compatibility when no culture is provided.
 */
export const DAY_NAMES = {
  short: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const,
  full: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const,
};

/**
 * Month names for date formatting (en-US defaults).
 * @deprecated Use CultureInfo.monthNames / CultureInfo.abbreviatedMonthNames instead.
 * Kept for backward compatibility when no culture is provided.
 */
export const MONTH_NAMES = {
  short: [
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
  ] as const,
  full: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ] as const,
};

// ============================================================================
// Culture-aware name helpers
// ============================================================================

/**
 * Get the full month name for a given month (0-11 indexed).
 *
 * @param monthIndex - Month index (0 = January)
 * @param culture - Optional CultureInfo for localization
 * @returns Full month name (e.g., "January" or "Januar")
 */
export function getMonthName(monthIndex: number, culture?: CultureInfo): string {
  if (culture) {
    return culture.monthNames[monthIndex];
  }
  return MONTH_NAMES.full[monthIndex];
}

/**
 * Get the abbreviated month name for a given month (0-11 indexed).
 *
 * @param monthIndex - Month index (0 = January)
 * @param culture - Optional CultureInfo for localization
 * @returns Abbreviated month name (e.g., "Jan" or "Jan")
 */
export function getAbbreviatedMonthName(monthIndex: number, culture?: CultureInfo): string {
  if (culture) {
    return culture.abbreviatedMonthNames[monthIndex];
  }
  return MONTH_NAMES.short[monthIndex];
}

/**
 * Get the first letter of the month name (for mmmmm format).
 *
 * @param monthIndex - Month index (0 = January)
 * @param culture - Optional CultureInfo for localization
 * @returns First letter of month name (e.g., "J" for January)
 */
export function getMonthFirstLetter(monthIndex: number, culture?: CultureInfo): string {
  const name = culture ? culture.monthNames[monthIndex] : MONTH_NAMES.full[monthIndex];
  return name[0];
}

/**
 * Get the full day name for a given day of week (0-6 indexed).
 *
 * @param dayOfWeek - Day of week (0 = Sunday)
 * @param culture - Optional CultureInfo for localization
 * @returns Full day name (e.g., "Sunday" or "Sonntag")
 */
export function getDayName(dayOfWeek: number, culture?: CultureInfo): string {
  if (culture) {
    return culture.dayNames[dayOfWeek];
  }
  return DAY_NAMES.full[dayOfWeek];
}

/**
 * Get the abbreviated day name for a given day of week (0-6 indexed).
 *
 * @param dayOfWeek - Day of week (0 = Sunday)
 * @param culture - Optional CultureInfo for localization
 * @returns Abbreviated day name (e.g., "Sun" or "So")
 */
export function getAbbreviatedDayName(dayOfWeek: number, culture?: CultureInfo): string {
  if (culture) {
    return culture.abbreviatedDayNames[dayOfWeek];
  }
  return DAY_NAMES.short[dayOfWeek];
}

/**
 * Get the AM/PM designator based on hour.
 *
 * @param hours - Hour (0-23)
 * @param culture - Optional CultureInfo for localization
 * @returns AM/PM designator (e.g., "AM" or "午前")
 */
export function getAmPmDesignator(hours: number, culture?: CultureInfo): string {
  if (culture) {
    return hours >= 12 ? culture.pmDesignator : culture.amDesignator;
  }
  return hours >= 12 ? 'PM' : 'AM';
}

// ============================================================================
// Serial to Date Conversion
// ============================================================================

/**
 * Convert an Excel serial number to a JavaScript Date object (UTC)
 *
 * @param serial - Excel serial number (days since 1900-01-01, with 1900 leap year bug)
 * @returns JavaScript Date object in UTC
 *
 * @example
 * serialToDate(1) // January 1, 1900
 * serialToDate(44561) // December 31, 2021
 * serialToDate(45639) // December 13, 2025
 */
export function serialToDate(serial: number): Date {
  if (typeof serial !== 'number' || !isFinite(serial)) {
    return new Date(NaN);
  }

  // Handle the 1900 leap year bug
  // Excel thinks Feb 29, 1900 exists (serial 60), but it doesn't
  // For serials > 60, subtract 1 day to correct
  let adjustedSerial = serial;
  if (serial > LEAP_YEAR_BUG_CUTOFF) {
    adjustedSerial = serial - 1;
  }

  // Convert to milliseconds and add to epoch
  const ms = EXCEL_EPOCH_MS + adjustedSerial * MS_PER_DAY;
  return new Date(ms);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Build a readback-safe Excel date serial contract without coercing serial 60
 * into a JavaScript Date. Excel's 1900 date system reserves serial 60 for the
 * Lotus-compatible fake 1900-02-29, so callers must treat that serial as
 * ambiguous instead of round-tripping it through JS Date math.
 */
export function safeExcelDateSerialSemantics(
  serial: number,
  displayValue: string,
): SafeExcelDateSerialSemantics {
  const dateSerial = Math.floor(serial);
  const serial60IsFakeLeapDay = dateSerial === LEAP_YEAR_BUG_CUTOFF;
  const unambiguous = Number.isFinite(serial) && !serial60IsFakeLeapDay;

  let parsedDate: ParsedExcelSerialDate | null = null;
  if (unambiguous) {
    const adjustedSerial = dateSerial > LEAP_YEAR_BUG_CUTOFF ? dateSerial - 1 : dateSerial;
    const date = new Date(EXCEL_EPOCH_MS + adjustedSerial * MS_PER_DAY);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    parsedDate = {
      isoDate: `${year}-${pad2(month)}-${pad2(day)}`,
      year,
      month,
      day,
    };
  }

  return {
    rawSerial: serial,
    displayValue,
    parsedDate,
    dateSystem: 'excel1900',
    conversionHelper: {
      kind: 'excelSerialDate',
      dateSystem: 'excel1900',
      lotus1900LeapYearBug: true,
      serial60IsFakeLeapDay,
      unambiguous,
    },
  };
}

/**
 * Convert a JavaScript Date object to an Excel serial number
 *
 * @param date - JavaScript Date object
 * @returns Excel serial number
 *
 * @example
 * dateToSerial(new Date(1900, 0, 1)) // 1
 * dateToSerial(new Date(2025, 11, 13)) // 45639
 */
export function dateToSerial(date: Date): number {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return NaN;
  }

  // Get UTC timestamp
  const ms = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  // Convert to days since epoch
  let serial = (ms - EXCEL_EPOCH_MS) / MS_PER_DAY;

  // Adjust for the 1900 leap year bug
  if (serial > LEAP_YEAR_BUG_CUTOFF - 1) {
    serial = serial + 1;
  }

  return Math.round(serial);
}

// ============================================================================
// Time Handling
// ============================================================================

/**
 * Extract the time portion from an Excel serial number
 *
 * Excel stores time as a fractional part of the serial number.
 * 0.5 = noon, 0.25 = 6 AM, 0.75 = 6 PM
 *
 * @param serial - Excel serial number (may include fractional time)
 * @returns Object with hours, minutes, seconds, and milliseconds
 */
export function serialToTime(serial: number): {
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
} {
  if (typeof serial !== 'number' || !isFinite(serial)) {
    return { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 };
  }

  // Get fractional part (time of day)
  const fraction = serial - Math.floor(serial);

  // Convert to time components
  const totalSeconds = fraction * 24 * 60 * 60;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);

  return { hours, minutes, seconds, milliseconds };
}

/**
 * Convert time components to an Excel time fraction
 *
 * @param hours - Hours (0-23)
 * @param minutes - Minutes (0-59)
 * @param seconds - Seconds (0-59)
 * @returns Fractional Excel time value
 */
export function timeToSerial(hours: number, minutes: number, seconds: number = 0): number {
  return (hours * 3600 + minutes * 60 + seconds) / (24 * 60 * 60);
}

/**
 * Combine a date serial and time fraction into a full date-time serial
 */
export function combineDateTimeSerial(dateSerial: number, timeFraction: number): number {
  return Math.floor(dateSerial) + timeFraction;
}

// ============================================================================
// Date Component Extraction
// ============================================================================

/**
 * Extract date components from an Excel serial number
 *
 * @param serial - Excel serial number
 * @returns Object with year, month (1-12), day, day of week (0-6)
 */
export function getDateComponents(serial: number): {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const date = serialToDate(serial);
  const time = serialToTime(serial);

  if (isNaN(date.getTime())) {
    return { year: 0, month: 0, day: 0, dayOfWeek: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1, // 1-indexed
    day: date.getUTCDate(),
    dayOfWeek: date.getUTCDay(),
    ...time,
  };
}

// ============================================================================
// Date Formatting
// ============================================================================

/**
 * Format an Excel date serial using a date format code
 *
 * Supported tokens:
 * - y, yy, yyyy: Year (2-digit or 4-digit)
 * - m, mm: Month (1-12, 01-12)
 * - mmm, mmmm: Month name (short, full) - localized if culture provided
 * - d, dd: Day (1-31, 01-31)
 * - ddd, dddd: Day name (short, full) - localized if culture provided
 * - h, hh: Hour 12-hour (1-12, 01-12)
 * - H, HH: Hour 24-hour (0-23, 00-23)
 * - m, mm: Minute (0-59, 00-59) - when following h/H
 * - s, ss: Second (0-59, 00-59)
 * - AM/PM, am/pm, A/P: AM/PM indicator - localized if culture provided
 *
 * @param serial - Excel serial number
 * @param formatCode - Date/time format code
 * @param culture - Optional CultureInfo for localized month/day names (Stream G)
 * @returns Formatted date string
 */
export function formatDateSerial(
  serial: number,
  formatCode: string,
  culture?: CultureInfo,
): string {
  if (typeof serial !== 'number' || !isFinite(serial)) {
    return '';
  }

  const components = getDateComponents(serial);
  if (components.year === 0) {
    return '';
  }

  // Get time components with milliseconds for fractional seconds
  const timeComponents = serialToTime(serial);

  // Tokenize the format string to handle replacements safely
  // This prevents 'm' in 'AM/PM' from being replaced
  const tokens: Array<{ type: 'token' | 'literal'; value: string }> = [];
  let remaining = formatCode;

  const is12Hour = /AM\/PM|am\/pm|A\/P|a\/p/i.test(formatCode);
  const hour24 = components.hours;
  const hour12 = components.hours % 12 || 12;
  // Use culture-aware AM/PM designator
  const ampm = getAmPmDesignator(components.hours, culture);

  // Determine if mm should always be minutes (time-only format without h)
  // In Excel, if format has no h/H but has s/ss, mm means minutes
  const hasHour = /[hH]/.test(formatCode);
  const hasSeconds = /[sS]/.test(formatCode);
  const hasDateTokens = /[yYdD]/.test(formatCode);
  const isTimeOnlyWithoutHour = !hasHour && hasSeconds && !hasDateTokens;

  // Track if we've seen an hour token (for m = minute disambiguation)
  let afterHour = isTimeOnlyWithoutHour; // Start as true for time-only formats without h

  while (remaining.length > 0) {
    let matched = false;

    // Handle quoted strings first - "text" means literal text
    if (remaining[0] === '"') {
      let i = 1;
      let quotedText = '';
      while (i < remaining.length && remaining[i] !== '"') {
        quotedText += remaining[i];
        i++;
      }
      tokens.push({ type: 'literal', value: quotedText });
      remaining = remaining.slice(i + 1); // Skip past closing quote
      continue;
    }

    // Try to match tokens in order of priority (longest first)
    const patterns: Array<{
      regex: RegExp;
      type: 'token' | 'literal';
      getValue: (match: RegExpMatchArray) => string;
      isHour?: boolean;
      isMinute?: boolean;
      isSecond?: boolean;
    }> = [
      // AM/PM markers (must come first to prevent 'm' replacement)
      { regex: /^AM\/PM/i, type: 'literal', getValue: () => ampm },
      { regex: /^A\/P/i, type: 'literal', getValue: () => ampm[0] },

      // Year
      { regex: /^yyyy/i, type: 'token', getValue: () => components.year.toString() },
      {
        regex: /^yy/i,
        type: 'token',
        getValue: () => (components.year % 100).toString().padStart(2, '0'),
      },

      // Month names - mmmmm MUST come before mmmm (longest first)
      // Use culture-aware helpers for localized month names
      {
        regex: /^mmmmm/i,
        type: 'token',
        getValue: () => getMonthFirstLetter(components.month - 1, culture),
      },
      {
        regex: /^mmmm/i,
        type: 'token',
        getValue: () => getMonthName(components.month - 1, culture),
      },
      {
        regex: /^mmm/i,
        type: 'token',
        getValue: () => getAbbreviatedMonthName(components.month - 1, culture),
      },

      // Day of week - use culture-aware helpers for localized day names
      {
        regex: /^dddd/i,
        type: 'token',
        getValue: () => getDayName(components.dayOfWeek, culture),
      },
      {
        regex: /^ddd/i,
        type: 'token',
        getValue: () => getAbbreviatedDayName(components.dayOfWeek, culture),
      },

      // Day
      { regex: /^dd/i, type: 'token', getValue: () => components.day.toString().padStart(2, '0') },
      { regex: /^d/i, type: 'token', getValue: () => components.day.toString() },

      // Hours (24-hour)
      {
        regex: /^HH/,
        type: 'token',
        getValue: () => hour24.toString().padStart(2, '0'),
        isHour: true,
      },
      { regex: /^H/, type: 'token', getValue: () => hour24.toString(), isHour: true },

      // Hours (12-hour)
      {
        regex: /^hh/,
        type: 'token',
        getValue: () => (is12Hour ? hour12 : hour24).toString().padStart(2, '0'),
        isHour: true,
      },
      {
        regex: /^h/,
        type: 'token',
        getValue: () => (is12Hour ? hour12 : hour24).toString(),
        isHour: true,
      },

      // Minutes/Months (mm) - context dependent
      {
        regex: /^mm/i,
        type: 'token',
        getValue: () =>
          afterHour
            ? components.minutes.toString().padStart(2, '0')
            : components.month.toString().padStart(2, '0'),
        isMinute: afterHour,
      },
      {
        regex: /^m/i,
        type: 'token',
        getValue: () => (afterHour ? components.minutes.toString() : components.month.toString()),
        isMinute: afterHour,
      },

      // Seconds with fractional part (must come before plain ss)
      {
        regex: /^ss\.0+/i,
        type: 'token',
        getValue: (match) => {
          const fracDigits = match[0].length - 3; // Length minus "ss."
          const seconds = components.seconds;
          const ms = timeComponents.milliseconds;
          // Convert ms to fractional part
          const frac = Math.floor(ms / Math.pow(10, 3 - fracDigits));
          return (
            seconds.toString().padStart(2, '0') + '.' + frac.toString().padStart(fracDigits, '0')
          );
        },
        isSecond: true,
      },
      {
        regex: /^s\.0+/i,
        type: 'token',
        getValue: (match) => {
          const fracDigits = match[0].length - 2; // Length minus "s."
          const seconds = components.seconds;
          const ms = timeComponents.milliseconds;
          const frac = Math.floor(ms / Math.pow(10, 3 - fracDigits));
          return seconds.toString() + '.' + frac.toString().padStart(fracDigits, '0');
        },
        isSecond: true,
      },

      // Seconds (plain)
      {
        regex: /^ss/i,
        type: 'token',
        getValue: () => components.seconds.toString().padStart(2, '0'),
        isSecond: true,
      },
      {
        regex: /^s/i,
        type: 'token',
        getValue: () => components.seconds.toString(),
        isSecond: true,
      },
    ];

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        tokens.push({ type: 'literal', value: pattern.getValue(match) });
        remaining = remaining.slice(match[0].length);
        matched = true;

        // Update hour tracking
        if (pattern.isHour) {
          afterHour = true;
        } else if (pattern.isMinute) {
          // After processing minutes, reset for subsequent month tokens
          // (unless we're in a time-only format)
          if (!isTimeOnlyWithoutHour) {
            afterHour = false;
          }
        }
        break;
      }
    }

    // If no token matched, take the next character as literal
    if (!matched) {
      // Handle backslash escape sequences: \X means X is a literal character
      if (remaining[0] === '\\' && remaining.length > 1) {
        tokens.push({ type: 'literal', value: remaining[1] });
        remaining = remaining.slice(2);
      } else {
        tokens.push({ type: 'literal', value: remaining[0] });
        remaining = remaining.slice(1);
      }
      // Reset hour tracking for non-time-related characters except : and space
      // But not for time-only formats
      if (!isTimeOnlyWithoutHour && !/[:\s]/.test(tokens[tokens.length - 1].value)) {
        afterHour = false;
      }
    }
  }

  return tokens.map((t) => t.value).join('');
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Check if a format code is a date format
 *
 * @param formatCode - Format code to check
 * @returns True if the format contains date/time tokens
 */
export function isDateFormat(formatCode: string): boolean {
  if (!formatCode || formatCode === 'General' || formatCode === '@') {
    return false;
  }

  // Remove escaped characters (both \x and "quoted") and color/condition brackets
  let cleaned = formatCode;
  // Remove escaped characters like \d, \m
  cleaned = cleaned.replace(/\\[a-zA-Z]/g, '');
  // Remove quoted strings
  cleaned = cleaned.replace(/"[^"]*"/g, '');
  // Remove bracketed expressions like [Red], [>100]
  cleaned = cleaned.replace(/\[[^\]]*\]/g, '');

  // Check for date/time tokens (case insensitive)
  // Look for y (year), d (day), h (hour), s (second)
  // m is tricky - could be month or minute, but presence of any m with y/d or h/s indicates date/time
  if (/[yY]/.test(cleaned)) return true; // Has year
  if (/[dD]/.test(cleaned)) return true; // Has day
  if (/[hH]/.test(cleaned)) return true; // Has hour
  if (/AM\/PM|am\/pm|A\/P/i.test(cleaned)) return true; // Has AM/PM marker

  // Check for standalone s (seconds) - but not in context of #,##0 or similar
  // Look for s that's not preceded by # or 0
  if (/(?<![#0])s/i.test(cleaned)) return true;

  return false;
}

/**
 * Check if a format code is a time-only format (no date components)
 *
 * @param formatCode - Format code to check
 * @returns True if the format only contains time tokens
 */
export function isTimeOnlyFormat(formatCode: string): boolean {
  if (!formatCode) return false;

  // Remove escaped characters and quoted strings
  const cleaned = formatCode.replace(/\\./g, '').replace(/"[^"]*"/g, '');

  // Has time tokens
  const hasTime = /[hHsS]|AM\/PM|am\/pm|A\/P/i.test(cleaned);
  // Has date tokens (y or d, and m not adjacent to h/s)
  const hasDate = /[yYdD]/i.test(cleaned);

  return hasTime && !hasDate;
}

/**
 * Check if a value looks like an Excel date serial number
 *
 * Excel dates for reasonable modern dates are roughly:
 * - 1900-01-01 = 1
 * - 2000-01-01 = 36526
 * - 2100-01-01 = 73051
 *
 * @param value - Value to check
 * @returns True if the value is likely a date serial
 */
export function isLikelyDateSerial(value: unknown): boolean {
  if (typeof value !== 'number' || !isFinite(value)) {
    return false;
  }

  // Reasonable range: 1900 to 2200 (roughly)
  // Serial 1 = Jan 1, 1900
  // Serial 109574 = Dec 31, 2199
  return value >= 1 && value <= 110000;
}

// ============================================================================
// Elapsed Time Formatting
// ============================================================================

/**
 * Format a serial number as elapsed time (duration)
 *
 * Supports formats like [h]:mm:ss, [m]:ss, [s] where bracketed tokens can exceed their normal range
 *
 * @param serial - Time value as fractional days
 * @param formatCode - Format code with bracketed hours/minutes/seconds
 * @returns Formatted duration string
 */
export function formatElapsedTime(serial: number, formatCode: string): string {
  if (typeof serial !== 'number' || !isFinite(serial)) {
    return '';
  }

  const totalSeconds = serial * 24 * 60 * 60;

  // Check for elapsed time format markers
  const hasElapsedHours = /\[h+\]/i.test(formatCode);
  const hasElapsedMinutes = /\[m+\]/i.test(formatCode);
  const hasElapsedSeconds = /\[s+\]/i.test(formatCode);

  let result = formatCode;

  if (hasElapsedHours) {
    const totalHours = Math.floor(totalSeconds / 3600);
    const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = Math.floor(totalSeconds % 60);

    result = result.replace(/\[h+\]/gi, totalHours.toString());
    result = result.replace(/mm/gi, remainingMinutes.toString().padStart(2, '0'));
    result = result.replace(/m/gi, remainingMinutes.toString());
    result = result.replace(/ss/gi, remainingSeconds.toString().padStart(2, '0'));
    result = result.replace(/s/gi, remainingSeconds.toString());
  } else if (hasElapsedMinutes) {
    const totalMinutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = Math.floor(totalSeconds % 60);

    result = result.replace(/\[m+\]/gi, totalMinutes.toString());
    result = result.replace(/ss/gi, remainingSeconds.toString().padStart(2, '0'));
    result = result.replace(/s/gi, remainingSeconds.toString());
  } else if (hasElapsedSeconds) {
    // [s] or [ss] - total elapsed seconds (can exceed 60)
    const totalSecs = Math.floor(totalSeconds);
    const fractionalPart = totalSeconds - totalSecs;

    // Handle [ss].0 or [s].0 patterns for fractional seconds
    result = result.replace(/\[ss?\]\.0+/gi, (match) => {
      const dotIndex = match.indexOf('.');
      const fracDigits = match.length - dotIndex - 1;
      const frac = Math.floor(fractionalPart * Math.pow(10, fracDigits));
      return totalSecs.toString() + '.' + frac.toString().padStart(fracDigits, '0');
    });

    // Handle plain [ss] or [s]
    result = result.replace(/\[ss\]/gi, totalSecs.toString().padStart(2, '0'));
    result = result.replace(/\[s\]/gi, totalSecs.toString());
  }

  return result;
}
