/**
 * Regression test: date-entry pipeline honors session userTimezone, never host-local.
 *
 * Pinning bug: prior to,
 * `setDateValue(Date)` and `setCells({value: Date})` decomposed Date instants via
 * `getFullYear/getMonth/getDate` — host-local getters. On any host whose process
 * timezone differs from the user's session timezone (a Modal worker is the
 * canonical example), this stored the wrong calendar day.
 *
 * The fix routes every Date → calendar-parts conversion through
 * `Intl.DateTimeFormat(session.userTimezone)`. This test pins down that
 * resolver's behavior directly. Wider integration through `WorksheetImpl`
 * is covered by UI-level date filtering scenarios.
 *
 * The host's `process.env.TZ` is irrelevant here because `Intl.DateTimeFormat`
 * with an explicit `timeZone` option ignores it — that is precisely the
 * property we want and what makes this test deterministic across hosts.
 */

import { calendarPartsInTz, parseIsoDate } from '../worksheet/operations/calendar-tz';

describe('calendarPartsInTz', () => {
  // -------------------------------------------------------------------------
  // 1. Same Date instant produces different calendar parts under different TZs
  // -------------------------------------------------------------------------

  describe('frame-of-reference correctness', () => {
    it("Date('2026-03-01') (UTC midnight) reads as March 1 in UTC", () => {
      expect(calendarPartsInTz(new Date('2026-03-01'), 'UTC')).toMatchObject({
        year: 2026,
        month: 3,
        day: 1,
      });
    });

    it("Date('2026-03-01') (UTC midnight) reads as Feb 28 in America/Los_Angeles", () => {
      // 2026-03-01 00:00 UTC = 2026-02-28 16:00 PST.
      expect(calendarPartsInTz(new Date('2026-03-01'), 'America/Los_Angeles')).toMatchObject({
        year: 2026,
        month: 2,
        day: 28,
      });
    });

    it("Date('2026-03-01') (UTC midnight) reads as March 1 in Asia/Tokyo (JST is UTC+9)", () => {
      // 2026-03-01 00:00 UTC = 2026-03-01 09:00 JST.
      expect(calendarPartsInTz(new Date('2026-03-01'), 'Asia/Tokyo')).toMatchObject({
        year: 2026,
        month: 3,
        day: 1,
        hours: 9,
      });
    });

    it('Date.UTC-constructed instant decomposes the same as ISO-string-constructed', () => {
      const a = calendarPartsInTz(new Date(Date.UTC(2026, 2, 1)), 'UTC');
      const b = calendarPartsInTz(new Date('2026-03-01'), 'UTC');
      expect(a).toEqual(b);
    });

    it('time-of-day extraction respects the target timezone', () => {
      // 2026-06-01 17:30:00 UTC = 2026-06-01 10:30:00 PDT (DST in effect).
      const parts = calendarPartsInTz(new Date('2026-06-01T17:30:00Z'), 'America/Los_Angeles');
      expect(parts.hours).toBe(10);
      expect(parts.minutes).toBe(30);
      expect(parts.seconds).toBe(0);
    });

    it('handles DST transitions correctly', () => {
      // 2026-03-08 10:00 UTC: clocks already sprang forward in LA (10:00 → 03:00 PDT, 02:00 PST).
      const before = calendarPartsInTz(new Date('2026-03-08T09:00:00Z'), 'America/Los_Angeles');
      // After spring-forward: 2026-03-08 11:00 UTC = 04:00 PDT.
      const after = calendarPartsInTz(new Date('2026-03-08T11:00:00Z'), 'America/Los_Angeles');

      expect(before.hours).toBe(1); // 01:00 PST
      expect(after.hours).toBe(4); // 04:00 PDT
    });
  });

  // -------------------------------------------------------------------------
  // 2. Error paths
  // -------------------------------------------------------------------------

  describe('error paths', () => {
    it('throws CONFIG_INVALID_USER_TIMEZONE for an unknown IANA name', () => {
      expect(() => calendarPartsInTz(new Date(), 'Not/A_Real_Zone')).toThrow(
        /CONFIG_INVALID_USER_TIMEZONE|valid IANA/i,
      );
    });

    it('throws API_INVALID_ARGUMENT for a non-finite Date', () => {
      expect(() => calendarPartsInTz(new Date(NaN), 'UTC')).toThrow(
        /API_INVALID_ARGUMENT|finite Date/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. Regression inputs: month-boundary dates
  // -------------------------------------------------------------------------

  describe('month-boundary date regression', () => {
    // The fixture wrote `new Date(Date.UTC(year, month-1, day))` and the API
    // decomposed via host-local getters, so on a Pacific host every literal
    // shifted back one day (e.g. "2026-03-01" stored as Feb 28). With
    // `userTimezone='UTC'`, the resolver MUST extract the original calendar
    // day regardless of host TZ.
    const inputs = [
      ['2026-02-15', 2026, 2, 15],
      ['2026-03-01', 2026, 3, 1],
      ['2026-03-15', 2026, 3, 15],
      ['2026-03-31', 2026, 3, 31],
      ['2026-04-01', 2026, 4, 1],
      ['2026-04-20', 2026, 4, 20],
    ] as const;

    it.each(inputs)(
      "with userTimezone='UTC', new Date('%s') decomposes to %d-%d-%d (no host-TZ leak)",
      (iso, year, month, day) => {
        const parts = calendarPartsInTz(new Date(iso), 'UTC');
        expect({ year: parts.year, month: parts.month, day: parts.day }).toEqual({
          year,
          month,
          day,
        });
      },
    );
  });
});

describe('parseIsoDate', () => {
  it("'2026-03-01' parses to {2026, 3, 1}", () => {
    expect(parseIsoDate('2026-03-01')).toEqual({ year: 2026, month: 3, day: 1 });
  });

  it('rejects slashes', () => {
    expect(() => parseIsoDate('2026/03/01')).toThrow(/API_INVALID_ARGUMENT|YYYY-MM-DD/i);
  });

  it('rejects month > 12', () => {
    expect(() => parseIsoDate('2026-13-01')).toThrow(/calendar date/i);
  });

  it('rejects day > daysInMonth (Feb 30)', () => {
    expect(() => parseIsoDate('2026-02-30')).toThrow(/calendar date/i);
  });

  it('accepts Feb 29 in a leap year, rejects in a common year', () => {
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(() => parseIsoDate('2025-02-29')).toThrow(/calendar date/i);
  });
});
