/**
 * Time injection for compute transports.
 *
 * WASM and NAPI environments don't have access to the system clock from within
 * the Rust compute core. Before every recalc-triggering command, we inject the
 * current time as an Excel serial number so NOW()/TODAY() functions work.
 *
 * Critically: the injected serial must be in the **user's calendar frame**,
 * not the host process's UTC. On a Modal worker running a US user's agent,
 * `chrono::Utc::now()` would give "now in UTC" — but Excel's TODAY() means
 * "today in the user's calendar", which is up to a calendar day off. The
 * caller supplies a `getUserTimezone()` callback that resolves the active
 * session's IANA timezone so we can convert the host instant into the right
 * frame here, before crossing the FFI boundary.
 *
 */
import type { BridgeTransport } from '@rust-bridge/client';
import type { WasmModule } from './types';

// Excel-serial epoch: Dec 31, 1899 UTC. Matches `spreadsheet-utils/src/number-formats/date-serial.ts`
// so NOW() / TODAY() share the same serial space as cell values written via `dateToSerial`.
// Excel keeps a 1900-leap-year-bug compensation (it thinks Feb 29 1900 existed); for any date
// after Feb 28 1900 the natural day-count needs +1 to match Excel's serial.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 31);
const LEAP_YEAR_BUG_CUTOFF = 60;
const MS_PER_DAY = 86_400_000;

const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMATTER_CACHE.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    });
    PARTS_FORMATTER_CACHE.set(tz, fmt);
  }
  return fmt;
}

/**
 * Excel serial number for the given instant in the given IANA timezone.
 *
 * The serial is the number of days (with fractional time-of-day) since the
 * Excel epoch (1899-12-30) interpreted in `tz`. So at 14:00 PST on
 * 2026-04-25, this returns the same calendar-day serial whether the host
 * process is in UTC, PST, or Tokyo — what matters is the user's frame.
 *
 * `tz` is required: there is no safe default, since the host process TZ is
 * meaningless when the host isn't the user's device.
 *
 * @param tz   IANA timezone name (e.g. `'America/Los_Angeles'`, `'UTC'`).
 * @param now  Instant to convert. Defaults to `new Date()` (real now).
 */
export function currentTimeAsExcelSerial(tz: string, now: Date = new Date()): number {
  const parts = getFormatter(tz).formatToParts(now);
  let year = NaN,
    month = NaN,
    day = NaN,
    hours = 0,
    minutes = 0,
    seconds = 0,
    fractional = 0;

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
        // Intl in en-US returns "24" at midnight under hour12:false — normalize.
        hours = Number(part.value) % 24;
        break;
      case 'minute':
        minutes = Number(part.value);
        break;
      case 'second':
        seconds = Number(part.value);
        break;
      case 'fractionalSecond':
        fractional = Number(part.value) / 1000;
        break;
    }
  }

  // Pin the calendar parts to the Excel epoch in UTC so the arithmetic is
  // timezone-free. The day/hour/minute/second values come from `tz`, so the
  // resulting serial is "elapsed days from Excel epoch in the tz frame".
  const calendarMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let dayPart = (calendarMs - EXCEL_EPOCH_UTC_MS) / MS_PER_DAY;
  // Apply the same 1900-leap-year-bug compensation as `dateToSerial` so
  // injected NOW()/TODAY() share the cell-value serial space.
  if (dayPart >= LEAP_YEAR_BUG_CUTOFF) {
    dayPart += 1;
  }
  return dayPart + fractional / 86400;
}

// RECALC_COMMANDS — auto-generated from bridge annotations.
// Regenerate: cargo test -p bridge-ts --test generate_handler_registry -- generate --nocapture
import { RECALC_COMMANDS } from './command-metadata.gen';
export { RECALC_COMMANDS };

/**
 * Wrap a WASM transport with time injection.
 *
 * Before every recalc-triggering command, calls `compute_set_current_time`
 * to set NOW() for the Rust compute core. The injected serial is computed
 * in the active session's IANA timezone (via the supplied callback) so
 * TODAY()/NOW() return the user's calendar today, not the host process's.
 */
export function createTimeInjectingTransport(
  inner: BridgeTransport,
  getModule: () => WasmModule,
  getUserTimezone: () => string,
): BridgeTransport {
  return {
    async call<T = unknown>(command: string, args: Record<string, unknown>): Promise<T> {
      if (RECALC_COMMANDS.has(command)) {
        const wasm = getModule();
        wasm['compute_set_current_time']?.(currentTimeAsExcelSerial(getUserTimezone()));
      }
      return inner.call<T>(command, args);
    },
  };
}
