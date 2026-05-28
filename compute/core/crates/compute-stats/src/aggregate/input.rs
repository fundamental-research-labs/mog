use value_types::CellValue;

use crate::values::{cell_value_is_numeric, welford_online};

/// Iterator over finite numeric values in a `CellValue` slice.
///
/// Yields the `f64` payload of every `CellValue::Number(n)` where `n` is
/// finite.  NaN, Infinity, and all non-Number variants are skipped.
#[inline]
pub(super) fn numeric_iter(values: &[CellValue]) -> impl Iterator<Item = f64> + '_ {
    values.iter().filter_map(|v| {
        if cell_value_is_numeric(v) {
            v.as_number()
        } else {
            None
        }
    })
}

/// Welford's online algorithm for numerically stable variance computation.
///
/// Returns `(mean, m2, count)` where `population_variance = m2 / count`.
/// Single-pass, avoids catastrophic cancellation with large close-together
/// values.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn welford_accumulate(values: &[CellValue]) -> (f64, f64, u64) {
    welford_online(numeric_iter(values))
}
