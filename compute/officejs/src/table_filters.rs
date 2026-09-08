//! Office.js table sorting and column filtering.
//!
//! The Office object model exposes TableSort and Filter as children of a
//! table and table column. This module is the translation boundary for those
//! children. It resolves the existing TableRef/TableColumnRef handles on
//! every operation and delegates mutations to the production compute-api
//! range-sort and SheetFilters facades. No workbook state is kept in this
//! adapter.
//!
//! Host wire contract:
//!
//! * getTableSort { id, tableId } binds id to the existing table handle.
//! * tableSortApply { tableId, fields, matchCase?, method? } calls
//!   apply_table_sort and stores the returned descriptor in the host's
//!   TableSort proxy map for load, clear, and reapply.
//! * tableSortClear { tableId } validates the table and clears the host
//!   descriptor. The current public compute-api has no table-sort metadata
//!   mutation; clearing therefore has no cell effect, as Office specifies.
//! * tableSortReapply { tableId, fields, matchCase, method } calls
//!   reapply_table_sort with the descriptor retained by that map.
//! * getTableColumnFilter { id, columnId } binds id to an existing column
//!   handle.
//! * tableFilterApply { columnId, criteria } and tableFilterClear
//!   { columnId } call the corresponding helpers below. Filter.criteria
//!   is loaded through load_table_filter.
//!
//! The Rust API deliberately accepts the already-bound TableRef and
//! TableColumnRef rather than host map IDs. This keeps stable table and
//! column identity in the existing table modules and prevents a second host
//! implementation from resolving names or columns differently.

use std::collections::HashMap;
use std::fmt;

use compute_api::{CellRange, ComputeApiError, Sheet};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use value_types::Color;

use crate::sort_filter::{RangeSortRequest, apply_range_sort};
use crate::table_collections::TableColumnRef;
use crate::tables::{TableError, TableRef};

/// Error returned by a table sort/filter host operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TableFilterError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl TableFilterError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "UnsupportedOperation",
            message: message.into(),
        }
    }

    fn item_not_found(message: impl Into<String>) -> Self {
        Self {
            code: "ItemNotFound",
            message: message.into(),
        }
    }

    fn general(message: impl Into<String>) -> Self {
        Self {
            code: "GeneralException",
            message: message.into(),
        }
    }
}

impl fmt::Display for TableFilterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for TableFilterError {}

impl From<ComputeApiError> for TableFilterError {
    fn from(error: ComputeApiError) -> Self {
        let message = error.to_string();
        match error {
            ComputeApiError::InvalidAddress { .. }
            | ComputeApiError::InvalidRange { .. }
            | ComputeApiError::InvalidOperation(_) => Self::invalid(message),
            ComputeApiError::SheetNotFound { .. }
            | ComputeApiError::Compute(value_types::ComputeError::SheetNotFound { .. }) => {
                Self::item_not_found(message)
            }
            ComputeApiError::Compute(value_types::ComputeError::InvalidInput { .. }) => {
                Self::invalid(message)
            }
            _ => Self::general(message),
        }
    }
}

