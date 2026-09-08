//! Office.js Range and Worksheet search helpers.
//!
//! The Office.js surface keeps search and used-range calls deferred: the
//! JavaScript adapter queues an operation and the host binds the returned
//! `Range` (or `RangeAreas`) during `context.sync()`.  This module owns the
//! translation from that wire operation to the production [`Sheet`] facade.
//!
//! The host routing contract is intentionally small and typed at the edge:
//!
//! * `used_range(sheet, address, values_only)` returns a canonical unqualified
//!   A1 address, or `None` when a bounded Range contains no used cells.  A
//!   worksheet call passes `address = None`; a worksheet `getUsedRange` on an
//!   empty sheet is handled by the host as `A1`, while the Range variant uses
//!   the `None` result to produce `ItemNotFound`/a null object.
//! * `find` returns one `(row, column)` cell address.  `find_all` returns
//!   individual coordinates and `matches_to_areas` coalesces those coordinates
//!   into rectangular `SearchArea` values for the RangeAreas adapter.
//! * `replace_all` returns the deferred ClientResult number after applying
//!   value/formula replacements through `Sheet::set_cell`.
//! * `special_cells` only accepts bounded cell ranges and the primitive cell
//!   types backed by the current engine: `Blanks`, `Constants`, and `Formulas`.
//!
//! The current compute-api extent query is the persisted non-null data extent.
//! It deliberately does not expose format-only cells, so `valuesOnly` is
//! accepted and preserved by the Office.js contract while both modes use that
//! same production extent.  This is preferable to inventing a shadow extent or
//! scanning the complete Excel grid.

use std::collections::HashSet;
use std::sync::Arc;

use compute_api::{CellRange, CellValue, Sheet};
use serde_json::{Value, json};

use crate::dispatch::{ExtensionHandler, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_areas::RangeAreasRef;
use crate::range_navigation::{
    EXCEL_MAX_COLUMNS, EXCEL_MAX_ROWS, RangeAddress, RangeNavigationError, parse_range_address,
};

const LAST_ROW: u32 = EXCEL_MAX_ROWS - 1;
const LAST_COLUMN: u32 = EXCEL_MAX_COLUMNS - 1;

/// Errors returned by the pure Range/Worksheet search dispatcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeSearchError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Normalized `SearchCriteria`/`WorksheetSearchCriteria` values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SearchCriteria {
    pub(crate) complete_match: bool,
    pub(crate) match_case: bool,
    pub(crate) backwards: bool,
}

impl Default for SearchCriteria {
    fn default() -> Self {
        Self {
            complete_match: false,
            match_case: false,
            backwards: false,
        }
    }
}

/// A rectangular area of cells returned by a multi-cell search.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct SearchArea {
    pub(crate) start_row: u32,
    pub(crate) start_col: u32,
    pub(crate) end_row: u32,
    pub(crate) end_col: u32,
}

/// Register the search/used-range bridge with an Office.js host.
///
/// The handler is intentionally stateless.  Search always resolves against
/// the current `Sheet` handle supplied by the bound Worksheet/Range proxy, so
/// a second cache of workbook or range state cannot drift from the engine.
pub(crate) fn register(host: &crate::host::Host) {
    host.register_extension(RangeSearchHandler);
}

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct RangeSearchHandler;

impl ExtensionHandler for RangeSearchHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "rangeSearch"
                | "worksheetSearch"
                | "rangeAreasSearch"
                | "worksheetRangeAreasSearch"
                | "rangeReplaceAll"
                | "worksheetReplaceAll"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let op = required_non_empty_string(operation, "op")?;
        match op {
            "rangeSearch" => handle_range_search(operation, context)?,
            "worksheetSearch" => handle_worksheet_search(operation, context)?,
            "rangeAreasSearch" => handle_range_areas_search(operation, context)?,
            "worksheetRangeAreasSearch" => handle_worksheet_range_areas_search(operation, context)?,
            "rangeReplaceAll" | "worksheetReplaceAll" => handle_replace_all(operation, context)?,
            _ => return Ok(false),
        }
        Ok(true)
    }
}

