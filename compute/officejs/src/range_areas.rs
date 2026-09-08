//! Office.js discontiguous range geometry and collection helpers.
//!
//! A range-area object is represented by its rectangular references. This
//! keeps whole-sheet references bounded in the representation and gives
//! result-producing APIs (such as data validation) one reusable constructor.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use compute_api::{CellAddress, CellRange, CellValue, ComputeApiError, Sheet};
use serde::Serialize;
use serde_json::{Map, Value, json};

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_content;
use crate::range_navigation::{RangeAddress, RangeNavigationError, parse_range_address};

/// Error returned by the RangeAreas host adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RangeAreasError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Host-side reference for a RangeAreas object.
#[derive(Clone)]
pub(crate) struct RangeAreasRef {
    sheet: Sheet,
    areas: Vec<RangeAddress>,
    is_null_object: bool,
}

/// Result type shared by result-producing Office.js families.
pub(crate) type RangeAreasResult = RangeAreasRef;

/// Collection descriptor consumed by the shared JavaScript collection
/// hydrator. key is an unqualified canonical A1 reference.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct RangeAreaItem {
    pub(crate) key: String,
    pub(crate) properties: Map<String, Value>,
}

impl RangeAreasRef {
    /// Parse a worksheet getRanges address. None represents one whole-sheet
    /// area. Commas and semicolons delimit areas, except inside quoted sheet
    /// names.
    pub(crate) fn from_address(sheet: Sheet, raw: Option<&str>) -> Result<Self, RangeAreasError> {
        let Some(raw) = raw else {
            return Ok(Self {
                sheet,
                areas: vec![RangeAddress::WholeSheet],
                is_null_object: false,
            });
        };

        let pieces = split_area_references(raw);
        if pieces.is_empty() {
            return Err(invalid("RangeAreas address must contain at least one area"));
        }

        let mut areas = Vec::with_capacity(pieces.len());
        for piece in pieces {
            let piece = piece.trim();
            if piece.is_empty() {
                return Err(invalid(format!(
                    "Invalid RangeAreas address '{raw}': empty area"
                )));
            }
            areas.push(
                parse_range_address(&sheet, piece)
                    .map_err(|error| map_navigation_error(error, piece))?,
            );
        }
        Ok(Self {
            sheet,
            areas,
            is_null_object: false,
        })
    }

