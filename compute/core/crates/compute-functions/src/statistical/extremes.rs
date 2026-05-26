//! Extreme value functions:
//! MAXA, MINA

use value_types::CellValue;

use super::helpers::extract_numbers_a;
use crate::helpers::coercion::flatten_values;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnMaxA;
impl PureFunction for FnMaxA {
    fn name(&self) -> &'static str {
        "MAXA"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_a(&flat) {
            Ok(nums) if nums.is_empty() => CellValue::number(0.0),
            Ok(nums) => CellValue::number(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max)),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnMinA;
impl PureFunction for FnMinA {
    fn name(&self) -> &'static str {
        "MINA"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_a(&flat) {
            Ok(nums) if nums.is_empty() => CellValue::number(0.0),
            Ok(nums) => CellValue::number(nums.iter().cloned().fold(f64::INFINITY, f64::min)),
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnMaxA));
    registry.register(Box::new(FnMinA));
}
