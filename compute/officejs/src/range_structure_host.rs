//! Host dispatch for the Office.js Range structural family.
//!
//! The JavaScript adapter emits structural operations into the normal
//! request queue. This handler resolves the already-bound Range proxy and
//! delegates the mutation to the range_structure module, which in turn calls
//! the production SheetStructure/SheetOutline APIs. Keeping this bridge in
//! its own family module lets the central host remain unaware of the Range
//! operation payloads.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};

use crate::dispatch::{ExtensionHandler, ExtensionObject, ExtensionRegistry, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_structure::{self, RangeStructureError, RemoveDuplicatesResult};

const OPERATIONS: &[&str] = &[
    "rangeInsert",
    "rangeDelete",
    "rangeMerge",
    "rangeUnmerge",
    "rangeRemoveDuplicates",
    "rangeGroup",
    "rangeUngroup",
];

/// Register the Range structural family with the host extension registry.
pub(crate) fn register(registry: &ExtensionRegistry) {
    registry.register(RangeStructureHandler);
}

/// Dispatches Range.insert/delete/merge/unmerge/removeDuplicates/group/ungroup.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct RangeStructureHandler;

impl ExtensionHandler for RangeStructureHandler {
    fn can_handle(&self, operation: &str) -> bool {
        OPERATIONS.contains(&operation)
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        match operation_name(operation)? {
            "rangeInsert" => range_insert(operation, context)?,
            "rangeDelete" => range_delete(operation, context)?,
            "rangeMerge" => range_merge(operation, context)?,
            "rangeUnmerge" => range_unmerge(operation, context)?,
            "rangeRemoveDuplicates" => range_remove_duplicates(operation, context)?,
            "rangeGroup" => range_group(operation, context, false)?,
            "rangeUngroup" => range_group(operation, context, true)?,
            _ => return Ok(false),
        }
        Ok(true)
    }
}

/// The deferred Office.js result object returned by Range.removeDuplicates.
#[derive(Clone)]
struct RemoveDuplicatesObject {
    result: RemoveDuplicatesResult,
}

impl ExtensionObject for RemoveDuplicatesObject {
    fn object_type(&self) -> &'static str {
        "RemoveDuplicatesResult"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let mut result = HashMap::new();
        for property in properties {
            match property.as_str() {
                "removed" => {
                    result.insert(property.clone(), json!(self.result.removed));
                }
                "uniqueRemaining" => {
                    result.insert(property.clone(), json!(self.result.unique_remaining));
                }
                other => {
                    return Err(invalid_argument(format!(
                        "Unsupported RemoveDuplicatesResult property '{other}'"
                    )));
                }
            }
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(invalid_argument(format!(
            "RemoveDuplicatesResult.{property} is read-only"
        )))
    }
}

fn range_insert(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let result_id = required_string(operation, "id")?;
    let range_id = required_string(operation, "rangeId")?;
    let shift = required_string(operation, "shift")?;
    let range = structural_range(context.range(range_id)?, "Range.insert")?;
    range_structure::insert(
        &range.sheet(),
        range_address(&range, "Range.insert")?,
        shift,
    )
    .map_err(range_structure_error)?;
    // Range.insert returns a live Range proxy at the original address. The
    // source RangeRef is already the exact worksheet/address binding needed
    // for that result, so reuse it rather than copying cells or values.
    context.bind_range(result_id, range);
    Ok(())
}

fn range_delete(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let range_id = required_string(operation, "id")?;
    let shift = required_string(operation, "shift")?;
    let range = structural_range(context.range(range_id)?, "Range.delete")?;
    range_structure::delete(
        &range.sheet(),
        range_address(&range, "Range.delete")?,
        shift,
    )
    .map_err(range_structure_error)
}

fn range_merge(operation: &Value, context: &mut HostDispatchContext<'_>) -> Result<(), BatchError> {
    let range_id = required_string(operation, "id")?;
    let across = optional_bool(operation, "across", false)?;
    let range = structural_range(context.range(range_id)?, "Range.merge")?;
    range_structure::merge(
        &range.sheet(),
        range_address(&range, "Range.merge")?,
        across,
    )
    .map_err(range_structure_error)
}

fn range_unmerge(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let range_id = required_string(operation, "id")?;
    let range = structural_range(context.range(range_id)?, "Range.unmerge")?;
    range_structure::unmerge(&range.sheet(), range_address(&range, "Range.unmerge")?)
        .map_err(range_structure_error)
}

fn range_remove_duplicates(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let result_id = required_string(operation, "id")?;
    let range_id = required_string(operation, "rangeId")?;
    let columns = required_columns(operation)?;
    let includes_header = required_bool(operation, "includesHeader")?;
    let range = structural_range(context.range(range_id)?, "Range.removeDuplicates")?;
    let result = range_structure::remove_duplicates(
        &range.sheet(),
        range_address(&range, "Range.removeDuplicates")?,
        &columns,
        includes_header,
    )
    .map_err(range_structure_error)?;

    // This is intentionally an ExtensionObject binding, rather than a
    // ClientResult response. The pinned Office.js declaration says that
    // removeDuplicates returns a ClientObject with loadable scalar fields.
    context.bind_object(result_id, Arc::new(RemoveDuplicatesObject { result }));
    Ok(())
}

fn range_group(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
    ungroup: bool,
) -> Result<(), BatchError> {
    let range_id = required_string(operation, "id")?;
    let group_option = required_string(operation, "groupOption")?;
    let label = if ungroup {
        "Range.ungroup"
    } else {
        "Range.group"
    };
    let range = structural_range(context.range(range_id)?, label)?;
    let address = range_address(&range, label)?;
    let result = if ungroup {
        range_structure::ungroup(&range.sheet(), address, group_option)
    } else {
        range_structure::group(&range.sheet(), address, group_option)
    };
    result.map_err(range_structure_error)
}

/// Structural mutations accept addressed ranges. Grouping additionally
/// accepts full-row/full-column ranges; the range_structure grouping helper
/// enforces the axis-specific groupOption contract after parsing them.
fn structural_range(range: RangeRef, operation: &str) -> Result<RangeRef, BatchError> {
    if range.is_null_object() {
        return Err(batch_error(
            "InvalidObjectPath",
            format!("{operation} cannot use a null Range object"),
        ));
    }
    if range.address().is_none() {
        return Err(invalid_argument(format!(
            "{operation} requires an addressed Range"
        )));
    }
    Ok(range)
}

fn range_address<'a>(range: &'a RangeRef, operation: &str) -> Result<&'a str, BatchError> {
    range
        .address()
        .ok_or_else(|| invalid_argument(format!("{operation} requires an addressed Range")))
}

