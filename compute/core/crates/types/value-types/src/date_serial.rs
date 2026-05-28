//! Excel serial date ↔ calendar date conversion primitives.
//!
//! These are the canonical conversions used throughout the compute engine.
//! Excel serial date numbers count days since 1899-12-30, with a known
//! Lotus 1-2-3 bug: day 60 is the fictional Feb 29, 1900.
//!
//! Domain-specific date arithmetic (day-count conventions, year fractions,
//! month addition) lives in `compute-functions`, not here.

use chrono::NaiveDate;

/// Error returned when a string cannot be parsed as a date, time, or datetime.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("failed to parse \"{input}\" as a {kind}")]
pub struct DateParseError {
    /// The input string that could not be parsed.
    pub input: String,
    /// What kind of parse was attempted.
    pub kind: &'static str,
}

// ---------------------------------------------------------------------------
// Basic calendar helpers
// ---------------------------------------------------------------------------

/// Check if a year is a leap year.
#[must_use]
pub fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Days in a given month (1-indexed).
///
/// # Panics
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

// ---------------------------------------------------------------------------
// Serial <-> YMD conversions
// ---------------------------------------------------------------------------

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
    // Excel quirk: serial 0 = "January 0, 1900"
    if days == 0 {
        return (1900, 1, 0);
    }
    if days == 60 {
        return (1900, 2, 29);
    }
    // Guard against extreme serials: Excel max is Dec 31, 9999 ≈ serial 2,958,465.
    if !(0..=3_000_000).contains(&days) {
        return (9999, 12, 31);
    }

    if days <= 59 {
        // Serials 1-59: Jan 1 1900 through Feb 28 1900 (before the Lotus bug gap).
        // Use a small loop — at most 59 iterations.
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

    // For serials > 60: subtract 2 to get days since 1899-12-31 (accounting
    // for the Lotus bug adding a phantom day at serial 60, and converting
    // from Excel's 1-based serial to a 0-based day count).
    // Then convert to days since 1970-01-01 for the civil algorithm.
    // Excel serial 1 = Jan 1, 1900 = day-offset 0 from 1900-01-01.
    // 1900-01-01 in days-since-1970-01-01 = -25567.
    // For serial > 60: adjusted = serial - 1 (remove Lotus phantom day),
    // days-since-epoch = adjusted - 1 + (-25567) = serial - 2 - 25567.
    let epoch_days = days - 25569; // days since 1970-01-01

    // Howard Hinnant's civil_from_days algorithm — O(1).
    let z = epoch_days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // year of era [0, 399]
    let y = (i64::from(yoe) + era * 400) as i32;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // day of year [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as i32; // day [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // month [1, 12]
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
/// Use `validated_ymd_to_serial()` if you need input validation.
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

// ---------------------------------------------------------------------------
// Chrono-based conversions
// ---------------------------------------------------------------------------

/// Convert an Excel serial number to a chrono `NaiveDate`.
///
/// Returns `None` for invalid serials (< 0).
/// Day 60 is the fake Feb 29, 1900 — `NaiveDate` can't represent it,
/// so we map to Mar 1 for practical purposes.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
#[must_use]
pub fn serial_to_date(serial: f64) -> Option<NaiveDate> {
    let days = serial.floor() as i64;
    if days < 0 {
        return None;
    }
    if days == 0 {
        // Excel serial 0 = "January 0, 1900" (fictional date).
        // Map to Dec 31, 1899 — the closest valid calendar date.
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
/// Panics if the chrono library cannot construct the epoch date (1899-12-31)
/// or March 1, 1900. These are valid dates, so this should never occur.
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

// ---------------------------------------------------------------------------
// Hand-rolled text → serial parsing (replaces chrono parse_from_str)
//
// These parsers extract (year, month, day, hour, minute, second) directly
// from text using byte-level scanning, then convert via ymd_to_serial().
// ~100x faster than chrono's format-string-based parsing (~100ns vs ~15μs).
// ---------------------------------------------------------------------------

/// Scan an unsigned integer starting at `pos`. Returns (value, `new_pos`).
fn scan_uint(bytes: &[u8], pos: usize) -> Option<(u32, usize)> {
    if pos >= bytes.len() || !bytes[pos].is_ascii_digit() {
        return None;
    }
    let mut val: u32 = 0;
    let mut i = pos;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        val = val
            .checked_mul(10)?
            .checked_add(u32::from(bytes[i] - b'0'))?;
        i += 1;
    }
    Some((val, i))
}

/// Skip ASCII whitespace at `pos`.
fn skip_ws(bytes: &[u8], mut pos: usize) -> usize {
    while pos < bytes.len() && bytes[pos] == b' ' {
        pos += 1;
    }
    pos
}

/// Skip an optional comma followed by optional whitespace.
fn skip_comma_ws(bytes: &[u8], mut pos: usize) -> usize {
    if pos < bytes.len() && bytes[pos] == b',' {
        pos += 1;
    }
    skip_ws(bytes, pos)
}

/// Parse a month name (case-insensitive, full or 3-letter abbreviation).
/// Returns (`month_1_to_12`, `position_after_name`).
fn scan_month_name(bytes: &[u8], pos: usize) -> Option<(u32, usize)> {
    let start = pos;
    let mut i = pos;
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        i += 1;
    }
    let len = i - start;
    if len < 3 {
        return None;
    }
    // Match on the first 3 lowercase characters
    let b0 = bytes[start].to_ascii_lowercase();
    let b1 = bytes[start + 1].to_ascii_lowercase();
    let b2 = bytes[start + 2].to_ascii_lowercase();
    let month = match (b0, b1, b2) {
        (b'j', b'a', b'n') => 1,
        (b'f', b'e', b'b') => 2,
        (b'm', b'a', b'r') => 3,
        (b'a', b'p', b'r') => 4,
        (b'm', b'a', b'y') => 5,
        (b'j', b'u', b'n') => 6,
        (b'j', b'u', b'l') => 7,
        (b'a', b'u', b'g') => 8,
        (b's', b'e', b'p') => 9,
        (b'o', b'c', b't') => 10,
        (b'n', b'o', b'v') => 11,
        (b'd', b'e', b'c') => 12,
        _ => return None,
    };
    // Accept 3-letter abbreviation or any longer prefix (full name)
    Some((month, i))
}

/// Apply 2-digit year windowing (Excel convention):
/// 0-29 → 2000-2029, 30-99 → 1930-1999.
#[allow(clippy::cast_possible_wrap)] // y is 0..=99, so 2000+y and 1900+y always fit in i32
fn resolve_2digit_year(y: u32) -> i32 {
    if y <= 29 {
        (2000 + y) as i32
    } else {
        (1900 + y) as i32
    }
}

/// Validate (year, month, day) and convert to Excel serial number.
///
/// Returns `None` if `month` is outside `1..=12`, `day` is outside
/// `1..=days_in_month`, or `year` is outside `1900..=9999`.
#[allow(clippy::cast_sign_loss, clippy::cast_possible_wrap)] // month is 1..=12, day is 1..=31
fn validated_ymd_to_serial(year: i32, month: u32, day: u32) -> Option<f64> {
    if !(1..=12).contains(&month) || day < 1 || !(1900..=9999).contains(&year) {
        return None;
    }
    if year == 1900 && month == 2 && day == 29 {
        return Some(60.0);
    }
    // SAFETY: month is validated to be 1..=12 above
    let max_day = days_in_month(year, month as i32).unwrap() as u32;
    if day > max_day {
        return None;
    }
    Some(ymd_to_serial(year, month as i32, day as i32))
}

/// Parse a time component `HH:MM[:SS][ AM/PM]` → (`hour_24h`, minute, second).
#[allow(clippy::cast_precision_loss)]
fn parse_time_component(text: &str) -> Option<(u32, u32, u32)> {
    let bytes = text.as_bytes();
    let (hour, pos) = scan_uint(bytes, 0)?;
    if pos >= bytes.len() || bytes[pos] != b':' {
        return None;
    }
    let (minute, pos) = scan_uint(bytes, pos + 1)?;

    let (second, pos) = if pos < bytes.len() && bytes[pos] == b':' {
        scan_uint(bytes, pos + 1)?
    } else {
        (0, pos)
    };

    // Check for AM/PM suffix
    let rest = text[pos..].trim();
    let hour = if rest.is_empty() {
        // 24-hour format
        if hour > 23 {
            return None;
        }
        hour
    } else if rest.eq_ignore_ascii_case("am") {
        if hour == 0 || hour > 12 {
            return None;
        }
        if hour == 12 { 0 } else { hour }
    } else if rest.eq_ignore_ascii_case("pm") {
        if hour == 0 || hour > 12 {
            return None;
        }
        if hour == 12 { 12 } else { hour + 12 }
    } else {
        return None;
    };

    if minute > 59 || second > 59 {
        return None;
    }
    Some((hour, minute, second))
}

/// Convert (hour, minute, second) to a fractional day value.
#[allow(clippy::cast_precision_loss)]
fn time_to_fraction(hour: u32, minute: u32, second: u32) -> f64 {
    (f64::from(hour) * 3600.0 + f64::from(minute) * 60.0 + f64::from(second)) / 86400.0
}

/// Try to parse a string as a date. Returns the Excel serial number.
///
/// Supported formats (with 4-digit or 2-digit year):
/// - `YYYY-MM-DD` (ISO)
/// - `M/D/YYYY`, `M/D/YY` (US slash)
/// - `M-D-YYYY`, `M-D-YY` (US dash)
/// - `D-Mon-YYYY`, `D-Mon-YY` (European with month name)
/// - `Month D, YYYY` / `Mon D, YYYY` (full/abbreviated month name)
///
/// # Errors
///
/// Returns [`DateParseError`] if the string does not match any recognized date format.
pub fn try_parse_date(text: &str) -> Result<f64, DateParseError> {
    try_parse_date_inner(text).ok_or_else(|| DateParseError {
        input: text.to_owned(),
        kind: "date",
    })
}

#[allow(clippy::cast_possible_wrap)] // year/month/day values from scan_uint are small enough for i32
fn try_parse_date_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let bytes = text.as_bytes();

    // Branch 1: Starts with letter → month-name format ("January 15, 2024")
    if bytes[0].is_ascii_alphabetic() {
        let (month, pos) = scan_month_name(bytes, 0)?;
        let pos = skip_ws(bytes, pos);
        let (day, pos) = scan_uint(bytes, pos)?;
        let pos = skip_comma_ws(bytes, pos);
        let (year_raw, pos) = scan_uint(bytes, pos)?;
        if pos != bytes.len() {
            return None;
        }
        let year = if year_raw < 100 {
            resolve_2digit_year(year_raw)
        } else {
            year_raw as i32
        };
        return validated_ymd_to_serial(year, month, day);
    }

    // Branch 2: Starts with digit
    if !bytes[0].is_ascii_digit() {
        return None;
    }

    let (first, pos) = scan_uint(bytes, 0)?;
    if pos >= bytes.len() {
        return None;
    }

    let sep = bytes[pos];
    match sep {
        b'/' => {
            // M/D/YYYY, M/D/YY (strict, no D/M fallback)
            let (second, pos) = scan_uint(bytes, pos + 1)?;
            if pos >= bytes.len() || bytes[pos] != b'/' {
                return None;
            }
            let (third, pos) = scan_uint(bytes, pos + 1)?;
            if pos != bytes.len() {
                return None;
            }
            let year = if third < 100 {
                resolve_2digit_year(third)
            } else {
                third as i32
            };
            // M/D/Y only (US format, matches Excel's default locale).
            // No D/M/Y fallback — Excel does not swap month/day for slash dates.
            validated_ymd_to_serial(year, first, second)
        }
        b'-' => {
            if first > 99 {
                // YYYY-MM-DD (ISO)
                let (month, pos) = scan_uint(bytes, pos + 1)?;
                if pos >= bytes.len() || bytes[pos] != b'-' {
                    return None;
                }
                let (day, pos) = scan_uint(bytes, pos + 1)?;
                if pos != bytes.len() {
                    return None;
                }
                validated_ymd_to_serial(first as i32, month, day)
            } else {
                // Check if second segment is a month name: D-Mon-YYYY
                let after_sep = pos + 1;
                if after_sep < bytes.len() && bytes[after_sep].is_ascii_alphabetic() {
                    let (month, pos) = scan_month_name(bytes, after_sep)?;
                    if pos >= bytes.len() || bytes[pos] != b'-' {
                        return None;
                    }
                    let (year_raw, pos) = scan_uint(bytes, pos + 1)?;
                    if pos != bytes.len() {
                        return None;
                    }
                    let year = if year_raw < 100 {
                        resolve_2digit_year(year_raw)
                    } else {
                        year_raw as i32
                    };
                    return validated_ymd_to_serial(year, month, first);
                }
                // M-D-YYYY or M-D-YY
                let (second, pos) = scan_uint(bytes, pos + 1)?;
                if pos >= bytes.len() || bytes[pos] != b'-' {
                    return None;
                }
                let (third, pos) = scan_uint(bytes, pos + 1)?;
                if pos != bytes.len() {
                    return None;
                }
                let year = if third < 100 {
                    resolve_2digit_year(third)
                } else {
                    third as i32
                };
                validated_ymd_to_serial(year, first, second)
            }
        }
        _ => None,
    }
}

