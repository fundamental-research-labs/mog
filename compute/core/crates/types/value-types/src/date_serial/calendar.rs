use chrono::NaiveDate;

/// Check if a year is a leap year.
#[must_use]
pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Days in a given month (1-indexed).
///
/// Returns `None` if `month` is not in the range 1..=12.
#[must_use]
#[allow(clippy::match_same_arms)] // months with the same day count are intentionally listed separately for clarity
pub fn days_in_month(year: i32, month: i32) -> Option<i32> {
    match month {
        1 => Some(31),
        2 => {
            if is_leap_year(year) {
                Some(29)
            } else {
                Some(28)
            }
        }
        3 => Some(31),
        4 => Some(30),
        5 => Some(31),
        6 => Some(30),
        7 => Some(31),
        8 => Some(31),
        9 => Some(30),
        10 => Some(31),
        11 => Some(30),
        12 => Some(31),
        _ => None,
    }
}

/// Convert an Excel serial number to (year, month, day).
///
/// Handles the Lotus 1-2-3 bug: serial 60 is the fictional Feb 29, 1900.
/// Excel's YEAR/MONTH/DAY functions return (1900, 2, 29) for serial 60.
///
/// For serials > 60 this uses Howard Hinnant's O(1) `civil_from_days` algorithm
/// instead of looping year-by-year and month-by-month.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap
)]
#[must_use]
pub fn serial_to_ymd(serial: f64) -> (i32, i32, i32) {
    let days = serial.floor() as i64;
    if days == 0 {
        return (1900, 1, 0);
    }
    if days == 60 {
        return (1900, 2, 29);
    }
    if !(0..=3_000_000).contains(&days) {
        return (9999, 12, 31);
    }

    if days <= 59 {
        let mut remaining = days;
        let mut m = 1_i32;
        loop {
            let dim = i64::from(days_in_month(1900, m).unwrap_or(31));
            if remaining <= dim {
                break;
            }
            remaining -= dim;
            m += 1;
        }
        #[allow(clippy::cast_possible_truncation)]
        let d = remaining as i32;
        return (1900, m, d.max(1));
    }

    let epoch_days = days - 25569;

    let z = epoch_days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (i64::from(yoe) + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as i32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    (y, m as i32, d)
}

/// Convert (year, month, day) to an Excel serial number.
///
/// Inverse of [`serial_to_ymd`]. Accounts for the Lotus 1-2-3 bug
/// (serials >= 60 are incremented by 1).
///
/// **Note:** This function does not validate its inputs. Passing an
/// out-of-range month or day will produce a meaningless serial number.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn ymd_to_serial(year: i32, month: i32, day: i32) -> f64 {
    if year == 1900 && month == 2 && day == 29 {
        return 60.0;
    }

    let mut total: i64 = 0;
    for y in 1900..year {
        total += if is_leap_year(y) { 366 } else { 365 };
    }
    for m in 1..month.min(13) {
        total += i64::from(days_in_month(year, m).unwrap_or(31));
    }
    total += i64::from(day);
    if total >= 60 {
        total += 1;
    }
    total as f64
}

/// Convert an Excel serial number to a chrono `NaiveDate`.
///
/// Returns `None` for invalid serials (< 0). Day 60 is the fake Feb 29, 1900;
/// `NaiveDate` cannot represent it, so this maps to Mar 1.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
#[must_use]
pub fn serial_to_date(serial: f64) -> Option<NaiveDate> {
    let days = serial.floor() as i64;
    if days < 0 {
        return None;
    }
    if days == 0 {
        return NaiveDate::from_ymd_opt(1899, 12, 31);
    }
    if days == 60 {
        return NaiveDate::from_ymd_opt(1900, 3, 1);
    }
    let (y, m, d) = serial_to_ymd(serial);
    NaiveDate::from_ymd_opt(y, m as u32, d as u32)
}

