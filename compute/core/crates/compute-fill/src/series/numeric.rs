use value_types::CellValue;

use crate::types::TimeUnit;

use super::common::{anchor_number, generate_copy, num_or_error};

pub(super) fn generate_linear(
    source_values: &[CellValue],
    count: usize,
    step: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };
    let mult = f64::from(direction_mult);
    (0..count)
        .map(|i| num_or_error(last + step * (i as f64 + 1.0) * mult))
        .collect()
}

pub(super) fn generate_growth(
    source_values: &[CellValue],
    count: usize,
    multiplier: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };
    let mut result = Vec::with_capacity(count);
    let mut current = last;
    for _ in 0..count {
        if direction_mult >= 0 {
            current *= multiplier;
        } else {
            current /= multiplier;
        }
        result.push(num_or_error(current));
    }
    result
}

pub(super) fn generate_time(
    source_values: &[CellValue],
    count: usize,
    unit: TimeUnit,
    step: f64,
    direction_mult: i32,
) -> Vec<CellValue> {
    let last = match anchor_number(source_values, 1) {
        Some(v) => v,
        None => return generate_copy(source_values, count),
    };

    let increment_per_unit = match unit {
        TimeUnit::Hour => 1.0 / 24.0,
        TimeUnit::Minute => 1.0 / 1440.0,
        TimeUnit::Second => 1.0 / 86400.0,
    };

    let mult = f64::from(direction_mult);
    let mut result = Vec::with_capacity(count);
    let mut current = last;
    for _ in 0..count {
        current += step * mult * increment_per_unit;
        result.push(num_or_error(current));
    }
    result
}
