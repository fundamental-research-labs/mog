//! Range metadata projections for the embedded Office.js host.
//!
//! This module owns the Range members whose values are derived from worksheet
//! geometry, layout state, formula reference style, and effective number
//! formats.  It deliberately keeps locale-aware properties explicit: the
//! compute API currently has no workbook culture/formula-localization
//! contract, so `formulasLocal` and `numberFormatLocal` return a deferred
//! `InvalidArgument` instead of presenting A1/canonical values as localized.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use cell_types::{CellId, ColId, RowId, SheetId};
use compute_api::{CellAddress, CellRange, Sheet, mutation::CellInput};
use compute_formats::detect_format_type;
use compute_parser::{IdentityResolver, to_identity_formula, to_r1c1_string};
use formula_types::WorkbookLookup;
use serde_json::{Value, json};
use value_types::CellValue;

use crate::range_navigation::{EXCEL_MAX_COLUMNS, EXCEL_MAX_ROWS, RangeAddress};

/// Error returned by a Range metadata projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeMetadataError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Load the metadata properties requested for a Range.
///
/// The host passes the parsed [`RangeAddress`] so this helper handles omitted
/// worksheet addresses and full-row/full-column ranges consistently with the
/// navigation family.  Rectangular cell properties remain `null` for an
/// unbounded axis, matching the existing Range values/formulas contract.
pub(crate) fn load(
    sheet: &Sheet,
    range: &RangeAddress,
    properties: &[String],
) -> Result<HashMap<String, Value>, RangeMetadataError> {
    let mut result = HashMap::new();
    let (start_row, start_col, end_row, end_col) = range.bounds();
    let unbounded = range.is_whole_sheet() || range.is_entire_row() || range.is_entire_column();

    for property in properties {
        let value = match property.as_str() {
            "formulasR1C1" => {
                if unbounded {
                    Value::Null
                } else {
                    formulas_r1c1(sheet, (start_row, start_col, end_row, end_col))?
                }
            }
            "formulasLocal" => return Err(locale_unsupported("formulasLocal")),
            "numberFormatLocal" => return Err(locale_unsupported("numberFormatLocal")),
            "numberFormatCategories" => {
                if unbounded {
                    Value::Null
                } else {
                    number_format_categories(sheet, (start_row, start_col, end_row, end_col))?
                }
            }
            "hasSpill" => {
                if unbounded {
                    return Err(unsupported(
                        "Range.hasSpill is not available for an unbounded worksheet range",
                    ));
                }
                has_spill(sheet, (start_row, start_col, end_row, end_col))?
            }
            "hidden" => hidden(sheet, range)?,
            "rowHidden" => axis_hidden(sheet, range, Axis::Rows)?,
            "columnHidden" => axis_hidden(sheet, range, Axis::Columns)?,
            "isEntireRow" => Value::Bool(range.is_entire_row()),
            "isEntireColumn" => Value::Bool(range.is_entire_column()),
            "height" | "width" | "left" | "top" => {
                return Err(unsupported(format!(
                    "Range.{property} requires an exact point-based layout projection"
                )));
            }
            other => {
                return Err(unsupported(format!(
                    "Unsupported Range load property '{other}'"
                )));
            }
        };
        result.insert(property.clone(), value);
    }

    Ok(result)
}

/// Set a writable metadata property on a Range.
///
/// `rowHidden` and `columnHidden` are layout mutations and are valid for
/// bounded, full-row, full-column, and whole-sheet ranges.  R1C1 formulas are
/// converted to canonical A1 formulas before entering the engine's typed
/// write path, preserving the engine as the source of truth for formula
/// parsing and calculation.
pub(crate) fn set(
    sheet: &Sheet,
    range: &RangeAddress,
    property: &str,
    value: &Value,
) -> Result<(), RangeMetadataError> {
    match property {
        "formulasR1C1" => {
            if range.is_whole_sheet() || range.is_entire_row() || range.is_entire_column() {
                return Err(unsupported(
                    "Range.formulasR1C1 requires a bounded cell range",
                ));
            }
            set_formulas_r1c1(sheet, range, value)
        }
        "formulasLocal" | "numberFormatLocal" => Err(locale_unsupported(property)),
        "rowHidden" => set_axis_hidden(sheet, range, Axis::Rows, value),
        "columnHidden" => set_axis_hidden(sheet, range, Axis::Columns, value),
        "hidden"
        | "hasSpill"
        | "numberFormatCategories"
        | "isEntireRow"
        | "isEntireColumn"
        | "height"
        | "width"
        | "left"
        | "top" => Err(read_only(property)),
        other => Err(unsupported(format!(
            "Unsupported Range set property '{other}'"
        ))),
    }
}

