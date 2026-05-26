//! Above/below average rules.
//!
//! Port of `evaluateAboveAverageRule` from TypeScript `rule-evaluator.ts`.

use crate::stats::RangeStatistics;
use value_types::CellValue;

/// Evaluate an above/below average rule.
///
/// - `above`: true = above average, false = below average
/// - `equal_average`: true = include values equal to the threshold
/// - `std_dev_count`: 0 = just the average, >0 = N standard deviations from the average
///
/// Returns `true` if the cell value matches, `false` otherwise.
/// Non-numeric values always return `false`.
pub fn evaluate_above_average(
    value: &CellValue,
    above: bool,
    equal_average: bool,
    std_dev_count: i32,
    stats: &RangeStatistics,
) -> bool {
    // Extract numeric value; non-numbers don't match
    let num_value = match value {
        CellValue::Number(n) => n.get(),
        _ => return false,
    };

    if stats.count == 0 {
        return false;
    }

    let mut threshold = stats.mean;

    // Apply standard deviation if specified
    if std_dev_count > 0 {
        let n = std_dev_count as f64;
        threshold = if above {
            stats.mean + stats.std_dev * n
        } else {
            stats.mean - stats.std_dev * n
        };
    }

    if equal_average {
        if above {
            num_value >= threshold
        } else {
            num_value <= threshold
        }
    } else if above {
        num_value > threshold
    } else {
        num_value < threshold
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
#[path = "above_average_tests.rs"]
mod tests;
