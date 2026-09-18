//! Office.js function calls reuse the formula evaluator without editing cells.

use std::{collections::HashMap, sync::Arc};

use serde_json::{Value, json};
use value_types::CellValue;

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

pub(crate) struct FunctionsHandler;

struct FunctionResult {
    value: CellValue,
}

impl ExtensionObject for FunctionResult {
    fn object_type(&self) -> &'static str {
        "FunctionResult"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        properties
            .iter()
            .map(|property| {
                let value = match (property.as_str(), &self.value) {
                    ("error", CellValue::Error(error, _)) => json!(error.to_string()),
                    ("error", _) | ("value", CellValue::Error(_, _)) => Value::Null,
                    ("value", CellValue::Number(number)) => json!(number.get()),
                    ("value", CellValue::Text(text)) => json!(text.as_ref()),
                    ("value", CellValue::Boolean(value)) => json!(value),
                    ("value", CellValue::Null) => Value::Null,
                    _ => {
                        return Err(invalid(format!(
                            "Unsupported FunctionResult property '{property}'"
                        )));
                    }
                };
                Ok((property.clone(), value))
            })
            .collect()
    }

    fn set(&self, property: &str, _: &Value) -> Result<(), BatchError> {
        Err(invalid(format!("FunctionResult.{property} is read-only")))
    }
}

impl ExtensionHandler for FunctionsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "functionEvaluate"
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let name = required_str(operation, "name")?;
        if name.is_empty()
            || !name
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        {
            return Err(invalid("Invalid function name"));
        }
        let args = operation["args"]
            .as_array()
            .ok_or_else(|| invalid("Expected function arguments"))?;
        let args = args
            .iter()
            .map(|arg| argument(arg, context))
            .collect::<Result<Vec<_>, _>>()?;
        let sheet = context
            .worksheet(required_str(operation, "worksheetId")?)?
            .sheet();
        let value = context
            .workbook()
            .names()
            .evaluate_expression(sheet.id(), &format!("={name}({})", args.join(",")))
            .map_err(engine)?;
        context.bind_object(
            required_str(operation, "id")?,
            Arc::new(FunctionResult { value }),
        );
        Ok(true)
    }
}

fn argument(value: &Value, context: &HostDispatchContext<'_>) -> Result<String, BatchError> {
    match value {
        Value::Null => Ok(String::new()),
        Value::Bool(value) => Ok(if *value { "TRUE" } else { "FALSE" }.into()),
        Value::Number(number) => Ok(number.to_string()),
        Value::String(text) => Ok(quote_text(text)),
        Value::Array(values) => {
            if values.is_empty() {
                return Err(invalid("Function arrays must not be empty"));
            }
            let rows: Vec<&[Value]> = if values[0].is_array() {
                values
                    .iter()
                    .map(|row| {
                        row.as_array()
                            .map(Vec::as_slice)
                            .ok_or_else(|| invalid("Function arrays must be rectangular"))
                    })
                    .collect::<Result<_, _>>()?
            } else {
                vec![values]
            };
            let width = rows[0].len();
            if width == 0 || rows.iter().any(|row| row.len() != width) {
                return Err(invalid("Function arrays must be rectangular"));
            }
            let rows = rows
                .iter()
                .map(|row| {
                    row.iter()
                        .map(|value| {
                            if value.is_array() || value.is_object() {
                                return Err(invalid("Array elements must be scalar values"));
                            }
                            argument(value, context)
                        })
                        .collect::<Result<Vec<_>, _>>()
                        .map(|row| row.join(","))
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("{{{}}}", rows.join(";")))
        }
        Value::Object(object) => {
            if let Some(id) = object.get("rangeId").and_then(Value::as_str) {
                let range = context.range(id)?;
                let sheet = range.sheet();
                let address = match range.address() {
                    Some(raw) => crate::range_navigation::parse_range_address(&sheet, raw)
                        .map_err(|e| invalid(e.message))?
                        .to_a1(),
                    None => "A1:XFD1048576".to_string(),
                };
                return Ok(format!(
                    "'{}'!{address}",
                    sheet.name().map_err(engine)?.replace('\'', "''")
                ));
            }
            if let Some(id) = object.get("resultId").and_then(Value::as_str) {
                // A result is a snapshot, including when reused after later writes.
                let result = context.extension_object::<FunctionResult>(id)?;
                return match &result.value {
                    CellValue::Number(value) => Ok(value.get().to_string()),
                    CellValue::Text(text) => Ok(quote_text(text)),
                    CellValue::Boolean(value) => Ok(if *value { "TRUE" } else { "FALSE" }.into()),
                    CellValue::Error(error, _) => Ok(error.to_string()),
                    CellValue::Null => Ok("0".into()),
                    _ => Err(invalid("Unsupported function result argument")),
                };
            }
            if let Some(address) = object.get("address").and_then(Value::as_str) {
                // RangeReference accepts an A1 reference or a defined name,
                // never arbitrary expressions. Preserve quoted worksheet names.
                let token = if let Some((sheet, token)) = address.rsplit_once('!') {
                    let name =
                        if sheet.starts_with('\'') && sheet.ends_with('\'') && sheet.len() >= 2 {
                            let inner = &sheet[1..sheet.len() - 1];
                            if inner.replace("''", "").contains('\'') {
                                return Err(invalid("Invalid worksheet qualifier"));
                            }
                            inner.replace("''", "'")
                        } else {
                            if !identifier(sheet) {
                                return Err(invalid("Invalid worksheet qualifier"));
                            }
                            sheet.to_string()
                        };
                    context.workbook().sheet_by_name(&name).map_err(engine)?;
                    token
                } else {
                    address
                };
                if crate::range_navigation::RangeAddress::parse(token).is_err()
                    && !identifier(token)
                {
                    return Err(invalid("Invalid range reference"));
                }
                return Ok(format!("({address})"));
            }
            Err(invalid("Invalid function argument object"))
        }
    }
}

fn identifier(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '\\')
        && chars.all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '\\'))
}

fn quote_text(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

fn required_str<'a>(value: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    value[field]
        .as_str()
        .ok_or_else(|| invalid(format!("Missing {field}")))
}

fn invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn engine(error: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}
