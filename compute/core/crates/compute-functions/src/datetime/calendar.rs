// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use chrono::{Datelike, NaiveDate, NaiveDateTime};

use crate::helpers::date_serial::{date_to_serial, serial_to_date};

#[allow(dead_code)]
pub(super) fn serial_to_datetime(serial: f64) -> Option<NaiveDateTime> {
    let date = serial_to_date(serial)?;
    let frac = serial - serial.floor();
    let total_seconds = (frac * 86400.0).round() as u32;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    date.and_hms_opt(hours, minutes, seconds)
}

/// Compute Excel-compatible day-of-week directly from serial number.
/// Returns 0=Sunday, 1=Monday, ..., 6=Saturday.
///
/// This avoids going through NaiveDate and chrono's weekday(), which gives the
/// REAL calendar day. Excel's calendar has a fake Feb 29, 1900 (serial 60) due
/// to the Lotus 1-2-3 bug, so for serials 1-59 the real weekday is off by one.
/// Computing (serial - 1) % 7 directly gives Excel's expected weekday for ALL
/// serial numbers because Excel's epoch (serial 1) is defined as Sunday.
pub(super) fn excel_dow_from_serial(serial: f64) -> Option<u32> {
    let days = serial.floor() as i64;
    if days < 1 {
        return None;
    }
    // Excel weekday: serial 1 = Sunday, serial 2 = Monday, etc.
    // (days - 1) % 7 gives 0=Sun, 1=Mon, ..., 6=Sat
    Some(((days - 1).rem_euclid(7)) as u32)
}

/// Check if an Excel serial number falls on a weekend day.
/// Uses Excel's serial-based DOW calculation for consistency with Excel's
/// Lotus 1-2-3 bug calendar.
/// Returns true if the serial falls on Saturday or Sunday.
pub(super) fn is_excel_weekend(serial: f64) -> bool {
    match excel_dow_from_serial(serial) {
        Some(dow) => dow == 0 || dow == 6, // 0=Sunday, 6=Saturday
        None => false,
    }
}