#[derive(Clone, Copy)]
enum Axis {
    Rows,
    Columns,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VisibilityState {
    All,
    None,
    Mixed,
}

fn hidden(sheet: &Sheet, range: &RangeAddress) -> Result<Value, RangeMetadataError> {
    let rows = axis_hidden_state(sheet, range, Axis::Rows)?;
    let columns = axis_hidden_state(sheet, range, Axis::Columns)?;
    // A cell is hidden when either its row or its column is hidden.  Thus all
    // cells are hidden when every row OR every column is hidden; no cells are
    // hidden only when neither axis contains a hidden member.
    let value = if rows == VisibilityState::All || columns == VisibilityState::All {
        Value::Bool(true)
    } else if rows == VisibilityState::None && columns == VisibilityState::None {
        Value::Bool(false)
    } else {
        Value::Null
    };
    Ok(value)
}

fn axis_hidden(
    sheet: &Sheet,
    range: &RangeAddress,
    axis: Axis,
) -> Result<Value, RangeMetadataError> {
    Ok(match axis_hidden_state(sheet, range, axis)? {
        VisibilityState::All => Value::Bool(true),
        VisibilityState::None => Value::Bool(false),
        VisibilityState::Mixed => Value::Null,
    })
}

fn axis_hidden_state(
    sheet: &Sheet,
    range: &RangeAddress,
    axis: Axis,
) -> Result<VisibilityState, RangeMetadataError> {
    let (start_row, start_col, end_row, end_col) = range.bounds();
    let (start, end, hidden_indices) = match axis {
        Axis::Rows => (
            start_row,
            end_row,
            sheet.layout().get_hidden_rows().map_err(engine)?,
        ),
        Axis::Columns => (
            start_col,
            end_col,
            sheet.layout().get_hidden_columns().map_err(engine)?,
        ),
    };
    let count = u64::from(end - start + 1);
    let hidden_count = hidden_indices
        .into_iter()
        .filter(|index| *index >= start && *index <= end)
        .count() as u64;
    Ok(if hidden_count == 0 {
        VisibilityState::None
    } else if hidden_count == count {
        VisibilityState::All
    } else {
        VisibilityState::Mixed
    })
}

fn set_axis_hidden(
    sheet: &Sheet,
    range: &RangeAddress,
    axis: Axis,
    value: &Value,
) -> Result<(), RangeMetadataError> {
    let hidden = value
        .as_bool()
        .ok_or_else(|| invalid_value(format!("Range.{} must be a boolean", axis_name(axis))))?;
    let (start, end) = match axis {
        Axis::Rows => {
            let (start, _, end, _) = range.bounds();
            (start, end)
        }
        Axis::Columns => {
            let (_, start, _, end) = range.bounds();
            (start, end)
        }
    };
    let indices: Vec<u32> = (start..=end).collect();
    let result = match axis {
        Axis::Rows if hidden => sheet.layout().hide_rows(indices),
        Axis::Rows => sheet.layout().unhide_rows(indices),
        Axis::Columns if hidden => sheet.layout().hide_columns(indices),
        Axis::Columns => sheet.layout().unhide_columns(indices),
    };
    result.map(|_| ()).map_err(engine)
}

fn axis_name(axis: Axis) -> &'static str {
    match axis {
        Axis::Rows => "rowHidden",
        Axis::Columns => "columnHidden",
    }
}