impl From<TableError> for TableFilterError {
    fn from(error: TableError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

/// Inputs to Table.sort.apply after the JS request has been decoded.
#[derive(Debug, Clone)]
pub(crate) struct TableSortRequest {
    pub(crate) fields: Value,
    pub(crate) match_case: Option<bool>,
    pub(crate) method: Option<String>,
}

/// The Office-shaped descriptor for a table's last sort.
///
/// A host keeps this descriptor alongside its TableSort proxy so that
/// reapply() can issue the same request after an edit. Imported OOXML table
/// sort state is projected into the same shape by load_table_sort.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TableSortSnapshot {
    pub(crate) fields: Vec<Value>,
    pub(crate) match_case: bool,
    pub(crate) method: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableView {
    id: String,
    name: String,
    range: TableRangeView,
    #[serde(default)]
    has_header_row: bool,
    #[serde(default)]
    has_totals_row: bool,
    #[serde(default)]
    columns: Vec<TableColumnView>,
    #[serde(default)]
    sort_state: Option<TableSortStateView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableRangeView {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableColumnView {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    index: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableSortStateView {
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    sort_method: String,
    #[serde(default)]
    conditions: Vec<TableSortConditionView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableSortConditionView {
    ref_range: String,
    #[serde(default)]
    descending: bool,
    #[serde(default)]
    sort_by: String,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    icon_set: Option<Value>,
    #[serde(default)]
    icon_id: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterView {
    id: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    filter_type: String,
    #[serde(default)]
    table_id: Option<String>,
    #[serde(default)]
    column_filters: HashMap<String, Value>,
}

/// Apply Table.sort.apply to the table data body.
///
/// SortField.key is a table-relative column offset. The production range
/// sorter receives the corresponding absolute worksheet columns and the
/// already-resolved data-body range, so headers and totals are excluded.
/// Empty data bodies are valid table state and produce no cell mutation while
/// still returning the requested last-sort descriptor.
pub(crate) fn apply_table_sort(
    table: &TableRef,
    request: TableSortRequest,
) -> Result<TableSortSnapshot, TableFilterError> {
    let table_view = resolve_table(table)?;
    let snapshot = sort_snapshot_from_request(&table_view, &request)?;

    let Some(data_bounds) = data_body_bounds(&table_view) else {
        return Ok(snapshot);
    };
    let address = a1_range(data_bounds.0, data_bounds.1, data_bounds.2, data_bounds.3);

    // Range.sort's parser performs the one authoritative conversion to
    // BridgeSortOptions, including color validation and unsupported icon /
    // TextAsNumber diagnostics. It receives hasHeaders=false because the
    // address is the table data body itself.
    apply_range_sort(
        &table.sheet(),
        &address,
        RangeSortRequest {
            fields: request.fields,
            match_case: request.match_case,
            has_headers: Some(false),
            orientation: Some("Rows".to_string()),
            method: request.method,
        },
    )
    .map_err(|error| TableFilterError {
        code: error.code,
        message: error.message,
    })?;
    Ok(snapshot)
}

/// Reapply a descriptor previously returned by apply_table_sort or
/// load_table_sort.
pub(crate) fn reapply_table_sort(
    table: &TableRef,
    snapshot: &TableSortSnapshot,
) -> Result<(), TableFilterError> {
    let request = TableSortRequest {
        fields: Value::Array(snapshot.fields.clone()),
        match_case: Some(snapshot.match_case),
        // PinYin is the Office-facing default used when no CJK override was
        // supplied. Passing it to the bridge would incorrectly turn the
        // default into an unsupported explicit override.
        method: (snapshot.method != "PinYin").then(|| snapshot.method.clone()),
    };
    apply_table_sort(table, request).map(|_| ())
}

/// Validate a table for TableSort.clear.
///
/// clear only clears header-button state in Office.js and leaves row order
/// unchanged. The current public compute-api exposes no table-level sort
/// metadata setter/clearer, so the host must drop its proxy descriptor after
/// this validation succeeds. Imported table metadata is intentionally not
/// rewritten by a no-op mutation.
pub(crate) fn clear_table_sort(table: &TableRef) -> Result<(), TableFilterError> {
    resolve_table(table).map(|_| ())
}

/// Load requested TableSort scalar properties.
pub(crate) fn load_table_sort(
    table: &TableRef,
    properties: &[String],
) -> Result<HashMap<String, Value>, TableFilterError> {
    let table_view = resolve_table(table)?;
    let snapshot = sort_snapshot_from_table(&table_view)?;
    let requested: Vec<&str> = if properties.is_empty() {
        vec!["fields", "matchCase", "method"]
    } else {
        properties.iter().map(String::as_str).collect()
    };
    let mut result = HashMap::new();
    for property in requested {
        let value = match property {
            "fields" => Value::Array(snapshot.fields.clone()),
            "matchCase" => Value::Bool(snapshot.match_case),
            "method" => Value::String(snapshot.method.clone()),
            other => {
                return Err(TableFilterError::invalid(format!(
                    "TableSort.{other} is not supported by this Office.js host"
                )));
            }
        };
        result.insert(property.to_string(), value);
    }
    Ok(result)
}

/// Apply a FilterCriteria to a bound table column.
///
/// Table creation/import creates a durable TableFilter record. If an
/// imported workbook omitted that record, this helper creates one from the
/// current table bounds before setting the column criterion. The
/// SheetFilters::set_column_filter facade performs the actual evaluation and
/// row visibility mutation as part of the same production operation.
pub(crate) fn apply_table_filter(
    column: &TableColumnRef,
    criteria: &Value,
) -> Result<(), TableFilterError> {
    let table = column.table();
    let table_view = resolve_table(&table)?;
    let table_column = resolve_table_column(&table_view, column.key())?;
    let filter = ensure_table_filter(&table.sheet(), &table_view)?;
    let absolute_column = table_view
        .range
        .start_col
        .checked_add(table_column.index)
        .ok_or_else(|| TableFilterError::invalid("Table column exceeds worksheet bounds"))?;
    let typed = parse_filter_criteria(criteria)?;
    table
        .sheet()
        .filters()
        .set_column_filter(&filter.id, absolute_column, typed)
        .map_err(TableFilterError::from)?;
    Ok(())
}

/// Clear one table-column criterion while retaining the table filter object.
pub(crate) fn clear_table_filter(column: &TableColumnRef) -> Result<(), TableFilterError> {
    let table = column.table();
    let table_view = resolve_table(&table)?;
    let table_column = resolve_table_column(&table_view, column.key())?;
    let filter = table_filter(&table.sheet(), &table_view)?;
    let absolute_column = table_view
        .range
        .start_col
        .checked_add(table_column.index)
        .ok_or_else(|| TableFilterError::invalid("Table column exceeds worksheet bounds"))?;
    table
        .sheet()
        .filters()
        .clear_column_filter(&filter.id, absolute_column)
        .map_err(TableFilterError::from)?;
    Ok(())
}

/// Load requested Filter scalar properties for one table column.
pub(crate) fn load_table_filter(
    column: &TableColumnRef,
    properties: &[String],
) -> Result<HashMap<String, Value>, TableFilterError> {
    let table = column.table();
    let table_view = resolve_table(&table)?;
    let table_column = resolve_table_column(&table_view, column.key())?;
    let filter = table_filter(&table.sheet(), &table_view)?;
    let criteria =
        office_criteria_for_column(&table.sheet(), &table_view, table_column.index, &filter)?;
    let requested: Vec<&str> = if properties.is_empty() {
        vec!["criteria"]
    } else {
        properties.iter().map(String::as_str).collect()
    };
    let mut result = HashMap::new();
    for property in requested {
        match property {
            "criteria" => {
                result.insert("criteria".to_string(), criteria.clone());
            }
            other => {
                return Err(TableFilterError::invalid(format!(
                    "Filter.{other} is not supported by this Office.js host"
                )));
            }
        }
    }
    Ok(result)
}

fn resolve_table(table: &TableRef) -> Result<TableView, TableFilterError> {
    let properties = table
        .load(&["id".to_string()])
        .map_err(TableFilterError::from)?;
    let id = properties
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| TableFilterError::general("The table did not return its stable ID"))?;
    let serialized = table
        .sheet()
        .tables()
        .get_all()
        .map_err(TableFilterError::from)?
        .into_iter()
        .find_map(|candidate| {
            let value = serde_json::to_value(candidate).ok()?;
            (value.get("id").and_then(Value::as_str) == Some(id)).then_some(value)
        })
        .ok_or_else(|| {
            TableFilterError::item_not_found(format!("The table '{id}' no longer exists"))
        })?;
    serde_json::from_value(serialized).map_err(|error| {
        TableFilterError::general(format!("Failed to decode table state: {error}"))
    })
}

fn resolve_table_column<'a>(
    table: &'a TableView,
    key: &str,
) -> Result<&'a TableColumnView, TableFilterError> {
    if let Some(column) = table.columns.iter().find(|column| column.id == key) {
        return Ok(column);
    }
    if let Ok(index) = key.parse::<u32>()
        && let Some(column) = table.columns.iter().find(|column| column.index == index)
    {
        return Ok(column);
    }
    table
        .columns
        .iter()
        .find(|column| column.name.eq_ignore_ascii_case(key))
        .ok_or_else(|| {
            TableFilterError::item_not_found(format!("The table column '{key}' no longer exists"))
        })
}

fn data_body_bounds(table: &TableView) -> Option<(u32, u32, u32, u32)> {
    let start_row = table
        .range
        .start_row
        .checked_add(u32::from(table.has_header_row))?;
    let end_row = table
        .range
        .end_row
        .checked_sub(u32::from(table.has_totals_row))?;
    (start_row <= end_row).then_some((
        start_row,
        table.range.start_col,
        end_row,
        table.range.end_col,
    ))
}

fn sort_snapshot_from_request(
    table: &TableView,
    request: &TableSortRequest,
) -> Result<TableSortSnapshot, TableFilterError> {
    let fields = request.fields.as_array().ok_or_else(|| {
        TableFilterError::invalid("Table.sort.apply fields must be an array of SortField objects")
    })?;
    if fields.is_empty() {
        return Err(TableFilterError::invalid(
            "Table.sort.apply fields must contain at least one SortField",
        ));
    }
    let method = request
        .method
        .clone()
        .unwrap_or_else(|| "PinYin".to_string());
    if request.method.is_some() {
        validate_sort_method(&method)?;
    }
    let width = table
        .range
        .end_col
        .checked_sub(table.range.start_col)
        .and_then(|span| span.checked_add(1))
        .ok_or_else(|| TableFilterError::invalid("Table range has invalid column bounds"))?;
    for (index, field) in fields.iter().enumerate() {
        validate_table_sort_field(field, index, width)?;
    }
    Ok(TableSortSnapshot {
        fields: fields.clone(),
        match_case: request.match_case.unwrap_or(false),
        method,
    })
}

fn validate_sort_method(method: &str) -> Result<(), TableFilterError> {
    match method {
        // The bridge sorter uses the workbook's normal locale ordering. The
        // CJK method is retained in the Office descriptor but is not
        // silently treated as a different comparator.
        "PinYin" | "StrokeCount" => Err(TableFilterError::unsupported(format!(
            "Table.sort.apply method '{method}' is not supported by the compute engine"
        ))),
        other => Err(TableFilterError::invalid(format!(
            "Unsupported SortMethod '{other}'"
        ))),
    }
}

fn validate_table_sort_field(
    field: &Value,
    field_index: usize,
    width: u32,
) -> Result<(), TableFilterError> {
    let object = field.as_object().ok_or_else(|| {
        TableFilterError::invalid(format!(
            "Table.sort.apply fields[{field_index}] must be a SortField object"
        ))
    })?;
    let key = required_u32(object, "key", &format!("fields[{field_index}]"))?;
    if key >= width {
        return Err(TableFilterError::invalid(format!(
            "Table.sort.apply fields[{field_index}].key {key} is outside the table's {width} columns"
        )));
    }
    if let Some(ascending) = object.get("ascending")
        && !ascending.is_null()
        && !ascending.is_boolean()
    {
        return Err(TableFilterError::invalid(format!(
            "fields[{field_index}].ascending must be a boolean"
        )));
    }
    let sort_on = optional_string(object, "sortOn")?.unwrap_or_else(|| "Value".to_string());
    match sort_on.as_str() {
        "Value" | "CellColor" | "FontColor" | "Icon" => {}
        other => {
            return Err(TableFilterError::invalid(format!(
                "Unsupported SortOn '{other}'"
            )));
        }
    }
    if let Some(data_option) = optional_string(object, "dataOption")? {
        match data_option.as_str() {
            "Normal" => {}
            "TextAsNumber" => {
                return Err(TableFilterError::unsupported(
                    "SortDataOption 'TextAsNumber' is not supported by the compute engine",
                ));
            }
            other => {
                return Err(TableFilterError::invalid(format!(
                    "Unsupported SortDataOption '{other}'"
                )));
            }
        }
    }
    if let Some(sub_field) = object.get("subField")
        && !sub_field.is_null()
    {
        return Err(TableFilterError::unsupported(
            "SortField.subField is not supported by the compute engine",
        ));
    }
    match sort_on.as_str() {
        "CellColor" | "FontColor" => {
            let color = required_string(object, "color", &format!("fields[{field_index}]"))?;
            if !is_engine_color_token(&color) {
                return Err(TableFilterError::invalid(format!(
                    "fields[{field_index}].color must be a valid color string"
                )));
            }
        }
        "Icon" => {
            return Err(TableFilterError::unsupported(
                "SortOn 'Icon' requires conditional-format icon context and is not supported by the compute engine",
            ));
        }
        _ => {}
    }
    Ok(())
}

fn sort_snapshot_from_table(table: &TableView) -> Result<TableSortSnapshot, TableFilterError> {
    let Some(state) = table.sort_state.as_ref() else {
        return Ok(TableSortSnapshot {
            fields: Vec::new(),
            match_case: false,
            method: "PinYin".to_string(),
        });
    };
    let method = match state.sort_method.as_str() {
        "stroke" | "Stroke" | "StrokeCount" => "StrokeCount",
        "pinYin" | "PinYin" => "PinYin",
        // OOXML's none is the absence of a CJK override. Office's public
        // SortMethod enum has no None; PinYin is the host's stable default.
        "" | "none" | "None" => "PinYin",
        other => {
            return Err(TableFilterError::unsupported(format!(
                "Stored table sort method '{other}' is unsupported"
            )));
        }
    }
    .to_string();
    let mut fields = Vec::with_capacity(state.conditions.len());
    for (index, condition) in state.conditions.iter().enumerate() {
        let (start_row, start_col, _, end_col) = CellRange::from(condition.ref_range.as_str())
            .resolve()
            .map_err(TableFilterError::from)?;
        let table_width = table
            .range
            .end_col
            .checked_sub(table.range.start_col)
            .and_then(|span| span.checked_add(1))
            .ok_or_else(|| TableFilterError::invalid("Table range has invalid columns"))?;
        let table_end_col = table
            .range
            .start_col
            .checked_add(table_width - 1)
            .ok_or_else(|| TableFilterError::invalid("Table range exceeds worksheet bounds"))?;
        if start_col < table.range.start_col || start_col > table_end_col {
            return Err(TableFilterError::unsupported(format!(
                "Stored table sort condition {index} is outside the table"
            )));
        }
        if end_col < start_col || start_row > table.range.end_row {
            return Err(TableFilterError::unsupported(format!(
                "Stored table sort condition {index} has an invalid range"
            )));
        }
        let key = start_col - table.range.start_col;
        let sort_on = match condition.sort_by.as_str() {
            "value" | "Value" | "" => "Value",
            "cellColor" | "CellColor" => "CellColor",
            "fontColor" | "FontColor" => "FontColor",
            "icon" | "Icon" => "Icon",
            other => {
                return Err(TableFilterError::unsupported(format!(
                    "Stored table sort condition kind '{other}' is unsupported"
                )));
            }
        };
        let mut field = Map::new();
        field.insert("key".to_string(), json!(key));
        field.insert("ascending".to_string(), json!(!condition.descending));
        field.insert("sortOn".to_string(), json!(sort_on));
        if let Some(color) = condition.color.as_ref() {
            field.insert("color".to_string(), Value::String(color.clone()));
        }
        if sort_on == "Icon"
            && let (Some(set), Some(icon_id)) = (condition.icon_set.as_ref(), condition.icon_id)
        {
            field.insert("icon".to_string(), json!({"set": set, "index": icon_id}));
        }
        fields.push(Value::Object(field));
    }
    Ok(TableSortSnapshot {
        fields,
        match_case: state.case_sensitive,
        method,
    })
}

fn table_filter(sheet: &Sheet, table: &TableView) -> Result<FilterView, TableFilterError> {
    let states = sheet.filters().get_all().map_err(TableFilterError::from)?;
    let value = serde_json::to_value(states).map_err(|error| {
        TableFilterError::general(format!("Failed to encode table filter state: {error}"))
    })?;
    let records: Vec<FilterView> = serde_json::from_value(value).map_err(|error| {
        TableFilterError::general(format!("Failed to decode table filter state: {error}"))
    })?;
    records
        .into_iter()
        .find(|record| record.table_id.as_deref() == Some(table.id.as_str()))
        .ok_or_else(|| {
            TableFilterError::item_not_found(format!(
                "The table '{}' has no table filter",
                table.name
            ))
        })
}

fn ensure_table_filter(sheet: &Sheet, table: &TableView) -> Result<FilterView, TableFilterError> {
    match table_filter(sheet, table) {
        Ok(filter) => Ok(filter),
        Err(error) if error.code == "ItemNotFound" => {
            let data_end_row = table
                .range
                .end_row
                .checked_sub(u32::from(table.has_totals_row))
                .unwrap_or(table.range.start_row);
            let result = sheet
                .filters()
                .create(json!({
                    "startRow": table.range.start_row,
                    "startCol": table.range.start_col,
                    "endRow": data_end_row,
                    "endCol": table.range.end_col,
                    "filterType": "tableFilter",
                    "tableId": table.id,
                }))
                .map_err(TableFilterError::from)?;
            let id = result
                .data
                .as_ref()
                .and_then(|data| data.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    TableFilterError::general(
                        "The compute engine did not return the created table filter ID",
                    )
                })?
                .to_string();
            table_filter(sheet, table).or_else(|_| {
                Ok(FilterView {
                    id,
                    filter_type: "tableFilter".to_string(),
                    table_id: Some(table.id.clone()),
                    column_filters: HashMap::new(),
                })
            })
        }
        Err(error) => Err(error),
    }
}

fn office_criteria_for_column(
    sheet: &Sheet,
    table: &TableView,
    column_index: u32,
    filter: &FilterView,
) -> Result<Value, TableFilterError> {
    let absolute_column = table
        .range
        .start_col
        .checked_add(column_index)
        .ok_or_else(|| TableFilterError::invalid("Table column exceeds worksheet bounds"))?;
    let header_cell_id = sheet
        .get_cell_data((table.range.start_row, absolute_column))
        .map_err(TableFilterError::from)?
        .and_then(|data| {
            data.get("cell_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
    let Some(header_cell_id) = header_cell_id else {
        return Err(TableFilterError::unsupported(
            "The table filter header cell has no resolvable identity",
        ));
    };
    let Some(stored) = filter.column_filters.get(&header_cell_id) else {
        // Office returns a valid FilterCriteria-shaped value for an unfiltered
        // table column. An empty Values selection is the stable projection
        // and keeps criteria.filterOn readable by clients.
        return Ok(json!({"filterOn":"Values", "values":[]}));
    };
    office_criteria_from_domain(stored)
}

fn parse_filter_criteria(criteria: &Value) -> Result<Value, TableFilterError> {
    let object = criteria.as_object().ok_or_else(|| {
        TableFilterError::invalid("Filter criteria must be a FilterCriteria object")
    })?;
    if let Some(sub_field) = object.get("subField")
        && !sub_field.is_null()
    {
        return Err(TableFilterError::unsupported(
            "FilterCriteria.subField is not supported by the compute engine",
        ));
    }
    let filter_on = object
        .get("filterOn")
        .and_then(Value::as_str)
        .ok_or_else(|| TableFilterError::invalid("FilterCriteria.filterOn is required"))?;
    match filter_on {
        "Values" => {
            let values = object
                .get("values")
                .and_then(Value::as_array)
                .ok_or_else(|| TableFilterError::invalid("Values filtering requires values[]"))?;
            for (index, value) in values.iter().enumerate() {
                match value {
                    Value::String(_) | Value::Number(_) | Value::Bool(_) => {}
                    Value::Object(_) => {
                        return Err(TableFilterError::unsupported(format!(
                            "Values filter value at index {index} is a FilterDatetime/rich value, which the compute engine cannot evaluate"
                        )));
                    }
                    Value::Null | Value::Array(_) => {
                        return Err(TableFilterError::invalid(format!(
                            "Values filter value at index {index} must be a scalar"
                        )));
                    }
                }
            }
            Ok(json!({
                "type":"values",
                "values":values,
                "includeBlanks":false,
            }))
        }
        "Custom" => parse_custom_filter(object),
        "TopItems" | "BottomItems" | "TopPercent" | "BottomPercent" => {
            let count = parse_count(object.get("criterion1"), "criterion1")?;
            if filter_on.ends_with("Items") && count.fract() != 0.0 {
                return Err(TableFilterError::invalid(
                    "Top/bottom item count must be an integer",
                ));
            }
            if filter_on.ends_with("Percent") && count > 100.0 {
                return Err(TableFilterError::invalid(
                    "Top/bottom percent must be between 0 and 100",
                ));
            }
            Ok(json!({
                "type":"topBottom",
                "direction":if filter_on.starts_with("Top") { "top" } else { "bottom" },
                "count":count,
                "by":if filter_on.ends_with("Percent") { "percent" } else { "items" },
            }))
        }
        "Dynamic" => {
            let dynamic = object
                .get("dynamicCriteria")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    TableFilterError::invalid("Dynamic filtering requires dynamicCriteria")
                })?;
            Ok(json!({"type":"dynamic", "rule":dynamic_rule(dynamic)?}))
        }
        "CellColor" | "FontColor" => {
            let color = object
                .get("color")
                .and_then(Value::as_str)
                .filter(|color| !color.is_empty())
                .ok_or_else(|| TableFilterError::invalid("Color filtering requires color"))?;
            if Color::from_hex(color).is_err() {
                return Err(TableFilterError::invalid(
                    "Color filtering requires a hexadecimal color string",
                ));
            }
            Ok(json!({
                "type":"color",
                "color":color,
                "byFont":filter_on == "FontColor",
            }))
        }
        "Icon" => Err(TableFilterError::unsupported(
            "FilterOn 'Icon' requires conditional-format icon context and is not supported by the compute engine",
        )),
        other => Err(TableFilterError::invalid(format!(
            "Unsupported FilterOn '{other}'"
        ))),
    }
}

fn parse_custom_filter(object: &Map<String, Value>) -> Result<Value, TableFilterError> {
    let criterion1 = object
        .get("criterion1")
        .and_then(Value::as_str)
        .ok_or_else(|| TableFilterError::invalid("Custom filtering requires criterion1"))?;
    let criterion2 = match object.get("criterion2") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_str().ok_or_else(|| {
            TableFilterError::invalid("Custom filtering criterion2 must be a string")
        })?),
    };
    let logic = match object.get("operator") {
        None | Some(Value::Null) => "and",
        Some(Value::String(value)) if value == "And" => "and",
        Some(Value::String(value)) if value == "Or" => "or",
        Some(Value::String(value)) => {
            return Err(TableFilterError::invalid(format!(
                "Unsupported FilterOperator '{value}'"
            )));
        }
        Some(_) => {
            return Err(TableFilterError::invalid(
                "FilterCriteria.operator must be 'And' or 'Or'",
            ));
        }
    };
    let first = parse_condition(criterion1)?;
    let second = criterion2.map(parse_condition).transpose()?;
    let mut conditions = vec![first];
    if let Some(second) = second {
        conditions.push(second);
    }
    Ok(json!({
        "type":"condition",
        "conditions":conditions,
        "logic":logic,
    }))
}

fn parse_condition(raw: &str) -> Result<Value, TableFilterError> {
    let (operator, operand) = if let Some(rest) = raw.strip_prefix(">=") {
        ("greaterThanOrEqual", rest)
    } else if let Some(rest) = raw.strip_prefix("<=") {
        ("lessThanOrEqual", rest)
    } else if let Some(rest) = raw.strip_prefix("<>") {
        ("notEquals", rest)
    } else if let Some(rest) = raw.strip_prefix('>') {
        ("greaterThan", rest)
    } else if let Some(rest) = raw.strip_prefix('<') {
        ("lessThan", rest)
    } else if let Some(rest) = raw.strip_prefix('=') {
        ("equals", rest)
    } else {
        ("equals", raw)
    };
    let (operator, operand) = wildcard_condition(operator, operand)?;
    if operand.is_empty() {
        return match operator {
            "equals" => Ok(json!({"operator":"isBlank"})),
            "notEquals" => Ok(json!({"operator":"isNotBlank"})),
            other => Err(TableFilterError::invalid(format!(
                "Custom filter operator '{other}' requires a criterion value"
            ))),
        };
    }
    Ok(json!({"operator":operator, "value":parse_operand(operand)}))
}

fn wildcard_condition<'a>(
    operator: &'static str,
    operand: &'a str,
) -> Result<(&'static str, &'a str), TableFilterError> {
    let has_wildcard = operand.contains('*') || operand.contains('?');
    if !has_wildcard {
        return Ok((operator, operand));
    }
    if operand.contains('?') {
        return Err(TableFilterError::unsupported(
            "Custom filter wildcard '?' is not supported by the compute engine",
        ));
    }
    if operator != "equals" && operator != "notEquals" {
        return Err(TableFilterError::unsupported(
            "Custom filter wildcards are supported only with equals/notEquals",
        ));
    }
    let leading = operand.starts_with('*');
    let trailing = operand.ends_with('*');
    let core = match (leading, trailing) {
        (true, true) => &operand[1..operand.len() - 1],
        (true, false) => &operand[1..],
        (false, true) => &operand[..operand.len() - 1],
        (false, false) => operand,
    };
    if core.contains('*') || core.contains('~') {
        return Err(TableFilterError::unsupported(
            "Custom filter wildcard patterns with interior escapes are not supported by the compute engine",
        ));
    }
    if operator == "notEquals" && (leading != trailing) {
        return Err(TableFilterError::unsupported(
            "Custom filter exclusion wildcards are supported only for contains/notContains patterns",
        ));
    }
    let mapped = match (operator, leading, trailing) {
        ("equals", true, true) => "contains",
        ("notEquals", true, true) => "notContains",
        ("equals", true, false) => "endsWith",
        ("equals", false, true) => "beginsWith",
        _ => operator,
    };
    Ok((mapped, core))
}

fn parse_operand(operand: &str) -> Value {
    if operand.eq_ignore_ascii_case("TRUE") {
        return Value::Bool(true);
    }
    if operand.eq_ignore_ascii_case("FALSE") {
        return Value::Bool(false);
    }
    if let Ok(number) = operand.parse::<f64>()
        && number.is_finite()
    {
        return json!(number);
    }
    Value::String(operand.to_string())
}

fn parse_count(value: Option<&Value>, name: &str) -> Result<f64, TableFilterError> {
    let value = value.ok_or_else(|| TableFilterError::invalid(format!("{name} is required")))?;
    let number = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|number| number.is_finite() && *number >= 0.0)
    .ok_or_else(|| {
        TableFilterError::invalid(format!("{name} must be a finite non-negative number"))
    })?;
    Ok(number)
}

