//! Miscellaneous lookup-adjacent functions: GETPIVOTDATA, HYPERLINK.

use value_types::CellValue;

use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// HYPERLINK
// ---------------------------------------------------------------------------

pub(super) struct FnHyperlink;
impl PureFunction for FnHyperlink {
    fn name(&self) -> &'static str {
        "HYPERLINK"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = crate::helpers::coercion::check_error(&args[0]) {
            return e;
        }
        if args.len() > 1 {
            if let Some(e) = crate::helpers::coercion::check_error(&args[1]) {
                return e;
            }
            // Return the friendly_name
            match args[1].coerce_to_string() {
                Ok(s) => CellValue::Text(s.into_owned().into()),
                Err(e) => CellValue::Error(e, None),
            }
        } else {
            // Return the URL itself
            match args[0].coerce_to_string() {
                Ok(s) => CellValue::Text(s.into_owned().into()),
                Err(e) => CellValue::Error(e, None),
            }
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    // GETPIVOTDATA is handled directly in eval_primitives.rs (needs AST/mirror access)
    // FORMULATEXT also needs evaluator-level access and must not be advertised
    // as a normal function until that support exists.
    registry.register(Box::new(FnHyperlink));
}