/// Try to parse a string as a combined date+time.
/// Returns the Excel serial number (integer part = date, fractional = time).
///
/// Supported: any `try_parse_date` format followed by a space and a time
/// component (`HH:MM[:SS][ AM/PM]`).
///
/// # Errors
///
/// Returns [`DateParseError`] if the string does not match any recognized datetime format.
pub fn try_parse_datetime(text: &str) -> Result<f64, DateParseError> {
    try_parse_datetime_inner(text).ok_or_else(|| DateParseError {
        input: text.to_owned(),
        kind: "datetime",
    })
}

#[allow(clippy::cast_precision_loss)]
fn try_parse_datetime_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    let bytes = text.as_bytes();

    // Find the split between date and time: scan for a space followed by a
    // digit where the remainder contains ':' (indicating a time component).
    for (i, &b) in bytes.iter().enumerate() {
        if b == b' ' {
            let rest = &text[i + 1..];
            if let Some(first_byte) = rest.as_bytes().first()
                && first_byte.is_ascii_digit()
                && rest.contains(':')
                && let Some(date_serial) = try_parse_date_inner(&text[..i])
                && let Some((h, m, s)) = parse_time_component(rest.trim())
            {
                return Some(date_serial + time_to_fraction(h, m, s));
            }
        }
    }
    None
}

