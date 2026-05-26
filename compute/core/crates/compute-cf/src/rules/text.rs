//! Text matching rules (contains, begins-with, ends-with).
//!
//! Ported from TypeScript `evaluateContainsTextRule`
//! in `rule-evaluator.ts` (lines 488-513).

use crate::types::CFTextOperator;
use value_types::CellValue;

/// Evaluate a contains-text CF rule.
/// Case-insensitive string matching.
///
/// The cell value is coerced to a string (via `Display`) for comparison.
/// All comparisons are done in lowercase for case-insensitivity.
/// `search_text` is expected to be pre-lowered at the TryFrom boundary.
pub fn evaluate_text(value: &CellValue, operator: &CFTextOperator, search_text: &str) -> bool {
    // In Excel, error cells are skipped entirely — they never participate in text matching.
    if matches!(value, CellValue::Error(..)) {
        return false;
    }

    // Coerce value to string, matching TypeScript `String(value ?? '')`
    let str_value = match value {
        CellValue::Text(s) => s.to_lowercase(),
        CellValue::Null => String::new(),
        other => other.to_string().to_lowercase(),
    };

    match operator {
        CFTextOperator::Contains => str_value.contains(search_text),
        CFTextOperator::NotContains => !str_value.contains(search_text),
        CFTextOperator::BeginsWith => str_value.starts_with(search_text),
        CFTextOperator::EndsWith => str_value.ends_with(search_text),
    }
}

#[cfg(test)]
#[path = "text_tests.rs"]
mod tests;
