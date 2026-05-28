use value_types::CellValue;

use crate::{FunctionRegistry, PureFunction};

fn coerce_between_number(value: &CellValue) -> Result<f64, CellValue> {
    value.coerce_to_number().map_err(|e| {
        CellValue::error_with_message(e, "ISBETWEEN: could not convert argument to number")
    })
}

fn coerce_between_flag(value: &CellValue) -> Result<bool, CellValue> {
    value
        .coerce_to_bool()
        .map_err(|e| CellValue::error_with_message(e, "ISBETWEEN: inclusivity flag is invalid"))
}

pub(super) struct FnIsBetween;

impl PureFunction for FnIsBetween {
    fn name(&self) -> &'static str {
        "ISBETWEEN"
    }

    fn min_args(&self) -> usize {
        3
    }

    fn max_args(&self) -> Option<usize> {
        Some(5)
    }

    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 | 4 => Some(CellValue::Boolean(true)),
            _ => None,
        }
    }

    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        let value = match coerce_between_number(&args[0]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let lower = match coerce_between_number(&args[1]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let upper = match coerce_between_number(&args[2]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let lower_inclusive = match args.get(3) {
            Some(value) => match coerce_between_flag(value) {
                Ok(flag) => flag,
                Err(error) => return error,
            },
            None => true,
        };
        let upper_inclusive = match args.get(4) {
            Some(value) => match coerce_between_flag(value) {
                Ok(flag) => flag,
                Err(error) => return error,
            },
            None => true,
        };

        let lower_ok = if lower_inclusive {
            value >= lower
        } else {
            value > lower
        };
        let upper_ok = if upper_inclusive {
            value <= upper
        } else {
            value < upper
        };
        CellValue::Boolean(lower_ok && upper_ok)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsBetween));
}
