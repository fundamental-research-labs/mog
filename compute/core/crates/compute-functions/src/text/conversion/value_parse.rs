use value_types::date_serial::{try_parse_date, try_parse_time};
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnValue;
impl PureFunction for FnValue {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "VALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match &args[0] {
            CellValue::Number(n) => CellValue::Number(*n),
            CellValue::Boolean(b) => CellValue::number(if *b { 1.0 } else { 0.0 }),
            CellValue::Text(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "VALUE: cannot convert empty string to a number",
                    );
                }

                let (working, is_negative) = if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    (&trimmed[1..trimmed.len() - 1], true)
                } else {
                    (trimmed, false)
                };

                let has_percent = working.contains('%');
                let cleaned =
                    working.replace([',', '$', '\u{20AC}', '\u{00A3}', '\u{00A5}', '%'], "");
                match fast_float::parse::<f64, _>(cleaned.trim()) {
                    Ok(n) => {
                        let mut result = n;
                        if has_percent {
                            result /= 100.0;
                        }
                        if is_negative {
                            result = -result;
                        }
                        CellValue::number(result)
                    }
                    Err(_) => {
                        if let Ok(serial) = try_parse_date(trimmed) {
                            return CellValue::number(serial);
                        }
                        if let Ok(frac) = try_parse_time(trimmed) {
                            return CellValue::number(frac);
                        }
                        CellValue::error_with_message(
                            CellError::Value,
                            format!("VALUE: cannot convert '{trimmed}' to a number"),
                        )
                    }
                }
            }
            _ => CellValue::error_with_message(CellError::Value, "VALUE: argument must be text"),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnValue));
}
