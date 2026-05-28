use value_types::CellValue;

use super::input::welford_accumulate;

/// Sample standard deviation.  Returns `Null` if fewer than 2 numeric values.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_stdev(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count < 2 {
        return CellValue::Null;
    }
    CellValue::number((m2 / (count - 1) as f64).sqrt())
}

/// Population standard deviation.  Returns `Null` for empty input.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_stdevp(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number((m2 / count as f64).sqrt())
}

/// Sample variance.  Returns `Null` if fewer than 2 numeric values.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_var(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count < 2 {
        return CellValue::Null;
    }
    CellValue::number(m2 / (count - 1) as f64)
}

/// Population variance.  Returns `Null` for empty input.
/// Uses Welford's algorithm for numerical stability.
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_varp(values: &[CellValue]) -> CellValue {
    let (_, m2, count) = welford_accumulate(values);
    if count == 0 {
        return CellValue::Null;
    }
    CellValue::number(m2 / count as f64)
}