/// Convert a chrono `NaiveDate` to an Excel serial number.
///
/// Inverse of [`serial_to_date`]. Adds 1 for dates on or after 1900-03-01
/// to account for the Lotus 1-2-3 leap year bug.
///
/// # Panics
///
/// Panics if chrono cannot construct fixed valid dates used by the conversion.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn date_to_serial(date: &NaiveDate) -> f64 {
    let epoch = NaiveDate::from_ymd_opt(1899, 12, 31).unwrap();
    let real_days = (*date - epoch).num_days();
    let mar1_1900 = NaiveDate::from_ymd_opt(1900, 3, 1).unwrap();
    if *date >= mar1_1900 {
        (real_days + 1) as f64
    } else {
        real_days as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ymd_to_serial_preserves_excel_1900_leap_day() {
        assert_eq!(ymd_to_serial(1900, 2, 29), 60.0);
        assert_eq!(serial_to_ymd(60.0), (1900, 2, 29));
    }

    #[test]
    fn serial_to_ymd_lotus_boundaries() {
        assert_eq!(serial_to_ymd(0.0), (1900, 1, 0));
        assert_eq!(serial_to_ymd(59.0), (1900, 2, 28));
        assert_eq!(serial_to_ymd(60.0), (1900, 2, 29));
        assert_eq!(serial_to_ymd(61.0), (1900, 3, 1));
    }

    #[test]
    fn serial_to_date_lotus_boundaries() {
        assert_eq!(serial_to_date(0.0), NaiveDate::from_ymd_opt(1899, 12, 31));
        assert_eq!(serial_to_date(59.0), NaiveDate::from_ymd_opt(1900, 2, 28));
        assert_eq!(serial_to_date(60.0), NaiveDate::from_ymd_opt(1900, 3, 1));
        assert_eq!(serial_to_date(61.0), NaiveDate::from_ymd_opt(1900, 3, 1));
    }

    #[test]
    fn serial_to_date_negative_rejected() {
        assert_eq!(serial_to_date(-1.0), None);
        assert_eq!(serial_to_date(-0.5), None);
    }

    #[test]
    fn serial_to_date_fractional_serials_floor() {
        assert_eq!(serial_to_date(61.9), NaiveDate::from_ymd_opt(1900, 3, 1));
    }

    #[test]
    fn serial_to_ymd_out_of_range_clamps() {
        assert_eq!(serial_to_ymd(-1.0), (9999, 12, 31));
        assert_eq!(serial_to_ymd(3_000_001.0), (9999, 12, 31));
    }

    #[test]
    fn serial_to_ymd_known_dates() {
        assert_eq!(serial_to_ymd(1.0), (1900, 1, 1));
        assert_eq!(serial_to_ymd(59.0), (1900, 2, 28));
        assert_eq!(serial_to_ymd(60.0), (1900, 2, 29));
        assert_eq!(serial_to_ymd(61.0), (1900, 3, 1));
        assert_eq!(serial_to_ymd(366.0), (1900, 12, 31));
        assert_eq!(serial_to_ymd(367.0), (1901, 1, 1));
        assert_eq!(serial_to_ymd(44927.0), (2023, 1, 1));
        assert_eq!(serial_to_ymd(45292.0), (2024, 1, 1));
        assert_eq!(serial_to_ymd(45352.0), (2024, 3, 1));
        assert_eq!(serial_to_ymd(45657.0), (2024, 12, 31));
        assert_eq!(serial_to_ymd(45658.0), (2025, 1, 1));
    }

    #[test]
    fn serial_to_ymd_roundtrip_spot_check() {
        let cases = [
            (1900, 1, 1),
            (1900, 2, 28),
            (1900, 3, 1),
            (1900, 12, 31),
            (1901, 1, 1),
            (1950, 6, 15),
            (1999, 12, 31),
            (2000, 1, 1),
            (2000, 2, 29),
            (2024, 2, 29),
            (2024, 7, 4),
            (2100, 3, 1),
            (9999, 12, 31),
        ];
        for (y, m, d) in cases {
            let serial = ymd_to_serial(y, m, d);
            let (ry, rm, rd) = serial_to_ymd(serial);
            assert_eq!(
                (ry, rm, rd),
                (y, m, d),
                "roundtrip failed for ({y}, {m}, {d}) serial={serial}"
            );
        }
    }

    #[test]
    fn leap_year_century_boundaries() {
        assert!(!is_leap_year(1900));
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(2100));
    }

    #[test]
    fn days_in_month_boundaries() {
        assert_eq!(days_in_month(1900, 2), Some(28));
        assert_eq!(days_in_month(2000, 2), Some(29));
        assert_eq!(days_in_month(2100, 2), Some(28));
        assert_eq!(days_in_month(2024, 4), Some(30));
        assert_eq!(days_in_month(2024, 13), None);
    }
}