fn dynamic_rule(value: &str) -> Result<&'static str, TableFilterError> {
    let rule = match value {
        "AboveAverage" => "aboveAverage",
        "BelowAverage" => "belowAverage",
        "Today" => "today",
        "Yesterday" => "yesterday",
        "Tomorrow" => "tomorrow",
        "ThisWeek" => "thisWeek",
        "LastWeek" => "lastWeek",
        "NextWeek" => "nextWeek",
        "ThisMonth" => "thisMonth",
        "LastMonth" => "lastMonth",
        "NextMonth" => "nextMonth",
        "ThisQuarter" => "thisQuarter",
        "LastQuarter" => "lastQuarter",
        "NextQuarter" => "nextQuarter",
        "ThisYear" => "thisYear",
        "LastYear" => "lastYear",
        "NextYear" => "nextYear",
        other => {
            return Err(TableFilterError::unsupported(format!(
                "DynamicFilterCriteria '{other}' is not supported by the compute engine"
            )));
        }
    };
    Ok(rule)
}

fn office_criteria_from_domain(value: &Value) -> Result<Value, TableFilterError> {
    let object = value
        .as_object()
        .ok_or_else(|| TableFilterError::general("Stored table criterion is not an object"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| TableFilterError::general("Stored table criterion has no type"))?;
    match kind {
        "values" => Ok(json!({
            "filterOn":"Values",
            "values":object.get("values").cloned().unwrap_or_else(|| json!([])),
        })),
        "condition" => domain_condition_to_office(object),
        "topBottom" => {
            let direction = object
                .get("direction")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    TableFilterError::general("Stored top/bottom criterion has no direction")
                })?;
            let by = object.get("by").and_then(Value::as_str).ok_or_else(|| {
                TableFilterError::general("Stored top/bottom criterion has no basis")
            })?;
            let count = object
                .get("count")
                .map(value_to_criterion_text)
                .unwrap_or_default();
            let filter_on = match (direction, by) {
                ("top", "items") => "TopItems",
                ("bottom", "items") => "BottomItems",
                ("top", "percent") => "TopPercent",
                ("bottom", "percent") => "BottomPercent",
                _ => {
                    return Err(TableFilterError::unsupported(
                        "Stored top/bottom filter basis is not supported by Office.js",
                    ));
                }
            };
            Ok(json!({"filterOn":filter_on,"criterion1":count}))
        }
        "dynamic" => {
            let rule = object
                .get("rule")
                .and_then(Value::as_str)
                .ok_or_else(|| TableFilterError::general("Stored dynamic criterion has no rule"))?;
            Ok(json!({
                "filterOn":"Dynamic",
                "dynamicCriteria":dynamic_rule_to_office(rule)?,
            }))
        }
        "color" => {
            let color = object
                .get("color")
                .and_then(Value::as_str)
                .ok_or_else(|| TableFilterError::general("Stored color criterion has no color"))?;
            let by_font = object
                .get("byFont")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(json!({
                "filterOn":if by_font { "FontColor" } else { "CellColor" },
                "color":color,
            }))
        }
        "icon" => Err(TableFilterError::unsupported(
            "Stored icon filter criteria cannot be evaluated by the compute engine",
        )),
        other => Err(TableFilterError::unsupported(format!(
            "Stored table criterion type '{other}' is unsupported"
        ))),
    }
}

