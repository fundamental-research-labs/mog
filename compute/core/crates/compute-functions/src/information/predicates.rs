use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

fn iserr_single(val: &CellValue) -> CellValue {
    match val {
        CellValue::Error(e, _) => CellValue::Boolean(*e != CellError::Na),
        _ => CellValue::Boolean(false),
    }
}

pub(super) struct FnIsErr;

impl PureFunction for FnIsErr {
    fn name(&self) -> &'static str {
        "ISERR"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(iserr_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => iserr_single(&args[0]),
        }
    }
}

pub(super) struct FnIsEven;

impl PureFunction for FnIsEven {
    fn name(&self) -> &'static str {
        "ISEVEN"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        if matches!(&args[0], CellValue::Boolean(_)) {
            return CellValue::error_with_message(
                CellError::Value,
                "ISEVEN: boolean argument is not allowed",
            );
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let int_val = n.trunc() as i64;
                CellValue::Boolean(int_val % 2 == 0)
            }
            Err(e) => CellValue::error_with_message(e, "ISEVEN: could not convert to number"),
        }
    }
}

pub(super) struct FnIsOdd;

impl PureFunction for FnIsOdd {
    fn name(&self) -> &'static str {
        "ISODD"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        if matches!(&args[0], CellValue::Boolean(_)) {
            return CellValue::error_with_message(
                CellError::Value,
                "ISODD: boolean argument is not allowed",
            );
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let int_val = n.trunc() as i64;
                CellValue::Boolean(int_val % 2 != 0)
            }
            Err(e) => CellValue::error_with_message(e, "ISODD: could not convert to number"),
        }
    }
}

fn islogical_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(matches!(val, CellValue::Boolean(_)))
}

pub(super) struct FnIsLogical;

impl PureFunction for FnIsLogical {
    fn name(&self) -> &'static str {
        "ISLOGICAL"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(islogical_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => islogical_single(&args[0]),
        }
    }
}

fn isnontext_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(!matches!(val, CellValue::Text(_)))
}

pub(super) struct FnIsNonText;

impl PureFunction for FnIsNonText {
    fn name(&self) -> &'static str {
        "ISNONTEXT"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isnontext_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isnontext_single(&args[0]),
        }
    }
}

pub(super) struct FnIsRef;

impl PureFunction for FnIsRef {
    fn name(&self) -> &'static str {
        "ISREF"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        CellValue::Boolean(!args[0].is_error())
    }
}

pub(super) fn register_core_predicates(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsErr));
    registry.register(Box::new(FnIsEven));
    registry.register(Box::new(FnIsOdd));
    registry.register(Box::new(FnIsLogical));
    registry.register(Box::new(FnIsNonText));
}

pub(super) fn register_reference_predicate(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsRef));
}