fn formulas_r1c1(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeMetadataError> {
    let sheet_name = sheet.name().map_err(engine)?;
    let mut rows = Vec::with_capacity((end_row - start_row + 1) as usize);
    for row in start_row..=end_row {
        let mut cells = Vec::with_capacity((end_col - start_col + 1) as usize);
        for col in start_col..=end_col {
            let address = CellAddress::Position(row, col);
            if let Some(formula) = sheet.get_formula(address.clone()).map_err(engine)? {
                let lookup = FormulaLookup::new(*sheet.id(), &sheet_name, &formula);
                let identity = to_identity_formula(&formula, &lookup).map_err(|error| {
                    formula_error(format!(
                        "unable to render formula at ({row}, {col}) as R1C1: {error}"
                    ))
                })?;
                cells.push(Value::String(to_r1c1_string(&identity, &lookup, row, col)));
            } else {
                cells.push(cell_to_js(sheet.get_cell_value(address).map_err(engine)?));
            }
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn set_formulas_r1c1(
    sheet: &Sheet,
    range: &RangeAddress,
    value: &Value,
) -> Result<(), RangeMetadataError> {
    let (start_row, start_col, end_row, end_col) = range.bounds();
    let expected_rows = (end_row - start_row + 1) as usize;
    let expected_cols = (end_col - start_col + 1) as usize;
    let rows = value
        .as_array()
        .ok_or_else(|| invalid_shape("a 2-dimensional array"))?;
    if rows.len() != expected_rows {
        return Err(invalid_shape(format!(
            "formulasR1C1 has {} rows; target range requires {expected_rows}",
            rows.len()
        )));
    }

    let mut grid = Vec::with_capacity(expected_rows);
    for (row_offset, row) in rows.iter().enumerate() {
        let cells = row
            .as_array()
            .ok_or_else(|| invalid_shape("a 2-dimensional array"))?;
        if cells.len() != expected_cols {
            return Err(invalid_shape(format!(
                "formulasR1C1 row {row_offset} has {} columns; target range requires {expected_cols}",
                cells.len()
            )));
        }
        let mut out = Vec::with_capacity(expected_cols);
        for (col_offset, cell) in cells.iter().enumerate() {
            let row = start_row + row_offset as u32;
            let col = start_col + col_offset as u32;
            out.push(r1c1_cell_input(cell, row, col)?);
        }
        grid.push(out);
    }

    sheet
        .set_range_typed(
            CellRange::Bounds(start_row, start_col, end_row, end_col),
            &grid,
        )
        .map(|_| ())
        .map_err(engine)
}

fn r1c1_cell_input(
    value: &Value,
    row: u32,
    col: u32,
) -> Result<Option<CellInput>, RangeMetadataError> {
    match value {
        // As with Range.formulas, null preserves the existing cell.
        Value::Null => Ok(None),
        Value::Bool(value) => Ok(Some(CellInput::Value {
            value: CellValue::Boolean(*value),
        })),
        Value::Number(value) => value
            .as_f64()
            .map(CellValue::from)
            .map(|value| Some(CellInput::Value { value }))
            .ok_or_else(|| invalid_value("Range.formulasR1C1 numbers must be finite")),
        Value::String(value) if value.is_empty() => Ok(Some(CellInput::Clear)),
        Value::String(value) if value.starts_with('=') => {
            let formula = r1c1_to_a1(value, row, col)?;
            Ok(Some(CellInput::formula(&formula)))
        }
        Value::String(value) => Ok(Some(CellInput::Literal {
            text: value.clone(),
        })),
        _ => Err(invalid_value(
            "Range.formulasR1C1 must contain only strings, numbers, booleans, or null",
        )),
    }
}

fn number_format_categories(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeMetadataError> {
    let mut rows = Vec::with_capacity((end_row - start_row + 1) as usize);
    for row in start_row..=end_row {
        let mut cells = Vec::with_capacity((end_col - start_col + 1) as usize);
        for col in start_col..=end_col {
            let format = sheet.formats().get_cell_format(row, col).map_err(engine)?;
            let format = serde_json::to_value(format)
                .map_err(|error| encoding(error.to_string()))?;
            let code = format
                .get("numberFormat")
                .and_then(Value::as_str)
                .unwrap_or("General");
            // Keep the category detector in compute-formats as the source of
            // truth. Its Display names are the exact Office
            // NumberFormatCategory wire values (General, Number, Currency, ...).
            cells.push(Value::String(detect_format_type(code).to_string()));
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn has_spill(
    sheet: &Sheet,
    (start_row, start_col, end_row, end_col): (u32, u32, u32, u32),
) -> Result<Value, RangeMetadataError> {
    let mut any = false;
    let mut all = true;
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            let spilled = sheet
                .get_cell_data(CellAddress::Position(row, col))
                .map_err(engine)?
                .and_then(|data| data.get("region").cloned())
                .and_then(|region| region.get("kind").cloned())
                .and_then(|kind| kind.as_str().map(|kind| kind == "arraySpill"))
                .unwrap_or(false);
            any |= spilled;
            all &= spilled;
            if any && !all {
                return Ok(Value::Null);
            }
        }
    }
    Ok(Value::Bool(all))
}

fn cell_to_js(value: CellValue) -> Value {
    match value {
        CellValue::Null => Value::String(String::new()),
        CellValue::Boolean(value) => Value::Bool(value),
        CellValue::Number(value) => json!(value.get()),
        CellValue::Text(value) => Value::String(value.to_string()),
        CellValue::Error(error, _) => Value::String(error.to_string()),
        other => Value::String(other.to_string()),
    }
}

fn r1c1_to_a1(formula: &str, base_row: u32, base_col: u32) -> Result<String, RangeMetadataError> {
    // compute-parser intentionally exposes R1C1 as a display formatter; its
    // input grammar is A1. Convert only reference tokens here, then hand the
    // resulting formula to CellInput::formula so the engine remains the
    // parser/calculation authority. String literals and function/name text
    // are copied byte-for-byte.
    let bytes = formula.as_bytes();
    let mut output = String::with_capacity(formula.len());
    let mut cursor = 0;
    let mut in_string = false;

    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if byte == b'\'' {
            // Single quotes delimit a worksheet qualifier. A sheet can be
            // named `R1C1`, so do not reinterpret text inside `'...'` as a
            // reference while converting the formula body.
            output.push('\'');
            cursor += 1;
            while cursor < bytes.len() {
                if bytes[cursor] == b'\'' {
                    output.push('\'');
                    if bytes.get(cursor + 1) == Some(&b'\'') {
                        output.push('\'');
                        cursor += 2;
                        continue;
                    }
                    cursor += 1;
                    break;
                }
                push_formula_char(&mut output, formula, &mut cursor);
            }
            continue;
        }
        if byte == b'"' {
            output.push('"');
            cursor += 1;
            if in_string && cursor < bytes.len() && bytes[cursor] == b'"' {
                output.push('"');
                cursor += 1;
            } else {
                in_string = !in_string;
            }
            continue;
        }
        if in_string || !reference_boundary_before(bytes, cursor) {
            push_formula_char(&mut output, formula, &mut cursor);
            continue;
        }

        if let Some((end, replacement)) = parse_r1c1_reference(bytes, cursor, base_row, base_col)? {
            output.push_str(&replacement);
            cursor = end;
        } else {
            push_formula_char(&mut output, formula, &mut cursor);
        }
    }

    Ok(output)
}

/// Copy one Unicode scalar from the source formula without reducing a
/// multi-byte UTF-8 character to a sequence of unrelated bytes. Reference
/// tokens are ASCII, so this helper is used only for untouched formula text,
/// string literals, and quoted sheet names.
fn push_formula_char(output: &mut String, formula: &str, cursor: &mut usize) {
    if let Some(character) = formula.get(*cursor..).and_then(|tail| tail.chars().next()) {
        output.push(character);
        *cursor += character.len_utf8();
    }
}

#[derive(Clone, Copy)]
struct R1C1Axis {
    index: u32,
    absolute: bool,
}

#[derive(Clone, Copy)]
enum R1C1Endpoint {
    Cell { row: R1C1Axis, col: R1C1Axis },
    Row(R1C1Axis),
    Column(R1C1Axis),
}

fn parse_r1c1_reference(
    bytes: &[u8],
    start: usize,
    base_row: u32,
    base_col: u32,
) -> Result<Option<(usize, String)>, RangeMetadataError> {
    if let Some((first, first_end)) = parse_r1c1_endpoint(bytes, start, base_row, base_col)? {
        if !reference_boundary_after(bytes, first_end) {
            return Ok(None);
        }
        // A token immediately followed by ! is a worksheet qualifier (for
        // example a sheet named R1C1), not a cell reference.
        if bytes.get(first_end) == Some(&b'!') {
            return Ok(None);
        }
        if bytes.get(first_end) == Some(&b':')
            && let Some((second, end)) =
                parse_r1c1_endpoint(bytes, first_end + 1, base_row, base_col)?
            && reference_boundary_after(bytes, end)
            && (matches!(
                (first, second),
                (R1C1Endpoint::Cell { .. }, R1C1Endpoint::Cell { .. })
            ) || matches!(
                (first, second),
                (R1C1Endpoint::Row(_), R1C1Endpoint::Row(_))
            ) || matches!(
                (first, second),
                (R1C1Endpoint::Column(_), R1C1Endpoint::Column(_))
            ))
        {
            let first = format_endpoint(first, true)?;
            let second = format_endpoint(second, true)?;
            return Ok(Some((end, format!("{first}:{second}"))));
        }
        if matches!(first, R1C1Endpoint::Cell { .. }) {
            return Ok(Some((first_end, format_endpoint(first, false)?)));
        }
    }
    Ok(None)
}

fn parse_r1c1_endpoint(
    bytes: &[u8],
    start: usize,
    base_row: u32,
    base_col: u32,
) -> Result<Option<(R1C1Endpoint, usize)>, RangeMetadataError> {
    if start >= bytes.len() {
        return Ok(None);
    }
    let marker = bytes[start].to_ascii_uppercase();
    if marker == b'R' {
        let Some((row, after_row)) = parse_r1c1_axis(bytes, start + 1, base_row, "row")? else {
            return Ok(None);
        };
        if bytes.get(after_row).map(u8::to_ascii_uppercase) == Some(b'C') {
            let Some((col, end)) = parse_r1c1_axis(bytes, after_row + 1, base_col, "column")?
            else {
                return Ok(None);
            };
            return Ok(Some((R1C1Endpoint::Cell { row, col }, end)));
        }
        return Ok(Some((R1C1Endpoint::Row(row), after_row)));
    }
    if marker == b'C' {
        let Some((column, end)) = parse_r1c1_axis(bytes, start + 1, base_col, "column")? else {
            return Ok(None);
        };
        return Ok(Some((R1C1Endpoint::Column(column), end)));
    }
    Ok(None)
}

fn parse_r1c1_axis(
    bytes: &[u8],
    start: usize,
    base: u32,
    axis: &str,
) -> Result<Option<(R1C1Axis, usize)>, RangeMetadataError> {
    if bytes.get(start) == Some(&b'[') {
        let mut cursor = start + 1;
        let negative = bytes.get(cursor) == Some(&b'-');
        if negative {
            cursor += 1;
        }
        let number_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        if cursor == number_start || bytes.get(cursor) != Some(&b']') {
            return Err(invalid_value(format!("invalid R1C1 {axis} reference")));
        }
        let magnitude = parse_u32_ascii(&bytes[number_start..cursor])?;
        let offset = if negative {
            -(i64::from(magnitude))
        } else {
            i64::from(magnitude)
        };
        let index = checked_relative_index(base, offset, axis)?;
        return Ok(Some((
            R1C1Axis {
                index,
                absolute: false,
            },
            cursor + 1,
        )));
    }

    let number_start = start;
    let mut cursor = start;
    while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
        cursor += 1;
    }
    if cursor == number_start {
        return Ok(Some((
            R1C1Axis {
                index: base,
                absolute: false,
            },
            start,
        )));
    }
    let one_based = parse_u32_ascii(&bytes[number_start..cursor])?;
    if one_based == 0 {
        return Err(invalid_value(format!("R1C1 {axis} references are 1-based")));
    }
    let index = one_based - 1;
    let limit = if axis == "row" {
        EXCEL_MAX_ROWS
    } else {
        EXCEL_MAX_COLUMNS
    };
    if index >= limit {
        return Err(invalid_value(format!(
            "R1C1 {axis} is outside the worksheet grid"
        )));
    }
    Ok(Some((
        R1C1Axis {
            index,
            absolute: true,
        },
        cursor,
    )))
}

fn format_endpoint(endpoint: R1C1Endpoint, in_range: bool) -> Result<String, RangeMetadataError> {
    match endpoint {
        R1C1Endpoint::Cell { row, col } => {
            if row.index >= EXCEL_MAX_ROWS || col.index >= EXCEL_MAX_COLUMNS {
                return Err(invalid_value(
                    "R1C1 reference is outside the worksheet grid",
                ));
            }
            let mut value = String::new();
            if col.absolute {
                value.push('$');
            }
            value.push_str(&column_name(col.index));
            if row.absolute {
                value.push('$');
            }
            value.push_str(&(row.index + 1).to_string());
            Ok(value)
        }
        R1C1Endpoint::Row(row) => {
            if !in_range {
                return Err(invalid_value("R1C1 row references must be ranges"));
            }
            if !row.absolute {
                return Err(invalid_value(
                    "relative R1C1 full-row references cannot be represented in A1",
                ));
            }
            if row.index >= EXCEL_MAX_ROWS {
                return Err(invalid_value("R1C1 row is outside the worksheet grid"));
            }
            Ok((row.index + 1).to_string())
        }
        R1C1Endpoint::Column(col) => {
            if !in_range {
                return Err(invalid_value("R1C1 column references must be ranges"));
            }
            if !col.absolute {
                return Err(invalid_value(
                    "relative R1C1 full-column references cannot be represented in A1",
                ));
            }
            if col.index >= EXCEL_MAX_COLUMNS {
                return Err(invalid_value("R1C1 column is outside the worksheet grid"));
            }
            Ok(column_name(col.index))
        }
    }
}

fn checked_relative_index(base: u32, offset: i64, axis: &str) -> Result<u32, RangeMetadataError> {
    let index = i64::from(base) + offset;
    let limit = if axis == "row" {
        i64::from(EXCEL_MAX_ROWS)
    } else {
        i64::from(EXCEL_MAX_COLUMNS)
    };
    if !(0..limit).contains(&index) {
        return Err(invalid_value(format!(
            "R1C1 {axis} is outside the worksheet grid"
        )));
    }
    Ok(index as u32)
}

fn parse_u32_ascii(bytes: &[u8]) -> Result<u32, RangeMetadataError> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid_value("invalid R1C1 number"))?;
    text.parse::<u32>()
        .map_err(|_| invalid_value("R1C1 number is too large"))
}

fn reference_boundary_before(bytes: &[u8], cursor: usize) -> bool {
    cursor == 0
        || !bytes[cursor - 1].is_ascii_alphanumeric()
            && bytes[cursor - 1] != b'_'
            && bytes[cursor - 1] != b'.'
}

fn reference_boundary_after(bytes: &[u8], cursor: usize) -> bool {
    bytes
        .get(cursor)
        .is_none_or(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_' && *byte != b'.')
}

fn column_name(mut column: u32) -> String {
    let mut result = String::new();
    loop {
        result.push(char::from(b'A' + (column % 26) as u8));
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    result.chars().rev().collect()
}

/// A small synthetic identity/lookup view lets the Office adapter reuse the
/// engine parser and R1C1 formatter without allocating workbook identities or
/// mutating the live document while reading a formula.
struct FormulaLookup {
    current_sheet: SheetId,
    sheet_ids: HashMap<String, SheetId>,
    sheet_names: HashMap<SheetId, String>,
    cells: RefCell<HashMap<(SheetId, u32, u32), CellId>>,
    cell_positions: RefCell<HashMap<CellId, (SheetId, u32, u32)>>,
    rows: RefCell<HashMap<(SheetId, u32), RowId>>,
    row_indices: RefCell<HashMap<RowId, (SheetId, u32)>>,
    columns: RefCell<HashMap<(SheetId, u32), ColId>>,
    col_indices: RefCell<HashMap<ColId, (SheetId, u32)>>,
    next_id: Cell<u128>,
}

impl FormulaLookup {
    fn new(current_sheet: SheetId, current_name: &str, formula: &str) -> Self {
        let mut sheet_ids = HashMap::new();
        let mut sheet_names = HashMap::new();
        sheet_ids.insert(current_name.to_ascii_lowercase(), current_sheet);
        sheet_names.insert(current_sheet, current_name.to_owned());

        let mut next_sheet = 1u128;
        for name in referenced_sheet_names(formula) {
            let key = name.to_ascii_lowercase();
            if sheet_ids.contains_key(&key) {
                continue;
            }
            let mut id = SheetId::from_raw(next_sheet);
            while sheet_names.contains_key(&id) {
                next_sheet += 1;
                id = SheetId::from_raw(next_sheet);
            }
            next_sheet += 1;
            sheet_ids.insert(key, id);
            sheet_names.insert(id, name);
        }

        Self {
            current_sheet,
            sheet_ids,
            sheet_names,
            cells: RefCell::new(HashMap::new()),
            cell_positions: RefCell::new(HashMap::new()),
            rows: RefCell::new(HashMap::new()),
            row_indices: RefCell::new(HashMap::new()),
            columns: RefCell::new(HashMap::new()),
            col_indices: RefCell::new(HashMap::new()),
            next_id: Cell::new(1),
        }
    }

    fn allocate_id(&self) -> u128 {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        id
    }
}

impl IdentityResolver for FormulaLookup {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        if let Some(id) = self.cells.borrow().get(&(*sheet, row, col)).copied() {
            return id;
        }
        let id = CellId::from_raw(self.allocate_id());
        self.cells.borrow_mut().insert((*sheet, row, col), id);
        self.cell_positions
            .borrow_mut()
            .insert(id, (*sheet, row, col));
        id
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        if let Some(id) = self.rows.borrow().get(&(*sheet, row)).copied() {
            return Some(id);
        }
        let id = RowId::from_raw(self.allocate_id());
        self.rows.borrow_mut().insert((*sheet, row), id);
        self.row_indices.borrow_mut().insert(id, (*sheet, row));
        Some(id)
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        if let Some(id) = self.columns.borrow().get(&(*sheet, col)).copied() {
            return Some(id);
        }
        let id = ColId::from_raw(self.allocate_id());
        self.columns.borrow_mut().insert((*sheet, col), id);
        self.col_indices.borrow_mut().insert(id, (*sheet, col));
        Some(id)
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.sheet_ids.get(&name.to_ascii_lowercase()).copied()
    }

    fn current_sheet(&self) -> SheetId {
        self.current_sheet
    }
}

impl WorkbookLookup for FormulaLookup {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.cell_positions.borrow().get(cell_id).copied()
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.row_indices.borrow().get(row_id).copied()
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.col_indices.borrow().get(col_id).copied()
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.sheet_names.get(sheet_id).map(String::as_str)
    }

    fn formula_sheet(&self) -> SheetId {
        self.current_sheet
    }
}

fn referenced_sheet_names(formula: &str) -> Vec<String> {
    let bytes = formula.as_bytes();
    let mut result = Vec::new();
    let mut in_string = false;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'"' {
            in_string = !in_string;
            continue;
        }
        if in_string || *byte != b'!' || index == 0 {
            continue;
        }
        if let Some(name) = sheet_name_before_bang(bytes, index)
            && !result
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&name))
        {
            result.push(name);
        }
    }
    result
}

