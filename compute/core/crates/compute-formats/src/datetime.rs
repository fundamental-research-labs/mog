//! Date/time formatting for Excel serial numbers.

use std::fmt::Write as _;

use chrono::Datelike;
use value_types::date_serial::{serial_to_date, serial_to_ymd};

use crate::locale::{self, CultureInfo};
use crate::types::{FormatSection, Token};

pub(crate) fn serial_to_datetime_parts(serial: f64) -> (i32, u32, u32, u32, u32, u32) {
    let time_frac = serial.fract().abs();

    let total_seconds = (time_frac * 86400.0).round() as u64;
    let hours = (total_seconds / 3600) % 24;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    // Serial 0 is Excel's special "January 0, 1900" — TEXT(0, "mm/dd/yyyy") = "01/00/1900".
    let int_serial = serial.floor() as i64;
    let (year, month, day) = if int_serial == 0 {
        (1900i32, 1u32, 0u32)
    } else {
        let (y, m, d) = serial_to_ymd(serial);
        (y, m as u32, d as u32)
    };

    (
        year,
        month,
        day,
        hours as u32,
        minutes as u32,
        seconds as u32,
    )
}

#[allow(clippy::too_many_lines)] // datetime token dispatch is inherently verbose
pub(crate) fn format_datetime(
    serial: f64,
    section: &FormatSection,
    locale: &CultureInfo,
) -> String {
    let (year, month, day, hours, minutes, seconds) = serial_to_datetime_parts(serial);

    let has_ampm = section.tokens.iter().any(|t| matches!(t, Token::AmPm(_)));
    let (display_hour, ampm_str) = if has_ampm {
        let h12 = if hours == 0 {
            12
        } else if hours > 12 {
            hours - 12
        } else {
            hours
        };
        let ampm = locale::get_am_pm_designator(locale, hours);
        (h12, ampm)
    } else {
        (hours, "")
    };

    // Elapsed time computations (for [h], [m], [s] brackets)
    let total_seconds_f = serial.abs() * 86400.0;
    let total_seconds_all = total_seconds_f.round() as u64;
    let total_hours = total_seconds_all / 3600;
    let total_minutes_all = total_seconds_all / 60;

    let has_elapsed_hours = section
        .tokens
        .iter()
        .any(|t| matches!(t, Token::ElapsedHours));
    let has_elapsed_minutes = section
        .tokens
        .iter()
        .any(|t| matches!(t, Token::ElapsedMinutes));

    // Remaining minutes/seconds after elapsed hours
    let elapsed_remaining_minutes = (total_seconds_all % 3600) / 60;
    let elapsed_remaining_seconds = total_seconds_all % 60;

    // Use serial_to_date for weekday: it returns a valid NaiveDate even for serial 60
    // (mapped to Mar 1, 1900 which has the correct weekday for the fictional Feb 29, 1900).
    // Serial 0 is a special case: Excel treats it as Saturday.
    // weekday_sun0: Sunday=0, Monday=1, ..., Saturday=6 (matches locale's day_names indexing)
    let int_serial = serial.floor() as i64;
    let weekday_sun0 = if int_serial == 0 {
        6 // Saturday in Sun=0..Sat=6 indexing
    } else {
        // SAFETY: 1900-01-01 is a valid date; from_ymd_opt cannot return None here.
        let weekday_date = serial_to_date(serial)
            .unwrap_or(chrono::NaiveDate::from_ymd_opt(1900, 1, 1).expect("constant date"));
        weekday_date.weekday().num_days_from_sunday() as usize
    };

    let mut result = String::new();
    for tok in &section.tokens {
        match tok {
            Token::DateYear4 => {
                let _ = write!(result, "{year:04}");
            }
            Token::DateYear2 => {
                let _ = write!(result, "{:02}", year % 100);
            }
            Token::DateMonth1 => {
                let _ = write!(result, "{month}");
            }
            Token::DateMonth2 => {
                let _ = write!(result, "{month:02}");
            }
            Token::DateMonthName3 => {
                if (1..=12).contains(&month) {
                    result.push_str(locale::get_abbreviated_month_name(
                        locale,
                        (month - 1) as usize,
                    ));
                }
            }
            Token::DateMonthName4 => {
                if (1..=12).contains(&month) {
                    result.push_str(locale::get_month_name(locale, (month - 1) as usize));
                }
            }
            Token::DateMonthName5 => {
                if (1..=12).contains(&month) {
                    result.push_str(locale::get_month_first_letter(locale, (month - 1) as usize));
                }
            }
            Token::DateDay1 => {
                let _ = write!(result, "{day}");
            }
            Token::DateDay2 => {
                let _ = write!(result, "{day:02}");
            }
            Token::DateDayName3 => {
                result.push_str(locale::get_abbreviated_day_name(locale, weekday_sun0));
            }
            Token::DateDayName4 => result.push_str(locale::get_day_name(locale, weekday_sun0)),
            Token::DateHour1 => {
                let _ = write!(result, "{display_hour}");
            }
            Token::DateHour2 => {
                let _ = write!(result, "{display_hour:02}");
            }
            Token::DateMinute1 => {
                if has_elapsed_hours {
                    let _ = write!(result, "{elapsed_remaining_minutes}");
                } else {
                    let _ = write!(result, "{minutes}");
                }
            }
            Token::DateMinute2 => {
                if has_elapsed_hours {
                    let _ = write!(result, "{elapsed_remaining_minutes:02}");
                } else {
                    let _ = write!(result, "{minutes:02}");
                }
            }
            Token::DateSecond1 => {
                if has_elapsed_hours || has_elapsed_minutes {
                    let _ = write!(result, "{elapsed_remaining_seconds}");
                } else {
                    let _ = write!(result, "{seconds}");
                }
            }
            Token::DateSecond2 => {
                if has_elapsed_hours || has_elapsed_minutes {
                    let _ = write!(result, "{elapsed_remaining_seconds:02}");
                } else {
                    let _ = write!(result, "{seconds:02}");
                }
            }
            Token::ElapsedHours => {
                let _ = write!(result, "{total_hours}");
            }
            Token::ElapsedMinutes => {
                if has_elapsed_hours {
                    let _ = write!(result, "{elapsed_remaining_minutes:02}");
                } else {
                    let _ = write!(result, "{total_minutes_all}");
                }
            }
            Token::ElapsedSeconds => {
                if has_elapsed_hours || has_elapsed_minutes {
                    let _ = write!(result, "{elapsed_remaining_seconds:02}");
                } else {
                    let _ = write!(result, "{total_seconds_all}");
                }
            }
            Token::AmPm(orig) => {
                let upper = orig.to_uppercase();
                if upper == "A/P" {
                    result.push_str(&ampm_str[..1]);
                } else {
                    result.push_str(ampm_str);
                }
            }
            Token::Literal(s) => result.push_str(s),
            Token::SkipWidth(_) => result.push(' '),
            _ => {}
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date_to_serial(year: i32, month: u32, day: u32) -> f64 {
        let date = chrono::NaiveDate::from_ymd_opt(year, month, day).unwrap();
        value_types::date_serial::date_to_serial(&date)
    }

    #[test]
    fn serial_to_datetime_parts_roundtrips_normal_dates() {
        let serial = date_to_serial(2024, 6, 15);
        let (year, month, day, _, _, _) = serial_to_datetime_parts(serial);
        assert_eq!((year, month, day), (2024, 6, 15));
    }

    #[test]
    fn serial_zero_uses_excel_january_zero() {
        let (year, month, day, _, _, _) = serial_to_datetime_parts(0.0);
        assert_eq!((year, month, day), (1900, 1, 0));
    }
}
