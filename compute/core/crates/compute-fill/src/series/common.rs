use value_types::{CellValue, FiniteF64};

/// Wrap an f64 into `CellValue::Number`, falling back to `CellValue::Error` for NaN/Inf.
pub(super) fn num_or_error(v: f64) -> CellValue {
    match FiniteF64::new(v) {
        Some(f) => CellValue::Number(f),
        None => CellValue::Error(value_types::CellError::Value, None),
    }
}

/// Extract the f64 from the last source value (for forward) or first (for backward).
pub(super) fn anchor_number(source_values: &[CellValue], direction_mult: i32) -> Option<f64> {
    let val = if direction_mult >= 0 {
        source_values.last()?
    } else {
        source_values.first()?
    };
    match val {
        CellValue::Number(f) => Some(f.get()),
        _ => None,
    }
}

/// Extract a &str from the anchor value.
pub(super) fn anchor_text(source_values: &[CellValue], direction_mult: i32) -> Option<&str> {
    let val = if direction_mult >= 0 {
        source_values.last()?
    } else {
        source_values.first()?
    };
    match val {
        CellValue::Text(s) => Some(&**s),
        _ => None,
    }
}

/// Euclidean modulo that always returns a non-negative result.
pub(super) fn positive_mod(a: i64, m: i64) -> usize {
    (a.rem_euclid(m)) as usize
}

pub(super) fn generate_copy(source_values: &[CellValue], count: usize) -> Vec<CellValue> {
    let len = source_values.len();
    (0..count).map(|i| source_values[i % len].clone()).collect()
}
