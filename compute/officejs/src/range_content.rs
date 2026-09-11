//! Range content projections for the embedded Office.js host.
//!
//! `Range` exposes a few properties whose values are naturally rectangular:
//! `numberFormat`, `text`, and `valueTypes`.  The helpers in this module keep
//! the Office.js wire shape at the boundary while delegating reads and writes
//! to the public `compute-api` [`Sheet`] facade.
//!
//! The locale-aware `formulasLocal` property is intentionally not included.
//! Translating formula names and separators without the workbook's culture
//! would return a plausible but incorrect result.

use std::collections::{BTreeMap, HashMap};

use compute_api::{CellRange, CellValue, ComputeApiError, Sheet};
use serde_json::{Value, json};

/// Error returned by a Range content projection.
///
/// Office.js host routing uses the same two fields as the other embedded host
/// adapters (`format` and `tables`) and maps them to a Rich API error at
/// `context.sync()`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeContentError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Load one or more supported rectangular Range content properties.
///
/// `address` is a bounded A1 range (for example, `"A1:C3"`).  The host keeps
/// whole-worksheet ranges unbounded and must return `null` for their cell
/// properties before calling this helper.
pub(crate) fn load(
    sheet: &Sheet,
    address: &str,
    properties: &[String],
) -> Result<HashMap<String, Value>, RangeContentError> {
    let bounds = resolve_bounds(address)?;
    let mut result = HashMap::new();

    for property in properties {
        let value = match property.as_str() {
            "numberFormat" => number_formats(sheet, bounds)?,
            "text" => text(sheet, bounds)?,
            "valueTypes" => value_types(sheet, bounds)?,
            // In particular, do not approximate formulasLocal with A1
            // formulas.  Its localized function names and separators require
            // a real culture-aware implementation at a later boundary.
            other => return Err(unsupported_load_property(other)),
        };
        result.insert(property.clone(), value);
    }

    Ok(result)
}

/// Set the `Range.numberFormat` projection.
///
/// The payload must be a 2D array whose dimensions exactly match `address`.
/// `null` entries are Office.js preserve-cell sentinels and are skipped.  All
/// payload cells are validated before the first engine mutation, so a bad
/// shape or value cannot partially update a range.
pub(crate) fn set(
    sheet: &Sheet,
    address: &str,
    property: &str,
    value: &Value,
) -> Result<(), RangeContentError> {
    if property != "numberFormat" {
        return Err(unsupported_set_property(property));
    }

    let bounds = resolve_bounds(address)?;
    let (start_row, start_col, end_row, end_col) = bounds;
    let expected_rows = (end_row - start_row + 1) as usize;
    let expected_cols = (end_col - start_col + 1) as usize;
    let rows = value
        .as_array()
        .ok_or_else(|| invalid_shape("a 2-dimensional array"))?;

    if rows.len() != expected_rows {
        return Err(invalid_shape(format!(
            "numberFormat has {} rows; target range requires {expected_rows}",
            rows.len()
        )));
    }

    // Group equal format codes so a heterogeneous payload still uses the
    // range-level compute-api patch primitive and each distinct code is sent
    // as one mutation. BTreeMap keeps mutation order deterministic.
    let mut patches: BTreeMap<String, Vec<(u32, u32, u32, u32)>> = BTreeMap::new();
    for (row_offset, row) in rows.iter().enumerate() {
        let cells = row
            .as_array()
            .ok_or_else(|| invalid_shape("a 2-dimensional array"))?;
        if cells.len() != expected_cols {
            return Err(invalid_shape(format!(
                "numberFormat row {row_offset} has {} columns; target range requires {expected_cols}",
                cells.len()
            )));
        }
        for (col_offset, cell) in cells.iter().enumerate() {
            let Some(format_code) = cell.as_str() else {
                if cell.is_null() {
                    continue;
                }
                return Err(invalid_value(
                    "Range.numberFormat cells must be strings or null",
                ));
            };
            let row = start_row + row_offset as u32;
            let col = start_col + col_offset as u32;
            patches
                .entry(canonicalize_excel_numfmt(format_code))
                .or_default()
                .push((row, col, row, col));
        }
    }

    for (format_code, ranges) in patches {
        // `CellFormat` is owned by domain-types and is deliberately consumed
        // through compute-api's public method here. Type inference keeps this
        // module independent of a second direct domain-types dependency.
        let format = serde_json::from_value(json!({ "numberFormat": format_code }))
            .map_err(|error| encoding(error.to_string()))?;
        sheet
            .formats()
            .patch_format_for_ranges(ranges, format, Vec::new())
            .map_err(engine)?;
    }

    Ok(())
}

