//! Dispersion functions:
//! STDEV, STDEV.S, STDEV.P, STDEVP, STDEVA, STDEVPA,
//! VAR, VAR.S, VAR.P, VARP, VARA, VARPA,
//! AVEDEV, DEVSQ

use value_types::{CellError, CellValue};

use super::helpers::extract_numbers_a;
use crate::helpers::coercion::{extract_numbers_strict, flatten_values};
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnStdevS;
impl PureFunction for FnStdevS {
    fn name(&self) -> &'static str {
        "STDEV.S"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                "STDEV.S: need at least 2 data points",
            ),
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let variance =
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64;
                CellValue::number(variance.sqrt())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// STDEV is an alias for STDEV.S
pub(super) struct FnStdev;
impl PureFunction for FnStdev {
    fn name(&self) -> &'static str {
        "STDEV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnStdevS.call(args)
    }
}

pub(super) struct FnStdevP;
impl PureFunction for FnStdevP {
    fn name(&self) -> &'static str {
        "STDEV.P"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Div0,
                "STDEV.P: need at least 1 data point",
            ),
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let variance =
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64;
                CellValue::number(variance.sqrt())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnAveDev;
impl PureFunction for FnAveDev {
    fn name(&self) -> &'static str {
        "AVEDEV"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "AVEDEV: no numeric values in data")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let avedev = nums.iter().map(|x| (x - mean).abs()).sum::<f64>() / nums.len() as f64;
                CellValue::number(avedev)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnDevSq;
impl PureFunction for FnDevSq {
    fn name(&self) -> &'static str {
        "DEVSQ"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Num, "DEVSQ: no numeric values in data")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                CellValue::number(nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnStdevA;
impl PureFunction for FnStdevA {
    fn name(&self) -> &'static str {
        "STDEVA"
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
            Ok(nums) if nums.len() < 2 => CellValue::error_with_message(
                CellError::Div0,
                "STDEVA: need at least 2 data points",
            ),
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let var =
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64;
                CellValue::number(var.sqrt())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// STDEVP is an alias for STDEV.P (already exists as FnStdevP)
pub(super) struct FnStdevPAlias;
impl PureFunction for FnStdevPAlias {
    fn name(&self) -> &'static str {
        "STDEVP"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnStdevP.call(args)
    }
}

pub(super) struct FnStdevPA;
impl PureFunction for FnStdevPA {
    fn name(&self) -> &'static str {
        "STDEVPA"
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
            Ok(nums) if nums.is_empty() => CellValue::error_with_message(
                CellError::Div0,
                "STDEVPA: need at least 1 data point",
            ),
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let var = nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64;
                CellValue::number(var.sqrt())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// VAR.S (sample variance)
pub(super) struct FnVarS;
impl PureFunction for FnVarS {
    fn name(&self) -> &'static str {
        "VAR.S"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.len() < 2 => {
                CellValue::error_with_message(CellError::Div0, "VAR.S: need at least 2 data points")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                let result =
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64;
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// VAR is an alias for VAR.S
pub(super) struct FnVar;
impl PureFunction for FnVar {
    fn name(&self) -> &'static str {
        "VAR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnVarS.call(args)
    }
}

/// VAR.P (population variance)
pub(super) struct FnVarP;
impl PureFunction for FnVarP {
    fn name(&self) -> &'static str {
        "VAR.P"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        match extract_numbers_strict(&flat) {
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Div0, "VAR.P: need at least 1 data point")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                CellValue::number(
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64,
                )
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// VARP is an alias for VAR.P
pub(super) struct FnVarPAlias;
impl PureFunction for FnVarPAlias {
    fn name(&self) -> &'static str {
        "VARP"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        FnVarP.call(args)
    }
}

pub(super) struct FnVarA;
impl PureFunction for FnVarA {
    fn name(&self) -> &'static str {
        "VARA"
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
            Ok(nums) if nums.len() < 2 => {
                CellValue::error_with_message(CellError::Div0, "VARA: need at least 2 data points")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                CellValue::number(
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (nums.len() - 1) as f64,
                )
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnVarPA;
impl PureFunction for FnVarPA {
    fn name(&self) -> &'static str {
        "VARPA"
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
            Ok(nums) if nums.is_empty() => {
                CellValue::error_with_message(CellError::Div0, "VARPA: need at least 1 data point")
            }
            Ok(nums) => {
                let mean = nums.iter().sum::<f64>() / nums.len() as f64;
                CellValue::number(
                    nums.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / nums.len() as f64,
                )
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnStdev));
    registry.register(Box::new(FnStdevS));
    registry.register(Box::new(FnStdevP));
    registry.register(Box::new(FnAveDev));
    registry.register(Box::new(FnDevSq));
    registry.register(Box::new(FnStdevA));
    registry.register(Box::new(FnStdevPAlias));
    registry.register(Box::new(FnStdevPA));
    registry.register(Box::new(FnVarS));
    registry.register(Box::new(FnVar));
    registry.register(Box::new(FnVarP));
    registry.register(Box::new(FnVarPAlias));
    registry.register(Box::new(FnVarA));
    registry.register(Box::new(FnVarPA));
}
