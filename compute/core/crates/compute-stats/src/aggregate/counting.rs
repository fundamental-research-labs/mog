use std::collections::HashSet;

use value_types::CellValue;

use crate::values::{GroupKey, cell_value_to_group_key};

/// Count of non-blank values (like Excel `COUNTA`).
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_counta(values: &[CellValue]) -> CellValue {
    let count = values.iter().filter(|v| !v.is_visually_blank()).count();
    if count == 0 {
        CellValue::Null
    } else {
        CellValue::number(count as f64)
    }
}

/// Count of unique non-blank values.
///
/// Uses the canonical [`cell_value_to_group_key`] for deduplication, which means:
/// - Case-insensitive text comparison (`"A"` and `"a"` are the same key).
/// - No trimming: `"  hello  "` and `"hello"` are *different* keys.
/// - Typed variants prevent cross-type collisions (Number vs Text).
/// - Negative zero canonicalized to positive zero.
/// - All NaN bit patterns map to one canonical key.
///
/// Returns `Null` for empty input (Excel pivot tables show blank for empty aggregations).
#[allow(clippy::cast_precision_loss)] // Safety: count values fit in f64 mantissa for practical pivot sizes
pub(super) fn pivot_countunique(values: &[CellValue]) -> CellValue {
    let seen: HashSet<GroupKey> = values
        .iter()
        .filter(|v| !v.is_visually_blank())
        .map(cell_value_to_group_key)
        .collect();
    if seen.is_empty() {
        CellValue::Null
    } else {
        CellValue::number(seen.len() as f64)
    }
}