/// Match Excel's stored formatCode for Office.js-assigned formats.
///
/// Excel quotes currency `$` and escapes hyphens in date tokens when it
/// writes `xl/styles.xml`. The script-visible `Range.numberFormat` value is
/// the unquoted form; export comparison uses the stored code.
fn canonicalize_excel_numfmt(code: &str) -> String {
    let looks_like_date = is_date_number_format(code);
    let mut out = String::with_capacity(code.len() + 8);
    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '"' => {
                out.push('"');
                i += 1;
                while i < chars.len() {
                    out.push(chars[i]);
                    if chars[i] == '"' {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            '\\' => {
                out.push('\\');
                i += 1;
                if i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                }
            }
            '$' => {
                out.push_str("\"$\"");
                i += 1;
            }
            '-' if looks_like_date => {
                out.push_str("\\-");
                i += 1;
            }
            _ => {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}

fn is_date_number_format(code: &str) -> bool {
    let lower = code.to_ascii_lowercase();
    let has_y = lower.contains('y');
    let has_d = lower.contains('d');
    let has_m = lower.contains('m');
    (has_y && has_m) || (has_y && has_d) || (has_m && has_d && !lower.contains('#'))
}

/// Clear a Range using an Office.js `ClearApplyTo` token.
///
/// The compute-api facade has production primitives for `All`, `Formats`,
/// `Contents`, and `Hyperlinks`. `RemoveHyperlinks` additionally clears
/// formatting while preserving content, and `ResetContents` has control-aware
/// behavior; neither can be represented faithfully by the current facade, so
/// they fail with `InvalidArgument` rather than silently doing the wrong thing.
pub(crate) fn clear(sheet: &Sheet, address: &str, apply_to: &str) -> Result<(), RangeContentError> {
    let mode = match apply_to {
        "All" => "all",
        "Formats" => "formats",
        "Contents" => "contents",
        "Hyperlinks" => "hyperlinks",
        "RemoveHyperlinks" | "ResetContents" => {
            return Err(unsupported_clear_mode(apply_to));
        }
        other => return Err(invalid_value(format!("Unsupported clear mode '{other}'"))),
    };

    let bounds = resolve_bounds(address)?;
    sheet
        .clear_with_mode(
            CellRange::Bounds(bounds.0, bounds.1, bounds.2, bounds.3),
            mode,
        )
        .map(|_| ())
        .map_err(engine)
}

fn number_formats(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeContentError> {
    let mut rows = Vec::with_capacity((end_row - start_row + 1) as usize);
    for row in start_row..=end_row {
        let mut cells = Vec::with_capacity((end_col - start_col + 1) as usize);
        for col in start_col..=end_col {
            let format = sheet.formats().get_cell_format(row, col).map_err(engine)?;
            let format =
                serde_json::to_value(format).map_err(|error| encoding(error.to_string()))?;
            let number_format = format
                .get("numberFormat")
                .and_then(Value::as_str)
                .unwrap_or("General");
            cells.push(Value::String(number_format.to_owned()));
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn text(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeContentError> {
    let mut rows = Vec::with_capacity((end_row - start_row + 1) as usize);
    for row in start_row..=end_row {
        let mut cells = Vec::with_capacity((end_col - start_col + 1) as usize);
        for col in start_col..=end_col {
            // Sheet::get_display_value is the engine's formatted display
            // projection. It does not depend on column width, so the '#'
            // substitution used by Excel's UI never appears here.
            cells.push(Value::String(
                sheet.get_display_value((row, col)).map_err(engine)?,
            ));
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn value_types(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeContentError> {
    let mut rows = Vec::with_capacity((end_row - start_row + 1) as usize);
    for row in start_row..=end_row {
        let mut cells = Vec::with_capacity((end_col - start_col + 1) as usize);
        for col in start_col..=end_col {
            let value = sheet.get_cell_value((row, col)).map_err(engine)?;
            cells.push(Value::String(value_type_name(&value).to_owned()));
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn value_type_name(value: &CellValue) -> &'static str {
    match value {
        CellValue::Null => "Empty",
        CellValue::Text(_) => "String",
        CellValue::Boolean(_) => "Boolean",
        CellValue::Number(number) => {
            // Excel exposes integral numeric cells as Integer and fractional
            // numeric cells as Double. Dates remain numbers here; their date
            // presentation is carried by numberFormat/text.
            #[allow(clippy::float_cmp)]
            if number.get().fract() == 0.0 {
                "Integer"
            } else {
                "Double"
            }
        }
        CellValue::Error(_, _) => "Error",
        CellValue::Array(_) | CellValue::Control(_) | CellValue::Image(_) => "RichValue",
    }
}

fn resolve_bounds(address: &str) -> Result<(u32, u32, u32, u32), RangeContentError> {
    CellRange::from(address)
        .resolve()
        .map_err(map_address_error)
}

fn map_address_error(error: ComputeApiError) -> RangeContentError {
    match error {
        ComputeApiError::InvalidAddress { address, reason } => RangeContentError {
            code: "InvalidArgument",
            message: format!("invalid address: {address} — {reason}"),
        },
        ComputeApiError::InvalidRange { range, reason } => RangeContentError {
            code: "InvalidArgument",
            message: format!("invalid range: {range} — {reason}"),
        },
        other => engine(other),
    }
}

fn engine(error: impl std::fmt::Display) -> RangeContentError {
    RangeContentError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(message: impl Into<String>) -> RangeContentError {
    RangeContentError {
        code: "GeneralException",
        message: format!("range content conversion failed: {}", message.into()),
    }
}

fn invalid_shape(message: impl Into<String>) -> RangeContentError {
    RangeContentError {
        code: "InvalidArgument",
        message: format!("Range.numberFormat requires {}", message.into()),
    }
}

fn invalid_value(message: impl Into<String>) -> RangeContentError {
    RangeContentError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported_load_property(property: &str) -> RangeContentError {
    RangeContentError {
        code: "InvalidArgument",
        message: format!("Unsupported Range load property '{property}'"),
    }
}

fn unsupported_set_property(property: &str) -> RangeContentError {
    RangeContentError {
        code: "InvalidArgument",
        message: format!("Unsupported Range set property '{property}'"),
    }
}

fn unsupported_clear_mode(mode: &str) -> RangeContentError {
    RangeContentError {
        code: "InvalidArgument",
        message: format!("Range.clear mode '{mode}' is not supported by this host"),
    }
}
