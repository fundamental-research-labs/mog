use value_types::CellValue;

use super::input::{numeric_iter, welford_accumulate};
use crate::values::kahan_sum;

/// Sum of numeric values using Kahan compensated summation.
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
pub(super) fn pivot_sum(values: &[CellValue]) -> CellValue {
    let mut iter = numeric_iter(values).peekable();
    if iter.peek().is_none() {
        return CellValue::Null;
    }
    CellValue::number(kahan_sum(iter))
}

/// Count of numeric values only (like OOXML `countNums`).
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_count(values: &[CellValue]) -> CellValue {
    let count = numeric_iter(values).count();
    if count == 0 {
        CellValue::Null
    } else {
        CellValue::number(count as f64)
    }
}

/// Average of numeric values using Welford's algorithm.
/// Returns `Null` for empty input.
pub(super) fn pivot_average(values: &[CellValue]) -> CellValue {
    let (mean, _, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number(mean)
}

/// Minimum numeric value.  Returns `Null` for empty input.
pub(super) fn pivot_min(values: &[CellValue]) -> CellValue {
    let mut min = f64::INFINITY;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        if n < min {
            min = n;
        }
    }
    if found {
        CellValue::number(min)
    } else {
        CellValue::Null
    }
}

/// Maximum numeric value.  Returns `Null` for empty input.
pub(super) fn pivot_max(values: &[CellValue]) -> CellValue {
    let mut max = f64::NEG_INFINITY;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        if n > max {
            max = n;
        }
    }
    if found {
        CellValue::number(max)
    } else {
        CellValue::Null
    }
}

/// Product of numeric values.  Returns `Null` for empty input
/// (Excel pivot tables show blank for empty aggregations).
pub(super) fn pivot_product(values: &[CellValue]) -> CellValue {
    let mut product = 1.0_f64;
    let mut found = false;
    for n in numeric_iter(values) {
        found = true;
        product *= n;
    }
    if found {
        CellValue::number(product)
    } else {
        CellValue::Null
    }
}
