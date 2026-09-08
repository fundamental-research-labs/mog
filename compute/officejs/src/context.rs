//! Host-side support for the `ClientRequestContext` recursive-load action.
//!
//! The JavaScript request context owns the Office.js query-option parser and
//! emits one bounded `loadRecursive` operation.  This module owns the host
//! side of that operation: it applies the normalized per-type projections to
//! already-bound object IDs and respects the depth attached to each cached
//! target.  It deliberately does not walk arbitrary proxy fields.  The
//! central host can add object-family target discovery later without changing
//! the wire or this bounded dispatcher.

use std::collections::HashMap;

use compute_api::{CellAddress, CellRange, Sheet};
use serde_json::{json, Value};
use value_types::CellValue;

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::format::FormatError;
use crate::host::{BatchError, RangeRef};
use crate::range_content;
use crate::range_navigation::{parse_range_address, RangeAddress};
use crate::worksheets::WorksheetError;

/// Register the request-context handler with a host.  The host owner calls
/// this while assembling the extension registry, before script batches run.
pub(crate) fn register(host: &crate::host::Host) {
    host.register_extension(ContextHandler);
}

/// Dispatches the request-context operation that is outside the core `Op`
/// enum.  Trace actions remain owned by the central host loop because their
/// response timing spans every operation in a batch.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct ContextHandler;

impl ExtensionHandler for ContextHandler {
    fn can_handle(&self, operation: &str) -> bool {
        operation == "loadRecursive"
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let id = required_string(operation, "id")?;
        let queries = operation
            .get("queries")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("loadRecursive requires a queries object"))?;
        let max_depth = parse_max_depth(operation.get("maxDepth"))?;
        let targets = parse_targets(operation.get("targets"))?;
        let root_type = infer_root_type(context, &id);

        for (type_name, raw_query) in queries {
            let query = QuerySpec::parse(raw_query, type_name)?;
            let target_list = target_ids_for_type(&targets, type_name, &id, root_type);
            if target_list.is_empty() {
                // A type with no materialized target is not a successful
                // recursive load.  Returning an explicit capability error
                // prevents a later property read from looking loaded when no
                // host object was hydrated.
                return Err(unsupported_type(type_name));
            }
            for target in target_list {
                if max_depth.is_some_and(|limit| target.depth > limit) {
                    continue;
                }
                match type_name {
                    "Range" => load_range(context, &target.id, &query)?,
                    "RangeFormat" => load_range_format(context, &target.id, &query)?,
                    "Worksheet" => load_worksheet(context, &target.id, &query)?,
                    _ => return Err(unsupported_type(type_name)),
                }
            }
        }

        Ok(true)
    }
}

#[derive(Debug, Clone)]
struct QuerySpec {
    select: Vec<String>,
    expand: Vec<String>,
}

impl QuerySpec {
    fn parse(value: &Value, type_name: &str) -> Result<Self, BatchError> {
        let object = value.as_object().ok_or_else(|| {
            invalid(format!(
                "loadRecursive query for {type_name} must be a normalized object"
            ))
        })?;

        let select = parse_property_list(object.get("Select"), type_name, "Select")?;
        let expand = parse_property_list(object.get("Expand"), type_name, "Expand")?;
        for key in object.keys() {
            if !matches!(key.as_str(), "Select" | "Expand" | "Top" | "Skip") {
                return Err(invalid(format!(
                    "loadRecursive query for {type_name} contains unsupported key '{key}'"
                )));
            }
            if matches!(key.as_str(), "Top" | "Skip") && !object[key].is_number() {
                return Err(invalid(format!(
                    "loadRecursive query {type_name}.{key} must be a number"
                )));
            }
        }

        Ok(Self { select, expand })
    }

    fn selected(&self, name: &str) -> bool {
        self.select.iter().any(|property| property == name)
    }

    fn selected_paths(&self, prefix: &str) -> Vec<String> {
        let prefix = format!("{prefix}/");
        self.select
            .iter()
            .filter_map(|property| property.strip_prefix(&prefix).map(str::to_owned))
            .collect()
    }
}

fn parse_property_list(
    value: Option<&Value>,
    type_name: &str,
    property: &str,
) -> Result<Vec<String>, BatchError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    match value {
        Value::String(value) => Ok(vec![value.clone()]),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_owned).ok_or_else(|| {
                    invalid(format!(
                        "loadRecursive query {type_name}.{property} must contain strings"
                    ))
                })
            })
            .collect(),
        _ => Err(invalid(format!(
            "loadRecursive query {type_name}.{property} must be a string or array"
        ))),
    }
}

