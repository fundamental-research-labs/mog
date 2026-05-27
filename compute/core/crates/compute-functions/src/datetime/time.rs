// Mechanical split from datetime.rs; keep behavior changes out of this refactor.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub struct FnTime;

impl PureFunction for FnTime {
    fn name(&self) -> &'static str {
        "TIME"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        let hour = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let minute = match args[1].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let second = match args[2].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };

        let total_seconds = hour * 3600 + minute * 60 + second;
        if total_seconds < 0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("TIME: total seconds must be non-negative, got {total_seconds}"),
            );
        }
        // Wrap to 24-hour period
        let wrapped = total_seconds % 86400;
        let fraction = wrapped as f64 / 86400.0;
        CellValue::number(fraction)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTime));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use crate::datetime::test_helpers::*;
    use value_types::CellValue;

    #[test]
    fn test_time() {
        let f = FnTime;
        // TIME(12, 30, 45) = 0.5 + 30/1440 + 45/86400
        let result = f.call(&[num(12.0), num(30.0), num(45.0)]);
        if let CellValue::Number(n) = result {
            let expected = (12.0 * 3600.0 + 30.0 * 60.0 + 45.0) / 86400.0;
            assert!((n.get() - expected).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_time_zero() {
        let f = FnTime;
        let result = f.call(&[num(0.0), num(0.0), num(0.0)]);
        assert_eq!(result, num(0.0));
    }
}
