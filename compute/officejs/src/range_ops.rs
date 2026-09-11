//! Range structure and layout mutations that are not core values/formulas.

use domain_types::domain::copy::CopyType;
use serde_json::{Value, json};

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_navigation::{RangeAddress, parse_range_address};

pub(crate) struct RangeOpsHandler;

impl ExtensionHandler for RangeOpsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "set" | "rangeMerge" | "rangeUnmerge" | "rangeInsert" | "rangeDelete" | "rangeCopyFrom"
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
        match op {
            "set" => handle_set(operation, context),
            "rangeMerge" => {
                merge(operation, context, false)?;
                Ok(true)
            }
            "rangeUnmerge" => {
                unmerge(operation, context)?;
                Ok(true)
            }
            "rangeInsert" => {
                insert(operation, context)?;
                Ok(true)
            }
            "rangeDelete" => {
                delete(operation, context)?;
                Ok(true)
            }
            "rangeCopyFrom" => {
                copy_from(operation, context)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

fn handle_set(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let property = match operation.get("property").and_then(Value::as_str) {
        Some(property) => property,
        None => return Ok(false),
    };
    if !matches!(
        property,
        "rowHidden" | "columnHidden" | "style" | "hyperlink"
    ) {
        return Ok(false);
    }
    let id = required_str(operation, "id")?;
    let Ok(range) = context.range(id) else {
        return Ok(false);
    };
    let value = operation.get("value").unwrap_or(&Value::Null);
    match property {
        "rowHidden" => set_hidden(&range, true, value)?,
        "columnHidden" => set_hidden(&range, false, value)?,
        "style" => apply_named_style(&range, value)?,
        "hyperlink" => set_hyperlink(&range, value)?,
        _ => return Ok(false),
    }
    Ok(true)
}

fn merge(
    operation: &Value,
    context: &HostDispatchContext<'_>,
    _unused: bool,
) -> Result<(), BatchError> {
    let range = context.range(required_str(operation, "rangeId")?)?;
    let across = operation
        .get("across")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (start_row, start_col, end_row, end_col) = bounds(&range)?;
    let structure = range.sheet().structure();
    if across {
        structure
            .merge_across(start_row, start_col, end_row, end_col)
            .map_err(engine)?;
    } else {
        structure
            .merge_range(start_row, start_col, end_row, end_col)
            .map_err(engine)?;
    }
    range
        .sheet()
        .formats()
        .patch_format_for_ranges(
            vec![(start_row, start_col, end_row, end_col)],
            serde_json::from_value(json!({ "wrapText": false })).map_err(engine)?,
            Vec::new(),
        )
        .map_err(engine)?;
    Ok(())
}

fn unmerge(operation: &Value, context: &HostDispatchContext<'_>) -> Result<(), BatchError> {
    let range = context.range(required_str(operation, "rangeId")?)?;
    let (start_row, start_col, end_row, end_col) = bounds(&range)?;
    range
        .sheet()
        .structure()
        .unmerge_range(start_row, start_col, end_row, end_col)
        .map_err(engine)?;
    Ok(())
}

fn insert(operation: &Value, context: &HostDispatchContext<'_>) -> Result<(), BatchError> {
    let range = context.range(required_str(operation, "rangeId")?)?;
    let shift = operation
        .get("shift")
        .and_then(Value::as_str)
        .unwrap_or("Down");
    let address = parsed(&range)?;
    let (start_row, start_col, end_row, end_col) = address.bounds();
    let structure = range.sheet().structure();
    match shift {
        "Down" | "down" => {
            structure
                .insert_rows(start_row, address.row_count())
                .map_err(engine)?;
        }
        "Right" | "right" => {
            structure
                .insert_columns(start_col, address.column_count())
                .map_err(engine)?;
        }
        other => {
            return Err(invalid(format!(
                "Unsupported InsertShiftDirection '{other}'"
            )));
        }
    }
    let _ = (end_row, end_col);
    Ok(())
}

fn delete(operation: &Value, context: &HostDispatchContext<'_>) -> Result<(), BatchError> {
    let range = context.range(required_str(operation, "rangeId")?)?;
    let shift = operation
        .get("shift")
        .and_then(Value::as_str)
        .unwrap_or("Up");
    let address = parsed(&range)?;
    let (start_row, start_col, _, _) = address.bounds();
    let structure = range.sheet().structure();
    match shift {
        "Up" | "up" if address.is_entire_row() => {
            structure
                .delete_rows(start_row, address.row_count())
                .map_err(engine)?;
        }
        "Left" | "left" if address.is_entire_column() => {
            structure
                .delete_columns(start_col, address.column_count())
                .map_err(engine)?;
        }
        "Up" | "up" => {
            structure
                .delete_cells_with_shift(
                    start_row,
                    start_col,
                    address.row_count(),
                    address.column_count(),
                    false,
                )
                .map_err(engine)?;
        }
        "Left" | "left" => {
            structure
                .delete_cells_with_shift(
                    start_row,
                    start_col,
                    address.row_count(),
                    address.column_count(),
                    true,
                )
                .map_err(engine)?;
        }
        other => {
            return Err(invalid(format!(
                "Unsupported DeleteShiftDirection '{other}'"
            )));
        }
    }
    Ok(())
}

fn copy_from(operation: &Value, context: &HostDispatchContext<'_>) -> Result<(), BatchError> {
    let dest = context.range(required_str(operation, "rangeId")?)?;
    let source = if let Some(id) = operation.get("sourceRangeId").and_then(Value::as_str) {
        context.range(id)?
    } else if let Some(address) = operation.get("sourceAddress").and_then(Value::as_str) {
        RangeRef::new(dest.sheet(), Some(address.to_string()), false)
    } else {
        return Err(invalid("Range.copyFrom requires a source range"));
    };
    let (src_sr, src_sc, src_er, src_ec) = bounds(&source)?;
    let (dst_sr, dst_sc, _, _) = bounds(&dest)?;
    let copy_type = match operation
        .get("copyType")
        .and_then(Value::as_str)
        .unwrap_or("All")
    {
        "All" | "all" => CopyType::All,
        "Values" | "values" => CopyType::Values,
        "Formulas" | "formulas" => CopyType::Formulas,
        "Formats" | "formats" => CopyType::Formats,
        other => return Err(invalid(format!("Unsupported RangeCopyType '{other}'"))),
    };
    source
        .sheet()
        .structure()
        .copy_range(
            src_sr,
            src_sc,
            src_er,
            src_ec,
            *dest.sheet().id(),
            dst_sr,
            dst_sc,
            copy_type,
            operation
                .get("skipBlanks")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            operation
                .get("transpose")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )
        .map_err(engine)?;
    Ok(())
}

fn set_hidden(range: &RangeRef, rows: bool, value: &Value) -> Result<(), BatchError> {
    let hidden = value.as_bool().ok_or_else(|| {
        invalid(format!(
            "{} must be a boolean",
            if rows { "rowHidden" } else { "columnHidden" }
        ))
    })?;
    let (start_row, start_col, end_row, end_col) = bounds(range)?;
    let layout = range.sheet().layout();
    if rows {
        let indices: Vec<u32> = (start_row..=end_row).collect();
        if hidden {
            layout.hide_rows(indices).map_err(engine)?;
        } else {
            layout.unhide_rows(indices).map_err(engine)?;
        }
    } else {
        let indices: Vec<u32> = (start_col..=end_col).collect();
        if hidden {
            layout.hide_columns(indices).map_err(engine)?;
        } else {
            layout.unhide_columns(indices).map_err(engine)?;
        }
    }
    Ok(())
}

fn apply_named_style(range: &RangeRef, value: &Value) -> Result<(), BatchError> {
    let name = value
        .as_str()
        .ok_or_else(|| invalid("Range.style must be a string"))?;
    let patch = named_style_patch(name)?;
    let bounds = bounds(range)?;
    range
        .sheet()
        .formats()
        .patch_format_for_ranges(
            vec![bounds],
            serde_json::from_value(patch).map_err(engine)?,
            Vec::new(),
        )
        .map_err(engine)?;
    Ok(())
}

fn named_style_patch(name: &str) -> Result<Value, BatchError> {
    Ok(match name {
        "Good" => json!({
            "fontFamily": "Calibri",
            "fontSize": 11.0,
            "fontColor": "#006100",
            "backgroundColor": "#C6EFCE",
            "patternType": "solid",
        }),
        "Input" => json!({
            "fontFamily": "Calibri",
            "fontSize": 11.0,
            "fontColor": "#3F3F76",
            "backgroundColor": "#FFCC99",
            "patternType": "solid",
            "borders": {
                "top": { "style": "thin", "color": "#7F7F7F" },
                "bottom": { "style": "thin", "color": "#7F7F7F" },
                "left": { "style": "thin", "color": "#7F7F7F" },
                "right": { "style": "thin", "color": "#7F7F7F" },
            }
        }),
        "Hyperlink" => json!({
            "fontColor": "theme:hyperlink",
            "underlineType": "single",
        }),
        "Normal" => json!({}),
        other => {
            return Err(invalid(format!("Unsupported built-in style '{other}'")));
        }
    })
}

fn set_hyperlink(range: &RangeRef, value: &Value) -> Result<(), BatchError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Range.hyperlink must be an object"))?;
    let url = object
        .get("address")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Range.hyperlink.address must be a string"))?;
    let (start_row, start_col, end_row, end_col) = bounds(range)?;
    if let Some(display) = object.get("textToDisplay").and_then(Value::as_str) {
        range
            .sheet()
            .set_range_typed(
                format_a1(start_row, start_col, end_row, end_col).as_str(),
                &[vec![Some(compute_api::mutation::CellInput::Literal {
                    text: display.to_string(),
                })]],
            )
            .map_err(engine)?;
    }
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            range
                .sheet()
                .hyperlinks()
                .set(row, col, url)
                .map_err(engine)?;
        }
    }
    apply_named_style(range, &Value::String("Hyperlink".to_string()))?;
    Ok(())
}

fn bounds(range: &RangeRef) -> Result<(u32, u32, u32, u32), BatchError> {
    Ok(parsed(range)?.bounds())
}

fn parsed(range: &RangeRef) -> Result<RangeAddress, BatchError> {
    match range.address() {
        Some(address) => parse_range_address(&range.sheet(), address).map_err(|error| BatchError {
            code: error.code,
            message: error.message,
        }),
        None => Ok(RangeAddress::WholeSheet),
    }
}

fn format_a1(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    fn col_name(mut col: u32) -> String {
        let mut out = String::new();
        col += 1;
        while col > 0 {
            col -= 1;
            out.insert(0, (b'A' + (col % 26) as u8) as char);
            col /= 26;
        }
        out
    }
    let start = format!("{}{}", col_name(start_col), start_row + 1);
    let end = format!("{}{}", col_name(end_col), end_row + 1);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn required_str<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{field} is required")))
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
