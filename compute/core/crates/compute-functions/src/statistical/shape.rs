//! Shape functions:
//! FREQUENCY, KURT, SKEW, SKEW.P

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnFrequency;
impl PureFunction for FnFrequency {
    fn name(&self) -> &'static str {
        "FREQUENCY"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat_data = flatten_values(&[args[0].clone()]);
        let flat_bins = flatten_values(&[args[1].clone()]);
        let data = match extract_numbers_strict(&flat_data) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let mut bins = match extract_numbers_strict(&flat_bins) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        bins.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let mut freq = vec![0u64; bins.len() + 1];
        for &d in &data {
            let bin_idx = bins.partition_point(|&b| b < d);
            freq[bin_idx] += 1;
        }
        // Return as vertical (column) array
        let result: Vec<CellValue> = freq.iter().map(|&f| CellValue::number(f as f64)).collect();
        CellValue::column_array(result)
    }
}

pub(super) struct FnKurt;
impl PureFunction for FnKurt {
    fn name(&self) -> &'static str {
        "KURT"
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
            Ok(nums) if nums.len() < 4 => CellValue::error_with_message(
                CellError::Div0,
                format!("KURT: need at least 4 data points, got {}", nums.len()),
            ),
            Ok(nums) => {
                let n = nums.len() as f64;
                let mean = nums.iter().sum::<f64>() / n;
                let s2 = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0);
                let s = s2.sqrt();
                if s < 1e-15 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "KURT: standard deviation is zero (all values identical)",
                    );
                }
                let m4: f64 = nums.iter().map(|x| ((x - mean) / s).powi(4)).sum();
                let kurt = (n * (n + 1.0) * m4) / ((n - 1.0) * (n - 2.0) * (n - 3.0))
                    - (3.0 * (n - 1.0).powi(2)) / ((n - 2.0) * (n - 3.0));
                CellValue::number(kurt)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSkew;
impl PureFunction for FnSkew {
    fn name(&self) -> &'static str {
        "SKEW"
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
            Ok(nums) if nums.len() < 3 => CellValue::error_with_message(
                CellError::Div0,
                format!("SKEW: need at least 3 data points, got {}", nums.len()),
            ),
            Ok(nums) => {
                let n = nums.len() as f64;
                let mean = nums.iter().sum::<f64>() / n;
                let s2 = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (n - 1.0);
                let s = s2.sqrt();
                if s < 1e-15 {
                    return CellValue::error_with_message(
                        CellError::Div0,
                        "SKEW: standard deviation is zero (all values identical)",
                    );
                }
                let m3: f64 = nums.iter().map(|x| ((x - mean) / s).powi(3)).sum();
                let skew = (n * m3) / ((n - 1.0) * (n - 2.0));
                CellValue::number(skew)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSkewP;
impl PureFunction for FnSkewP {
    fn name(&self) -> &'static str {
        "SKEW.P"
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
                CellValue::error_with_message(CellError::Div0, "SKEW.P: need at least 1 data point")
            }
            Ok(nums) => {
                let n = nums.len() as f64;
                let mean = nums.iter().sum::<f64>() / n;
                let s2 = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
                let s = s2.sqrt();
                if s < 1e-15 {
                    // Population skewness is 0 when all values are identical
                    return if nums.len() < 2 {
                        CellValue::error_with_message(
                            CellError::Div0,
                            "SKEW.P: need at least 2 data points",
                        )
                    } else {
                        CellValue::number(0.0)
                    };
                }
                let m3: f64 = nums.iter().map(|x| ((x - mean) / s).powi(3)).sum::<f64>() / n;
                CellValue::number(m3)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFrequency));
    registry.register(Box::new(FnKurt));
    registry.register(Box::new(FnSkew));
    registry.register(Box::new(FnSkewP));
}