#[derive(Debug, Clone)]
struct Target {
    id: String,
    depth: u32,
}

fn parse_targets(value: Option<&Value>) -> Result<HashMap<String, Vec<Target>>, BatchError> {
    let Some(value) = value else {
        return Ok(HashMap::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| invalid("loadRecursive targets must be an object"))?;
    let mut targets = HashMap::new();
    for (type_name, entries) in object {
        let entries = entries.as_array().ok_or_else(|| {
            invalid(format!(
                "loadRecursive targets.{type_name} must be an array"
            ))
        })?;
        let mut parsed = Vec::with_capacity(entries.len());
        for entry in entries {
            let (id, depth) = match entry {
                Value::String(id) => (id.clone(), 0),
                Value::Object(entry) => {
                    let id = entry
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| invalid("loadRecursive target is missing an id"))?;
                    let depth = entry
                        .get("depth")
                        .and_then(|value| {
                            value.as_u64().and_then(|depth| u32::try_from(depth).ok())
                        })
                        .unwrap_or(0);
                    (id.to_owned(), depth)
                }
                _ => return Err(invalid("loadRecursive target must be a string or object")),
            };
            parsed.push(Target { id, depth });
        }
        targets.insert(type_name.clone(), parsed);
    }
    Ok(targets)
}

fn parse_max_depth(value: Option<&Value>) -> Result<Option<u32>, BatchError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let depth = value
        .as_u64()
        .and_then(|depth| u32::try_from(depth).ok())
        .ok_or_else(|| invalid("loadRecursive maxDepth must be a non-negative integer"))?;
    Ok(Some(depth))
}

fn target_ids_for_type(
    targets: &HashMap<String, Vec<Target>>,
    type_name: &str,
    root_id: &str,
    root_type: Option<&str>,
) -> Vec<Target> {
    if let Some(targets) = targets.get(type_name) {
        return targets.clone();
    }
    if root_type == Some(type_name) {
        return vec![Target {
            id: root_id.to_owned(),
            depth: 0,
        }];
    }
    Vec::new()
}