    /// Parse a list of one-rectangle references into a RangeAreas object.
    pub(crate) fn from_addresses<I, S>(sheet: Sheet, addresses: I) -> Result<Self, RangeAreasError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut areas = Vec::new();
        for address in addresses {
            let address = address.as_ref();
            if address.trim().is_empty() {
                return Err(invalid("RangeAreas address cannot contain an empty area"));
            }
            if split_area_references(address).len() != 1 {
                return Err(invalid(format!(
                    "RangeAreas area '{address}' contains multiple references"
                )));
            }
            areas.push(
                parse_range_address(&sheet, address)
                    .map_err(|error| map_navigation_error(error, address))?,
            );
        }
        if areas.is_empty() {
            return Err(item_not_found("RangeAreas contains no areas"));
        }
        Ok(Self {
            sheet,
            areas,
            is_null_object: false,
        })
    }

    /// Construct a null result for an OrNullObject operation.
    pub(crate) fn null(sheet: Sheet) -> Self {
        Self {
            sheet,
            areas: Vec::new(),
            is_null_object: true,
        }
    }

    /// Construct a result from cell coordinates, compressing adjacent cells
    /// into rectangles. Empty input is ItemNotFound; callers implementing an
    /// OrNullObject operation can use null for that case.
    pub(crate) fn from_cells<I>(sheet: Sheet, cells: I) -> Result<RangeAreasResult, RangeAreasError>
    where
        I: IntoIterator<Item = (u32, u32)>,
    {
        let mut cells: Vec<(u32, u32)> = cells.into_iter().collect();
        if cells.is_empty() {
            return Err(item_not_found("No cells matched the RangeAreas result"));
        }
        if cells
            .iter()
            .any(|(row, column)| *row >= EXCEL_MAX_ROWS || *column >= EXCEL_MAX_COLUMNS)
        {
            return Err(invalid(
                "RangeAreas cell coordinates exceed the worksheet grid",
            ));
        }
        cells.sort_unstable();
        cells.dedup();

        let mut row_runs = Vec::<CellRun>::new();
        let mut index = 0usize;
        while index < cells.len() {
            let row = cells[index].0;
            let mut start_column = cells[index].1;
            let mut end_column = start_column;
            index += 1;
            while index < cells.len() && cells[index].0 == row {
                let column = cells[index].1;
                if column == end_column.saturating_add(1) {
                    end_column = column;
                } else {
                    row_runs.push(CellRun {
                        start_row: row,
                        end_row: row,
                        start_column,
                        end_column,
                    });
                    start_column = column;
                    end_column = column;
                }
                index += 1;
            }
            row_runs.push(CellRun {
                start_row: row,
                end_row: row,
                start_column,
                end_column,
            });
        }

        // A run can merge only with one of the same width in the immediately
        // preceding row. This is rectangle-level state, never cell-level
        // materialization.
        let mut rectangles = Vec::<CellRun>::new();
        let mut active = HashMap::<(u32, u32), usize>::new();
        let mut row_index = 0usize;
        while row_index < row_runs.len() {
            let row = row_runs[row_index].start_row;
            let mut next_active = HashMap::<(u32, u32), usize>::new();
            while row_index < row_runs.len() && row_runs[row_index].start_row == row {
                let run = row_runs[row_index];
                let key = (run.start_column, run.end_column);
                let rectangle_index = if let Some(rectangle_index) = active.get(&key).copied()
                    && rectangles[rectangle_index].end_row.saturating_add(1) == run.start_row
                {
                    rectangles[rectangle_index].end_row = run.end_row;
                    rectangle_index
                } else {
                    let rectangle_index = rectangles.len();
                    rectangles.push(run);
                    rectangle_index
                };
                next_active.insert(key, rectangle_index);
                row_index += 1;
            }
            active = next_active;
        }

        let areas = rectangles
            .into_iter()
            .map(|run| {
                let text = format_bounds(
                    run.start_row,
                    run.start_column,
                    run.end_row,
                    run.end_column,
                    false,
                    false,
                );
                RangeAddress::parse(&text).map_err(|error| map_navigation_error(error, &text))
            })
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Self {
            sheet,
            areas,
            is_null_object: false,
        })
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.is_null_object
    }

    /// Return unqualified canonical area addresses in first-seen order.
    pub(crate) fn addresses(&self) -> Result<Vec<String>, RangeAreasError> {
        self.ensure_live()?;
        Ok(self.areas.iter().map(RangeAddress::to_a1).collect())
    }

    pub(crate) fn area_at(&self, index: usize) -> Result<String, RangeAreasError> {
        self.ensure_live()?;
        self.areas
            .get(index)
            .map(RangeAddress::to_a1)
            .ok_or_else(|| item_not_found(format!("RangeCollection index {index} is out of range")))
    }

    pub(crate) fn area_count(&self) -> Result<usize, RangeAreasError> {
        self.ensure_live()?;
        Ok(self.areas.len())
    }

    /// Return the canonical qualified address used by RangeAreas.address.
    pub(crate) fn canonical_address(&self) -> Result<String, RangeAreasError> {
        self.address()
    }

    /// Return scalar metadata for a RangeAreas.load request.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, RangeAreasError> {
        self.ensure_live()?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "address" | "addressLocal" => Value::String(self.address()?),
                "areaCount" => json!(self.areas.len()),
                "cellCount" => json!(self.cell_count()),
                "isEntireColumn" => json!(self.all_entire_columns()),
                "isEntireRow" => json!(self.all_entire_rows()),
                "isNullObject" => Value::Bool(false),
                other => return Err(unsupported_load_property("RangeAreas", other)),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Return descriptors for RangeAreas.areas / RangeCollection.items.
    /// properties contains item names after stripping the items/ prefix.
    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<RangeAreaItem>, RangeAreasError> {
        self.ensure_live()?;
        let item_properties = properties
            .iter()
            .filter_map(|property| {
                if property == "items" {
                    None
                } else {
                    Some(
                        property
                            .strip_prefix("items/")
                            .unwrap_or(property)
                            .to_string(),
                    )
                }
            })
            .collect::<Vec<_>>();
        self.validate_item_properties(&item_properties)?;
        self.areas
            .iter()
            .map(|area| self.item(area, &item_properties))
            .collect()
    }

    /// Load a `RangeCollection` projection for `RangeAreas.areas`.
    ///
    /// The collection is represented by the same typed range-area reference
    /// in the host binding, but its wire surface is deliberately kept
    /// separate from the parent scalar projection: collection loads accept
    /// `items` and `items/<Range property>` paths only.
    pub(crate) fn load_collection(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, RangeAreasError> {
        let mut item_properties = Vec::new();
        let mut wants_items = false;
        for property in properties {
            if property == "items" {
                wants_items = true;
            } else if let Some(item_property) = property.strip_prefix("items/") {
                if item_property.is_empty() {
                    return Err(unsupported_load_property("RangeCollection", property));
                }
                wants_items = true;
                if !item_properties
                    .iter()
                    .any(|existing| existing == item_property)
                {
                    item_properties.push(item_property.to_string());
                }
            } else if property == "isNullObject" {
                // The shared extension binding adds this property for every
                // live object. Keep it accepted here for collection-specific
                // handlers that project the property themselves.
            } else {
                return Err(unsupported_load_property("RangeCollection", property));
            }
        }

        let mut result = HashMap::new();
        if wants_items {
            result.insert(
                "items".to_string(),
                serde_json::to_value(self.collection_items(&item_properties)?).map_err(
                    |error| engine(format!("failed to encode RangeCollection items: {error}")),
                )?,
            );
        }
        Ok(result)
    }

    /// Clear every bounded area using an Office.js clear mode. Validate all
    /// shapes before the first engine mutation.
    pub(crate) fn clear(&self, apply_to: &str) -> Result<(), RangeAreasError> {
        self.ensure_live()?;
        self.ensure_bounded("RangeAreas.clear")?;
        for area in &self.areas {
            range_content::clear(&self.sheet, &area.to_a1(), apply_to).map_err(|error| {
                RangeAreasError {
                    code: error.code,
                    message: error.message,
                }
            })?;
        }
        Ok(())
    }

    /// Return rectangle intersections with another same-sheet collection.
    pub(crate) fn intersection(
        &self,
        other: &RangeAreasRef,
        or_null_object: bool,
    ) -> Result<RangeAreasResult, RangeAreasError> {
        self.ensure_live()?;
        other.ensure_live()?;
        if self.sheet.id() != other.sheet.id() {
            return Err(invalid(
                "RangeAreas arguments must belong to the same worksheet",
            ));
        }

        let mut intersections = Vec::new();
        let mut seen = HashSet::new();
        for left in &self.areas {
            for right in &other.areas {
                let (left_start_row, left_start_column, left_end_row, left_end_column) =
                    left.bounds();
                let (right_start_row, right_start_column, right_end_row, right_end_column) =
                    right.bounds();
                let start_row = left_start_row.max(right_start_row);
                let start_column = left_start_column.max(right_start_column);
                let end_row = left_end_row.min(right_end_row);
                let end_column = left_end_column.min(right_end_column);
                if start_row > end_row || start_column > end_column {
                    continue;
                }

                let rows_unbounded = (left.is_entire_row() || left.is_whole_sheet())
                    && (right.is_entire_row() || right.is_whole_sheet());
                let columns_unbounded = (left.is_entire_column() || left.is_whole_sheet())
                    && (right.is_entire_column() || right.is_whole_sheet());
                let text = format_bounds(
                    start_row,
                    start_column,
                    end_row,
                    end_column,
                    rows_unbounded,
                    columns_unbounded,
                );
                if seen.insert(text.clone()) {
                    intersections.push(
                        RangeAddress::parse(&text)
                            .map_err(|error| map_navigation_error(error, &text))?,
                    );
                }
            }
        }

        if intersections.is_empty() {
            if or_null_object {
                return Ok(Self::null(self.sheet.clone()));
            }
            return Err(item_not_found("The specified RangeAreas do not intersect"));
        }

        Ok(Self {
            sheet: self.sheet.clone(),
            areas: intersections,
            is_null_object: false,
        })
    }

    pub(crate) fn is_bounded(&self) -> Result<bool, RangeAreasError> {
        self.ensure_live()?;
        Ok(self.areas.iter().all(|area| {
            !area.is_whole_sheet() && !area.is_entire_row() && !area.is_entire_column()
        }))
    }

    fn address(&self) -> Result<String, RangeAreasError> {
        self.ensure_live()?;
        let name = self.sheet.name().map_err(engine)?;
        let qualified = qualified_sheet_name(&name);
        Ok(self
            .areas
            .iter()
            .map(|area| format!("{qualified}!{}", area.to_a1()))
            .collect::<Vec<_>>()
            .join(", "))
    }

    fn cell_count(&self) -> i64 {
        let mut total = 0u64;
        for area in &self.areas {
            let count = area.cell_count();
            if count < 0 {
                return -1;
            }
            total = match total.checked_add(count as u64) {
                Some(total) if total <= i32::MAX as u64 => total,
                _ => return -1,
            };
        }
        total as i64
    }

    fn all_entire_columns(&self) -> bool {
        !self.areas.is_empty()
            && self
                .areas
                .iter()
                .all(|area| area.is_entire_column() || area.is_whole_sheet())
    }

    fn all_entire_rows(&self) -> bool {
        !self.areas.is_empty()
            && self
                .areas
                .iter()
                .all(|area| area.is_entire_row() || area.is_whole_sheet())
    }

    fn item(
        &self,
        area: &RangeAddress,
        properties: &[String],
    ) -> Result<RangeAreaItem, RangeAreasError> {
        let mut item = Map::new();
        let (start_row, start_column, end_row, end_column) = area.bounds();
        let name = self.sheet.name().map_err(engine)?;
        let qualified_address = format!("{}!{}", qualified_sheet_name(&name), area.to_a1());
        let unbounded = area.is_whole_sheet() || area.is_entire_row() || area.is_entire_column();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "address" | "addressLocal" => Value::String(qualified_address.clone()),
                "rowIndex" => json!(start_row),
                "columnIndex" => json!(start_column),
                "rowCount" => json!(area.row_count()),
                "columnCount" => json!(area.column_count()),
                "cellCount" => json!(area.cell_count()),
                "values" => {
                    if unbounded {
                        Value::Null
                    } else {
                        range_values_json(&self.sheet, area.to_a1().as_str())?
                    }
                }
                "formulas" => {
                    if unbounded {
                        Value::Null
                    } else {
                        range_formulas_json(&self.sheet, area.to_a1().as_str())?
                    }
                }
                "numberFormat" | "text" | "valueTypes" => {
                    if unbounded {
                        Value::Null
                    } else {
                        range_content::load(
                            &self.sheet,
                            area.to_a1().as_str(),
                            std::slice::from_ref(property),
                        )
                        .map_err(|error| RangeAreasError {
                            code: error.code,
                            message: error.message,
                        })?
                        .get(property)
                        .cloned()
                        .unwrap_or(Value::Null)
                    }
                }
                other => return Err(unsupported_load_property("RangeCollection item", other)),
            };
            item.insert(property.clone(), value);
        }
        Ok(RangeAreaItem {
            key: area.to_a1(),
            properties: item,
        })
    }

    fn validate_item_properties(&self, properties: &[String]) -> Result<(), RangeAreasError> {
        for property in properties {
            match property.as_str() {
                "isNullObject" | "address" | "addressLocal" | "rowIndex" | "columnIndex"
                | "rowCount" | "columnCount" | "cellCount" | "values" | "formulas"
                | "numberFormat" | "text" | "valueTypes" => {}
                other => return Err(unsupported_load_property("RangeCollection item", other)),
            }
        }
        Ok(())
    }

    fn ensure_bounded(&self, method: &str) -> Result<(), RangeAreasError> {
        if self
            .areas
            .iter()
            .any(|area| area.is_whole_sheet() || area.is_entire_row() || area.is_entire_column())
        {
            return Err(invalid(format!("{method} requires bounded ranges")));
        }
        Ok(())
    }

    fn ensure_live(&self) -> Result<(), RangeAreasError> {
        if self.is_null_object {
            return Err(RangeAreasError {
                code: "InvalidObjectPath",
                message: "The RangeAreas object is a null object.".to_string(),
            });
        }
        Ok(())
    }
}

