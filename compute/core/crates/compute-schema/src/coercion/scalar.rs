use value_types::CellValue;

use super::number;
use crate::types::{CellValueResult, CoercionResult};

pub(super) fn coerce_passthrough(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Number(n.get())),
        CellValue::Text(s) => CoercionResult::ok(CellValueResult::Text(s.to_string())),
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Boolean(*b)),
        CellValue::Null => CoercionResult::ok(CellValueResult::Null),
        CellValue::Error(e, _) => CoercionResult::err(format!("Cannot coerce error value: {e}")),
        CellValue::Array(_) => CoercionResult::ok(CellValueResult::Text("[Array]".into())),
        CellValue::Control(c) => CoercionResult::ok(CellValueResult::Boolean(c.value)),
        CellValue::Image(image) => {
            CoercionResult::ok(CellValueResult::Text(image.fallback_text().into()))
        }
    }
}

pub(super) fn coerce_to_null(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Null => CoercionResult::ok(CellValueResult::Null),
        CellValue::Text(s) if s.is_empty() => CoercionResult::ok(CellValueResult::Null),
        CellValue::Number(n) if n.get() == 0.0 => CoercionResult::ok(CellValueResult::Null),
        CellValue::Boolean(false) => CoercionResult::ok(CellValueResult::Null),
        _ => CoercionResult::err("Value is not empty"),
    }
}

pub(super) fn coerce_to_boolean(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Boolean(*b)),
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Boolean(n.get() != 0.0)),
        CellValue::Text(s) => {
            let lower = s.trim().to_ascii_lowercase();
            match lower.as_str() {
                "true" | "yes" | "1" | "on" => CoercionResult::ok(CellValueResult::Boolean(true)),
                "false" | "no" | "0" | "off" | "" => {
                    CoercionResult::ok(CellValueResult::Boolean(false))
                }
                _ => CoercionResult::err(format!("Cannot coerce \"{s}\" to boolean")),
            }
        }
        _ => CoercionResult::err("Cannot coerce value to boolean"),
    }
}

pub(super) fn coerce_to_integer(value: &CellValue) -> CoercionResult {
    let num_result = number::coerce_to_number(value);
    if !num_result.success {
        return num_result;
    }
    match num_result.value {
        Some(CellValueResult::Number(n)) => CoercionResult::ok(CellValueResult::Number(n.round())),
        _ => num_result,
    }
}

pub(super) fn coerce_to_string(value: &CellValue) -> CoercionResult {
    match value {
        CellValue::Text(s) => CoercionResult::ok(CellValueResult::Text(s.to_string())),
        CellValue::Number(n) => CoercionResult::ok(CellValueResult::Text(format_number(n.get()))),
        CellValue::Boolean(b) => CoercionResult::ok(CellValueResult::Text(b.to_string())),
        CellValue::Null => CoercionResult::ok(CellValueResult::Text(String::new())),
        CellValue::Error(e, _) => CoercionResult::ok(CellValueResult::Text(format!("{e}"))),
        CellValue::Array(_) => CoercionResult::ok(CellValueResult::Text("[Array]".into())),
        CellValue::Control(c) => CoercionResult::ok(CellValueResult::Text(
            if c.value { "true" } else { "false" }.into(),
        )),
        CellValue::Image(image) => {
            CoercionResult::ok(CellValueResult::Text(image.fallback_text().into()))
        }
    }
}

fn format_number(n: f64) -> String {
    if n == n.trunc() {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}
