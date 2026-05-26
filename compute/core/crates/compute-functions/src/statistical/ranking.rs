//! Ranking functions:
//! RANK, RANK.EQ, RANK.AVG, LARGE, SMALL
//!
//! All functions use the epoch-scoped `SortedArrayCache` to avoid redundant
//! sorts when many cells reference the same array (e.g., 2000 rows calling
//! `SMALL(same_range, ROW()-header)`).

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{check_error, flatten_values};
use crate::helpers::sorted_cache;
use crate::{FunctionRegistry, PureFunction};

/// Epsilon tolerance for "number exists in array" checks (matches Excel behavior).
const EPS: f64 = 1e-10;

pub(super) struct FnLarge;
impl PureFunction for FnLarge {
    fn name(&self) -> &'static str {
        "LARGE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(&[args[0].clone()]);
        let k = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("LARGE: k must be >= 1, got {n}"),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_cache::get_or_sort_asc(&flat) {
            Ok(sorted) if k > sorted.len() => CellValue::error_with_message(
                CellError::Num,
                format!("LARGE: k={k} exceeds data size of {}", sorted.len()),
            ),
            Ok(sorted) if sorted.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "LARGE: data array contains no numeric values",
            ),
            Ok(sorted) => {
                // k-th largest = sorted_asc[len - k]
                CellValue::number(sorted[sorted.len() - k])
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnSmall;
impl PureFunction for FnSmall {
    fn name(&self) -> &'static str {
        "SMALL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(&[args[0].clone()]);
        let k = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Num,
                    format!("SMALL: k must be >= 1, got {n}"),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        match sorted_cache::get_or_sort_asc(&flat) {
            Ok(sorted) if k > sorted.len() => CellValue::error_with_message(
                CellError::Num,
                format!("SMALL: k={k} exceeds data size of {}", sorted.len()),
            ),
            Ok(sorted) if sorted.is_empty() => CellValue::error_with_message(
                CellError::Num,
                "SMALL: data array contains no numeric values",
            ),
            Ok(sorted) => {
                // k-th smallest = sorted_asc[k - 1]
                CellValue::number(sorted[k - 1])
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// Find the rank of `number` in a sorted ascending slice using binary search
/// with epsilon tolerance. Returns `(count_less, count_equal)` where "less"
/// and "equal" are defined relative to the `order` parameter:
/// - order == 0 (descending): "less" means values > number, "equal" means values ≈ number
/// - order != 0 (ascending): "less" means values < number, "equal" means values ≈ number
fn rank_components(sorted_asc: &[f64], number: f64, order: i32) -> Option<(usize, usize)> {
    // Find the range of elements approximately equal to `number`
    let first_ge = sorted_asc.partition_point(|&x| x < number - EPS);
    let first_gt = sorted_asc.partition_point(|&x| x <= number + EPS);
    let equal_count = first_gt - first_ge;

    if equal_count == 0 {
        return None; // number not found in array
    }

    if order == 0 {
        // Descending: count how many are strictly greater
        let greater_count = sorted_asc.len() - first_gt;
        Some((greater_count, equal_count))
    } else {
        // Ascending: count how many are strictly less
        Some((first_ge, equal_count))
    }
}

pub(super) struct FnRank;
impl PureFunction for FnRank {
    fn name(&self) -> &'static str {
        "RANK"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let flat = flatten_values(&[args[1].clone()]);
        let order = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        match sorted_cache::get_or_sort_asc(&flat) {
            Ok(sorted) => match rank_components(&sorted, number, order) {
                Some((less, _equal)) => CellValue::number((less + 1) as f64),
                None => CellValue::error_with_message(
                    CellError::Na,
                    format!("RANK: value {number} not found in data array"),
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnRankEq;
impl PureFunction for FnRankEq {
    fn name(&self) -> &'static str {
        "RANK.EQ"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnRank.call(args)
    }
}

pub(super) struct FnRankAvg;
impl PureFunction for FnRankAvg {
    fn name(&self) -> &'static str {
        "RANK.AVG"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let flat = flatten_values(&[args[1].clone()]);
        let order = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        match sorted_cache::get_or_sort_asc(&flat) {
            Ok(sorted) => match rank_components(&sorted, number, order) {
                Some((less, equal)) => {
                    let rank = less as f64 + 1.0 + (equal as f64 - 1.0) / 2.0;
                    CellValue::number(rank)
                }
                None => CellValue::error_with_message(
                    CellError::Na,
                    format!("RANK.AVG: value {number} not found in data array"),
                ),
            },
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnLarge));
    registry.register(Box::new(FnSmall));
    registry.register(Box::new(FnRank));
    registry.register(Box::new(FnRankEq));
    registry.register(Box::new(FnRankAvg));
}