/// Try to parse a string as a time.
/// Returns the fractional day value (0.0 = midnight, 0.5 = noon).
///
/// Supported: `HH:MM[:SS]`, `H:MM[:SS] AM/PM`.
///
/// # Errors
///
/// Returns [`DateParseError`] if the string does not match any recognized time format.
pub fn try_parse_time(text: &str) -> Result<f64, DateParseError> {
    try_parse_time_inner(text).ok_or_else(|| DateParseError {
        input: text.to_owned(),
        kind: "time",
    })
}

#[allow(clippy::cast_precision_loss)]
fn try_parse_time_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    let (h, m, s) = parse_time_component(text)?;
    Some(time_to_fraction(h, m, s))
}

// ---------------------------------------------------------------------------
// Date arithmetic helpers (moved from compute-functions for broader reuse)
// ---------------------------------------------------------------------------

/// Add months to a serial date.
///
/// The day is clamped to the last day of the target month (e.g. Jan 31 + 1 month = Feb 28/29).
///
#[must_use]
pub fn add_months_to_serial(serial: f64, months: i32) -> f64 {
    let (y, m, d) = serial_to_ymd(serial);
    let mut new_month = m + months;
    let mut new_year = y;

    if !(1..=12).contains(&new_month) {
        new_year += (new_month - 1).div_euclid(12);
        new_month = (new_month - 1).rem_euclid(12) + 1;
    }

    let max_day = days_in_month(new_year, new_month).unwrap_or(31);
    let new_day = d.min(max_day);
    ymd_to_serial(new_year, new_month, new_day)
}

