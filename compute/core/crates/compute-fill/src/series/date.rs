use value_types::CellValue;
use value_types::date_serial::add_months_to_serial;

use crate::types::DateUnit;

use super::common::{anchor_number, generate_copy, num_or_error};

pub(super) fn generate_date(
    source_values: &[CellValue],
    count: usize,
    unit: DateUnit,
    step: i32,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last_serial = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };

    let mut result = Vec::with_capacity(count);
    let mut current_serial = last_serial;

    for _ in 0..count {
        match unit {
            DateUnit::Day => {
                current_serial += f64::from(step * direction_mult);
            }
            DateUnit::Weekday => {
                let mut days_remaining = (step * direction_mult).abs();
                let dir = if step * direction_mult > 0 { 1.0 } else { -1.0 };
                while days_remaining > 0 {
                    current_serial += dir;
                    if !is_weekend_serial(current_serial) {
                        days_remaining -= 1;
                    }
                }
            }
            DateUnit::Month => {
                current_serial = add_months_to_serial(current_serial, step * direction_mult);
            }
            DateUnit::Year => {
                current_serial = add_months_to_serial(current_serial, step * direction_mult * 12);
            }
        }
        result.push(num_or_error(current_serial));
    }
    result
}

/// Check if a serial date falls on a weekend (Saturday or Sunday).
///
/// Excel serial 1 = Jan 1, 1900 which was a Sunday.
/// So serial % 7: 0 = Saturday, 1 = Sunday, 2 = Monday, ..., 6 = Friday.
pub(super) fn is_weekend_serial(serial: f64) -> bool {
    let day_int = serial.floor() as i64;
    let dow = day_int.rem_euclid(7);
    // 0 = Saturday, 1 = Sunday
    dow == 0 || dow == 1
}
