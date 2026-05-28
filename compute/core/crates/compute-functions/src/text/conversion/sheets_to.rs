use value_types::CellValue;

use crate::{FunctionRegistry, PureFunction};

fn passthrough_numeric_format_conversion(args: &[CellValue]) -> CellValue {
    match &args[0] {
        CellValue::Number(n) => CellValue::Number(*n),
        other => other.clone(),
    }
}

pub(super) struct FnToDate;
impl PureFunction for FnToDate {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_DATE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(super) struct FnToDollars;
impl PureFunction for FnToDollars {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_DOLLARS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(super) struct FnToPercent;
impl PureFunction for FnToPercent {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_PERCENT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(super) struct FnToPureNumber;
impl PureFunction for FnToPureNumber {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_PURE_NUMBER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(super) struct FnToText;
impl PureFunction for FnToText {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_TEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Number(n) => CellValue::Text(value_types::format_number(n.get()).into()),
            other => other.clone(),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnToDate));
    registry.register(Box::new(FnToDollars));
    registry.register(Box::new(FnToPercent));
    registry.register(Box::new(FnToPureNumber));
    registry.register(Box::new(FnToText));
}
