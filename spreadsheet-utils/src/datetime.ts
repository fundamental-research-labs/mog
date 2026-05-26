/**
 * Date/Time utilities for Excel serial number conversion
 *
 * Excel stores dates as serial numbers:
 * - Integer part = days since 1900-01-01 (serial 1 = 1900-01-01)
 * - Fractional part = time of day (0.5 = noon)
 *
 * CRITICAL: Excel has a bug where it treats 1900 as a leap year (it wasn't).
 * For Lotus 1-2-3 compatibility, serial 60 = 1900-02-29 (doesn't exist!).
 * All dates after Feb 28, 1900 are off by 1 day.
 */

// Excel epoch: 1900-01-01 is serial number 1 (using UTC to avoid timezone issues)
const EXCEL_EPOCH_UTC = Date.UTC(1900, 0, 1);

// The infamous 1900 leap year bug
// Serial 60 = 1900-02-29 (fake date)
const LEAP_YEAR_BUG_SERIAL = 60;

/**
 * Convert Excel serial number to JavaScript Date
 * Handles the 1900 leap year bug correctly
 * Uses UTC to avoid timezone issues
 */
export function serialToDate(serial: number): Date {
  // Handle the fake leap day
  if (serial === LEAP_YEAR_BUG_SERIAL) {
    return new Date(Date.UTC(1900, 1, 29)); // Feb 29, 1900 (doesn't exist!)
  }

  // Adjust for the 1900 bug (all dates after the fake leap day are off by 1)
  let adjustedSerial = serial;
  if (serial > LEAP_YEAR_BUG_SERIAL) {
    adjustedSerial = serial - 1;
  }

  // Calculate milliseconds from Excel epoch
  // Excel serial 1 = 1900-01-01
  const daysFromEpoch = adjustedSerial - 1;
  const millisecondsFromEpoch = daysFromEpoch * 24 * 60 * 60 * 1000;

  return new Date(EXCEL_EPOCH_UTC + millisecondsFromEpoch);
}

/**
 * Convert JavaScript Date to Excel serial number
 * Handles the 1900 leap year bug correctly
 * Uses UTC to avoid timezone issues
 */
export function dateToSerial(date: Date): number {
  // Get year, month, day from date (using UTC methods to avoid timezone issues)
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const millisecond = date.getUTCMilliseconds();

  // Create UTC timestamp for date only
  const dateOnlyUTC = Date.UTC(year, month, day);

  // Calculate days from epoch
  const millisecondsDiff = dateOnlyUTC - EXCEL_EPOCH_UTC;
  const daysDiff = Math.floor(millisecondsDiff / (24 * 60 * 60 * 1000));

  // Excel serial 1 = 1900-01-01
  let serial = daysDiff + 1;

  // Adjust for 1900 bug (dates after Feb 28, 1900 need +1)
  const feb28_1900_UTC = Date.UTC(1900, 1, 28);
  if (dateOnlyUTC > feb28_1900_UTC) {
    serial += 1;
  }

  // Add time fraction
  const totalSeconds = hour * 3600 + minute * 60 + second + millisecond / 1000;
  const timeFraction = totalSeconds / (24 * 60 * 60);

  return serial + timeFraction;
}

/**
 * Extract integer part (date portion) from serial number
 */
export function getDatePart(serial: number): number {
  return Math.floor(serial);
}

/**
 * Extract fractional part (time portion) from serial number
 */
export function getTimePart(serial: number): number {
  return serial - Math.floor(serial);
}

/**
 * Combine date and time serials
 */
export function combineDateTime(datePart: number, timePart: number): number {
  return datePart + timePart;
}

/**
 * Create serial number from date components
 * Handles component overflow (e.g., month 13 = next year)
 */
export function dateComponentsToSerial(year: number, month: number, day: number): number {
  // JavaScript Date handles overflow automatically
  // month is 0-based in JS Date, but Excel uses 1-based
  // Use UTC to avoid timezone issues
  const date = new Date(Date.UTC(year, month - 1, day));
  return dateToSerial(date);
}

/**
 * Create time serial (fractional) from time components
 * Handles overflow (e.g., 25 hours = 1.04166...)
 */
export function timeComponentsToSerial(hour: number, minute: number, second: number): number {
  const totalSeconds = hour * 3600 + minute * 60 + second;
  const secondsPerDay = 24 * 60 * 60;
  return totalSeconds / secondsPerDay;
}

/**
 * Validate that serial number represents a valid Excel date
 * Excel doesn't support dates before 1900-01-01 (serial < 1)
 * Excel max date is 9999-12-31 (serial 2958465)
 */
export function isValidDateSerial(serial: number): boolean {
  return serial >= 1 && serial <= 2958465;
}

/**
 * Extract year from serial number
 */