fn handle_range_search(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let id = required_non_empty_string(operation, "id")?;
    let source = context.range(required_non_empty_string(operation, "rangeId")?)?;
    let sheet = source.sheet();
    let method = required_non_empty_string(operation, "method")?;
    let or_null_object = optional_bool(operation, "orNullObject", false)?;
    let args = operation_args(operation)?;

    if source.is_null_object() {
        return Err(invalid("Cannot invoke search on a null Range object"));
    }

    match method {
        "getUsedRange" => {
            let values_only = argument_bool(args, 0, "valuesOnly")?;
            let address =
                used_range(&sheet, source.address(), values_only).map_err(search_error)?;
            bind_used_range(context, id, sheet, address, or_null_object, false)
        }
        "find" => {
            let text = argument_string(args, 0, "text")?;
            let criteria = argument_criteria(args, 1)?;
            let match_cell =
                find(&sheet, source.address(), text, criteria).map_err(search_error)?;
            bind_found_range(context, id, sheet, match_cell, or_null_object)
        }
        _ => Err(unsupported(format!(
            "Unsupported Range search method '{method}'"
        ))),
    }
}

fn handle_worksheet_search(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let id = required_non_empty_string(operation, "id")?;
    let worksheet = context.worksheet(required_non_empty_string(operation, "worksheetId")?)?;
    let sheet = worksheet.sheet();
    let method = required_non_empty_string(operation, "method")?;
    let or_null_object = optional_bool(operation, "orNullObject", false)?;
    let args = operation_args(operation)?;

    match method {
        "getUsedRange" => {
            let values_only = argument_bool(args, 0, "valuesOnly")?;
            let address = used_range(&sheet, None, values_only).map_err(search_error)?;
            // Office's Worksheet.getUsedRange has a top-left fallback on an
            // entirely blank sheet. Its OrNullObject form exposes a null
            // Range for the same condition.
            bind_used_range(context, id, sheet, address, or_null_object, true)
        }
        _ => Err(unsupported(format!(
            "Unsupported Worksheet search method '{method}'"
        ))),
    }
}

fn handle_range_areas_search(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let id = required_non_empty_string(operation, "id")?;
    let source = context.range(required_non_empty_string(operation, "rangeId")?)?;
    if source.is_null_object() {
        return Err(invalid("Cannot invoke search on a null Range object"));
    }
    let sheet = source.sheet();
    let method = required_non_empty_string(operation, "method")?;
    let or_null_object = optional_bool(operation, "orNullObject", false)?;
    let args = operation_args(operation)?;

    match method {
        "getSpecialCells" => {
            let address = source
                .address()
                .ok_or_else(|| invalid("Range.getSpecialCells requires a bounded Range"))?;
            let cell_type = argument_string(args, 0, "cellType")?;
            let value_type = argument_optional_string(args, 1, "cellValueType")?;
            let areas =
                special_cells(&sheet, address, cell_type, value_type).map_err(search_error)?;
            bind_range_areas(context, id, sheet, areas, or_null_object)
        }
        _ => Err(unsupported(format!(
            "Unsupported RangeAreas search method '{method}'"
        ))),
    }
}

fn handle_worksheet_range_areas_search(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let id = required_non_empty_string(operation, "id")?;
    let worksheet = context.worksheet(required_non_empty_string(operation, "worksheetId")?)?;
    let sheet = worksheet.sheet();
    let method = required_non_empty_string(operation, "method")?;
    let or_null_object = optional_bool(operation, "orNullObject", false)?;
    let args = operation_args(operation)?;

    match method {
        "findAll" => {
            let text = argument_string(args, 0, "text")?;
            let criteria = argument_criteria(args, 1)?;
            let matches = find_all(&sheet, None, text, criteria).map_err(search_error)?;
            bind_range_areas_from_cells(context, id, sheet, matches, or_null_object)
        }
        _ => Err(unsupported(format!(
            "Unsupported Worksheet RangeAreas search method '{method}'"
        ))),
    }
}