/// Actual days between two serial dates.
#[must_use]
pub fn actual_days_between(start: f64, end: f64) -> f64 {
    end.floor() - start.floor()
}

/// 30/360 days between two serial dates.
/// method 0 = US (NASD), method 4 = European.
///
#[must_use]
pub fn days360_between(start_serial: f64, end_serial: f64, method: i32) -> f64 {
    let (sy, sm, mut sd) = serial_to_ymd(start_serial);
    let (ey, em, mut ed) = serial_to_ymd(end_serial);

    if method == 4 {
        // European 30/360
        if sd == 31 {
            sd = 30;
        }
        if ed == 31 {
            ed = 30;
        }
    } else {
        // US (NASD) 30/360
        let start_is_last_feb = sm == 2 && sd == days_in_month(sy, 2).unwrap_or(28);
        let end_is_last_feb = em == 2 && ed == days_in_month(ey, 2).unwrap_or(28);
        if start_is_last_feb {
            sd = 30;
        }
        if end_is_last_feb && start_is_last_feb {
            ed = 30;
        }
        if sd == 31 {
            sd = 30;
        }
        if ed == 31 && sd >= 30 {
            ed = 30;
        }
    }

    f64::from((ey - sy) * 360 + (em - sm) * 30 + (ed - sd))
}

/// Year fraction between two dates given basis.
///
/// Basis values: 0 = US 30/360, 1 = Actual/actual, 2 = Actual/360,
/// 3 = Actual/365, 4 = European 30/360.
#[must_use]
#[allow(clippy::match_same_arms)] // basis 0 and wildcard intentionally share the same default behavior
pub fn year_frac(start: f64, end: f64, basis: i32) -> f64 {
    let (days, year_days) = match basis {
        0 => (days360_between(start, end, 0), 360.0),
        1 => {
            let d = actual_days_between(start, end);
            let (sy, _, _) = serial_to_ymd(start);
            let (ey, _, _) = serial_to_ymd(end);
            let avg_year_days = if sy == ey {
                if is_leap_year(sy) { 366.0 } else { 365.0 }
            } else {
                // Average over the years sy..ey (exclusive of end year).
                // This matches Excel's YEARFRAC basis 1: e.g. Jan 1 2023 →
                // Jan 1 2025 spans years 2023 and 2024, giving avg =
                // (365+366)/2 = 365.5, so fraction = 731/365.5 = 2.0.
                let num_years = ey - sy;
                let total_days: f64 = (sy..ey)
                    .map(|y| if is_leap_year(y) { 366.0 } else { 365.0 })
                    .sum();
                total_days / f64::from(num_years)
            };
            (d, avg_year_days)
        }
        2 => (actual_days_between(start, end), 360.0),
        3 => (actual_days_between(start, end), 365.0),
        4 => (days360_between(start, end, 4), 360.0),
        _ => (days360_between(start, end, 0), 360.0),
    };
    if year_days == 0.0 {
        0.0
    } else {
        days / year_days
    }
}

