//! Percentile and quartile functions:
//! PERCENTILE, PERCENTILE.INC, PERCENTILE.EXC,
//! PERCENTRANK, PERCENTRANK.INC, PERCENTRANK.EXC,
//! QUARTILE, QUARTILE.INC, QUARTILE.EXC

use value_types::{CellError, CellValue};

use super::helpers::{percentile_exc, percentile_inc, sorted_numbers};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnPercentileInc;
impl PureFunction for FnPercentileInc {
    fn name(&self) -> &'static str {
        "PERCENTILE.INC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let k = match args[1].coerce_to_number() {
            Ok(k) if !(0.0..=1.0).contains(&k) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("PERCENTILE.INC: k must be between 0 and 1, got {k}"),
                );
            }
            Ok(k) => k,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "PERCENTILE.INC: data array contains no numeric values",
            ),
            Ok(nums) => CellValue::number(percentile_inc(&nums, k)),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// PERCENTILE is an alias for PERCENTILE.INC
pub(super) struct FnPercentile;
impl PureFunction for FnPercentile {
    fn name(&self) -> &'static str {
        "PERCENTILE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnPercentileInc.call(args)
    }
}

pub(super) struct FnPercentileExc;
impl PureFunction for FnPercentileExc {
    fn name(&self) -> &'static str {
        "PERCENTILE.EXC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let k = match args[1].coerce_to_number() {
            Ok(k) if k <= 0.0 || k >= 1.0 => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("PERCENTILE.EXC: k must be strictly between 0 and 1, got {k}"),
                );
            }
            Ok(k) => k,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "PERCENTILE.EXC: data array contains no numeric values",
            ),
            Ok(nums) => match percentile_exc(&nums, k) {
                Some(v) => CellValue::number(v),
                None => CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "PERCENTILE.EXC: k={k} is out of interpolation range for {n} data points",
                        n = nums.len()
                    ),
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPercentRankInc;
impl PureFunction for FnPercentRankInc {
    fn name(&self) -> &'static str {
        "PERCENTRANK.INC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            2 => Some(CellValue::number(3.0)), // significance defaults to 3 decimal places
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let significance = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(s) if s < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("PERCENTRANK.INC: significance must be >= 1, got {s}"),
                    );
                }
                Ok(s) => s as u32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            3
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "PERCENTRANK.INC: data array contains no numeric values",
            ),
            Ok(nums) => {
                if x < nums[0] || x > nums[nums.len() - 1] {
                    return CellValue::error_with_message(
                        CellError::Na,
                        format!(
                            "PERCENTRANK.INC: value {x} is outside the data range [{}, {}]",
                            nums[0],
                            nums[nums.len() - 1]
                        ),
                    );
                }
                let n = nums.len();
                // Find position via interpolation
                let mut rank = 0.0;
                let pos = nums.partition_point(|&v| v < x);
                if pos < n && (nums[pos] - x).abs() < 1e-15 {
                    // Exact match
                    rank = pos as f64 / (n - 1) as f64;
                } else if pos > 0 && pos < n {
                    // Interpolate between nums[pos-1] and nums[pos]
                    let i = pos - 1;
                    rank = (i as f64 + (x - nums[i]) / (nums[i + 1] - nums[i])) / (n - 1) as f64;
                }
                let factor = 10f64.powi(significance as i32);
                CellValue::number((rank * factor).floor() / factor)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// PERCENTRANK is an alias for PERCENTRANK.INC
pub(super) struct FnPercentRank;
impl PureFunction for FnPercentRank {
    fn name(&self) -> &'static str {
        "PERCENTRANK"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnPercentRankInc.call(args)
    }
}

pub(super) struct FnPercentRankExc;
impl PureFunction for FnPercentRankExc {
    fn name(&self) -> &'static str {
        "PERCENTRANK.EXC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            2 => Some(CellValue::number(3.0)), // significance defaults to 3 decimal places
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let x = match args[1].coerce_to_number() {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let significance = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(s) if s < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("PERCENTRANK.EXC: significance must be >= 1, got {s}"),
                    );
                }
                Ok(s) => s as u32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            3
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "PERCENTRANK.EXC: data array contains no numeric values",
            ),
            Ok(nums) => {
                if x < nums[0] || x > nums[nums.len() - 1] {
                    return CellValue::error_with_message(
                        CellError::Na,
                        format!(
                            "PERCENTRANK.EXC: value {x} is outside the data range [{}, {}]",
                            nums[0],
                            nums[nums.len() - 1]
                        ),
                    );
                }
                let n = nums.len();
                let mut rank = 0.0;
                let pos = nums.partition_point(|&v| v < x);
                if pos < n && (nums[pos] - x).abs() < 1e-15 {
                    // Exact match
                    rank = (pos + 1) as f64 / (n + 1) as f64;
                } else if pos > 0 && pos < n {
                    // Interpolate between nums[pos-1] and nums[pos]
                    let i = pos - 1;
                    rank =
                        ((i + 1) as f64 + (x - nums[i]) / (nums[i + 1] - nums[i])) / (n + 1) as f64;
                }
                let factor = 10f64.powi(significance as i32);
                CellValue::number((rank * factor).floor() / factor)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnQuartileInc;
impl PureFunction for FnQuartileInc {
    fn name(&self) -> &'static str {
        "QUARTILE.INC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let quart = match args[1].coerce_to_number() {
            Ok(q) if !(0.0..=4.0).contains(&q) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("QUARTILE.INC: quart must be between 0 and 4, got {q}"),
                );
            }
            Ok(q) => q as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "QUARTILE.INC: data array contains no numeric values",
            ),
            Ok(nums) => CellValue::number(percentile_inc(&nums, quart as f64 * 0.25)),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// QUARTILE is an alias for QUARTILE.INC
pub(super) struct FnQuartile;
impl PureFunction for FnQuartile {
    fn name(&self) -> &'static str {
        "QUARTILE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnQuartileInc.call(args)
    }
}

pub(super) struct FnQuartileExc;
impl PureFunction for FnQuartileExc {
    fn name(&self) -> &'static str {
        "QUARTILE.EXC"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let quart = match args[1].coerce_to_number() {
            Ok(q) if !(1.0..=3.0).contains(&q) => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("QUARTILE.EXC: quart must be between 1 and 3, got {q}"),
                );
            }
            Ok(q) => q as i32,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_numbers(&[args[0].clone()]) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "QUARTILE.EXC: data array contains no numeric values",
            ),
            Ok(nums) => match percentile_exc(&nums, quart as f64 * 0.25) {
                Some(v) => CellValue::number(v),
                None => CellValue::error_with_message(
                    CellError::Num,
                    format!(
                        "QUARTILE.EXC: quartile {quart} is out of interpolation range for {} data points",
                        nums.len()
                    ),
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnPercentile));
    registry.register(Box::new(FnPercentileInc));
    registry.register(Box::new(FnPercentileExc));
    registry.register(Box::new(FnPercentRank));
    registry.register(Box::new(FnPercentRankInc));
    registry.register(Box::new(FnPercentRankExc));
    registry.register(Box::new(FnQuartile));
    registry.register(Box::new(FnQuartileInc));
    registry.register(Box::new(FnQuartileExc));
}