fn domain_condition_to_office(object: &Map<String, Value>) -> Result<Value, TableFilterError> {
    let conditions = object
        .get("conditions")
        .and_then(Value::as_array)
        .ok_or_else(|| TableFilterError::general("Stored condition criterion has no conditions"))?;
    if conditions.is_empty() || conditions.len() > 2 {
        return Err(TableFilterError::unsupported(
            "Stored table condition count cannot be represented by Office.js",
        ));
    }
    let logic = match object.get("logic").and_then(Value::as_str) {
        Some("or") => "Or",
        _ => "And",
    };
    let first =
        condition_to_office(conditions[0].as_object().ok_or_else(|| {
            TableFilterError::general("Stored table condition is not an object")
        })?)?;
    let second = if conditions.len() == 2 {
        Some(condition_to_office(conditions[1].as_object().ok_or_else(
            || TableFilterError::general("Stored table condition is not an object"),
        )?)?)
    } else {
        None
    };
    let mut result = Map::new();
    result.insert("filterOn".to_string(), Value::String("Custom".to_string()));
    result.insert("criterion1".to_string(), Value::String(first));
    if let Some(second) = second {
        result.insert("criterion2".to_string(), Value::String(second));
        result.insert("operator".to_string(), Value::String(logic.to_string()));
    }
    Ok(Value::Object(result))
}