fn handle_replace_all(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<(), BatchError> {
    let result_id = required_non_empty_string(operation, "resultId")?;
    let is_worksheet = operation
        .get("op")
        .and_then(Value::as_str)
        .is_some_and(|op| op == "worksheetReplaceAll");
    let (sheet, address) = if is_worksheet {
        let worksheet = context.worksheet(required_non_empty_string(operation, "worksheetId")?)?;
        (worksheet.sheet(), None)
    } else {
        let range = context.range(required_non_empty_string(operation, "rangeId")?)?;
        if range.is_null_object() {
            return Err(invalid("Cannot replace through a null Range object"));
        }
        (range.sheet(), range.address().map(ToOwned::to_owned))
    };
    let text = required_string(operation, "text")?;
    let replacement = required_string(operation, "replacement")?;
    let criteria = operation_criteria(operation, "criteria")?;
    let count = replace_all(&sheet, address.as_deref(), text, replacement, criteria)
        .map_err(search_error)?;
    context.set_result(result_id, json!(count));
    Ok(())
}

fn bind_used_range(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    sheet: Sheet,
    address: Option<String>,
    or_null_object: bool,
    worksheet_scope: bool,
) -> Result<(), BatchError> {
    match address {
        Some(address) => {
            context.bind_range(id, RangeRef::new(sheet, Some(address), false));
            Ok(())
        }
        None if worksheet_scope && !or_null_object => {
            context.bind_range(id, RangeRef::new(sheet, Some("A1".to_string()), false));
            Ok(())
        }
        None if or_null_object => {
            context.bind_range(id, RangeRef::new(sheet, None, true));
            context.set_loaded(id, "isNullObject", Value::Bool(true));
            Ok(())
        }
        None => Err(item_not_found("The specified Range has no used cells")),
    }
}

fn bind_found_range(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    sheet: Sheet,
    match_cell: Option<(u32, u32)>,
    or_null_object: bool,
) -> Result<(), BatchError> {
    match match_cell {
        Some((row, column)) => {
            let address = SearchArea {
                start_row: row,
                start_col: column,
                end_row: row,
                end_col: column,
            }
            .to_a1();
            context.bind_range(id, RangeRef::new(sheet, Some(address), false));
            Ok(())
        }
        None if or_null_object => {
            context.bind_range(id, RangeRef::new(sheet, None, true));
            context.set_loaded(id, "isNullObject", Value::Bool(true));
            Ok(())
        }
        None => Err(item_not_found("The search text was not found")),
    }
}

fn bind_range_areas(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    sheet: Sheet,
    areas: Vec<SearchArea>,
    or_null_object: bool,
) -> Result<(), BatchError> {
    if areas.is_empty() {
        if or_null_object {
            context.bind_null_object(id);
            return Ok(());
        }
        return Err(item_not_found("No cells matched the RangeAreas result"));
    }
    let addresses = areas.iter().map(|area| area.to_a1()).collect::<Vec<_>>();
    let range_areas = RangeAreasRef::from_addresses(sheet, addresses).map_err(range_areas_error)?;
    context.bind_object(id, Arc::new(range_areas));
    Ok(())
}

fn bind_range_areas_from_cells(
    context: &mut HostDispatchContext<'_>,
    id: &str,
    sheet: Sheet,
    matches: Vec<(u32, u32)>,
    or_null_object: bool,
) -> Result<(), BatchError> {
    if matches.is_empty() {
        if or_null_object {
            context.bind_null_object(id);
            return Ok(());
        }
        return Err(item_not_found("No cells matched the RangeAreas result"));
    }
    let range_areas = RangeAreasRef::from_cells(sheet, matches).map_err(range_areas_error)?;
    context.bind_object(id, Arc::new(range_areas));
    Ok(())
}

fn operation_args(operation: &Value) -> Result<&[Value], BatchError> {
    operation
        .get("args")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid("Search operation requires an args array"))
}

fn argument_string<'a>(args: &'a [Value], index: usize, name: &str) -> Result<&'a str, BatchError> {
    args.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("Search operation argument {name} must be a string")))
}

fn argument_optional_string<'a>(
    args: &'a [Value],
    index: usize,
    name: &str,
) -> Result<Option<&'a str>, BatchError> {
    match args.get(index) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(Some)
            .ok_or_else(|| invalid(format!("Search operation argument {name} must be a string"))),
    }
}

fn argument_bool(args: &[Value], index: usize, name: &str) -> Result<bool, BatchError> {
    match args.get(index) {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(invalid(format!(
            "Search operation argument {name} must be a boolean"
        ))),
    }
}

fn argument_criteria(args: &[Value], index: usize) -> Result<SearchCriteria, BatchError> {
    let value = args
        .get(index)
        .ok_or_else(|| invalid("Search operation requires criteria"))?;
    parse_criteria(value)
}

