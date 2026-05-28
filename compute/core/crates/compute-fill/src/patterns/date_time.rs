use value_types::CellValue;
use value_types::date_serial::serial_to_ymd;

use crate::types::{DateUnit, FillPattern, FillPatternType, TimeUnit};

use super::default_pattern;
use super::values::{TOLERANCE, all_numbers};

/// Excel valid date serial range: 1 .. 2_958_465 (1900-01-01 .. 9999-12-31).
const MIN_DATE_SERIAL: f64 = 1.0;
const MAX_DATE_SERIAL: f64 = 2_958_465.0;

fn is_valid_date_serial(serial: f64) -> bool {
    (MIN_DATE_SERIAL..=MAX_DATE_SERIAL).contains(&serial)
}

pub(crate) fn detect_date_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }
    // All must be valid date serials.
    if !nums
        .iter()
        .all(|&n| n.is_finite() && is_valid_date_serial(n))
    {
        return None;
    }

    let ymds: Vec<(i32, i32, i32)> = nums.iter().map(|&n| serial_to_ymd(n)).collect();

    let serial_ints: Vec<i64> = nums.iter().map(|&n| n.floor() as i64).collect();
    let day_diff = serial_ints[1] - serial_ints[0];

    if day_diff != 0 {
        let mut consistent = true;
        for i in 2..serial_ints.len() {
            if serial_ints[i] - serial_ints[i - 1] != day_diff {
                consistent = false;
                break;
            }
        }
        if consistent {
            let dows: Vec<u32> = nums.iter().map(|&n| day_of_week_from_serial(n)).collect();
            let is_weekday_only = dows.iter().all(|&d| (1..=5).contains(&d));

            if is_weekday_only && (1..=5).contains(&day_diff) {
                let mut skipped_weekend = false;
                for i in 1..dows.len() {
                    let prev = dows[i - 1];
                    let curr = dows[i];
                    // Friday(5) -> Monday(1) means we skipped a weekend.
                    if prev == 5 && curr == 1 {
                        skipped_weekend = true;
                        break;
                    }
                    let expected = (prev + day_diff as u32) % 7;
                    if curr != expected && (curr == 1 || expected == 0 || expected == 6) {
                        skipped_weekend = true;
                        break;
                    }
                }
                if skipped_weekend {
                    return Some(FillPattern {
                        pattern_type: FillPatternType::Date,
                        date_unit: Some(DateUnit::Weekday),
                        step: Some(day_diff as f64),
                        ..default_pattern()
                    });
                }
            }

            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Day),
                step: Some(day_diff as f64),
                ..default_pattern()
            });
        }
    }

    // Year increment (check before month so 12-month intervals -> yearly).
    let year_diff = ymds[1].0 - ymds[0].0;
    if year_diff != 0 && ymds[0].1 == ymds[1].1 && ymds[0].2 == ymds[1].2 {
        let mut consistent = true;
        for i in 2..ymds.len() {
            let diff = ymds[i].0 - ymds[i - 1].0;
            if diff != year_diff || ymds[i].1 != ymds[0].1 || ymds[i].2 != ymds[0].2 {
                consistent = false;
                break;
            }
        }
        if consistent {
            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Year),
                step: Some(year_diff as f64),
                ..default_pattern()
            });
        }
    }

    let month_diff = (ymds[1].0 - ymds[0].0) * 12 + (ymds[1].1 - ymds[0].1);
    if month_diff != 0 && ymds[0].2 == ymds[1].2 {
        let mut consistent = true;
        for i in 2..ymds.len() {
            let diff = (ymds[i].0 - ymds[i - 1].0) * 12 + (ymds[i].1 - ymds[i - 1].1);
            if diff != month_diff || ymds[i].2 != ymds[0].2 {
                consistent = false;
                break;
            }
        }
        if consistent {
            return Some(FillPattern {
                pattern_type: FillPatternType::Date,
                date_unit: Some(DateUnit::Month),
                step: Some(month_diff as f64),
                ..default_pattern()
            });
        }
    }

    None
}

/// Compute day-of-week from an Excel serial number. 0=Sunday .. 6=Saturday.
/// Excel serial 1 = 1900-01-01 which was a Monday (dow=1).
fn day_of_week_from_serial(serial: f64) -> u32 {
    let s = serial.floor() as i64;
    let r = ((s % 7) + 7) % 7;
    r as u32
}

pub(crate) fn detect_time_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    // All must share the same integer part (same date).
    let int_parts: Vec<i64> = nums.iter().map(|&n| n.floor() as i64).collect();
    if !int_parts.iter().all(|&d| d == int_parts[0]) {
        return None;
    }

    let fractions: Vec<f64> = nums.iter().map(|&n| n % 1.0).collect();
    let time_diff = fractions[1] - fractions[0];
    if time_diff == 0.0 {
        return None;
    }

    for i in 2..fractions.len() {
        let diff = fractions[i] - fractions[i - 1];
        if (diff - time_diff).abs() > TOLERANCE {
            return None;
        }
    }

    let minutes_diff = (time_diff * 1440.0).round() as i64;
    let hours_diff = minutes_diff as f64 / 60.0;

    if hours_diff == hours_diff.floor() && hours_diff != 0.0 {
        return Some(FillPattern {
            pattern_type: FillPatternType::Time,
            time_unit: Some(TimeUnit::Hour),
            step: Some(hours_diff),
            ..default_pattern()
        });
    }
    if minutes_diff != 0 {
        return Some(FillPattern {
            pattern_type: FillPatternType::Time,
            time_unit: Some(TimeUnit::Minute),
            step: Some(minutes_diff as f64),
            ..default_pattern()
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_of_week_serial_1_is_monday() {
        assert_eq!(day_of_week_from_serial(1.0), 1);
    }

    #[test]
    fn day_of_week_serial_7_is_sunday() {
        assert_eq!(day_of_week_from_serial(7.0), 0);
    }
}