fn condition_to_office(object: &Map<String, Value>) -> Result<String, TableFilterError> {
    let operator = object
        .get("operator")
        .and_then(Value::as_str)
        .ok_or_else(|| TableFilterError::general("Stored table condition has no operator"))?;
    if matches!(operator, "isBlank" | "isNotBlank") {
        return Ok(if operator == "isBlank" {
            "=".to_string()
        } else {
            "<>".to_string()
        });
    }
    let value = object.get("value").cloned().unwrap_or(Value::Null);
    let text = value_to_criterion_text(&value);
    let prefix = match operator {
        "equals" => "=",
        "notEquals" => "<>",
        "greaterThan" => ">",
        "greaterThanOrEqual" => ">=",
        "lessThan" => "<",
        "lessThanOrEqual" => "<=",
        "beginsWith" | "endsWith" | "contains" => "=",
        "notContains" => "<>",
        other => {
            return Err(TableFilterError::unsupported(format!(
                "Stored table condition operator '{other}' cannot be represented"
            )));
        }
    };
    let wildcard = match operator {
        "beginsWith" => format!("{text}*"),
        "endsWith" => format!("*{text}"),
        "contains" | "notContains" => format!("*{text}*"),
        _ => text,
    };
    Ok(format!("{prefix}{wildcard}"))
}