fn operation_criteria<'a>(operation: &'a Value, field: &str) -> Result<SearchCriteria, BatchError> {
    let value = operation
        .get(field)
        .ok_or_else(|| invalid(format!("Search operation requires {field}")))?;
    parse_criteria(value)
}

fn parse_criteria(value: &Value) -> Result<SearchCriteria, BatchError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Search criteria must be an object"))?;
    let complete_match = object_bool(object, "completeMatch")?.unwrap_or(false);
    let match_case = object_bool(object, "matchCase")?.unwrap_or(false);
    let backwards = match object.get("searchDirection") {
        None | Some(Value::Null) => false,
        Some(Value::String(value)) if value == "Forward" => false,
        Some(Value::String(value)) if value == "Backwards" => true,
        Some(_) => {
            return Err(invalid(
                "SearchCriteria.searchDirection must be 'Forward' or 'Backwards'",
            ));
        }
    };
    Ok(SearchCriteria {
        complete_match,
        match_case,
        backwards,
    })
}

fn object_bool(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<bool>, BatchError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(invalid(format!("SearchCriteria.{field} must be a boolean"))),
    }
}

fn optional_bool(operation: &Value, field: &str, default: bool) -> Result<bool, BatchError> {
    match operation.get(field) {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(invalid(format!(
            "Search operation {field} must be a boolean"
        ))),
    }
}

fn required_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("Search operation requires string {field}")))
}

fn required_non_empty_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    let value = required_string(operation, field)?;
    if value.trim().is_empty() {
        return Err(invalid(format!(
            "Search operation requires non-empty {field}"
        )));
    }
    Ok(value)
}

fn search_error(error: RangeSearchError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn range_areas_error(error: crate::range_areas::RangeAreasError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn item_not_found(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "ItemNotFound",
        message: message.into(),
    }
}

fn invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "UnsupportedOperation",
        message: message.into(),
    }
}

impl SearchArea {
    /// Render the canonical unqualified A1 address used by RangeAreas.
    pub(crate) fn to_a1(self) -> String {
        let start = cell_name(self.start_row, self.start_col);
        let end = cell_name(self.end_row, self.end_col);
        if start == end {
            start
        } else {
            format!("{start}:{end}")
        }
    }
}

/// Return the used extent of a worksheet or bounded Range.
///
/// `address == None` denotes a worksheet call.  For a Range address, the
/// result is the intersection of the Range and the persisted sheet extent.
/// `values_only` is part of the Office.js contract; the current engine's
/// `get_data_bounds` already excludes format-only cells, so both modes use the
/// same production query until a format-aware extent primitive exists.
pub(crate) fn used_range(
    sheet: &Sheet,
    address: Option<&str>,
    values_only: bool,
) -> Result<Option<String>, RangeSearchError> {
    let _ = values_only;
    let scope = scope_bounds(sheet, address)?;
    let Some(data) = sheet.get_data_bounds().map_err(engine)? else {
        return Ok(None);
    };
    let data = (data.min_row, data.min_col, data.max_row, data.max_col);
    let Some(bounds) = intersect(scope, data) else {
        return Ok(None);
    };
    Ok(Some(SearchArea::from_bounds(bounds).to_a1()))
}

