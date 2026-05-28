use value_types::CellValue;

use crate::types::{FillPattern, FillPatternType};

use super::default_pattern;
use super::values::{TOLERANCE, all_numbers};

pub(crate) fn detect_linear_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    let step = nums[1] - nums[0];

    for i in 2..nums.len() {
        if (nums[i] - nums[i - 1] - step).abs() > TOLERANCE {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Linear,
        step: Some(step),
        ..default_pattern()
    })
}

pub(crate) fn detect_growth_pattern(values: &[CellValue]) -> Option<FillPattern> {
    let nums = all_numbers(values)?;
    if nums.len() < 2 {
        return None;
    }

    // All must be non-zero.
    if nums.contains(&0.0) {
        return None;
    }

    let multiplier = nums[1] / nums[0];

    // Reject multiplier approximately 1.0 because linear owns that case.
    if (multiplier - 1.0).abs() < TOLERANCE {
        return None;
    }

    for i in 2..nums.len() {
        if (nums[i] / nums[i - 1] - multiplier).abs() > TOLERANCE {
            return None;
        }
    }

    Some(FillPattern {
        pattern_type: FillPatternType::Growth,
        multiplier: Some(multiplier),
        ..default_pattern()
    })
}
