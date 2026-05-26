//! Joining functions: CONCAT, CONCATENATE, TEXTJOIN, JOIN, REPT, EXACT

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{check_error, flatten_values};
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnConcatenate;
impl PureFunction for FnConcatenate {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CONCATENATE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let mut result = String::new();
        for arg in args {
            if let Some(e) = check_error(arg) {
                return e;
            }
            match arg.coerce_to_string() {
                Ok(s) => result.push_str(&s),
                Err(e) => return CellValue::Error(e, None),
            }
        }
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnConcat;
impl PureFunction for FnConcat {
    fn name(&self) -> &'static str {
        "CONCAT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // CONCAT is like CONCATENATE but also accepts ranges (flattens arrays)
        let flat = flatten_values(args);
        let mut result = String::new();
        for v in flat {
            if let CellValue::Error(e, _) = v {
                return CellValue::Error(e, None);
            }
            match v.coerce_to_string() {
                Ok(s) => {
                    result.push_str(&s);
                    if result.chars().count() > 32767 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            "CONCAT: result exceeds 32767 character limit",
                        );
                    }
                }
                Err(e) => return CellValue::Error(e, None),
            }
        }
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnTextJoin;
impl PureFunction for FnTextJoin {
    fn name(&self) -> &'static str {
        "TEXTJOIN"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let delimiter = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let ignore_empty = match args[1].coerce_to_bool() {
            Ok(b) => b,
            Err(e) => return CellValue::Error(e, None),
        };

        let mut parts = Vec::new();
        for arg in &args[2..] {
            let flat = flatten_values(std::slice::from_ref(arg));
            for v in flat {
                if let CellValue::Error(e, _) = v {
                    return CellValue::Error(e, None);
                }
                if ignore_empty && matches!(v, CellValue::Null) {
                    continue;
                }
                match v.coerce_to_string() {
                    Ok(s) => {
                        if ignore_empty && s.is_empty() {
                            continue;
                        }
                        parts.push(s.into_owned());
                    }
                    Err(e) => return CellValue::Error(e, None),
                }
            }
        }

        let result = parts.join(&delimiter);
        if result.chars().count() > 32767 {
            return CellValue::error_with_message(
                CellError::Value,
                "TEXTJOIN: result exceeds 32767 character limit",
            );
        }
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnJoin;
impl PureFunction for FnJoin {
    fn name(&self) -> &'static str {
        "JOIN"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if matches!(args[0], CellValue::Array(_)) {
            return CellValue::error_with_message(
                CellError::Value,
                "JOIN: delimiter must be scalar",
            );
        }
        let delimiter = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };

        let mut parts = Vec::new();
        for arg in &args[1..] {
            match arg {
                CellValue::Array(arr) if arr.rows() > 1 && arr.cols() > 1 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "JOIN: value arrays must be one-dimensional",
                    );
                }
                CellValue::Array(arr) => {
                    for cell in arr.iter() {
                        if let CellValue::Error(e, _) = cell {
                            return CellValue::Error(*e, None);
                        }
                        match cell.coerce_to_string() {
                            Ok(s) => parts.push(s.into_owned()),
                            Err(e) => return CellValue::Error(e, None),
                        }
                    }
                }
                other => {
                    if let Some(e) = check_error(other) {
                        return e;
                    }
                    match other.coerce_to_string() {
                        Ok(s) => parts.push(s.into_owned()),
                        Err(e) => return CellValue::Error(e, None),
                    }
                }
            }
        }

        let result = parts.join(&delimiter);
        if result.chars().count() > 32767 {
            return CellValue::error_with_message(
                CellError::Value,
                "JOIN: result exceeds 32767 character limit",
            );
        }
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnRept;
impl PureFunction for FnRept {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REPT"
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
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let times = match args[1].coerce_to_number() {
            Ok(n) if n < 0.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("REPT: number_times must be >= 0, got {n}"),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        // Excel limit: result can't exceed 32767 chars
        if text.chars().count() * times > 32767 {
            return CellValue::error_with_message(
                CellError::Value,
                format!(
                    "REPT: result would exceed 32767 character limit ({} x {times})",
                    text.chars().count()
                ),
            );
        }
        CellValue::Text(text.repeat(times).into())
    }
}

pub(crate) struct FnExact;
impl PureFunction for FnExact {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "EXACT"
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
        let s1 = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let s2 = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        // EXACT is case-sensitive (unlike normal Excel comparison)
        CellValue::Boolean(s1 == s2)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnConcatenate));
    registry.register(Box::new(FnConcat));
    registry.register(Box::new(FnTextJoin));
    registry.register(Box::new(FnJoin));
    registry.register(Box::new(FnRept));
    registry.register(Box::new(FnExact));
}

#[cfg(test)]
mod join_tests {
    use super::*;

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }

    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    #[test]
    fn join_scalars_vectors_and_blanks() {
        assert_eq!(
            FnJoin.call(&[text(","), text("a"), CellValue::Null, text(""), text("b")]),
            text("a,,,b")
        );
        assert_eq!(
            FnJoin.call(&[text(""), text("a"), text("b"), text("c")]),
            text("abc")
        );
        assert_eq!(
            FnJoin.call(&[
                text("-"),
                CellValue::row_array(vec![text("a"), num(2.0)]),
                text("c"),
                CellValue::column_array(vec![text("d"), CellValue::Boolean(true)])
            ]),
            text("a-2-c-d-TRUE")
        );
    }

    #[test]
    fn join_rejects_two_dimensional_arrays_before_element_errors() {
        let arr = CellValue::from_rows(vec![
            vec![text("a"), err(CellError::Div0)],
            vec![text("b"), text("c")],
        ]);
        assert!(matches!(
            FnJoin.call(&[text(","), arr]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn join_propagates_errors_in_one_dimensional_order() {
        let arr = CellValue::row_array(vec![text("a"), err(CellError::Na), text("b")]);
        assert_eq!(FnJoin.call(&[text(","), arr]), err(CellError::Na));
        assert_eq!(
            FnJoin.call(&[err(CellError::Div0), text("a")]),
            err(CellError::Div0)
        );
    }

    #[test]
    fn join_rejects_array_delimiter_and_overflow() {
        assert!(matches!(
            FnJoin.call(&[CellValue::row_array(vec![text(",")]), text("a")]),
            CellValue::Error(CellError::Value, _)
        ));
        let long = "a".repeat(32_768);
        assert!(matches!(
            FnJoin.call(&[text(","), CellValue::Text(long.into())]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn join_diverges_from_textjoin_by_including_blanks() {
        assert_eq!(
            FnJoin.call(&[text(","), text("a"), CellValue::Null, text("b")]),
            text("a,,b")
        );
        assert_eq!(
            FnTextJoin.call(&[
                text(","),
                CellValue::Boolean(true),
                text("a"),
                CellValue::Null,
                text("b")
            ]),
            text("a,b")
        );
    }
}
