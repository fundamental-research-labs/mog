use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnN;

impl PureFunction for FnN {
    fn name(&self) -> &'static str {
        "N"
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
        match &args[0] {
            CellValue::Number(n) => CellValue::Number(*n),
            CellValue::Boolean(b) => CellValue::number(if *b { 1.0 } else { 0.0 }),
            CellValue::Error(e, _) => CellValue::Error(*e, None),
            _ => CellValue::number(0.0),
        }
    }
}

pub(super) struct FnType;

impl PureFunction for FnType {
    fn name(&self) -> &'static str {
        "TYPE"
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
        let type_num = match &args[0] {
            CellValue::Number(_) => 1.0,
            CellValue::Text(_) => 2.0,
            CellValue::Boolean(_) | CellValue::Control(_) => 4.0,
            CellValue::Error(..) => 16.0,
            CellValue::Array(_) => 64.0,
            CellValue::Image(_) => 64.0,
            CellValue::Null => 1.0,
        };
        CellValue::number(type_num)
    }
}

pub(super) struct FnErrorType;

impl PureFunction for FnErrorType {
    fn name(&self) -> &'static str {
        "ERROR.TYPE"
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
        match &args[0] {
            CellValue::Error(e, _) => {
                let n = match e {
                    CellError::Null => 1.0,
                    CellError::Div0 => 2.0,
                    CellError::Value => 3.0,
                    CellError::Ref => 4.0,
                    CellError::Name => 5.0,
                    CellError::Num => 6.0,
                    CellError::Na => 7.0,
                    CellError::GettingData => 8.0,
                    CellError::Spill | CellError::Calc | CellError::Circ => {
                        return CellValue::error_with_message(
                            CellError::Na,
                            "ERROR.TYPE: unrecognized error variant",
                        );
                    }
                };
                CellValue::number(n)
            }
            _ => CellValue::error_with_message(
                CellError::Na,
                "ERROR.TYPE: argument is not an error value",
            ),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnN));
    registry.register(Box::new(FnType));
    registry.register(Box::new(FnErrorType));
}