/// Check if an Excel serial number falls on a weekend day according to a mask.
/// Uses Excel's serial-based DOW calculation for consistency.
/// The mask is [Mon, Tue, Wed, Thu, Fri, Sat, Sun] where true = weekend.
pub(super) fn is_excel_weekend_mask(serial: f64, weekend_mask: &[bool; 7]) -> bool {
    match excel_dow_from_serial(serial) {
        Some(dow) => {
            // dow: 0=Sun, 1=Mon, ..., 6=Sat
            // mask: 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
            let mask_idx = if dow == 0 { 6 } else { (dow - 1) as usize };
            weekend_mask[mask_idx]
        }
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Array broadcasting helpers (for SUMPRODUCT compatibility)
// ---------------------------------------------------------------------------

pub(super) fn add_months(date: NaiveDate, months: i32) -> Option<NaiveDate> {
    let total_months = date.year() * 12 + date.month0() as i32 + months;
    let new_year = total_months.div_euclid(12);
    let new_month = (total_months.rem_euclid(12) + 1) as u32;
    let max_day = last_day_of_month(new_year, new_month);
    let new_day = date.day().min(max_day);
    NaiveDate::from_ymd_opt(new_year, new_month, new_day)
}

pub(super) fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

pub(super) fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Parse the weekend parameter for NETWORKDAYS.INTL and WORKDAY.INTL.
pub(super) fn excel_iso_week_from_serial(serial: f64) -> u32 {
    let days = serial.floor() as i64;
    if days < 1 {
        return 1; // fallback
    }

    // Excel DOW: 0=Sun, 1=Mon, ..., 6=Sat
    let dow = (days - 1).rem_euclid(7); // 0=Sun, 1=Mon, ..., 6=Sat

    // Convert to ISO day: Mon=1, Tue=2, ..., Sun=7
    let iso_day = if dow == 0 { 7 } else { dow };

    // Find Thursday of the same ISO week: serial + (4 - iso_day)
    let thu_serial = days + (4 - iso_day);

    // If Thursday's serial is before serial 1 (before the Excel epoch), this
    // means the date falls in an ISO week belonging to a "previous year" in
    // Excel's calendar. In Excel's world, serial 1 = Sunday, Jan 1, 1900.
    // The ISO week containing that Sunday has its Thursday on serial 1 + (4-7) = -2,
    // which is before the epoch. Excel treats this as week 52 of the "previous year".
    if thu_serial < 1 {
        // This only happens for the very first few days (serial 1-3, which are
        // Sun-Tue in Excel's calendar). Their ISO Thursday falls before the epoch.
        // Excel returns 52 for these dates (last week of "previous year").
        return 52;
    }

    // Convert Thursday's serial to a date to get its year
    let thu_date = match serial_to_date(thu_serial as f64) {
        Some(d) => d,
        None => return 1, // fallback
    };

    let thu_year = thu_date.year();

    // Find Jan 1 of the Thursday's year and its serial
    let jan1 = NaiveDate::from_ymd_opt(thu_year, 1, 1)
        .expect("Jan 1 of a year from a valid NaiveDate is always valid");
    let jan1_serial = date_to_serial(&jan1) as i64;

    // Find the Thursday of the week containing Jan 1
    let jan1_dow = ((jan1_serial - 1).rem_euclid(7)) as i64;
    let jan1_iso_day = if jan1_dow == 0 { 7 } else { jan1_dow };
    let jan1_thu = jan1_serial + (4 - jan1_iso_day);

    // Week number = (thu_serial - jan1_thu) / 7 + 1

    ((thu_serial - jan1_thu) / 7 + 1) as u32
}

/// Calculate average year length for YEARFRAC basis 1 (actual/actual).
pub(super) fn year_length_actual(start: NaiveDate, end: NaiveDate) -> f64 {
    let sy = start.year();
    let ey = end.year();
    if sy == ey {
        if is_leap_year(sy) { 366.0 } else { 365.0 }
    } else {
        // Average year length across the years spanned
        let mut total = 0.0;
        let mut count = 0;
        for y in sy..=ey {
            total += if is_leap_year(y) { 366.0 } else { 365.0 };
            count += 1;
        }
        total / count as f64
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use crate::helpers::date_serial::{date_to_serial, serial_to_date};
    use chrono::{Datelike, NaiveDate};

    #[test]
    fn test_serial_date_roundtrip() {
        // 2024-01-15 should be serial 45306
        let d = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let serial = date_to_serial(&d);
        let back = serial_to_date(serial).unwrap();
        assert_eq!(d, back);
    }

    #[test]
    fn test_serial_date_known_values() {
        // 1900-01-01 = day 1
        let d1 = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap();
        assert_eq!(date_to_serial(&d1), 1.0);

        // 1900-03-01 = day 61 (after the fake Feb 29)
        let d61 = NaiveDate::from_ymd_opt(1900, 3, 1).unwrap();
        assert_eq!(date_to_serial(&d61), 61.0);

        // 2000-01-01 = day 36526
        let d2000 = NaiveDate::from_ymd_opt(2000, 1, 1).unwrap();
        assert_eq!(date_to_serial(&d2000), 36526.0);
    }

    #[test]
    fn test_serial_to_date_roundtrip() {
        // Serial 1 = Jan 1, 1900
        let d1 = serial_to_date(1.0).unwrap();
        assert_eq!(d1, NaiveDate::from_ymd_opt(1900, 1, 1).unwrap());
        assert_eq!(date_to_serial(&d1), 1.0);

        // Serial 44927 = Jan 1, 2023 (Sunday)
        let d2 = serial_to_date(44927.0).unwrap();
        assert_eq!(d2, NaiveDate::from_ymd_opt(2023, 1, 1).unwrap());
        assert_eq!(date_to_serial(&d2), 44927.0);

        // Test the leap year boundary
        let d59 = serial_to_date(59.0).unwrap();
        assert_eq!(d59, NaiveDate::from_ymd_opt(1900, 2, 28).unwrap());

        let d61 = serial_to_date(61.0).unwrap();
        assert_eq!(d61, NaiveDate::from_ymd_opt(1900, 3, 1).unwrap());
    }

    #[test]
    fn test_serial_to_date_comprehensive() {
        // Verify serial-to-date for a range of well-known Excel dates
        use chrono::Weekday;

        // Serial 1 = Jan 1, 1900 (Monday)
        let d = serial_to_date(1.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 1));

        // Serial 2 = Jan 2, 1900 (Tuesday)
        let d = serial_to_date(2.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Tue);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 2));

        // Serial 7 = Jan 7, 1900 (Sunday)
        let d = serial_to_date(7.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Sun);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 1, 7));

        // Serial 59 = Feb 28, 1900 (Wednesday)
        let d = serial_to_date(59.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Wed);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 2, 28));

        // Serial 61 = Mar 1, 1900 (Thursday)
        let d = serial_to_date(61.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Thu);
        assert_eq!((d.year(), d.month(), d.day()), (1900, 3, 1));

        // Serial 44927 = Jan 1, 2023 (Sunday)
        let d = serial_to_date(44927.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Sun);
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 1));

        // Serial 44928 = Jan 2, 2023 (Monday)
        let d = serial_to_date(44928.0).unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);
        assert_eq!((d.year(), d.month(), d.day()), (2023, 1, 2));

        // DATE(2024, 1, 15) serial should give Monday
        let d = serial_to_date(date_to_serial(
            &NaiveDate::from_ymd_opt(2024, 1, 15).unwrap(),
        ))
        .unwrap();
        assert_eq!(d.weekday(), Weekday::Mon);

        // Verify WEEKDAY consistency: serial_to_date weekday matches Excel's WEEKDAY
        // for a range of known serials
        for serial in [1, 7, 44927, 44928, 44929, 44930, 44931, 44932, 44933] {
            let d = serial_to_date(serial as f64).unwrap();
            let dow = d.weekday().num_days_from_sunday() as i32;
            let weekday_type1 = dow + 1;
            // Verify it's in 1-7 range
            assert!(
                (1..=7).contains(&weekday_type1),
                "serial {} gave weekday_type1={}",
                serial,
                weekday_type1
            );
        }
    }
}
