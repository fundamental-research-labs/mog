//! Top/bottom N items or N% rules.
//!
//! Port of `evaluateTop10Rule` from TypeScript `rule-evaluator.ts`.

use crate::stats::{RangeStatistics, percentile};
use value_types::CellValue;

/// Evaluate a top/bottom N rule.
///
/// - `rank`: number of values (or percent if `percent` is true)
/// - `percent`: if true, `rank` is a percentage (0-100)
/// - `bottom`: if true, check bottom N instead of top N
///
/// Returns `true` if the cell value matches, `false` otherwise.
/// Non-numeric values always return `false`.
pub fn evaluate_top_bottom(
    value: &CellValue,
    rank: u32,
    percent: bool,
    bottom: bool,
    stats: &RangeStatistics,
) -> bool {
    // "Top 0" or "Bottom 0" matches nothing.
    if rank == 0 {
        return false;
    }

    // Extract numeric value; non-numbers don't match
    let num_value = match value {
        CellValue::Number(n) => n.get(),
        _ => return false,
    };

    let values = &stats.sorted_values;
    if values.is_empty() {
        return false;
    }

    let threshold: f64 = if percent {
        // Top/bottom N percent
        // TS: const percentile = rule.bottom ? rule.rank : 100 - rule.rank;
        //     threshold = computePercentile(values, percentile);
        // Note: TS computePercentile takes [0,100], Rust percentile() takes [0,1]
        let p = if bottom {
            (rank.min(100) as f64) / 100.0
        } else {
            (100u32.saturating_sub(rank) as f64) / 100.0
        };
        percentile(values, p)
    } else {
        // Top/bottom N values
        let len = values.len();
        let index = ((rank as usize).saturating_sub(1)).min(len - 1);
        if bottom {
            values[index] // nth smallest
        } else {
            values[len - 1 - index] // nth largest
        }
    };

    if bottom {
        num_value <= threshold
    } else {
        num_value >= threshold
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[path = "top_bottom_tests.rs"]
mod tests;
