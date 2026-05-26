//! Formula-based CF rules.
//!
//! Ported from TypeScript `evaluateFormulaRule` and `isTruthyValue`
//! in `rule-evaluator.ts` (lines 573-612).

use value_types::CellValue;

/// Evaluate a formula CF rule.
///
/// # Design
///
/// This is an **intentional stub** — the caller pre-evaluates the formula and passes
/// the result as `formula_result`. The actual formula evaluation (including AST-level
/// row/column shifting per cell) happens in the scheduler/evaluator layer, not here.
///
/// Formula evaluation requires `Evaluator` + `FunctionRegistry` context that individual
/// rule matchers do not have access to. The AST adjustment logic (shifting cell references
/// relative to each target cell) lives in `evaluator.rs`, which orchestrates formula
/// evaluation before calling into this matcher.
///
/// Returns `true` if the formula result is truthy, `false` otherwise.
pub fn evaluate_formula(formula_result: Option<&CellValue>) -> bool {
    // If no formula result is available (no formula engine), skip.
    let Some(result) = formula_result else {
        return false;
    };

    is_truthy(result)
}

/// Check if a CellValue is truthy (for CF formula evaluation).
///
/// - `Boolean(true)`: truthy
/// - `Number(n)` where n != 0: truthy (NaN/Infinity cannot occur; `FiniteF64` invariant)
/// - `Text(_)`: always falsy (Excel CF formula rules treat text as falsy)
/// - Everything else (false, 0, Null, Error): falsy
pub fn is_truthy(value: &CellValue) -> bool {
    match value {
        CellValue::Boolean(b) => *b,
        CellValue::Number(n) => n.get() != 0.0,
        CellValue::Text(_) => false,
        _ => false,
    }
}

#[cfg(test)]
#[path = "formula_tests.rs"]
mod tests;
