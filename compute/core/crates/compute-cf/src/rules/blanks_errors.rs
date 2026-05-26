//! Blank/error detection rules.
//!
//! Ported from TypeScript `evaluateContainsBlanksRule`, `evaluateContainsErrorsRule`,
//! `isBlankValue`, and `isErrorValue` in `rule-evaluator.ts` (lines 112-533).

use value_types::CellValue;

/// Evaluate a contains-blanks CF rule.
/// `blanks=true`: match blank cells; `blanks=false`: match non-blank cells.
pub fn evaluate_blanks(value: &CellValue, blanks: bool) -> bool {
    let blank = value.is_visually_blank();
    if blanks { blank } else { !blank }
}

/// Evaluate a contains-errors CF rule.
/// `errors=true`: match error cells; `errors=false`: match non-error cells.
pub fn evaluate_errors(value: &CellValue, errors: bool) -> bool {
    let error = is_error(value);
    if errors { error } else { !error }
}

/// Check if a value is an error.
///
/// Matches TypeScript: `isCellError(value)` (canonical CellError object).
/// In Rust, this is simply the `CellValue::Error(..)` variant.
pub fn is_error(value: &CellValue) -> bool {
    matches!(value, CellValue::Error(..))
}

#[cfg(test)]
#[path = "blanks_errors_tests.rs"]
mod tests;