/// Find the first matching cell in a Worksheet or Range.
///
/// A Range larger than one cell is searched in its own bounds.  A single-cell
/// Range follows Office.js's documented special case: the entire used sheet
/// extent is searched, beginning after that cell and wrapping once.  Forward
/// searches use row-major order; backwards searches use the reverse order.
pub(crate) fn find(
    sheet: &Sheet,
    address: Option<&str>,
    text: &str,
    criteria: SearchCriteria,
) -> Result<Option<(u32, u32)>, RangeSearchError> {
    let parsed = address
        .map(|raw| parse_range_address(sheet, raw).map_err(map_address_error))
        .transpose()?;
    let single_cell = parsed.as_ref().is_some_and(|range| {
        matches!(range, RangeAddress::Cells { start_row, start_column, end_row, end_column }
            if start_row == end_row && start_column == end_column)
    });

    let bounds = if single_cell {
        let Some(data) = sheet.get_data_bounds().map_err(engine)? else {
            return Ok(None);
        };
        (data.min_row, data.min_col, data.max_row, data.max_col)
    } else {
        let scope = parsed
            .as_ref()
            .map_or((0, 0, LAST_ROW, LAST_COLUMN), RangeAddress::bounds);
        let Some(data) = sheet.get_data_bounds().map_err(engine)? else {
            return Ok(None);
        };
        let data = (data.min_row, data.min_col, data.max_row, data.max_col);
        let Some(intersection) = intersect(scope, data) else {
            return Ok(None);
        };
        intersection
    };

    let matches = find_matches(sheet, bounds, text, criteria)?;
    if matches.is_empty() {
        return Ok(None);
    }

    if single_cell {
        let RangeAddress::Cells {
            start_row,
            start_column,
            ..
        } = parsed.expect("single-cell address was parsed")
        else {
            unreachable!("single-cell marker requires a Cells address")
        };
        return Ok(Some(select_after_anchor(
            &matches,
            (start_row, start_column),
            criteria.backwards,
        )));
    }

    Ok(Some(if criteria.backwards {
        *matches.last().expect("non-empty matches")
    } else {
        matches[0]
    }))
}

/// Find all matching cells in a Worksheet or bounded Range.
///
/// Unlike `Range.find`, a worksheet `findAll` call has no search direction and
/// a RangeAreas result is represented by all matching coordinates.  The host
/// should call [`matches_to_areas`] before constructing its RangeAreas proxy.
pub(crate) fn find_all(
    sheet: &Sheet,
    address: Option<&str>,
    text: &str,
    criteria: SearchCriteria,
) -> Result<Vec<(u32, u32)>, RangeSearchError> {
    let parsed = address
        .map(|raw| parse_range_address(sheet, raw).map_err(map_address_error))
        .transpose()?;
    let scope = parsed
        .as_ref()
        .map_or((0, 0, LAST_ROW, LAST_COLUMN), RangeAddress::bounds);
    let Some(data) = sheet.get_data_bounds().map_err(engine)? else {
        return Ok(Vec::new());
    };
    let data = (data.min_row, data.min_col, data.max_row, data.max_col);
    let Some(bounds) = intersect(scope, data) else {
        return Ok(Vec::new());
    };
    let mut matches = find_matches(sheet, bounds, text, criteria)?;
    if criteria.backwards {
        matches.reverse();
    }
    Ok(matches)
}

/// Replace all matching values in a Worksheet or bounded Range.
///
/// The returned count is suitable for the top-level `ClientResult<number>`
/// response.  Replacement is staged before mutation so scanning never mixes
/// reads with writes. Formula cells are matched and replaced against their raw
/// formula text; literal cells use their displayed value (which is also the
/// raw stored value for the primitive cell types).
pub(crate) fn replace_all(
    sheet: &Sheet,
    address: Option<&str>,
    text: &str,
    replacement: &str,
    criteria: SearchCriteria,
) -> Result<u32, RangeSearchError> {
    if text.is_empty() {
        return Err(invalid("replaceAll text cannot be empty"));
    }

    let parsed = address
        .map(|raw| parse_range_address(sheet, raw).map_err(map_address_error))
        .transpose()?;
    let scope = parsed
        .as_ref()
        .map_or((0, 0, LAST_ROW, LAST_COLUMN), RangeAddress::bounds);
    let Some(data) = sheet.get_data_bounds().map_err(engine)? else {
        return Ok(0);
    };
    let data = (data.min_row, data.min_col, data.max_row, data.max_col);
    let Some(bounds) = intersect(scope, data) else {
        return Ok(0);
    };

    let values = values_in_bounds(sheet, bounds)?;
    let mut changes = Vec::new();
    let mut count = 0u32;
    for (row_offset, row_values) in values.iter().enumerate() {
        for (col_offset, value) in row_values.iter().enumerate() {
            let row = bounds.0 + row_offset as u32;
            let col = bounds.1 + col_offset as u32;
            let raw = sheet.get_raw_value((row, col)).map_err(engine)?;
            let display = value.to_string();
            let candidate = if raw.starts_with('=') {
                raw.as_str()
            } else {
                display.as_str()
            };
            if !matches_text(candidate, text, criteria) {
                continue;
            }
            let (updated, occurrences) = replace_text(&raw, text, replacement, criteria);
            if occurrences == 0 {
                continue;
            }
            count = count.saturating_add(occurrences);
            changes.push((row, col, updated));
        }
    }

    for (row, col, value) in changes {
        sheet
            .set_cell((row, col), value)
            .map_err(engine)
            .map(|_| ())?;
    }

    Ok(count)
}

