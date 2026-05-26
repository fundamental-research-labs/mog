/**
 * Time-injection regression: TODAY/NOW must read the user's calendar frame,
 * not the host process's. This locks down `currentTimeAsExcelSerial(tz, now)`
 * for known instants in distinct zones; the prior UTC-only implementation
 * silently shifted serials by ±1 calendar day on cloud workers.
 *
 */

import { currentTimeAsExcelSerial, RECALC_COMMANDS } from '../time-injection';

describe('currentTimeAsExcelSerial — session timezone resolution', () => {
  // Pick a fixed instant: 2026-03-01 07:30:45 UTC.
  // - In UTC:                 March 1, 07:30:45
  // - In America/Los_Angeles: Feb 28 (PST, UTC-8), 23:30:45
  // - In Asia/Tokyo:          March 1 (JST, UTC+9), 16:30:45
  const FIXED_INSTANT = new Date('2026-03-01T07:30:45Z');

  // Excel-serial sanity anchors (matches spreadsheet-utils `dateToSerial`):
  // - 2026-03-01 = day-only serial 46082
  // - 2026-02-28 = day-only serial 46081
  const MARCH_1_2026 = 46082;
  const FEB_28_2026 = 46081;

  it('UTC frame: 2026-03-01 07:30:45 UTC → serial 46083 + (07:30:45 / 86400)', () => {
    const serial = currentTimeAsExcelSerial('UTC', FIXED_INSTANT);
    const expectedFraction = (7 * 3600 + 30 * 60 + 45) / 86400;
    expect(Math.floor(serial)).toBe(MARCH_1_2026);
    expect(serial - Math.floor(serial)).toBeCloseTo(expectedFraction, 8);
  });

  it('America/Los_Angeles frame: same instant → serial for Feb 28 (rolls back a day)', () => {
    const serial = currentTimeAsExcelSerial('America/Los_Angeles', FIXED_INSTANT);
    const expectedFraction = (23 * 3600 + 30 * 60 + 45) / 86400;
    expect(Math.floor(serial)).toBe(FEB_28_2026);
    expect(serial - Math.floor(serial)).toBeCloseTo(expectedFraction, 8);
  });

  it('Asia/Tokyo frame: same instant → serial for March 1 (still that day, time shifts forward)', () => {
    const serial = currentTimeAsExcelSerial('Asia/Tokyo', FIXED_INSTANT);
    const expectedFraction = (16 * 3600 + 30 * 60 + 45) / 86400;
    expect(Math.floor(serial)).toBe(MARCH_1_2026);
    expect(serial - Math.floor(serial)).toBeCloseTo(expectedFraction, 8);
  });

  it('DST boundary: UTC frame is unaffected; LA frame springs forward', () => {
    // 2026-03-08 09:30 UTC = 01:30 PST (clocks not yet sprung).
    const beforeDst = new Date('2026-03-08T09:30:00Z');
    const beforeLa = currentTimeAsExcelSerial('America/Los_Angeles', beforeDst);
    expect((beforeLa - Math.floor(beforeLa)) * 24).toBeCloseTo(1.5, 6);

    // 2026-03-08 11:30 UTC = 04:30 PDT (clocks sprang from 02:00 → 03:00).
    const afterDst = new Date('2026-03-08T11:30:00Z');
    const afterLa = currentTimeAsExcelSerial('America/Los_Angeles', afterDst);
    expect((afterLa - Math.floor(afterLa)) * 24).toBeCloseTo(4.5, 6);
  });

  it('default `now` parameter uses the live clock (smoke test — must not throw)', () => {
    const serial = currentTimeAsExcelSerial('UTC');
    expect(Number.isFinite(serial)).toBe(true);
    // Sanity: serial for any time in 2026 is > 46000 (Jan 1 2026 ≈ 46023).
    expect(serial).toBeGreaterThan(46000);
  });

  it('invalid IANA zone surfaces an Intl error (caller responsibility — not silent)', () => {
    expect(() => currentTimeAsExcelSerial('Not/A_Real_Zone', FIXED_INSTANT)).toThrow();
  });

  it('injects time before explicit full recalculation commands', () => {
    expect(RECALC_COMMANDS.has('compute_full_recalc')).toBe(true);
  });

  it('injects time before XLSX import and deferred hydration commands', () => {
    expect(RECALC_COMMANDS.has('compute_import_from_xlsx_bytes')).toBe(true);
    expect(RECALC_COMMANDS.has('compute_import_from_xlsx_bytes_deferred')).toBe(true);
    expect(RECALC_COMMANDS.has('compute_complete_deferred_hydration')).toBe(true);
  });
});