fn required_columns(operation: &Value) -> Result<Vec<u32>, BatchError> {
    let values = operation
        .get("columns")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_argument("Range.removeDuplicates columns must be an array"))?;
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            value
                .as_u64()
                .and_then(|value| u32::try_from(value).ok())
                .ok_or_else(|| {
                    invalid_argument(format!(
                        "Range.removeDuplicates columns[{index}] must be a non-negative integer"
                    ))
                })
        })
        .collect()
}

fn operation_name(operation: &Value) -> Result<&str, BatchError> {
    operation
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid_argument("Range structural operation requires an op name"))
}

fn required_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation.get(field).and_then(Value::as_str).ok_or_else(|| {
        invalid_argument(format!(
            "Range structural operation field '{field}' must be a string"
        ))
    })
}

fn required_bool(operation: &Value, field: &str) -> Result<bool, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            invalid_argument(format!(
                "Range structural operation field '{field}' must be a boolean"
            ))
        })
}

fn optional_bool(operation: &Value, field: &str, default: bool) -> Result<bool, BatchError> {
    match operation.get(field) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(invalid_argument(format!(
            "Range structural operation field '{field}' must be a boolean"
        ))),
    }
}

fn batch_error(code: &'static str, message: impl Into<String>) -> BatchError {
    BatchError {
        code,
        message: message.into(),
    }
}

fn invalid_argument(message: impl Into<String>) -> BatchError {
    batch_error("InvalidArgument", message)
}

fn range_structure_error(error: RangeStructureError) -> BatchError {
    batch_error(error.code, error.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_only_structure_operations() {
        let handler = RangeStructureHandler;
        assert!(handler.can_handle("rangeInsert"));
        assert!(handler.can_handle("rangeRemoveDuplicates"));
        assert!(handler.can_handle("rangeGroup"));
        assert!(handler.can_handle("rangeUngroup"));
        assert!(!handler.can_handle("rangeSort"));
    }

    #[test]
    fn parses_non_negative_u32_column_indexes() {
        let operation = json!({"columns": [0, 7, 4294967295u64]});
        assert_eq!(required_columns(&operation).unwrap(), vec![0, 7, u32::MAX]);

        let invalid = json!({"columns": [-1]});
        assert_eq!(
            required_columns(&invalid).unwrap_err().code,
            "InvalidArgument"
        );
    }
}