export function getYear(serial: number): number {
  const datePart = getDatePart(serial);

  // Special handling for the fake leap day
  if (datePart === LEAP_YEAR_BUG_SERIAL) {
    return 1900;
  }

  const date = serialToDate(datePart);
  return date.getUTCFullYear();
}

/**
 * Extract month from serial number (1-12)
 */
export function getMonth(serial: number): number {
  const datePart = getDatePart(serial);

  // Special handling for the fake leap day
  if (datePart === LEAP_YEAR_BUG_SERIAL) {
    return 2; // February
  }

  const date = serialToDate(datePart);
  return date.getUTCMonth() + 1; // Convert from 0-based to 1-based
}

/**
 * Extract day from serial number (1-31)
 */
export function getDay(serial: number): number {
  const datePart = getDatePart(serial);

  // Special handling for the fake leap day
  if (datePart === LEAP_YEAR_BUG_SERIAL) {
    return 29; // 29th day (fake)
  }

  const date = serialToDate(datePart);
  return date.getUTCDate();
}

/**
 * Extract hour from serial number (0-23)
 */
export function getHour(serial: number): number {
  const timePart = getTimePart(serial);
  const totalSeconds = timePart * 24 * 60 * 60;
  return Math.floor(totalSeconds / 3600) % 24;
}

/**
 * Extract minute from serial number (0-59)
 */
export function getMinute(serial: number): number {
  const timePart = getTimePart(serial);
  const totalSeconds = timePart * 24 * 60 * 60;
  return Math.floor((totalSeconds % 3600) / 60);
}

/**
 * Extract second from serial number (0-59)
 */
export function getSecond(serial: number): number {
  const timePart = getTimePart(serial);
  const totalSeconds = timePart * 24 * 60 * 60;
  return Math.floor(totalSeconds % 60);
}

/**
 * Get day of week from serial number
 * @param returnType 1=Sun-Sat (1-7), 2=Mon-Sun (1-7), 3=Mon-Sun (0-6)
 */
export function getWeekday(serial: number, returnType: number = 1): number {
  const date = serialToDate(getDatePart(serial));
  const jsDay = date.getUTCDay(); // 0=Sunday, 6=Saturday

  switch (returnType) {
    case 1: // Sunday=1, Saturday=7
      return jsDay + 1;
    case 2: // Monday=1, Sunday=7
      return jsDay === 0 ? 7 : jsDay;
    case 3: // Monday=0, Sunday=6
      return jsDay === 0 ? 6 : jsDay - 1;
    default:
      return jsDay + 1;
  }
}

/**
 * Add months to a date serial
 * Used by EDATE function
 */
export function addMonths(serial: number, months: number): number {
  const date = serialToDate(getDatePart(serial));
  const timePart = getTimePart(serial);

  // Get current date components
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // Add months
  const newDate = new Date(Date.UTC(year, month + months, day));

  return dateToSerial(newDate) + timePart;
}

/**
 * Get end of month for a date serial
 * Used by EOMONTH function
 */
export function getEndOfMonth(serial: number, monthOffset: number = 0): number {
  const date = serialToDate(getDatePart(serial));

  // Get current date components
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  // Move to first day of next month, then subtract one day to get end of target month
  const endDate = new Date(Date.UTC(year, month + monthOffset + 1, 0));

  return dateToSerial(endDate);
}

/**
 * Parse date string to serial number
 * Supports common date formats
 */
export function parseDateString(dateText: string): number | null {
  // Try parsing various formats
  const trimmed = dateText.trim();

  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return dateComponentsToSerial(year, month, day);
  }

  // Try MM/DD/YYYY format
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10);
    const day = parseInt(usMatch[2], 10);
    let year = parseInt(usMatch[3], 10);

    // Handle 2-digit years
    if (year < 100) {
      year += year < 30 ? 2000 : 1900;
    }

    return dateComponentsToSerial(year, month, day);
  }

  // Try JavaScript Date parsing as fallback
  const date = new Date(dateText);
  if (!isNaN(date.getTime())) {
    return dateToSerial(date);
  }

  return null;
}

/**
 * Parse time string to serial number (fractional)
 * Supports formats like "HH:MM:SS", "HH:MM", "HH:MM AM/PM"
 */
export function parseTimeString(timeText: string): number | null {
  const trimmed = timeText.trim();

  // Check for AM/PM
  const ampmMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = parseInt(ampmMatch[2], 10);
    const second = ampmMatch[3] ? parseInt(ampmMatch[3], 10) : 0;
    const ampm = ampmMatch[4].toUpperCase();

    // Convert to 24-hour format
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    return timeComponentsToSerial(hour, minute, second);
  }

  // Try HH:MM:SS or HH:MM format
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;

    return timeComponentsToSerial(hour, minute, second);
  }

  return null;
}