fn sheet_name_before_bang(bytes: &[u8], bang: usize) -> Option<String> {
    if bytes.get(bang - 1) == Some(&b'\'') {
        let mut cursor = bang - 2;
        loop {
            if bytes[cursor] == b'\'' {
                if cursor > 0 && bytes[cursor - 1] == b'\'' {
                    cursor -= 2;
                    continue;
                }
                let name = std::str::from_utf8(&bytes[cursor + 1..bang - 1]).ok()?;
                return Some(name.replace("''", "'"));
            }
            if cursor == 0 {
                return None;
            }
            cursor -= 1;
        }
    }

    let mut start = bang;
    while start > 0 && is_sheet_name_byte(bytes[start - 1]) {
        start -= 1;
    }
    if start == bang {
        None
    } else {
        std::str::from_utf8(&bytes[start..bang])
            .ok()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned)
    }
}

fn is_sheet_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b' ' | b'[' | b']' | b'$')
}

fn engine(error: impl std::fmt::Display) -> RangeMetadataError {
    RangeMetadataError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(message: impl Into<String>) -> RangeMetadataError {
    RangeMetadataError {
        code: "GeneralException",
        message: format!("range metadata conversion failed: {}", message.into()),
    }
}

fn formula_error(message: impl Into<String>) -> RangeMetadataError {
    RangeMetadataError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn invalid_shape(message: impl Into<String>) -> RangeMetadataError {
    RangeMetadataError {
        code: "InvalidArgument",
        message: format!("Range.formulasR1C1 requires {}", message.into()),
    }
}

fn invalid_value(message: impl Into<String>) -> RangeMetadataError {
    RangeMetadataError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn read_only(property: &str) -> RangeMetadataError {
    RangeMetadataError {
        code: "InvalidArgument",
        message: format!("Range.{property} is read-only"),
    }
}

fn unsupported(message: impl Into<String>) -> RangeMetadataError {
    RangeMetadataError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn locale_unsupported(property: &str) -> RangeMetadataError {
    unsupported(format!(
        "Range.{property} requires workbook locale support; this host has no localized formula/number-format context"
    ))
}
