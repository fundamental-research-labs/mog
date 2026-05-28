use super::calendar::{days_in_month, ymd_to_serial};

/// Error returned when a string cannot be parsed as a date, time, or datetime.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("failed to parse \"{input}\" as a {kind}")]
pub struct DateParseError {
    /// The input string that could not be parsed.
    pub input: String,
    /// What kind of parse was attempted.
    pub kind: &'static str,
}

// Hand-rolled text to serial parsing.
//
// These helpers are used by text coercion, comparable-number conversion,
// compute-functions text conversion, schema validation, and date parsing
// functions. They extract fields with byte-level scanning to avoid chrono
// format parsing overhead on hot text-coercion paths.

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

fn skip_ws(bytes: &[u8], mut pos: usize) -> usize {
    while pos < bytes.len() && bytes[pos] == b' ' {
        pos += 1;
    }
    pos
}

fn skip_comma_ws(bytes: &[u8], mut pos: usize) -> usize {
    if pos < bytes.len() && bytes[pos] == b',' {
        pos += 1;
    }
    skip_ws(bytes, pos)
}

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
    Some((month, i))
}

#[allow(clippy::cast_possible_wrap)] // y is 0..=99.
fn resolve_2digit_year(y: u32) -> i32 {
    if y <= 29 {
        (2000 + y) as i32
    } else {
        (1900 + y) as i32
    }
}

#[allow(clippy::cast_sign_loss, clippy::cast_possible_wrap)]
fn validated_ymd_to_serial(year: i32, month: u32, day: u32) -> Option<f64> {
    if !(1..=12).contains(&month) || day < 1 || !(1900..=9999).contains(&year) {
        return None;
    }
    if year == 1900 && month == 2 && day == 29 {
        return Some(60.0);
    }
    let max_day = days_in_month(year, month as i32).unwrap() as u32;
    if day > max_day {
        return None;
    }
    Some(ymd_to_serial(year, month as i32, day as i32))
}

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

    let rest = text[pos..].trim();
    let hour = if rest.is_empty() {
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

#[allow(clippy::cast_possible_wrap)]
fn try_parse_date_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let bytes = text.as_bytes();

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
            validated_ymd_to_serial(year, first, second)
        }
        b'-' => {
            if first > 99 {
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
///
/// Returns the Excel serial number (integer part = date, fractional = time).
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

fn try_parse_datetime_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    let bytes = text.as_bytes();

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
///
/// Returns the fractional day value (0.0 = midnight, 0.5 = noon).
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

fn try_parse_time_inner(text: &str) -> Option<f64> {
    let text = text.trim();
    let (h, m, s) = parse_time_component(text)?;
    Some(time_to_fraction(h, m, s))
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

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
    fn try_parse_date_iso() {
        let serial = try_parse_date("2024-01-15").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_us_slash() {
        let serial = try_parse_date("1/15/2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        let serial = try_parse_date("01/15/2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_us_dash() {
        let serial = try_parse_date("01-15-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_european_month_name() {
        let serial = try_parse_date("15-Jan-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        let serial = try_parse_date("15-JAN-2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_no_dmy_fallback_for_slash() {
        assert!(try_parse_date("15/1/2024").is_err());
        assert!(try_parse_date("25/11/2024").is_err());
        assert!(try_parse_date("31/12/2024").is_err());
    }

    #[test]
    fn try_parse_date_month_name_full() {
        let serial = try_parse_date("January 15, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        let serial = try_parse_date("December 31, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 12, 31));
    }

    #[test]
    fn try_parse_date_month_name_abbrev() {
        let serial = try_parse_date("Jan 15, 2024").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
    }

    #[test]
    fn try_parse_date_month_name_no_comma() {
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

    #[test]
    fn try_parse_date_2digit_year_slash() {
        let serial = try_parse_date("1/15/24").unwrap();
        assert_eq!(serial, ymd_to_serial(2024, 1, 15));
        let serial = try_parse_date("1/15/00").unwrap();
        assert_eq!(serial, ymd_to_serial(2000, 1, 15));
        let serial = try_parse_date("1/15/29").unwrap();
        assert_eq!(serial, ymd_to_serial(2029, 1, 15));
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

    #[test]
    fn try_parse_date_rejects_invalid() {
        assert!(try_parse_date("").is_err());
        assert!(try_parse_date("hello").is_err());
        assert!(try_parse_date("12345").is_err());
        assert!(try_parse_date("2024").is_err());
        assert!(try_parse_date("13/32/2024").is_err());
        assert!(try_parse_date("2/30/2024").is_err());
        assert!(try_parse_date("2/29/2023").is_err());
        assert!(try_parse_date("2/29/2024").is_ok());
        assert!(try_parse_date("1900-02-30").is_err());
        assert!(try_parse_date("2/30/1900").is_err());
        assert!(try_parse_date("2023-02-29").is_err());
        assert!(try_parse_date("abc/def/ghi").is_err());
        assert!(try_parse_date("1/2/3/4").is_err());
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
        let t = try_parse_time("3:50 pm").unwrap();
        assert!((t - (15.0 * 3600.0 + 50.0 * 60.0) / 86400.0).abs() < 1e-10);
    }

    #[test]
    fn try_parse_time_rejects_invalid() {
        assert!(try_parse_time("24:00").is_err());
        assert!(try_parse_time("0:00 AM").is_err());
        assert!(try_parse_time("13:00 PM").is_err());
        assert!(try_parse_time("12:60").is_err());
        assert!(try_parse_time("12:00:60").is_err());
        assert!(try_parse_time("hello").is_err());
        assert!(try_parse_time("").is_err());
    }

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

    #[test]
    fn try_parse_date_rejects_common_text_fast() {
        assert!(try_parse_date("Revenue").is_err());
        assert!(try_parse_date("Active").is_err());
        assert!(try_parse_date("CONTRACT-12345").is_err());
        assert!(try_parse_date("N/A").is_err());
        assert!(try_parse_date("Yes").is_err());
        assert!(try_parse_date("123 Main St").is_err());
        assert!(try_parse_date("Q1 2024").is_err());
    }
}