/// Discover bounded primitive special-cell areas.
///
/// Supported `cell_type` values are `Blanks`, `Constants`, and `Formulas`.
/// The conditional-format, data-validation, same-format, and visibility
/// families require engine indexes that are not currently exposed by the
/// compute-api facade, so they return `UnsupportedOperation` explicitly.
pub(crate) fn special_cells(
    sheet: &Sheet,
    address: &str,
    cell_type: &str,
    cell_value_type: Option<&str>,
) -> Result<Vec<SearchArea>, RangeSearchError> {
    let parsed = parse_range_address(sheet, address).map_err(map_address_error)?;
    let bounds = match parsed {
        RangeAddress::Cells {
            start_row,
            start_column,
            end_row,
            end_column,
        } => (start_row, start_column, end_row, end_column),
        RangeAddress::WholeSheet | RangeAddress::Rows { .. } | RangeAddress::Columns { .. } => {
            return Err(unsupported("getSpecialCells requires a bounded cell range"));
        }
    };

    let mode = match cell_type {
        "Blanks" => SpecialCellMode::Blanks,
        "Constants" => SpecialCellMode::Constants,
        "Formulas" => SpecialCellMode::Formulas,
        other => {
            return Err(unsupported(format!(
                "getSpecialCells cell type '{other}' is not supported by this host"
            )));
        }
    };
    let value_type = ValueType::parse(cell_value_type.unwrap_or("All"))?;
    let values = values_in_bounds(sheet, bounds)?;
    let formula_positions =
        if matches!(mode, SpecialCellMode::Formulas | SpecialCellMode::Constants) {
            sheet
                .find_by_formula(".*")
                .map_err(engine)?
                .into_iter()
                .filter(|&(row, col)| {
                    row >= bounds.0 && row <= bounds.2 && col >= bounds.1 && col <= bounds.3
                })
                .collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };

    let mut selected = Vec::new();
    for (row_offset, row_values) in values.iter().enumerate() {
        for (col_offset, value) in row_values.iter().enumerate() {
            let row = bounds.0 + row_offset as u32;
            let col = bounds.1 + col_offset as u32;
            let has_formula = formula_positions.contains(&(row, col));
            let include = match mode {
                SpecialCellMode::Blanks => !has_formula && value.is_null(),
                SpecialCellMode::Constants => {
                    !has_formula && !value.is_null() && value_type.matches(value)
                }
                SpecialCellMode::Formulas => has_formula && value_type.matches(value),
            };
            if include {
                selected.push((row, col));
            }
        }
    }

    Ok(matches_to_areas(&selected))
}

