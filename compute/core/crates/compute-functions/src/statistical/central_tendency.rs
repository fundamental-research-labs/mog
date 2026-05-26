//! Central tendency functions:
//! MEDIAN, MODE, MODE.SNGL, MODE.MULT, AVERAGEA, GEOMEAN, HARMEAN, TRIMMEAN

use value_types::{CellError, CellValue};

use super::helpers::extract_numbers_a;
use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnMedian;
impl PureFunction for FnMedian {
    fn name(&self) -> &'static str {
        "MEDIAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "MEDIAN: no numeric values in data")
            }
            Ok(mut nums) => {
                nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let mid = nums.len() / 2;
                if nums.len() % 2 == 0 {
                    CellValue::number((nums[mid - 1] + nums[mid]) / 2.0)
                } else {
                    CellValue::number(nums[mid])
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnMode;
impl PureFunction for FnMode {
    fn name(&self) -> &'static str {
        "MODE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Na, "MODE: no numeric values in data")
            }
            Ok(nums) => {
                // Find most frequent value
                let mut counts: Vec<(f64, usize)> = Vec::new();
                for &n in &nums {
                    let found = counts.iter_mut().find(|(v, _)| *v == n);
                    if let Some((_, count)) = found {
                        *count += 1;
                    } else {
                        counts.push((n, 1));
                    }
                }
                let max_count = counts.iter().map(|(_, c)| *c).max().unwrap_or(0);
                if max_count <= 1 {
                    CellValue::error_with_message(CellError::Na, "MODE: no repeating values found")
                } else {
                    // Return the first value that has the max count (matches Excel)
                    for &n in &nums {
                        let count = counts.iter().find(|(v, _)| *v == n);
                        if let Some((_, c)) = count
                            && *c == max_count
                        {
                            return CellValue::number(n);
                        }
                    }
                    CellValue::error_with_message(CellError::Na, "MODE: no repeating values found")
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAverageA;
impl PureFunction for FnAverageA {
    fn name(&self) -> &'static str {
        "AVERAGEA"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_a(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Div0, "AVERAGEA: no values to average")
            }
            Ok(nums) => CellValue::number(nums.iter().sum::<f64>() / nums.len() as f64),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnGeoMean;
impl PureFunction for FnGeoMean {
    fn name(&self) -> &'static str {
        "GEOMEAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "GEOMEAN: no numeric values in data")
            }
            Ok(nums) => {
                if nums.iter().any(|&x| x <= 0.0) {
                    return CellValue::error_with_message(
                        CellError::Num,
                        "GEOMEAN: all values must be positive",
                    );
                }
                let log_sum: f64 = nums.iter().map(|x| x.ln()).sum();
                CellValue::number((log_sum / nums.len() as f64).exp())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnHarMean;
impl PureFunction for FnHarMean {
    fn name(&self) -> &'static str {
        "HARMEAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "HARMEAN: no numeric values in data")
            }
            Ok(nums) => {
                if nums.iter().any(|&x| x <= 0.0) {
                    return CellValue::error_with_message(
                        CellError::Num,
                        "HARMEAN: all values must be positive",
                    );
                }
                let recip_sum: f64 = nums.iter().map(|x| 1.0 / x).sum();
                CellValue::number(nums.len() as f64 / recip_sum)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnTrimMean;
impl PureFunction for FnTrimMean {
    fn name(&self) -> &'static str {
        "TRIMMEAN"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let percent = match args[1].coerce_to_number() {
            Ok(p) if !(0.0..1.0).contains(&p) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("TRIMMEAN: percent must be between 0 and 1, got {p}"),
                );
            }
            Ok(p) => p,
            Err(e) => return CellValue::Error(e, None),
        };
        let flat = flatten_values(&[args[0].clone()]);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "TRIMMEAN: no numeric values in data")
            }
            Ok(mut nums) => {
                nums.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let trim_count = ((nums.len() as f64 * percent) / 2.0).floor() as usize;
                let trimmed = &nums[trim_count..nums.len() - trim_count];
                if trimmed.is_empty() {
                    return CellValue::error_with_message(
                        CellError::Num,
                        "TRIMMEAN: trimming percentage removes all data points",
                    );
                }
                CellValue::number(trimmed.iter().sum::<f64>() / trimmed.len() as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// MODE.SNGL is an alias for MODE
pub(super) struct FnModeSngl;
impl PureFunction for FnModeSngl {
    fn name(&self) -> &'static str {
        "MODE.SNGL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnMode.call(args)
    }
}

pub(super) struct FnModeMult;
impl PureFunction for FnModeMult {
    fn name(&self) -> &'static str {
        "MODE.MULT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Na, "MODE.MULT: no numeric values in data")
            }
            Ok(nums) => {
                let mut counts: Vec<(f64, usize)> = Vec::new();
                for &n in &nums {
                    let found = counts.iter_mut().find(|(v, _)| *v == n);
                    if let Some((_, count)) = found {
                        *count += 1;
                    } else {
                        counts.push((n, 1));
                    }
                }
                let max_count = counts.iter().map(|(_, c)| *c).max().unwrap_or(0);
                if max_count <= 1 {
                    return CellValue::error_with_message(
                        CellError::Na,
                        "MODE.MULT: no repeating values found",
                    );
                }
                let mut modes: Vec<f64> = counts
                    .iter()
                    .filter(|(_, c)| *c == max_count)
                    .map(|(v, _)| *v)
                    .collect();
                // NaN impossible: values are frequency-counted f64 keys
                modes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let mode_vals: Vec<CellValue> = modes.into_iter().map(CellValue::number).collect();
                CellValue::column_array(mode_vals)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnMedian));
    registry.register(Box::new(FnMode));
    registry.register(Box::new(FnAverageA));
    registry.register(Box::new(FnGeoMean));
    registry.register(Box::new(FnHarMean));
    registry.register(Box::new(FnTrimMean));
    registry.register(Box::new(FnModeSngl));
    registry.register(Box::new(FnModeMult));
}