fn value_to_criterion_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(value) => {
            let number = value.as_f64().unwrap_or(0.0);
            if number == 0.0 {
                "0".to_string()
            } else if number.is_finite() && number.fract() == 0.0 && number.abs() < 1e21 {
                format!("{number:.0}")
            } else {
                value.to_string()
            }
        }
        other => other.to_string(),
    }
}

fn dynamic_rule_to_office(rule: &str) -> Result<&'static str, TableFilterError> {
    let office = match rule {
        "aboveAverage" => "AboveAverage",
        "belowAverage" => "BelowAverage",
        "today" => "Today",
        "yesterday" => "Yesterday",
        "tomorrow" => "Tomorrow",
        "thisWeek" => "ThisWeek",
        "lastWeek" => "LastWeek",
        "nextWeek" => "NextWeek",
        "thisMonth" => "ThisMonth",
        "lastMonth" => "LastMonth",
        "nextMonth" => "NextMonth",
        "thisQuarter" => "ThisQuarter",
        "lastQuarter" => "LastQuarter",
        "nextQuarter" => "NextQuarter",
        "thisYear" => "ThisYear",
        "lastYear" => "LastYear",
        "nextYear" => "NextYear",
        other => {
            return Err(TableFilterError::unsupported(format!(
                "Stored dynamic filter rule '{other}' is unsupported"
            )));
        }
    };
    Ok(office)
}