/// Coalesce row-major cell coordinates into deterministic rectangular areas.
pub(crate) fn matches_to_areas(matches: &[(u32, u32)]) -> Vec<SearchArea> {
    if matches.is_empty() {
        return Vec::new();
    }

    let mut coordinates = matches.to_vec();
    coordinates.sort_unstable();
    coordinates.dedup();

    // First build maximal horizontal runs for each row.
    let mut runs = Vec::new();
    let mut index = 0;
    while index < coordinates.len() {
        let row = coordinates[index].0;
        let mut start_col = coordinates[index].1;
        let mut end_col = start_col;
        index += 1;
        while index < coordinates.len() && coordinates[index].0 == row {
            let col = coordinates[index].1;
            if col == end_col + 1 {
                end_col = col;
            } else {
                runs.push(SearchArea {
                    start_row: row,
                    start_col,
                    end_row: row,
                    end_col,
                });
                start_col = col;
                end_col = col;
            }
            index += 1;
        }
        runs.push(SearchArea {
            start_row: row,
            start_col,
            end_row: row,
            end_col,
        });
    }

    // Merge identical horizontal runs across adjacent rows.  This produces a
    // compact, disjoint set while keeping the result stable for RangeAreas.
    let mut merged = Vec::new();
    for run in runs {
        if let Some(previous) = merged.last_mut()
            && previous.end_row + 1 == run.start_row
            && previous.start_col == run.start_col
            && previous.end_col == run.end_col
        {
            previous.end_row = run.end_row;
        } else {
            merged.push(run);
        }
    }
    merged
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SpecialCellMode {
    Blanks,
    Constants,
    Formulas,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ValueType {
    All,
    Errors,
    ErrorsLogical,
    ErrorsNumbers,
    ErrorsText,
    ErrorsLogicalNumber,
    ErrorsLogicalText,
    ErrorsNumberText,
    Logical,
    LogicalNumbers,
    LogicalText,
    LogicalNumbersText,
    Numbers,
    NumbersText,
    Text,
}

impl ValueType {
    fn parse(raw: &str) -> Result<Self, RangeSearchError> {
        match raw {
            "All" => Ok(Self::All),
            "Errors" => Ok(Self::Errors),
            "ErrorsLogical" => Ok(Self::ErrorsLogical),
            "ErrorsNumbers" => Ok(Self::ErrorsNumbers),
            "ErrorsText" => Ok(Self::ErrorsText),
            "ErrorsLogicalNumber" => Ok(Self::ErrorsLogicalNumber),
            "ErrorsLogicalText" => Ok(Self::ErrorsLogicalText),
            "ErrorsNumberText" => Ok(Self::ErrorsNumberText),
            "Logical" => Ok(Self::Logical),
            "LogicalNumbers" => Ok(Self::LogicalNumbers),
            "LogicalText" => Ok(Self::LogicalText),
            "LogicalNumbersText" => Ok(Self::LogicalNumbersText),
            "Numbers" => Ok(Self::Numbers),
            "NumbersText" => Ok(Self::NumbersText),
            "Text" => Ok(Self::Text),
            other => Err(invalid(format!(
                "getSpecialCells value type '{other}' is invalid"
            ))),
        }
    }

    fn matches(self, value: &CellValue) -> bool {
        if self == Self::All {
            return true;
        }
        let is_error = value.is_error();
        let is_logical = value.is_boolean() || matches!(value, CellValue::Control(_));
        let is_number = value.is_number();
        let is_text = value.is_text();
        match self {
            Self::All => true,
            Self::Errors => is_error,
            Self::ErrorsLogical => is_error || is_logical,
            Self::ErrorsNumbers => is_error || is_number,
            Self::ErrorsText => is_error || is_text,
            Self::ErrorsLogicalNumber => is_error || is_logical || is_number,
            Self::ErrorsLogicalText => is_error || is_logical || is_text,
            Self::ErrorsNumberText => is_error || is_number || is_text,
            Self::Logical => is_logical,
            Self::LogicalNumbers => is_logical || is_number,
            Self::LogicalText => is_logical || is_text,
            Self::LogicalNumbersText => is_logical || is_number || is_text,
            Self::Numbers => is_number,
            Self::NumbersText => is_number || is_text,
            Self::Text => is_text,
        }
    }
}

fn find_matches(
    sheet: &Sheet,
    bounds: (u32, u32, u32, u32),
    text: &str,
    criteria: SearchCriteria,
) -> Result<Vec<(u32, u32)>, RangeSearchError> {
    // The engine's search primitive walks the sparse mirror rather than
    // allocating a matrix.  Use it for the exact/case-sensitive form, which
    // is also the common form used by callers that need a deterministic cell
    // locator.  Partial and case-insensitive searches still need the value
    // projection below because the primitive deliberately has no criteria
    // arguments.
    if criteria.complete_match && criteria.match_case {
        return sheet
            .find_by_value(
                text,
                Some(CellRange::Bounds(bounds.0, bounds.1, bounds.2, bounds.3)),
            )
            .map_err(engine);
    }

    let values = values_in_bounds(sheet, bounds)?;
    let mut matches = Vec::new();
    for (row_offset, row_values) in values.iter().enumerate() {
        for (col_offset, value) in row_values.iter().enumerate() {
            if matches_text(&value.to_string(), text, criteria) {
                matches.push((bounds.0 + row_offset as u32, bounds.1 + col_offset as u32));
            }
        }
    }
    Ok(matches)
}

fn values_in_bounds(
    sheet: &Sheet,
    bounds: (u32, u32, u32, u32),
) -> Result<Vec<Vec<CellValue>>, RangeSearchError> {
    sheet
        .get_range_values_2d(CellRange::Bounds(bounds.0, bounds.1, bounds.2, bounds.3))
        .map_err(engine)
}

fn select_after_anchor(matches: &[(u32, u32)], anchor: (u32, u32), backwards: bool) -> (u32, u32) {
    if backwards {
        matches
            .iter()
            .rev()
            .find(|&&(row, col)| (row, col) < anchor)
            .copied()
            .unwrap_or(*matches.last().expect("non-empty matches"))
    } else {
        matches
            .iter()
            .find(|&&(row, col)| (row, col) > anchor)
            .copied()
            .unwrap_or(matches[0])
    }
}

fn matches_text(value: &str, text: &str, criteria: SearchCriteria) -> bool {
    if criteria.complete_match {
        if criteria.match_case {
            value == text
        } else {
            value.to_lowercase() == text.to_lowercase()
        }
    } else if criteria.match_case {
        value.contains(text)
    } else {
        value.to_lowercase().contains(&text.to_lowercase())
    }
}

fn replace_text(
    value: &str,
    text: &str,
    replacement: &str,
    criteria: SearchCriteria,
) -> (String, u32) {
    if criteria.complete_match {
        return (replacement.to_string(), 1);
    }
    if criteria.match_case {
        let count = value.match_indices(text).count() as u32;
        (value.replace(text, replacement), count)
    } else {
        replace_case_insensitive(value, text, replacement)
    }
}

fn replace_case_insensitive(value: &str, text: &str, replacement: &str) -> (String, u32) {
    if text.is_empty() {
        return (value.to_string(), 0);
    }
    let lowered_value = value.to_lowercase();
    let lowered_text = text.to_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    let mut count = 0;
    while let Some(relative) = lowered_value[cursor..].find(&lowered_text) {
        let start = cursor + relative;
        let end = start + lowered_text.len();
        // `to_lowercase` can change byte lengths for a few Unicode code
        // points.  The Office.js adapter's search contract is primarily
        // ASCII-oriented; preserve a safe fallback for those boundaries.
        if !value.is_char_boundary(start) || !value.is_char_boundary(end) || end > value.len() {
            return (value.to_string(), 0);
        }
        output.push_str(&value[cursor..start]);
        output.push_str(replacement);
        cursor = end;
        count += 1;
    }
    output.push_str(&value[cursor..]);
    (output, count)
}

fn scope_bounds(
    sheet: &Sheet,
    address: Option<&str>,
) -> Result<(u32, u32, u32, u32), RangeSearchError> {
    address
        .map(|raw| {
            parse_range_address(sheet, raw)
                .map(|range| range.bounds())
                .map_err(map_address_error)
        })
        .transpose()
        .map(|bounds| bounds.unwrap_or((0, 0, LAST_ROW, LAST_COLUMN)))
}

fn intersect(
    left: (u32, u32, u32, u32),
    right: (u32, u32, u32, u32),
) -> Option<(u32, u32, u32, u32)> {
    let bounds = (
        left.0.max(right.0),
        left.1.max(right.1),
        left.2.min(right.2),
        left.3.min(right.3),
    );
    (bounds.0 <= bounds.2 && bounds.1 <= bounds.3).then_some(bounds)
}

impl SearchArea {
    fn from_bounds((start_row, start_col, end_row, end_col): (u32, u32, u32, u32)) -> Self {
        Self {
            start_row,
            start_col,
            end_row,
            end_col,
        }
    }
}

fn cell_name(row: u32, column: u32) -> String {
    format!("{}{}", column_name(column), row + 1)
}

fn column_name(mut column: u32) -> String {
    let mut reversed = Vec::new();
    loop {
        reversed.push((b'A' + (column % 26) as u8) as char);
        column /= 26;
        if column == 0 {
            break;
        }
        column -= 1;
    }
    reversed.into_iter().rev().collect()
}

fn map_address_error(error: RangeNavigationError) -> RangeSearchError {
    RangeSearchError {
        code: error.code,
        message: error.message,
    }
}

fn engine(error: impl std::fmt::Display) -> RangeSearchError {
    RangeSearchError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn invalid(message: impl Into<String>) -> RangeSearchError {
    RangeSearchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> RangeSearchError {
    RangeSearchError {
        code: "UnsupportedOperation",
        message: message.into(),
    }
}
