//! Duplicate/unique value detection.
//!
//! Port of `evaluateDuplicateValuesRule` from rule-evaluator.ts (lines 461-486).
//! Uses frequency maps from RangeStatistics to detect duplicate values across
//! all value types: numbers, text (case-insensitive), and booleans.
//!
//! # Cross-type coercion (Excel behavior)
//!
//! Excel considers values as duplicates across types when text can be coerced
//! to a number. For example, `Number(1.0)` and `Text("1")` are duplicates.
//! Booleans use their own text namespace ("true"/"false") and are NOT coerced
//! to numbers for duplicate purposes.

use crate::stats::{RangeStatistics, canonical_bits, parse_plain_number};
use value_types::CellValue;

/// Compute the unified duplicate count for a cell value, handling cross-type
/// coercion between numbers and numeric-looking text.
///
/// - `Number(n)`: count from `frequency` + count of text entries that parse to n
/// - `Text(s)` that parses as number n: count from `text_frequency` + count from `frequency`
/// - `Text(s)` non-numeric: count from `text_frequency` only
/// - `Boolean`: count from `bool_frequency` only (no cross-type coercion)
fn unified_count(value: &CellValue, stats: &RangeStatistics) -> Option<usize> {
    match value {
        CellValue::Null => None,
        CellValue::Number(n) => {
            let bits = canonical_bits(n.get());
            let numeric_count = stats.frequency.get(&bits).copied().unwrap_or(0);
            // Cross-type: also count text entries that parse to the same number.
            // O(1) lookup via pre-computed numeric_text_frequency map.
            let text_count = stats
                .numeric_text_frequency
                .get(&bits)
                .copied()
                .unwrap_or(0);
            Some(numeric_count + text_count)
        }
        CellValue::Text(s) => {
            let key = s.to_lowercase();
            let text_count = stats.text_frequency.get(&key).copied().unwrap_or(0);
            // Cross-type: if this text parses as a plain number, also count numeric entries
            if let Some(parsed) = parse_plain_number(&key) {
                let numeric_count = stats
                    .frequency
                    .get(&canonical_bits(parsed))
                    .copied()
                    .unwrap_or(0);
                Some(text_count + numeric_count)
            } else {
                Some(text_count)
            }
        }
        CellValue::Boolean(b) => Some(stats.bool_frequency.get(b).copied().unwrap_or(0)),
        // Error and other types don't participate
        _ => None,
    }
}

/// Evaluate a duplicate/unique values rule.
///
/// - `unique`: true = highlight unique values, false = highlight duplicate values.
///
/// Uses the frequency maps from RangeStatistics with cross-type coercion:
/// `Number(1.0)` and `Text("1")` are considered duplicates (Excel behavior).
///
/// A value is "duplicate" if its unified count > 1.
/// Blank cells (Null) and error cells are excluded from matching.
pub fn evaluate_duplicate(value: &CellValue, unique: bool, stats: &RangeStatistics) -> bool {
    let Some(count) = unified_count(value, stats) else {
        return false;
    };

    let is_duplicate = count > 1;

    // unique=true  -> match when NOT duplicate (count <= 1)
    // unique=false -> match when IS duplicate  (count > 1)
    if unique { !is_duplicate } else { is_duplicate }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[path = "duplicate_tests.rs"]
mod tests;