fn required_u32(
    object: &Map<String, Value>,
    name: &str,
    location: &str,
) -> Result<u32, TableFilterError> {
    let value = object
        .get(name)
        .ok_or_else(|| TableFilterError::invalid(format!("{location}.{name} is required")))?;
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            TableFilterError::invalid(format!("{location}.{name} must be a non-negative integer"))
        })
}

fn required_string(
    object: &Map<String, Value>,
    name: &str,
    location: &str,
) -> Result<String, TableFilterError> {
    let value = object
        .get(name)
        .ok_or_else(|| TableFilterError::invalid(format!("{location}.{name} is required")))?;
    let string = value
        .as_str()
        .ok_or_else(|| TableFilterError::invalid(format!("{location}.{name} must be a string")))?;
    if string.is_empty() {
        return Err(TableFilterError::invalid(format!(
            "{location}.{name} must not be empty"
        )));
    }
    Ok(string.to_string())
}

fn optional_string(
    object: &Map<String, Value>,
    name: &str,
) -> Result<Option<String>, TableFilterError> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(ToOwned::to_owned)
            .map(Some)
            .ok_or_else(|| TableFilterError::invalid(format!("{name} must be a string"))),
    }
}

fn is_engine_color_token(color: &str) -> bool {
    Color::from_hex(color).is_ok()
        || color.starts_with("theme:")
        || color.starts_with("rgb(")
        || color.starts_with("rgba(")
}

