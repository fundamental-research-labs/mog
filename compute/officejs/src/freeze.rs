//! Worksheet.freezePanes host operations.

use serde_json::Value;

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::BatchError;

pub(crate) struct FreezeHandler;

impl ExtensionHandler for FreezeHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "freezeRows" | "freezeColumns" | "freezeAt" | "unfreeze" | "freezeLocation"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let op = operation
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let worksheet = context.worksheet(required_str(operation, "worksheetId")?)?;
        let layout = worksheet.sheet().layout();
        match op {
            "freezeLocation" => {
                use crate::range_navigation::RangeAddress;
                let panes = layout.get_frozen_panes().map_err(engine)?;
                let address = match (panes.rows, panes.cols) {
                    (0, 0) => None,
                    (rows, 0) => Some(RangeAddress::Rows {
                        start: 0,
                        end: rows - 1,
                    }),
                    (0, cols) => Some(RangeAddress::Columns {
                        start: 0,
                        end: cols - 1,
                    }),
                    (rows, cols) => Some(RangeAddress::Cells {
                        start_row: 0,
                        start_column: 0,
                        end_row: rows - 1,
                        end_column: cols - 1,
                    }),
                };
                let is_null = address.is_none();
                if is_null && operation["nullable"] != true {
                    return Err(BatchError {
                        code: "ItemNotFound",
                        message: "No frozen panes exist".into(),
                    });
                }
                context.bind_range(
                    required_str(operation, "id")?,
                    crate::host::RangeRef::new(
                        worksheet.sheet(),
                        address.map(|a| a.to_a1()),
                        is_null,
                    ),
                    is_null,
                );
            }
            "freezeRows" => {
                let count = required_u32(operation, "count")?;
                layout.freeze_rows(count).map_err(engine)?;
            }
            "freezeColumns" => {
                let count = required_u32(operation, "count")?;
                layout.freeze_columns(count).map_err(engine)?;
            }
            "unfreeze" => {
                layout.set_frozen_panes(0, 0).map_err(engine)?;
            }
            "freezeAt" => {
                let range_id = required_str(operation, "rangeId")?;
                let range = context.range(range_id)?;
                let address = range.address().ok_or_else(|| BatchError {
                    code: "InvalidArgument",
                    message: "freezePanes.freezeAt requires a bounded range".to_string(),
                })?;
                let parsed = crate::range_navigation::parse_range_address(&range.sheet(), address)
                    .map_err(|error| BatchError {
                        code: error.code,
                        message: error.message,
                    })?;
                let (start_row, start_col, _, _) = parsed.bounds();
                layout
                    .set_frozen_panes(start_row, start_col)
                    .map_err(engine)?;
            }
            _ => return Ok(false),
        }
        Ok(true)
    }
}

fn required_str<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("{field} is required"),
        })
}

fn required_u32(operation: &Value, field: &str) -> Result<u32, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("{field} must be a non-negative integer"),
        })
}

fn engine(error: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}