/// Days in year by basis.
///
/// Basis values: 0/2/4 = 360, 3 = 365, 1 = actual (365 or 366).
#[must_use]
#[allow(clippy::match_same_arms)] // basis 0/2/4 and wildcard intentionally share the same default
pub fn days_in_year_by_basis(year: i32, basis: i32) -> f64 {
    match basis {
        0 | 2 | 4 => 360.0,
        3 => 365.0,
        1 => {
            if is_leap_year(year) {
                366.0
            } else {
                365.0
            }
        }
        _ => 360.0,
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::CellValue;

    #[test]
    fn try_parse_datetime_24h() {
        let serial = try_parse_datetime("01/30/2026 15:50").unwrap();
        assert!((serial - 46_052.659_722_222_22).abs() < 1e-6);

        let serial = try_parse_datetime("01/30/2026 15:50:30").unwrap();
        assert!((serial - 46_052.660_069_444_44).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_12h_am_pm() {
        let serial = try_parse_datetime("01/30/2026 03:50 PM").unwrap();
        assert!((serial - 46_052.659_722_222_22).abs() < 1e-6);

        let serial = try_parse_datetime("01/30/2026 03:50 AM").unwrap();
        assert!((serial - 46_052.159_722_222_22).abs() < 1e-6);

        let serial = try_parse_datetime("01/30/2026 12:00 PM").unwrap();
        assert!((serial - 46052.5).abs() < 1e-6);

        let serial = try_parse_datetime("01/30/2026 12:00 AM").unwrap();
        assert!((serial - 46052.0).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_12h_with_seconds() {
        let serial = try_parse_datetime("01/30/2026 03:50:30 PM").unwrap();
        assert!((serial - 46_052.660_069_444_44).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_iso_12h() {
        let serial = try_parse_datetime("2026-01-30 03:50 PM").unwrap();
        assert!((serial - 46_052.659_722_222_22).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_dash_12h() {
        let serial = try_parse_datetime("01-30-2026 03:50 PM").unwrap();
        assert!((serial - 46_052.659_722_222_22).abs() < 1e-6);
    }

    #[test]
    fn ymd_to_serial_preserves_excel_1900_leap_day() {
        assert_eq!(ymd_to_serial(1900, 2, 29), 60.0);
        assert_eq!(serial_to_ymd(60.0), (1900, 2, 29));
    }

    #[test]
    fn coerce_to_number_datetime_ampm() {
        let v = CellValue::Text("01/30/2026 03:50 PM".into());
        let n = v.coerce_to_number().unwrap();
        assert!((n - 46_052.659_722_222_22).abs() < 1e-6);
    }

    #[test]
    fn coerce_to_number_datetime_ampm_arithmetic() {
        // Simulates the workbook pattern: "01/30/2026 03:50 PM" - 0.25
        let v = CellValue::Text("01/30/2026 03:50 PM".into());
        let n = v.coerce_to_number().unwrap();
        let result = n - 0.25;
        assert!((result - 46_052.409_722_222_22).abs() < 1e-6);
    }

    // -----------------------------------------------------------------------
    // Date-only parsing
    // -----------------------------------------------------------------------

    #[test]
    fn try_parse_date_iso() {
        // YYYY-MM-DD
        let serial = try_parse_date("2024-01-15").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_us_slash() {
        // M/D/YYYY
        let serial = try_parse_date("1/15/2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        // MM/DD/YYYY
        let serial = try_parse_date("01/15/2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_us_dash() {
        // M-D-YYYY
        let serial = try_parse_date("01-15-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_european_month_name() {
        // D-Mon-YYYY
        let serial = try_parse_date("15-Jan-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        // Case-insensitive
        let serial = try_parse_date("15-JAN-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_no_dmy_fallback_for_slash() {
        // Slash dates are strictly M/D/Y (Excel behavior).
        // When the first number > 12, M/D fails and the result is None —
        // no D/M/Y fallback.
        assert!(
            try_parse_date("15/1/2024").is_err(),
            "Slash dates with invalid month should not fallback to D/M"
        );
        assert!(
            try_parse_date("25/11/2024").is_err(),
            "25/11/2024 is not a valid M/D/Y date"
        );
        assert!(
            try_parse_date("31/12/2024").is_err(),
            "31/12/2024 is not a valid M/D/Y date"
        );
    }

    #[test]
    fn try_parse_date_month_name_full() {
        // "January 15, 2024"
        let serial = try_parse_date("January 15, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        // "December 31, 2024"
        let serial = try_parse_date("December 31, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 12, 31));
    }

    #[test]
    fn try_parse_date_month_name_abbrev() {
        // "Jan 15, 2024"
        let serial = try_parse_date("Jan 15, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_month_name_no_comma() {
        // "Jan 15 2024" (no comma — should still work)
        let serial = try_parse_date("Jan 15 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_accepts_excel_1900_leap_day_forms() {
        for text in [
            "2/29/1900",
            "1900-02-29",
            "2-29-1900",
            "February 29, 1900",
            "Feb 29, 1900",
            "29-Feb-1900",
        ] {
            assert_eq!(try_parse_date(text).unwrap(), 60.0, "failed for {text}");
        }
    }

    // -----------------------------------------------------------------------
    // 2-digit year support (P3 fix for DATEVALUE mismatches)
    // -----------------------------------------------------------------------

    #[test]
    fn try_parse_date_2digit_year_slash() {
        // 0-29 → 2000-2029
        let serial = try_parse_date("1/15/24").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        let serial = try_parse_date("1/15/00").unwrap();
        assert_eq!(serial, ymd_to_serial(2000, 1, 15));
        let serial = try_parse_date("1/15/29").unwrap();
        assert_eq!(serial, ymd_to_serial(2029, 1, 15));
        // 30-99 → 1930-1999
        let serial = try_parse_date("1/15/30").unwrap();
        assert_eq!(serial, ymd_to_serial(1930, 1, 15));
        let serial = try_parse_date("1/15/99").unwrap();
        assert_eq!(serial, ymd_to_serial(1999, 1, 15));
        let serial = try_parse_date("1/15/50").unwrap();
        assert_eq!(serial, ymd_to_serial(1950, 1, 15));
    }

    #[test]
    fn try_parse_date_2digit_year_dash() {
        let serial = try_parse_date("01-15-24").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_2digit_year_month_name() {
        let serial = try_parse_date("15-Jan-24").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    // -----------------------------------------------------------------------
    // Rejection tests (should return None)
    // -----------------------------------------------------------------------

    #[test]
    fn try_parse_date_rejects_invalid() {
        assert!(try_parse_date("").is_err());
        assert!(try_parse_date("hello").is_err());
        assert!(try_parse_date("12345").is_err());
        assert!(try_parse_date("2024").is_err());
        assert!(try_parse_date("13/32/2024").is_err()); // invalid month+day
        assert!(try_parse_date("2/30/2024").is_err()); // Feb 30
        assert!(try_parse_date("2/29/2023").is_err()); // Feb 29 non-leap
        assert!(try_parse_date("2/29/2024").is_ok()); // Feb 29 leap year OK
        assert!(try_parse_date("1900-02-30").is_err()); // nearby invalid fake date
        assert!(try_parse_date("2/30/1900").is_err()); // nearby invalid fake date
        assert!(try_parse_date("2023-02-29").is_err()); // ISO non-leap
        assert!(try_parse_date("abc/def/ghi").is_err());
        assert!(try_parse_date("1/2/3/4").is_err()); // too many separators
    }

    #[test]
    fn try_parse_time_24h() {
        let t = try_parse_time("15:50").unwrap();
        assert!((t - (15.0 * 3600.0 + 50.0 * 60.0) / 86400.0).abs() < 1e-10);
        let t = try_parse_time("15:50:30").unwrap();
        assert!((t - (15.0 * 3600.0 + 50.0 * 60.0 + 30.0) / 86400.0).abs() < 1e-10);
        let t = try_parse_time("0:00").unwrap();
        assert!((t - 0.0).abs() < 1e-10);
        let t = try_parse_time("23:59:59").unwrap();
        assert!((t - (23.0 * 3600.0 + 59.0 * 60.0 + 59.0) / 86400.0).abs() < 1e-10);
    }

    #[test]
    fn try_parse_time_12h_ampm() {
        let t = try_parse_time("3:50 PM").unwrap();
        assert!((t - (15.0 * 3600.0 + 50.0 * 60.0) / 86400.0).abs() < 1e-10);
        let t = try_parse_time("3:50 AM").unwrap();
        assert!((t - (3.0 * 3600.0 + 50.0 * 60.0) / 86400.0).abs() < 1e-10);
        let t = try_parse_time("12:00 PM").unwrap();
        assert!((t - 0.5).abs() < 1e-10);
        let t = try_parse_time("12:00 AM").unwrap();
        assert!((t - 0.0).abs() < 1e-10);
        // lowercase
        let t = try_parse_time("3:50 pm").unwrap();
        assert!((t - (15.0 * 3600.0 + 50.0 * 60.0) / 86400.0).abs() < 1e-10);
    }

    #[test]
    fn serial_to_date_zero() {
        // Serial 0 = "January 0, 1900" → maps to Dec 31, 1899
        assert_eq!(serial_to_date(0.0), NaiveDate::from_ymd_opt(1899, 12, 31));
    }

    #[test]
    fn serial_to_date_negative_rejected() {
        assert_eq!(serial_to_date(-1.0), None);
        assert_eq!(serial_to_date(-0.5), None);
    }

    #[test]
    fn try_parse_time_rejects_invalid() {
        assert!(try_parse_time("24:00").is_err());
        assert!(try_parse_time("0:00 AM").is_err()); // 0 AM invalid in 12h
        assert!(try_parse_time("13:00 PM").is_err()); // 13 PM invalid
        assert!(try_parse_time("12:60").is_err()); // minute > 59
        assert!(try_parse_time("hello").is_err());
        assert!(try_parse_time("").is_err());
    }

    // -----------------------------------------------------------------------
    // Datetime with 2-digit year
    // -----------------------------------------------------------------------

    #[test]
    fn try_parse_datetime_2digit_year() {
        let serial = try_parse_datetime("1/15/24 15:50").unwrap();
        let expected = ymd_to_serial(2024, 1, 15) + (15.0 * 3600.0 + 50.0 * 60.0) / 86400.0;
        assert!((serial - expected).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_month_name() {
        let serial = try_parse_datetime("January 15, 2024 3:00 PM").unwrap();
        let expected = ymd_to_serial(2024, 1, 15) + 0.625;
        assert!((serial - expected).abs() < 1e-6);
    }

    #[test]
    fn try_parse_datetime_accepts_excel_1900_leap_day_forms() {
        let serial = try_parse_datetime("2/29/1900 15:30").unwrap();
        assert!((serial - 60.645_833_333_333_336).abs() < 1e-10);

        let serial = try_parse_datetime("February 29, 1900 3:30 PM").unwrap();
        assert!((serial - 60.645_833_333_333_336).abs() < 1e-10);
    }

    // -----------------------------------------------------------------------
    // Non-date text rejection (performance-critical: must fail fast)
    // -----------------------------------------------------------------------

    #[test]
    fn try_parse_date_rejects_common_text_fast() {
        // These are the kinds of text cells that appear millions of times
        // in criteria ranges. They must fail quickly, not after 25 format attempts.
        assert!(try_parse_date("Revenue").is_err());
        assert!(try_parse_date("Active").is_err());
        assert!(try_parse_date("CONTRACT-12345").is_err());
        assert!(try_parse_date("N/A").is_err());
        assert!(try_parse_date("Yes").is_err());
        assert!(try_parse_date("123 Main St").is_err());
        assert!(try_parse_date("Q1 2024").is_err());
    }

    // -----------------------------------------------------------------------
    // Date arithmetic helpers
    // -----------------------------------------------------------------------

    #[test]
    fn add_months_basic() {
        // Jan 15, 2024 + 1 month = Feb 15, 2024
        let jan15 = ymd_to_serial(2024, 1, 15);
        let feb15 = ymd_to_serial(2024, 2, 15);
        assert_eq!(add_months_to_serial(jan15, 1), feb15);
    }

    #[test]
    fn add_months_clamp_day() {
        // Jan 31, 2024 + 1 month = Feb 29, 2024 (leap year, day clamped)
        let jan31 = ymd_to_serial(2024, 1, 31);
        let feb29 = ymd_to_serial(2024, 2, 29);
        assert_eq!(add_months_to_serial(jan31, 1), feb29);

        // Jan 31, 2023 + 1 month = Feb 28, 2023 (non-leap year)
        let jan31_23 = ymd_to_serial(2023, 1, 31);
        let feb28_23 = ymd_to_serial(2023, 2, 28);
        assert_eq!(add_months_to_serial(jan31_23, 1), feb28_23);
    }

    #[test]
    fn add_months_negative() {
        // Mar 15, 2024 - 2 months = Jan 15, 2024
        let mar15 = ymd_to_serial(2024, 3, 15);
        let jan15 = ymd_to_serial(2024, 1, 15);
        assert_eq!(add_months_to_serial(mar15, -2), jan15);
    }

    #[test]
    fn add_months_cross_year() {
        // Nov 15, 2023 + 3 months = Feb 15, 2024
        let nov15 = ymd_to_serial(2023, 11, 15);
        let feb15 = ymd_to_serial(2024, 2, 15);
        assert_eq!(add_months_to_serial(nov15, 3), feb15);
    }

    #[test]
    fn actual_days_between_basic() {
        let jan_first = ymd_to_serial(2024, 1, 1);
        let jan_last = ymd_to_serial(2024, 1, 31);
        assert_eq!(actual_days_between(jan_first, jan_last), 30.0);
    }

    #[test]
    fn actual_days_between_same_date() {
        let d = ymd_to_serial(2024, 6, 15);
        assert_eq!(actual_days_between(d, d), 0.0);
    }

    #[test]
    fn days360_us_basic() {
        // 30/360 US: Jan 1 to Jul 1 = 180 days
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert_eq!(days360_between(jan1, jul1, 0), 180.0);
    }

    #[test]
    fn days360_european_31st() {
        // European: both 31sts become 30
        let jan31 = ymd_to_serial(2024, 1, 31);
        let mar31 = ymd_to_serial(2024, 3, 31);
        assert_eq!(days360_between(jan31, mar31, 4), 60.0);
    }

    #[test]
    fn year_frac_basis0() {
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        assert!((year_frac(jan1, jul1, 0) - 0.5).abs() < 1e-10);
    }

    #[test]
    fn year_frac_basis3() {
        // Actual/365
        let jan1 = ymd_to_serial(2024, 1, 1);
        let feb1 = ymd_to_serial(2024, 2, 1);
        assert!((year_frac(jan1, feb1, 3) - 31.0 / 365.0).abs() < 1e-10);
    }

    #[test]
    fn days_in_year_by_basis_all() {
        assert_eq!(days_in_year_by_basis(2024, 0), 360.0);
        assert_eq!(days_in_year_by_basis(2024, 1), 366.0); // 2024 is leap
        assert_eq!(days_in_year_by_basis(2023, 1), 365.0); // 2023 is not leap
        assert_eq!(days_in_year_by_basis(2024, 2), 360.0);
        assert_eq!(days_in_year_by_basis(2024, 3), 365.0);
        assert_eq!(days_in_year_by_basis(2024, 4), 360.0);
    }

    // -----------------------------------------------------------------------
    // serial_to_ymd O(1) algorithm verification
    // -----------------------------------------------------------------------

    #[test]
    fn serial_to_ymd_known_dates() {
        assert_eq!(serial_to_ymd(1.0), (1900, 1, 1));
        assert_eq!(serial_to_ymd(59.0), (1900, 2, 28));
        assert_eq!(serial_to_ymd(60.0), (1900, 2, 29)); // Lotus bug
        assert_eq!(serial_to_ymd(61.0), (1900, 3, 1));
        assert_eq!(serial_to_ymd(366.0), (1900, 12, 31));
        assert_eq!(serial_to_ymd(367.0), (1901, 1, 1));
        assert_eq!(serial_to_ymd(44927.0), (2023, 1, 1));
        assert_eq!(serial_to_ymd(45292.0), (2024, 1, 1)); // leap year
        assert_eq!(serial_to_ymd(45352.0), (2024, 3, 1));
        assert_eq!(serial_to_ymd(45657.0), (2024, 12, 31));
        assert_eq!(serial_to_ymd(45658.0), (2025, 1, 1));
    }

    #[test]
    fn serial_to_ymd_roundtrip_spot_check() {
        // Verify ymd_to_serial → serial_to_ymd roundtrips for a spread of dates.
        let cases = [
            (1900, 1, 1),
            (1900, 2, 28),
            (1900, 3, 1),
            (1900, 12, 31),
            (1901, 1, 1),
            (1950, 6, 15),
            (1999, 12, 31),
            (2000, 1, 1),
            (2000, 2, 29), // leap
            (2024, 2, 29), // leap
            (2024, 7, 4),
            (2100, 3, 1), // 2100 is NOT a leap year
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

    // -----------------------------------------------------------------------
    // year_frac basis 1 (Actual/Actual) tests
    // -----------------------------------------------------------------------

    #[test]
    fn year_frac_basis1_same_year_leap() {
        // Jan 1 to Jul 1, 2024 (leap year): 182 days / 366 = 0.49726...
        let jan1 = ymd_to_serial(2024, 1, 1);
        let jul1 = ymd_to_serial(2024, 7, 1);
        let frac = year_frac(jan1, jul1, 1);
        assert!(
            (frac - 182.0 / 366.0).abs() < 1e-10,
            "same-year leap: expected {}, got {frac}",
            182.0 / 366.0
        );
    }

    #[test]
    fn year_frac_basis1_multi_year_exact() {
        // Jan 1, 2023 to Jan 1, 2025 = exactly 2.0 years.
        // 2023 has 365 days, 2024 has 366 days → 731 actual days.
        // avg year = (365+366)/2 = 365.5 → 731/365.5 = 2.0.
        let start = ymd_to_serial(2023, 1, 1);
        let end = ymd_to_serial(2025, 1, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 2.0).abs() < 1e-10,
            "multi-year exact: expected 2.0, got {frac}"
        );
    }

    #[test]
    fn year_frac_basis1_cross_leap_year() {
        // Jul 1, 2023 to Jul 1, 2025: crosses the 2024 leap year.
        // Actual days: 184 (rest of 2023) + 366 (2024) + 181 (2025) = 731.
        // sy=2023, ey=2025, avg = (365+366)/2 = 365.5.
        // frac = 731 / 365.5 = 2.0.
        let start = ymd_to_serial(2023, 7, 1);
        let end = ymd_to_serial(2025, 7, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 2.0).abs() < 1e-10,
            "cross-leap: expected 2.0, got {frac}"
        );
    }

    #[test]
    fn year_frac_basis1_single_year_non_leap() {
        // Jan 1 to Apr 1, 2023 (non-leap): 90 days / 365
        let start = ymd_to_serial(2023, 1, 1);
        let end = ymd_to_serial(2023, 4, 1);
        let frac = year_frac(start, end, 1);
        assert!(
            (frac - 90.0 / 365.0).abs() < 1e-10,
            "same-year non-leap: expected {}, got {frac}",
            90.0 / 365.0
        );
    }
}
