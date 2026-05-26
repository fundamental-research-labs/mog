//! Index/match functions: CHOOSE.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// CHOOSE
// ---------------------------------------------------------------------------

pub(super) struct FnChoose;
impl PureFunction for FnChoose {
    fn name(&self) -> &'static str {
        "CHOOSE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let idx = n as usize;
                if idx < 1 || idx >= args.len() {
                    CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "CHOOSE: index_num ({idx}) is out of range, must be between 1 and {}",
                            args.len() - 1
                        ),
                    )
                } else {
                    args[idx].clone()
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnChoose));
}