fn a1_range(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    let start = format!("{}{}", column_name(start_col), start_row + 1);
    let end = format!("{}{}", column_name(end_col), end_row + 1);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_table_values_filter_into_domain_shape() {
        assert_eq!(
            parse_filter_criteria(&json!({
                "filterOn":"Values",
                "values":["Open", "Closed"]
            }))
            .unwrap(),
            json!({
                "type":"values",
                "values":["Open", "Closed"],
                "includeBlanks":false
            })
        );
    }

    #[test]
    fn parses_custom_filter_wildcards_and_numbers() {
        assert_eq!(
            parse_filter_criteria(&json!({
                "filterOn":"Custom",
                "criterion1":">=10",
                "criterion2":"<=20",
                "operator":"And"
            }))
            .unwrap(),
            json!({
                "type":"condition",
                "conditions":[
                    {"operator":"greaterThanOrEqual", "value":10.0},
                    {"operator":"lessThanOrEqual", "value":20.0}
                ],
                "logic":"and"
            })
        );
        assert_eq!(
            parse_filter_criteria(&json!({
                "filterOn":"Custom",
                "criterion1":"=*needle*"
            }))
            .unwrap(),
            json!({
                "type":"condition",
                "conditions":[{"operator":"contains", "value":"needle"}],
                "logic":"and"
            })
        );
    }

    #[test]
    fn rejects_unsupported_date_icon_and_dynamic_shapes_explicitly() {
        let date = parse_filter_criteria(&json!({
            "filterOn":"Values",
            "values":[{"date":"2024-01-01", "specificity":"Day"}]
        }))
        .unwrap_err();
        assert_eq!(date.code, "UnsupportedOperation");

        let icon = parse_filter_criteria(&json!({
            "filterOn":"Icon",
            "icon":{"set":"ThreeArrows", "index":0}
        }))
        .unwrap_err();
        assert_eq!(icon.code, "UnsupportedOperation");

        let dynamic = parse_filter_criteria(&json!({
            "filterOn":"Dynamic",
            "dynamicCriteria":"AllDatesInPeriodJanuary"
        }))
        .unwrap_err();
        assert_eq!(dynamic.code, "UnsupportedOperation");
    }
}