pub(crate) const EXCEL_MAX_ROWS: u32 = 1_048_576;
pub(crate) const EXCEL_MAX_COLUMNS: u32 = 16_384;

#[derive(Debug, Clone, Copy)]
struct CellRun {
    start_row: u32,
    end_row: u32,
    start_column: u32,
    end_column: u32,
}

fn range_values_json(sheet: &Sheet, address: &str) -> Result<Value, RangeAreasError> {
    let (start_row, start_column, end_row, end_column) = CellRange::from(address)
        .resolve()
        .map_err(map_compute_error)?;
    let values = sheet
        .get_range_values_2d(CellRange::Bounds(
            start_row,
            start_column,
            end_row,
            end_column,
        ))
        .map_err(engine)?;
    Ok(Value::Array(
        values
            .into_iter()
            .map(|row| Value::Array(row.into_iter().map(cell_to_js).collect()))
            .collect(),
    ))
}

fn range_formulas_json(sheet: &Sheet, address: &str) -> Result<Value, RangeAreasError> {
    let (start_row, start_column, end_row, end_column) = CellRange::from(address)
        .resolve()
        .map_err(map_compute_error)?;
    let mut rows = Vec::new();
    for row in start_row..=end_row {
        let mut cells = Vec::new();
        for column in start_column..=end_column {
            let cell = CellAddress::Position(row, column);
            if let Some(formula) = sheet.get_formula(cell.clone()).map_err(engine)? {
                cells.push(Value::String(formula));
            } else {
                cells.push(cell_to_js(sheet.get_cell_value(cell).map_err(engine)?));
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
        CellValue::Number(_) => value
            .as_number()
            .map(|number| json!(number))
            .unwrap_or(Value::Null),
        CellValue::Text(value) => Value::String(value.to_string()),
        CellValue::Error(error, _) => Value::String(error.to_string()),
        other => Value::String(other.to_string()),
    }
}

fn split_area_references(raw: &str) -> Vec<String> {
    let mut references = Vec::new();
    let mut start = 0usize;
    let mut in_quote = false;
    let bytes = raw.as_bytes();
    let mut index = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b'\'' => {
                if in_quote && bytes.get(index + 1) == Some(&b'\'') {
                    index += 1;
                } else {
                    in_quote = !in_quote;
                }
            }
            b',' | b';' if !in_quote => {
                references.push(raw[start..index].to_string());
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }
    references.push(raw[start..].to_string());
    references
        .into_iter()
        .map(|reference| reference.trim().to_string())
        .collect()
}

fn format_bounds(
    start_row: u32,
    start_column: u32,
    end_row: u32,
    end_column: u32,
    rows_unbounded: bool,
    columns_unbounded: bool,
) -> String {
    match (rows_unbounded, columns_unbounded) {
        (true, true) => format!("1:{EXCEL_MAX_ROWS}"),
        (true, false) => format!("{}:{}", column_name(start_column), column_name(end_column)),
        (false, true) => format!("{}:{}", start_row + 1, end_row + 1),
        (false, false) => {
            let start = cell_name(start_row, start_column);
            let end = cell_name(end_row, end_column);
            if start == end {
                start
            } else {
                format!("{start}:{end}")
            }
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

fn map_navigation_error(error: RangeNavigationError, address: &str) -> RangeAreasError {
    RangeAreasError {
        code: error.code,
        message: format!("RangeAreas address '{address}': {}", error.message),
    }
}

fn map_compute_error(error: ComputeApiError) -> RangeAreasError {
    match error {
        ComputeApiError::InvalidAddress { address, reason } => {
            invalid(format!("invalid address: {address} — {reason}"))
        }
        ComputeApiError::InvalidRange { range, reason } => {
            invalid(format!("invalid range: {range} — {reason}"))
        }
        other => engine(other),
    }
}

fn engine(error: impl std::fmt::Display) -> RangeAreasError {
    RangeAreasError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn invalid(message: impl Into<String>) -> RangeAreasError {
    RangeAreasError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn item_not_found(message: impl Into<String>) -> RangeAreasError {
    RangeAreasError {
        code: "ItemNotFound",
        message: message.into(),
    }
}

fn unsupported_load_property(object: &str, property: &str) -> RangeAreasError {
    RangeAreasError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} load property '{property}'"),
    }
}

/// Bind RangeAreas through the shared extension-object path. The parent and
/// its `areas` collection can share this typed reference: the collection
/// handler calls [`RangeAreasRef::load_collection`] for `items/...` paths,
/// while ordinary loads use the scalar projection above.
impl ExtensionObject for RangeAreasRef {
    fn object_type(&self) -> &'static str {
        "RangeAreas"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let is_collection = properties
            .iter()
            .any(|property| property == "items" || property.starts_with("items/"));
        let result = if is_collection {
            self.load_collection(properties)
        } else {
            RangeAreasRef::load(self, properties)
        };
        result.map_err(range_areas_batch_error)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(range_areas_batch_error(unsupported_set_property(
            "RangeAreas",
            property,
        )))
    }
}

fn range_areas_batch_error(error: RangeAreasError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn unsupported_set_property(object: &str, property: &str) -> RangeAreasError {
    RangeAreasError {
        code: "InvalidArgument",
        message: format!("Unsupported {object} set property '{property}'"),
    }
}

/// Host extension handler for the RangeAreas/RangeCollection wire family.
///
/// The handler binds a single typed [`RangeAreasRef`] for both the parent and
/// its `areas` collection. Collection item-at results are deliberately bound
/// through the core Range map, so the returned object keeps the complete
/// Range content/navigation/format surface instead of becoming a second
/// range-like shadow object.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct RangeAreasHandler;

impl ExtensionHandler for RangeAreasHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "getRangeAreas"
                | "getRangeAreasCollection"
                | "rangeCollectionGetCount"
                | "rangeCollectionGetItemAt"
                | "rangeAreasClear"
                | "rangeAreasNavigation"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let name = operation
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| batch_invalid("RangeAreas operation has no op"))?;
        match name {
            "getRangeAreas" => {
                let id = required_operation_string(operation, "id")?;
                let worksheet_id = required_operation_string(operation, "worksheetId")?;
                let worksheet = context.worksheet(worksheet_id)?;
                let address = optional_operation_string(operation, "address")?;
                let areas = RangeAreasRef::from_address(worksheet.sheet(), address)
                    .map_err(range_areas_batch_error)?;
                context.bind_object(id, Arc::new(areas));
            }
            "getRangeAreasCollection" => {
                let id = required_operation_string(operation, "id")?;
                let range_areas_id = required_operation_string(operation, "rangeAreasId")?;
                let areas = context.extension_object::<RangeAreasRef>(range_areas_id)?;
                // The collection uses the same geometry reference. Its
                // `items/...` load paths are recognized by the typed object
                // projection, while its proxy ID remains distinct.
                context.bind_object(id, areas);
            }
            "rangeCollectionGetCount" => {
                let collection_id = required_operation_string(operation, "collectionId")?;
                let result_id = required_operation_string(operation, "resultId")?;
                let areas = context.extension_object::<RangeAreasRef>(collection_id)?;
                let count = areas.area_count().map_err(range_areas_batch_error)?;
                context.set_result(result_id, json!(count));
            }
            "rangeCollectionGetItemAt" => {
                let id = required_operation_string(operation, "id")?;
                let collection_id = required_operation_string(operation, "collectionId")?;
                let index = operation
                    .get("index")
                    .and_then(Value::as_u64)
                    .and_then(|index| usize::try_from(index).ok())
                    .ok_or_else(|| {
                        batch_invalid("RangeCollection.getItemAt index must be a non-negative integer")
                    })?;
                let areas = context.extension_object::<RangeAreasRef>(collection_id)?;
                let address = areas.area_at(index).map_err(range_areas_batch_error)?;
                // RangeRef::new is the small host-owned constructor that
                // preserves the core Range object path for collection items.
                let range = RangeRef::new(areas.sheet(), Some(address), false);
                context.bind_range(id, range);
            }
            "rangeAreasClear" => {
                let id = required_operation_string(operation, "id")?;
                let apply_to = required_operation_string(operation, "applyTo")?;
                let areas = context.extension_object::<RangeAreasRef>(id)?;
                areas.clear(apply_to).map_err(range_areas_batch_error)?;
            }
            "rangeAreasNavigation" => {
                let id = required_operation_string(operation, "id")?;
                let source_id = required_operation_string(operation, "rangeAreasId")?;
                let method = required_operation_string(operation, "method")?;
                if method != "getIntersectionOrNullObject" {
                    return Err(batch_invalid(format!(
                        "Unsupported RangeAreas navigation method '{method}'"
                    )));
                }
                let arguments = operation
                    .get("args")
                    .and_then(Value::as_array)
                    .ok_or_else(|| batch_invalid("RangeAreas navigation requires an argument"))?;
                if arguments.len() != 1 {
                    return Err(batch_invalid(
                        "RangeAreas.getIntersectionOrNullObject requires exactly one argument",
                    ));
                }
                let source = context.extension_object::<RangeAreasRef>(source_id)?;
                let other = intersection_argument(&arguments[0], &source, context)?;
                let result = source
                    .intersection(&other, true)
                    .map_err(range_areas_batch_error)?;
                if result.is_null_object() {
                    context.bind_null_object(id);
                } else {
                    context.bind_object(id, Arc::new(result));
                }
            }
            _ => unreachable!("can_handle and handle operation names differ"),
        }
        Ok(true)
    }
}

fn intersection_argument(
    argument: &Value,
    source: &RangeAreasRef,
    context: &HostDispatchContext<'_>,
) -> Result<RangeAreasRef, BatchError> {
    if let Some(object) = argument.as_object() {
        let range_areas_id = object
            .get("rangeAreasId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        let range_id = object
            .get("rangeId")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty());
        return match (range_areas_id, range_id) {
            (Some(_), Some(_)) => Err(batch_invalid(
                "RangeAreas intersection argument cannot contain both Range and RangeAreas IDs",
            )),
            (Some(id), None) => context.extension_object::<RangeAreasRef>(id).map(|value| (*value).clone()),
            (None, Some(id)) => {
                let range = context.range(id)?;
                if range.is_null_object() {
                    return Err(BatchError {
                        code: "InvalidObjectPath",
                        message: "RangeAreas intersection cannot use a null Range.".to_string(),
                    });
                }
                RangeAreasRef::from_address(range.sheet(), range.address())
                    .map_err(range_areas_batch_error)
            }
            (None, None) => Err(batch_invalid(
                "RangeAreas intersection argument requires a Range or RangeAreas ID",
            )),
        };
    }
    let address = argument
        .as_str()
        .ok_or_else(|| batch_invalid("RangeAreas intersection argument must be a Range, RangeAreas, or address"))?;
    RangeAreasRef::from_address(source.sheet(), Some(address)).map_err(range_areas_batch_error)
}

fn required_operation_string<'a>(
    operation: &'a Value,
    field: &str,
) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| batch_invalid(format!("RangeAreas operation requires a non-empty {field}")))
}

fn optional_operation_string<'a>(
    operation: &'a Value,
    field: &str,
) -> Result<Option<&'a str>, BatchError> {
    match operation.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.as_str())),
        Some(_) => Err(batch_invalid(format!(
            "RangeAreas operation field '{field}' must be a string or null"
        ))),
    }
}

fn batch_invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}