fn infer_root_type(context: &HostDispatchContext<'_>, id: &str) -> Option<&'static str> {
    // The returned string literals are static; keeping this probe in one
    // place makes the unsupported-family boundary obvious.
    if context.range(id).is_ok() {
        return Some("Range");
    }
    if context.format(id).is_ok() {
        return Some("RangeFormat");
    }
    if context.worksheet(id).is_ok() {
        return Some("Worksheet");
    }
    None
}

fn load_range(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    query: &QuerySpec,
) -> Result<(), BatchError> {
    let range = context.range(id)?;
    if range.is_null_object() {
        if query
            .select
            .iter()
            .all(|property| property == "isNullObject")
        {
            context.set_loaded(id, "isNullObject", Value::Bool(true));
            return Ok(());
        }
        return Err(BatchError {
            code: "InvalidObjectPath",
            message: "Range properties cannot be loaded from a null object".to_string(),
        });
    }

    let parsed = parsed_range(&range)?;
    let unbounded = parsed.is_whole_sheet() || parsed.is_entire_row() || parsed.is_entire_column();
    let mut loaded = HashMap::new();
    for property in &query.select {
        if property.contains('/') || property == "format" {
            continue;
        }
        let value = match property.as_str() {
            "isNullObject" => Value::Bool(false),
            "address" => Value::String(range_address(&range, &parsed)?),
            "rowIndex" => json!(parsed.bounds().0),
            "columnIndex" => json!(parsed.bounds().1),
            "rowCount" => json!(parsed.row_count()),
            "columnCount" => json!(parsed.column_count()),
            "cellCount" => json!(parsed.cell_count()),
            "values" => {
                if unbounded {
                    Value::Null
                } else {
                    range_values_json(&range.sheet(), range.address().expect("bounded range"))?
                }
            }
            "formulas" => {
                if unbounded {
                    Value::Null
                } else {
                    range_formulas_json(&range.sheet(), range.address().expect("bounded range"))?
                }
            }
            "numberFormat" | "text" | "valueTypes" => {
                if unbounded {
                    Value::Null
                } else {
                    range_content::load(
                        &range.sheet(),
                        range.address().expect("bounded range"),
                        std::slice::from_ref(property),
                    )
                    .map_err(range_content_error)?
                    .remove(property)
                    .unwrap_or(Value::Null)
                }
            }
            other => return Err(unsupported_property("Range", other)),
        };
        loaded.insert(property.clone(), value);
    }
    context.extend_loaded(id, loaded);
    load_nested_format(context, &range, query)
}

fn load_nested_format(
    context: &mut HostDispatchContext<'_>,
    _range: &RangeRef,
    query: &QuerySpec,
) -> Result<(), BatchError> {
    // The JavaScript side includes cached navigation IDs in `targets`.  The
    // handler processes RangeFormat through its own query entry, so this
    // helper only documents the select-path case and leaves target discovery
    // to the host registry.
    let _ = query.expand.iter().any(|property| property == "format");
    let _ = query.selected_paths("format");
    let _ = context;
    Ok(())
}

fn load_range_format(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    query: &QuerySpec,
) -> Result<(), BatchError> {
    let format = context.format(id)?;
    let properties: Vec<String> = query
        .select
        .iter()
        .filter(|property| property.as_str() != "isNullObject" && !property.contains('/'))
        .cloned()
        .collect();
    let mut loaded = format.load(&properties).map_err(format_error)?;
    if query.selected("isNullObject") {
        loaded.insert("isNullObject".to_string(), Value::Bool(false));
    }
    context.extend_loaded(id, loaded);
    Ok(())
}

fn load_worksheet(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    query: &QuerySpec,
) -> Result<(), BatchError> {
    let worksheet = context.worksheet(id)?;
    let properties: Vec<String> = query
        .select
        .iter()
        .filter(|property| !property.contains('/'))
        .cloned()
        .collect();
    let loaded = worksheet.load(&properties).map_err(worksheet_error)?;
    context.extend_loaded(id, loaded);
    Ok(())
}

fn parsed_range(range: &RangeRef) -> Result<RangeAddress, BatchError> {
    match range.address() {
        Some(address) => {
            parse_range_address(&range.sheet(), address).map_err(range_navigation_error)
        }
        None => Ok(RangeAddress::WholeSheet),
    }
}

fn range_address(range: &RangeRef, parsed: &RangeAddress) -> Result<String, BatchError> {
    let sheet_name = range.sheet().name().map_err(engine_error)?;
    Ok(format!(
        "{}!{}",
        qualified_sheet_name(&sheet_name),
        parsed.to_a1()
    ))
}

fn qualified_sheet_name(name: &str) -> String {
    if name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

fn range_values_json(sheet: &Sheet, address: &str) -> Result<Value, BatchError> {
    let (start_row, start_col, end_row, end_col) =
        CellRange::from(address).resolve().map_err(engine_error)?;
    let values = sheet
        .get_range_values_2d(CellRange::Bounds(start_row, start_col, end_row, end_col))
        .map_err(engine_error)?;
    Ok(Value::Array(
        values
            .into_iter()
            .map(|row| Value::Array(row.into_iter().map(cell_to_js).collect()))
            .collect(),
    ))
}

fn range_formulas_json(sheet: &Sheet, address: &str) -> Result<Value, BatchError> {
    let (start_row, start_col, end_row, end_col) =
        CellRange::from(address).resolve().map_err(engine_error)?;
    let mut rows = Vec::new();
    for row in start_row..=end_row {
        let mut cells = Vec::new();
        for column in start_col..=end_col {
            let address = CellAddress::Position(row, column);
            if let Some(formula) = sheet.get_formula(address.clone()).map_err(engine_error)? {
                cells.push(Value::String(formula));
            } else {
                cells.push(cell_to_js(
                    sheet.get_cell_value(address).map_err(engine_error)?,
                ));
            }
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn cell_to_js(value: CellValue) -> Value {
    match value {
        CellValue::Null => Value::String(String::new()),
        CellValue::Boolean(value) => Value::Bool(value),
        CellValue::Number(value) => value.as_number().map_or(Value::Null, |value| json!(value)),
        CellValue::Text(value) => Value::String(value.to_string()),
        CellValue::Error(error, _) => Value::String(error.to_string()),
        other => Value::String(other.to_string()),
    }
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("loadRecursive requires string field '{field}'")))
}

fn invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported_type(type_name: &str) -> BatchError {
    BatchError {
        code: "ApiNotFound",
        message: format!("loadRecursive does not support the {type_name} object family"),
    }
}

fn unsupported_property(object: &str, property: &str) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} load property '{property}'"),
    }
}

fn engine_error(error: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn range_navigation_error(error: crate::range_navigation::RangeNavigationError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn range_content_error(error: crate::range_content::RangeContentError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn format_error(error: FormatError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn worksheet_error(error: WorksheetError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}
