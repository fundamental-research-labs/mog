use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnValueToText;
impl PureFunction for FnValueToText {
    fn name(&self) -> &'static str {
        "VALUETOTEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let format = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(f) => {
                    let f = f as i32;
                    if f != 0 && f != 1 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!("VALUETOTEXT: format must be 0 or 1, got {f}"),
                        );
                    }
                    f
                }
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        match &args[0] {
            CellValue::Null => CellValue::Text(String::new().into()),
            CellValue::Boolean(b) => CellValue::Text(if *b {
                "TRUE".to_string().into()
            } else {
                "FALSE".to_string().into()
            }),
            CellValue::Control(c) => CellValue::Text(if c.value {
                "TRUE".to_string().into()
            } else {
                "FALSE".to_string().into()
            }),
            CellValue::Image(image) => CellValue::Text(image.fallback_text().into()),
            CellValue::Number(_) => CellValue::Text(
                args[0]
                    .coerce_to_string()
                    .unwrap_or_default()
                    .into_owned()
                    .into(),
            ),
            CellValue::Text(s) => {
                if format == 1 {
                    CellValue::Text(format!("\"{}\"", s).into())
                } else {
                    CellValue::Text(s.clone())
                }
            }
            CellValue::Array(arr) => {
                let mut parts = Vec::new();
                for row in arr.rows_iter() {
                    let row_parts: Vec<String> = row
                        .iter()
                        .map(|v| match v.coerce_to_string() {
                            Ok(s) => {
                                if format == 1 {
                                    if matches!(v, CellValue::Text(_)) {
                                        format!("\"{}\"", s)
                                    } else {
                                        s.into_owned()
                                    }
                                } else {
                                    s.into_owned()
                                }
                            }
                            Err(_) => String::new(),
                        })
                        .collect();
                    parts.push(row_parts.join(","));
                }
                if format == 1 {
                    CellValue::Text(format!("{{{}}}", parts.join(";")).into())
                } else {
                    CellValue::Text(parts.join(", ").into())
                }
            }
            CellValue::Error(e, _) => CellValue::Error(*e, None),
        }
    }
}

pub(super) struct FnArrayToText;
impl PureFunction for FnArrayToText {
    fn name(&self) -> &'static str {
        "ARRAYTOTEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let format = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(f) => {
                    let f = f as i32;
                    if f != 0 && f != 1 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!("ARRAYTOTEXT: format must be 0 or 1, got {f}"),
                        );
                    }
                    f
                }
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let strict = format == 1;

        fn value_to_text(v: &CellValue, strict: bool) -> String {
            match v {
                CellValue::Null => String::new(),
                CellValue::Boolean(b) => {
                    if *b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                }
                CellValue::Number(_) => v.coerce_to_string().unwrap_or_default().into_owned(),
                CellValue::Text(s) => {
                    if strict {
                        format!("\"{}\"", s)
                    } else {
                        s.to_string()
                    }
                }
                CellValue::Error(e, _) => e.as_str().to_string(),
                CellValue::Control(c) => if c.value { "TRUE" } else { "FALSE" }.to_string(),
                CellValue::Array(_) => String::new(),
                CellValue::Image(image) => image.fallback_text().to_string(),
            }
        }

        match &args[0] {
            CellValue::Array(arr) => {
                let row_strs: Vec<String> = arr
                    .rows_iter()
                    .map(|row| {
                        let cell_strs: Vec<String> =
                            row.iter().map(|v| value_to_text(v, strict)).collect();
                        if strict {
                            cell_strs.join(",")
                        } else {
                            cell_strs.join(", ")
                        }
                    })
                    .collect();
                if strict {
                    let inner = row_strs
                        .iter()
                        .map(|r| format!("{{{}}}", r))
                        .collect::<Vec<_>>()
                        .join(";");
                    CellValue::Text(format!("{{{}}}", inner).into())
                } else {
                    CellValue::Text(row_strs.join("; ").into())
                }
            }
            other => CellValue::Text(value_to_text(other, strict).into()),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnValueToText));
    registry.register(Box::new(FnArrayToText));
}
