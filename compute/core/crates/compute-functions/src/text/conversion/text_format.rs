use value_types::date_serial::{try_parse_date, try_parse_datetime, try_parse_time};
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnText;
impl PureFunction for FnText {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let format_code = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };

        if format_code == "@" {
            return match &args[0] {
                CellValue::Text(t) => CellValue::Text(t.clone()),
                CellValue::Number(n) => CellValue::Text(value_types::format_number(n.get()).into()),
                CellValue::Boolean(b) => CellValue::Text(if *b { "TRUE" } else { "FALSE" }.into()),
                CellValue::Null => CellValue::Text("".into()),
                CellValue::Error(e, _) => CellValue::Error(*e, None),
                _ => CellValue::Text(args[0].coerce_to_string().unwrap_or_default().into()),
            };
        }

        if let CellValue::Text(ref t) = args[0] {
            let trimmed = t.trim();
            let first = trimmed.as_bytes().first().copied().unwrap_or(0);
            let could_be_numeric = first.is_ascii_digit()
                || first == b'-'
                || first == b'+'
                || first == b'('
                || first == b'.';
            if could_be_numeric {
                if let Ok(n) = trimmed.parse::<f64>() {
                    return CellValue::Text(compute_formats::format_number(n, &format_code).into());
                }
                if let Ok(serial) = try_parse_date(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(serial, &format_code).into(),
                    );
                }
                if let Ok(serial) = try_parse_datetime(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(serial, &format_code).into(),
                    );
                }
                if let Ok(time_val) = try_parse_time(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(time_val, &format_code).into(),
                    );
                }
            }
            return CellValue::Text(compute_formats::format_text(t, &format_code).into());
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                if n < 0.0 && compute_formats::is_date_format(&format_code) {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "TEXT: negative number {n} cannot be formatted with date/time format code"
                        ),
                    );
                }
                CellValue::Text(compute_formats::format_number(n, &format_code).into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnText));
}
