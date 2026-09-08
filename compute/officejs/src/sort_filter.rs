//! Office.js range sorting and worksheet AutoFilter integration.
//!
//! The Office.js bootstrap intentionally keeps request objects thin.  This
//! module is the typed boundary behind those objects: it parses the public
//! Office.js descriptors, delegates sorting/filtering to the production
//! `compute-api` facades, and converts the engine's durable filter state back
//! to Office.js-shaped values.

use std::collections::{BTreeMap, HashMap};
use std::fmt;

use compute_api::{CellRange, ComputeApiError, Sheet};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use value_types::Color;

/// Error returned by the Office.js sort/filter boundary.
///
/// `Host` maps this directly to a Rich API batch error.  Keeping the Office
/// error code here prevents unsupported descriptors from becoming silent
/// no-ops at the JS boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SortFilterError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl SortFilterError {
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

impl fmt::Display for SortFilterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for SortFilterError {}

impl From<ComputeApiError> for SortFilterError {
    fn from(error: ComputeApiError) -> Self {
        match error {
            ComputeApiError::InvalidAddress { .. }
            | ComputeApiError::InvalidRange { .. }
            | ComputeApiError::InvalidOperation(_) => Self::invalid(error.to_string()),
            ComputeApiError::SheetNotFound { .. } => Self::item_not_found(error.to_string()),
            ComputeApiError::Compute(value_types::ComputeError::SheetNotFound { .. }) => {
                Self::item_not_found(error.to_string())
            }
            ComputeApiError::Compute(value_types::ComputeError::InvalidInput { .. }) => {
                Self::invalid(error.to_string())
            }
            other => Self::general(other.to_string()),
        }
    }
}

/// Inputs to `Range.sort.apply` after the JS request has been decoded.
#[derive(Debug, Clone)]
pub(crate) struct RangeSortRequest {
    pub(crate) fields: Value,
    pub(crate) match_case: Option<bool>,
    pub(crate) has_headers: Option<bool>,
    pub(crate) orientation: Option<String>,
    pub(crate) method: Option<String>,
}

/// Inputs to `AutoFilter.apply` after the JS request has been decoded.
#[derive(Debug, Clone)]
pub(crate) struct AutoFilterApplyRequest {
    pub(crate) range: String,
    pub(crate) column_index: Option<i64>,
    pub(crate) criteria: Option<Value>,
}

/// A serializable view of a worksheet AutoFilter.
///
/// `range` is an unqualified A1 range (`A1:C6`); the host adds the worksheet
/// qualifier when it hydrates a returned `Range` object's `address` property.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoFilterSnapshot {
    pub(crate) filter_id: Option<String>,
    pub(crate) range: Option<String>,
    pub(crate) criteria: Vec<Value>,
    pub(crate) enabled: bool,
    pub(crate) is_data_filtered: bool,
}

/// A worksheet AutoFilter proxy anchored to the engine's stable filter ID.
///
/// The JS object can be created before a filter exists (`Worksheet.autoFilter`
/// is always an object), so `filter_id` and `range` are optional until the
/// first `apply`.  `known_criteria` preserves exact Office.js descriptors for
/// filters created through this request context; imported filters are rebuilt
/// from the durable typed filter state when possible.
#[derive(Clone)]
pub(crate) struct AutoFilterRef {
    sheet: Sheet,
    filter_id: Option<String>,
    range: Option<String>,
    known_criteria: BTreeMap<u32, Value>,
}

impl AutoFilterRef {
    pub(crate) fn new(sheet: Sheet) -> Self {
        Self {
            sheet,
            filter_id: None,
            range: None,
            known_criteria: BTreeMap::new(),
        }
    }

    /// Apply or create a worksheet AutoFilter and optionally set one column's
    /// criteria.  The range and column index are validated before any engine
    /// mutation occurs, so an invalid descriptor cannot partially mutate the
    /// workbook.
    pub(crate) fn apply(&mut self, request: AutoFilterApplyRequest) -> Result<(), SortFilterError> {
        let bounds = resolve_range(&request.range)?;
        let (start_row, start_col, end_row, end_col) = bounds;
        let width = end_col
            .checked_sub(start_col)
            .and_then(|span| span.checked_add(1))
            .ok_or_else(|| SortFilterError::invalid("AutoFilter range has invalid columns"))?;

        let relative_column = match request.column_index {
            Some(index) => {
                if index < 0 {
                    return Err(SortFilterError::invalid(
                        "AutoFilter columnIndex must be a non-negative integer",
                    ));
                }
                let index = u32::try_from(index).map_err(|_| {
                    SortFilterError::invalid("AutoFilter columnIndex is outside the worksheet")
                })?;
                if index >= width {
                    return Err(SortFilterError::invalid(format!(
                        "AutoFilter columnIndex {index} is outside the range's {width} columns"
                    )));
                }
                Some(index)
            }
            None => None,
        };

        let typed_criteria = match request.criteria.as_ref() {
            Some(criteria) => Some(parse_filter_criteria(criteria)?),
            None => None,
        };
        if relative_column.is_none() && typed_criteria.is_some() {
            return Err(SortFilterError::invalid(
                "AutoFilter criteria requires columnIndex",
            ));
        }

        // A worksheet has one AutoFilter surface.  Reuse an exact existing
        // range; when the requested range changes, delete old worksheet-level
        // AutoFilters while leaving table filters intact.
        let records = filter_records(&self.sheet)?;
        let existing = records
            .iter()
            .find(|record| record.is_auto_filter() && record.bounds() == Some(bounds))
            .cloned();

        let filter_id = if let Some(record) = existing.as_ref() {
            record.id.clone()
        } else {
            for record in records.iter().filter(|record| record.is_auto_filter()) {
                self.sheet
                    .filters()
                    .delete(&record.id)
                    .map_err(SortFilterError::from)?;
            }

            let result = self
                .sheet
                .filters()
                .create(json!({
                    "startRow": start_row,
                    "startCol": start_col,
                    "endRow": end_row,
                    "endCol": end_col,
                    "filterType": "autoFilter",
                }))
                .map_err(SortFilterError::from)?;
            result
                .data
                .as_ref()
                .and_then(|data| data.get("id"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    SortFilterError::general(
                        "The compute engine did not return the created AutoFilter ID",
                    )
                })?
        };

        // A proxy can be reused for a different worksheet filter range.  Its
        // request-context criteria cache is valid only for the filter ID that
        // populated it; discard it before hydrating the new filter.
        if self.filter_id.as_deref() != Some(filter_id.as_str()) {
            self.known_criteria.clear();
        }

        if let (Some(relative_column), Some(criteria)) = (relative_column, typed_criteria) {
            let absolute_column = start_col.checked_add(relative_column).ok_or_else(|| {
                SortFilterError::invalid("AutoFilter columnIndex exceeds the worksheet")
            })?;
            let original_criteria = request.criteria.clone().ok_or_else(|| {
                SortFilterError::general("AutoFilter criteria disappeared while applying")
            })?;
            set_column_filter_json(&self.sheet, &filter_id, absolute_column, criteria)?;
            self.known_criteria
                .insert(relative_column, original_criteria);
        }

        self.filter_id = Some(filter_id);
        self.range = Some(request.range);
        // Keep the local proxy's range synchronized with the canonical
        // position even when it was supplied with `$` markers.
        if let Some(record) = filter_records(&self.sheet)?
            .into_iter()
            .find(|record| record.id == self.filter_id.as_deref().unwrap_or_default())
        {
            self.range = record.bounds().map(range_address);
        }
        Ok(())
    }

    pub(crate) fn clear_column_criteria(
        &mut self,
        column_index: i64,
    ) -> Result<(), SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            return Err(SortFilterError::item_not_found(
                "The worksheet has no AutoFilter",
            ));
        };
        let bounds = record.bounds().ok_or_else(|| {
            SortFilterError::general("The AutoFilter range could not be resolved")
        })?;
        let relative_column = validate_relative_column(column_index, bounds)?;
        let absolute_column = bounds.1.checked_add(relative_column).ok_or_else(|| {
            SortFilterError::invalid("AutoFilter columnIndex exceeds the worksheet")
        })?;
        self.sheet
            .filters()
            .clear_column_filter(&record.id, absolute_column)
            .map_err(SortFilterError::from)?;
        self.known_criteria.remove(&relative_column);
        self.filter_id = Some(record.id);
        self.range = Some(range_address(bounds));
        Ok(())
    }

    pub(crate) fn clear_criteria(&mut self) -> Result<(), SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            self.known_criteria.clear();
            return Ok(());
        };
        self.sheet
            .filters()
            .clear_all_column_filters(&record.id)
            .map_err(SortFilterError::from)?;
        let filter_id = record.id.clone();
        let range = record.bounds().map(range_address);
        self.known_criteria.clear();
        self.filter_id = Some(filter_id);
        self.range = range;
        Ok(())
    }

    pub(crate) fn reapply(&mut self) -> Result<(), SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            return Ok(());
        };
        self.sheet
            .filters()
            .reapply(&record.id)
            .map_err(SortFilterError::from)?;
        let filter_id = record.id.clone();
        let range = record.bounds().map(range_address);
        self.filter_id = Some(filter_id);
        self.range = range;
        Ok(())
    }

    pub(crate) fn remove(&mut self) -> Result<(), SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            self.filter_id = None;
            self.range = None;
            self.known_criteria.clear();
            return Ok(());
        };
        self.sheet
            .filters()
            .delete(&record.id)
            .map_err(SortFilterError::from)?;
        self.filter_id = None;
        self.range = None;
        self.known_criteria.clear();
        Ok(())
    }

    /// Return the Office.js state for `criteria`, `enabled`, and
    /// `isDataFiltered` loads.
    pub(crate) fn snapshot(&self) -> Result<AutoFilterSnapshot, SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            return Ok(AutoFilterSnapshot {
                filter_id: None,
                range: None,
                criteria: Vec::new(),
                enabled: false,
                is_data_filtered: false,
            });
        };
        let bounds = record.bounds().ok_or_else(|| {
            SortFilterError::general("The AutoFilter range could not be resolved")
        })?;
        let criteria = criteria_array(&self.sheet, &record, bounds, &self.known_criteria)?;
        Ok(AutoFilterSnapshot {
            filter_id: Some(record.id.clone()),
            range: Some(range_address(bounds)),
            is_data_filtered: criteria.iter().any(|value| !value.is_null()),
            enabled: true,
            criteria,
        })
    }

    /// Resolve the current range for `getRange`.
    pub(crate) fn range_address(&self) -> Result<String, SortFilterError> {
        let Some(record) = self.resolve_current()? else {
            return Err(SortFilterError::item_not_found(
                "The worksheet has no AutoFilter range",
            ));
        };
        let bounds = record.bounds().ok_or_else(|| {
            SortFilterError::general("The AutoFilter range could not be resolved")
        })?;
        Ok(range_address(bounds))
    }

    fn resolve_current(&self) -> Result<Option<FilterRecord>, SortFilterError> {
        let records = filter_records(&self.sheet)?;
        if let Some(id) = self.filter_id.as_deref() {
            return Ok(records
                .into_iter()
                .find(|record| record.is_auto_filter() && record.id == id));
        }
        if let Some(range) = self.range.as_deref() {
            let bounds = resolve_range(range)?;
            return Ok(records
                .into_iter()
                .find(|record| record.is_auto_filter() && record.bounds() == Some(bounds)));
        }
        Ok(records.into_iter().find(FilterRecord::is_auto_filter))
    }
}

/// Apply `Range.sort.apply` through the production sort mutation.
pub(crate) fn apply_range_sort(
    sheet: &Sheet,
    address: &str,
    request: RangeSortRequest,
) -> Result<(), SortFilterError> {
    let bounds = resolve_range(address)?;
    let (start_row, start_col, end_row, end_col) = bounds;
    let match_case = request.match_case.unwrap_or(false);
    let has_headers = request.has_headers.unwrap_or(false);

    let orientation = request.orientation.as_deref().unwrap_or("Rows");
    match orientation {
        "Rows" => {}
        "Columns" => {
            return Err(SortFilterError::unsupported(
                "Range.sort.apply with orientation 'Columns' is not supported by the compute engine",
            ));
        }
        other => {
            return Err(SortFilterError::invalid(format!(
                "Unsupported SortOrientation '{other}'"
            )));
        }
    }

    if let Some(method) = request.method.as_deref() {
        match method {
            "PinYin" | "StrokeCount" => {
                return Err(SortFilterError::unsupported(format!(
                    "Range.sort.apply method '{method}' is not supported by the compute engine"
                )));
            }
            other => {
                return Err(SortFilterError::invalid(format!(
                    "Unsupported SortMethod '{other}'"
                )));
            }
        }
    }

    let fields = request.fields.as_array().ok_or_else(|| {
        SortFilterError::invalid("Range.sort.apply fields must be an array of SortField objects")
    })?;
    if fields.is_empty() {
        return Err(SortFilterError::invalid(
            "Range.sort.apply fields must contain at least one SortField",
        ));
    }
    let width = end_col
        .checked_sub(start_col)
        .and_then(|span| span.checked_add(1))
        .ok_or_else(|| SortFilterError::invalid("Range has invalid column bounds"))?;

    let mut criteria = Vec::with_capacity(fields.len());
    for (field_index, field) in fields.iter().enumerate() {
        let object = field.as_object().ok_or_else(|| {
            SortFilterError::invalid(format!(
                "Range.sort.apply fields[{field_index}] must be a SortField object"
            ))
        })?;
        let key = required_u32(object, "key", &format!("fields[{field_index}]"))?;
        if key >= width {
            return Err(SortFilterError::invalid(format!(
                "Range.sort.apply fields[{field_index}].key {key} is outside the range's {width} columns"
            )));
        }
        let column = start_col.checked_add(key).ok_or_else(|| {
            SortFilterError::invalid(format!(
                "Range.sort.apply fields[{field_index}].key exceeds the worksheet"
            ))
        })?;
        let ascending = optional_bool(object, "ascending")?.unwrap_or(true);
        let sort_on = optional_string(object, "sortOn")?.unwrap_or("Value".to_string());
        let mode = match sort_on.as_str() {
            "Value" => {
                if let Some(data_option) = optional_string(object, "dataOption")? {
                    match data_option.as_str() {
                        "Normal" => {}
                        "TextAsNumber" => {
                            return Err(SortFilterError::unsupported(
                                "SortDataOption 'TextAsNumber' is not supported by the compute engine",
                            ));
                        }
                        other => {
                            return Err(SortFilterError::invalid(format!(
                                "Unsupported SortDataOption '{other}'"
                            )));
                        }
                    }
                }
                json!({"kind":"value"})
            }
            "CellColor" | "FontColor" => {
                let color = required_string(object, "color", &format!("fields[{field_index}]"))?;
                if !is_engine_color_token(&color) {
                    return Err(SortFilterError::invalid(format!(
                        "fields[{field_index}].color must be a valid color string"
                    )));
                }
                if let Some(data_option) = optional_string(object, "dataOption")? {
                    if data_option == "TextAsNumber" {
                        return Err(SortFilterError::unsupported(
                            "SortDataOption 'TextAsNumber' is not supported for color sorting",
                        ));
                    }
                    if data_option != "Normal" {
                        return Err(SortFilterError::invalid(format!(
                            "Unsupported SortDataOption '{data_option}'"
                        )));
                    }
                }
                json!({
                    "kind": if sort_on == "CellColor" { "cellColor" } else { "fontColor" },
                    "target": color,
                    "position": "top",
                })
            }
            "Icon" => {
                return Err(SortFilterError::unsupported(
                    "SortOn 'Icon' requires conditional-format icon context and is not supported by the compute engine",
                ));
            }
            other => {
                return Err(SortFilterError::invalid(format!(
                    "Unsupported SortOn '{other}'"
                )));
            }
        };
        if let Some(sub_field) = object.get("subField")
            && !sub_field.is_null()
        {
            return Err(SortFilterError::unsupported(
                "SortField.subField is not supported by the compute engine",
            ));
        }
        criteria.push(json!({
            "column": column,
            "direction": if ascending { "asc" } else { "desc" },
            "caseSensitive": match_case,
            "mode": mode,
        }));
    }

    let options: compute_api::mutation::BridgeSortOptions = serde_json::from_value(json!({
        "criteria": criteria,
        "hasHeaders": has_headers,
        "visibleRowsOnly": false,
    }))
    .map_err(|error| SortFilterError::general(format!("failed to build sort options: {error}")))?;
    sheet
        .sort_range(
            CellRange::Bounds(start_row, start_col, end_row, end_col),
            options,
        )
        .map_err(SortFilterError::from)?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilterRecord {
    id: String,
    #[serde(rename = "type")]
    filter_type: String,
    #[serde(default)]
    column_filters: HashMap<String, Value>,
    #[serde(default)]
    start_row: Option<u32>,
    #[serde(default)]
    start_col: Option<u32>,
    #[serde(default)]
    end_row: Option<u32>,
    #[serde(default)]
    end_col: Option<u32>,
}

impl FilterRecord {
    fn is_auto_filter(&self) -> bool {
        self.filter_type == "autoFilter"
    }

    fn bounds(&self) -> Option<(u32, u32, u32, u32)> {
        let bounds = (
            self.start_row?,
            self.start_col?,
            self.end_row?,
            self.end_col?,
        );
        (bounds.0 <= bounds.2 && bounds.1 <= bounds.3).then_some(bounds)
    }
}

fn filter_records(sheet: &Sheet) -> Result<Vec<FilterRecord>, SortFilterError> {
    let states = sheet.filters().get_all().map_err(SortFilterError::from)?;
    let value = serde_json::to_value(states).map_err(|error| {
        SortFilterError::general(format!("failed to encode AutoFilter state: {error}"))
    })?;
    serde_json::from_value(value).map_err(|error| {
        SortFilterError::general(format!("failed to decode AutoFilter state: {error}"))
    })
}

fn resolve_range(address: &str) -> Result<(u32, u32, u32, u32), SortFilterError> {
    let bounds = CellRange::from(address)
        .resolve()
        .map_err(SortFilterError::from)?;
    if bounds.0 > bounds.2 || bounds.1 > bounds.3 {
        return Err(SortFilterError::invalid(format!(
            "Range '{address}' has its start after its end"
        )));
    }
    Ok(bounds)
}

fn range_address((start_row, start_col, end_row, end_col): (u32, u32, u32, u32)) -> String {
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

fn required_u32(
    object: &Map<String, Value>,
    name: &str,
    location: &str,
) -> Result<u32, SortFilterError> {
    let value = object
        .get(name)
        .ok_or_else(|| SortFilterError::invalid(format!("{location}.{name} is required")))?;
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            SortFilterError::invalid(format!("{location}.{name} must be a non-negative integer"))
        })
}

fn required_string(
    object: &Map<String, Value>,
    name: &str,
    location: &str,
) -> Result<String, SortFilterError> {
    let value = object
        .get(name)
        .ok_or_else(|| SortFilterError::invalid(format!("{location}.{name} is required")))?;
    let string = value
        .as_str()
        .ok_or_else(|| SortFilterError::invalid(format!("{location}.{name} must be a string")))?;
    if string.is_empty() {
        return Err(SortFilterError::invalid(format!(
            "{location}.{name} must not be empty"
        )));
    }
    Ok(string.to_string())
}

fn optional_string(
    object: &Map<String, Value>,
    name: &str,
) -> Result<Option<String>, SortFilterError> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(ToOwned::to_owned)
            .map(Some)
            .ok_or_else(|| SortFilterError::invalid(format!("{name} must be a string"))),
    }
}

fn optional_bool(object: &Map<String, Value>, name: &str) -> Result<Option<bool>, SortFilterError> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_bool()
            .map(Some)
            .ok_or_else(|| SortFilterError::invalid(format!("{name} must be a boolean"))),
    }
}

fn is_engine_color_token(color: &str) -> bool {
    Color::from_hex(color).is_ok()
        || color.starts_with("theme:")
        || color.starts_with("rgb(")
        || color.starts_with("rgba(")
}

fn validate_relative_column(
    column_index: i64,
    bounds: (u32, u32, u32, u32),
) -> Result<u32, SortFilterError> {
    if column_index < 0 {
        return Err(SortFilterError::invalid(
            "AutoFilter columnIndex must be a non-negative integer",
        ));
    }
    let index = u32::try_from(column_index)
        .map_err(|_| SortFilterError::invalid("AutoFilter columnIndex is outside the worksheet"))?;
    let width = bounds.3 - bounds.1 + 1;
    if index >= width {
        return Err(SortFilterError::invalid(format!(
            "AutoFilter columnIndex {index} is outside the range's {width} columns"
        )));
    }
    Ok(index)
}

fn set_column_filter_json(
    sheet: &Sheet,
    filter_id: &str,
    absolute_column: u32,
    criteria: Value,
) -> Result<(), SortFilterError> {
    // The target type is inferred from SheetFilters::set_column_filter's
    // typed argument.  This keeps officejs independent from the domain-types
    // crate while still crossing the production typed API.
    let typed = serde_json::from_value(criteria).map_err(|error| {
        SortFilterError::general(format!("failed to build typed filter criteria: {error}"))
    })?;
    sheet
        .filters()
        .set_column_filter(filter_id, absolute_column, typed)
        .map_err(SortFilterError::from)?;
    Ok(())
}

fn parse_filter_criteria(criteria: &Value) -> Result<Value, SortFilterError> {
    let object = criteria.as_object().ok_or_else(|| {
        SortFilterError::invalid("AutoFilter criteria must be a FilterCriteria object")
    })?;
    if let Some(sub_field) = object.get("subField")
        && !sub_field.is_null()
    {
        return Err(SortFilterError::unsupported(
            "FilterCriteria.subField is not supported by the compute engine",
        ));
    }
    let filter_on = object
        .get("filterOn")
        .and_then(Value::as_str)
        .ok_or_else(|| SortFilterError::invalid("FilterCriteria.filterOn is required"))?;

    match filter_on {
        "Values" => {
            let values = object
                .get("values")
                .and_then(Value::as_array)
                .ok_or_else(|| SortFilterError::invalid("Values filtering requires values[]"))?;
            for (index, value) in values.iter().enumerate() {
                match value {
                    Value::String(_) | Value::Number(_) | Value::Bool(_) => {}
                    Value::Object(_) => {
                        return Err(SortFilterError::unsupported(format!(
                            "Values filter value at index {index} is a FilterDatetime/rich value, which the compute engine cannot evaluate"
                        )));
                    }
                    Value::Null | Value::Array(_) => {
                        return Err(SortFilterError::invalid(format!(
                            "Values filter value at index {index} must be a scalar"
                        )));
                    }
                }
            }
            Ok(json!({
                "type": "values",
                "values": values,
                "includeBlanks": false,
            }))
        }
        "Custom" => parse_custom_filter(object),
        "TopItems" | "BottomItems" | "TopPercent" | "BottomPercent" => {
            let count = parse_count(object.get("criterion1"), "criterion1")?;
            if filter_on.ends_with("Items") && count.fract() != 0.0 {
                return Err(SortFilterError::invalid(
                    "Top/bottom item count must be an integer",
                ));
            }
            if filter_on.ends_with("Percent") && count > 100.0 {
                return Err(SortFilterError::invalid(
                    "Top/bottom percent must be between 0 and 100",
                ));
            }
            let direction = if filter_on.starts_with("Top") {
                "top"
            } else {
                "bottom"
            };
            let by = if filter_on.ends_with("Percent") {
                "percent"
            } else {
                "items"
            };
            Ok(json!({
                "type": "topBottom",
                "direction": direction,
                "count": count,
                "by": by,
            }))
        }
        "Dynamic" => {
            let dynamic = object
                .get("dynamicCriteria")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SortFilterError::invalid("Dynamic filtering requires dynamicCriteria")
                })?;
            let rule = dynamic_rule(dynamic)?;
            Ok(json!({"type":"dynamic", "rule":rule}))
        }
        "CellColor" | "FontColor" => {
            let color = object
                .get("color")
                .and_then(Value::as_str)
                .filter(|color| !color.is_empty())
                .ok_or_else(|| SortFilterError::invalid("Color filtering requires color"))?;
            if Color::from_hex(color).is_err() {
                return Err(SortFilterError::invalid(
                    "Color filtering requires a hexadecimal color string",
                ));
            }
            Ok(json!({
                "type": "color",
                "color": color,
                "byFont": filter_on == "FontColor",
            }))
        }
        "Icon" => Err(SortFilterError::unsupported(
            "FilterOn 'Icon' requires conditional-format icon context and is not supported by the compute engine",
        )),
        other => Err(SortFilterError::invalid(format!(
            "Unsupported FilterOn '{other}'"
        ))),
    }
}

fn parse_custom_filter(object: &Map<String, Value>) -> Result<Value, SortFilterError> {
    let criterion1 = object
        .get("criterion1")
        .and_then(Value::as_str)
        .ok_or_else(|| SortFilterError::invalid("Custom filtering requires criterion1"))?;
    let criterion2 = match object.get("criterion2") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_str().ok_or_else(|| {
            SortFilterError::invalid("Custom filtering criterion2 must be a string")
        })?),
    };
    let logic = match object.get("operator") {
        None | Some(Value::Null) => "and",
        Some(Value::String(value)) if value == "And" => "and",
        Some(Value::String(value)) if value == "Or" => "or",
        Some(Value::String(value)) => {
            return Err(SortFilterError::invalid(format!(
                "Unsupported FilterOperator '{value}'"
            )));
        }
        Some(_) => {
            return Err(SortFilterError::invalid(
                "FilterCriteria.operator must be 'And' or 'Or'",
            ));
        }
    };
    let first = parse_condition(criterion1)?;
    let second = criterion2.map(parse_condition).transpose()?;

    // Above/BelowAverage have dedicated dynamic filter semantics and cannot
    // be represented as custom criteria; reject them explicitly if a caller
    // attempts to smuggle them through a string descriptor.
    let mut conditions = vec![first];
    if let Some(second) = second {
        conditions.push(second);
    }
    Ok(json!({
        "type": "condition",
        "conditions": conditions,
        "logic": logic,
    }))
}

fn parse_condition(raw: &str) -> Result<Value, SortFilterError> {
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
            "equals" => Ok(json!({"operator": "isBlank"})),
            "notEquals" => Ok(json!({"operator": "isNotBlank"})),
            other => Err(SortFilterError::invalid(format!(
                "Custom filter operator '{other}' requires a criterion value"
            ))),
        };
    }
    Ok(json!({
        "operator": operator,
        "value": parse_operand(operand),
    }))
}

fn wildcard_condition<'a>(
    operator: &'static str,
    operand: &'a str,
) -> Result<(&'static str, &'a str), SortFilterError> {
    let has_wildcard = operand.contains('*') || operand.contains('?');
    if !has_wildcard {
        return Ok((operator, operand));
    }
    if operand.contains('?') {
        return Err(SortFilterError::unsupported(
            "Custom filter wildcard '?' is not supported by the compute engine",
        ));
    }
    if operator != "equals" && operator != "notEquals" {
        return Err(SortFilterError::unsupported(
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
        return Err(SortFilterError::unsupported(
            "Custom filter wildcard patterns with interior escapes are not supported by the compute engine",
        ));
    }
    if operator == "notEquals" && (leading != trailing) {
        return Err(SortFilterError::unsupported(
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

fn parse_count(value: Option<&Value>, name: &str) -> Result<f64, SortFilterError> {
    let value = value.ok_or_else(|| SortFilterError::invalid(format!("{name} is required")))?;
    let number = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|number| number.is_finite() && *number >= 0.0)
    .ok_or_else(|| {
        SortFilterError::invalid(format!("{name} must be a finite non-negative number"))
    })?;
    Ok(number)
}

fn dynamic_rule(value: &str) -> Result<&'static str, SortFilterError> {
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
            return Err(SortFilterError::unsupported(format!(
                "DynamicFilterCriteria '{other}' is not supported by the compute engine"
            )));
        }
    };
    Ok(rule)
}

fn criteria_array(
    sheet: &Sheet,
    record: &FilterRecord,
    bounds: (u32, u32, u32, u32),
    known: &BTreeMap<u32, Value>,
) -> Result<Vec<Value>, SortFilterError> {
    let width = (bounds.3 - bounds.1 + 1) as usize;
    let mut result = vec![Value::Null; width];
    let mut resolved_ids: HashMap<String, u32> = HashMap::new();

    // For regular headers, `get_cell_data` exposes the stable CellId used as
    // the filter map key.  Identity-only blank headers are covered by the
    // local request-context cache (`known`) when the filter was applied here.
    for relative in 0..width as u32 {
        let absolute_col = bounds.1 + relative;
        if let Some(data) = sheet
            .get_cell_data((bounds.0, absolute_col))
            .map_err(SortFilterError::from)?
            && let Some(cell_id) = data.get("cell_id").and_then(Value::as_str)
        {
            resolved_ids.insert(cell_id.to_string(), relative);
        }
    }

    if !record.column_filters.is_empty() {
        for (relative, criterion) in known {
            if (*relative as usize) < result.len() {
                result[*relative as usize] = criterion.clone();
            }
        }
    }
    let unresolved_count = record
        .column_filters
        .keys()
        .filter(|cell_id| !resolved_ids.contains_key(*cell_id))
        .count();
    if unresolved_count > 0 && known.len() != record.column_filters.len() {
        let unresolved = record
            .column_filters
            .keys()
            .find(|cell_id| !resolved_ids.contains_key(*cell_id))
            .cloned()
            .unwrap_or_default();
        return Err(SortFilterError::unsupported(format!(
            "AutoFilter criterion for column CellId '{unresolved}' could not be resolved"
        )));
    }
    for (cell_id, criterion) in &record.column_filters {
        if let Some(relative) = resolved_ids.get(cell_id) {
            // Keep the exact descriptor supplied by this request context
            // when available (for example `>50`, rather than the typed
            // engine value's `>50.0`).  Imported criteria are rebuilt from
            // the durable domain representation below.
            if !known.contains_key(relative) {
                result[*relative as usize] = office_criteria_from_domain(criterion)?;
            }
        }
    }
    Ok(result)
}

fn office_criteria_from_domain(value: &Value) -> Result<Value, SortFilterError> {
    let object = value
        .as_object()
        .ok_or_else(|| SortFilterError::general("stored AutoFilter criterion is not an object"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| SortFilterError::general("stored AutoFilter criterion has no type"))?;
    match kind {
        "values" => Ok(json!({
            "filterOn": "Values",
            "values": object.get("values").cloned().unwrap_or_else(|| json!([])),
        })),
        "condition" => domain_condition_to_office(object),
        "topBottom" => {
            let direction = object
                .get("direction")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    SortFilterError::general("stored top/bottom criterion has no direction")
                })?;
            let by = object.get("by").and_then(Value::as_str).ok_or_else(|| {
                SortFilterError::general("stored top/bottom criterion has no basis")
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
                    return Err(SortFilterError::unsupported(
                        "stored top/bottom filter basis is not supported by Office.js AutoFilter",
                    ));
                }
            };
            Ok(json!({"filterOn":filter_on,"criterion1":count}))
        }
        "dynamic" => {
            let rule = object
                .get("rule")
                .and_then(Value::as_str)
                .ok_or_else(|| SortFilterError::general("stored dynamic criterion has no rule"))?;
            let office = dynamic_rule_to_office(rule)?;
            Ok(json!({"filterOn":"Dynamic","dynamicCriteria":office}))
        }
        "color" => {
            let color = object
                .get("color")
                .and_then(Value::as_str)
                .ok_or_else(|| SortFilterError::general("stored color criterion has no color"))?;
            let by_font = object
                .get("byFont")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(json!({
                "filterOn": if by_font { "FontColor" } else { "CellColor" },
                "color": color,
            }))
        }
        "icon" => Err(SortFilterError::unsupported(
            "stored icon filter criteria cannot be evaluated by the compute engine",
        )),
        other => Err(SortFilterError::unsupported(format!(
            "stored AutoFilter criterion type '{other}' is unsupported"
        ))),
    }
}

fn domain_condition_to_office(object: &Map<String, Value>) -> Result<Value, SortFilterError> {
    let conditions = object
        .get("conditions")
        .and_then(Value::as_array)
        .ok_or_else(|| SortFilterError::general("stored condition criterion has no conditions"))?;
    if conditions.is_empty() || conditions.len() > 2 {
        return Err(SortFilterError::unsupported(
            "stored AutoFilter condition count cannot be represented by Office.js",
        ));
    }
    let logic = match object.get("logic").and_then(Value::as_str) {
        Some("or") => "Or",
        _ => "And",
    };
    let first = condition_to_office(conditions[0].as_object().ok_or_else(|| {
        SortFilterError::general("stored AutoFilter condition is not an object")
    })?)?;
    let second = if conditions.len() == 2 {
        Some(condition_to_office(conditions[1].as_object().ok_or_else(
            || SortFilterError::general("stored AutoFilter condition is not an object"),
        )?)?)
    } else {
        None
    };
    let mut result = Map::new();
    result.insert("filterOn".into(), Value::String("Custom".into()));
    result.insert("criterion1".into(), Value::String(first));
    if let Some(second) = second {
        result.insert("criterion2".into(), Value::String(second));
        result.insert("operator".into(), Value::String(logic.into()));
    }
    Ok(Value::Object(result))
}

fn condition_to_office(object: &Map<String, Value>) -> Result<String, SortFilterError> {
    let operator = object
        .get("operator")
        .and_then(Value::as_str)
        .ok_or_else(|| SortFilterError::general("stored AutoFilter condition has no operator"))?;
    if matches!(operator, "isBlank" | "isNotBlank") {
        return Ok(if operator == "isBlank" {
            "=".into()
        } else {
            "<>".into()
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
        "beginsWith" => "=",
        "endsWith" => "=",
        "contains" => "=",
        "notContains" => "<>",
        other => {
            return Err(SortFilterError::unsupported(format!(
                "stored AutoFilter condition operator '{other}' cannot be represented"
            )));
        }
    };
    let wildcard = match operator {
        // Excel's custom criteria use a leading `*` for suffix matches and a
        // trailing `*` for prefix matches.  Keeping these positions exact is
        // necessary for criteria read after an imported filter is hydrated.
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
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        Value::Number(value) => {
            let number = value.as_f64().unwrap_or(0.0);
            if number == 0.0 {
                "0".into()
            } else if number.is_finite() && number.fract() == 0.0 && number.abs() < 1e21 {
                format!("{number:.0}")
            } else {
                value.to_string()
            }
        }
        other => other.to_string(),
    }
}

fn dynamic_rule_to_office(rule: &str) -> Result<&'static str, SortFilterError> {
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
            return Err(SortFilterError::unsupported(format!(
                "stored dynamic filter rule '{other}' is unsupported"
            )));
        }
    };
    Ok(office)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numeric_custom_threshold_as_number() {
        let parsed = parse_filter_criteria(&json!({
            "filterOn": "Custom",
            "criterion1": ">50"
        }))
        .expect("custom criterion");
        assert_eq!(
            parsed,
            json!({
                "type":"condition",
                "conditions":[{"operator":"greaterThan","value":50.0}],
                "logic":"and"
            })
        );
    }

    #[test]
    fn parses_values_and_custom_two_condition_logic() {
        assert_eq!(
            parse_filter_criteria(&json!({
                "filterOn":"Values",
                "values":["Open", "Closed"]
            }))
            .unwrap(),
            json!({"type":"values","values":["Open","Closed"],"includeBlanks":false})
        );
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
                    {"operator":"greaterThanOrEqual","value":10.0},
                    {"operator":"lessThanOrEqual","value":20.0}
                ],
                "logic":"and"
            })
        );
    }

    #[test]
    fn rejects_unsupported_icon_and_column_orientation() {
        let error = parse_filter_criteria(&json!({
            "filterOn":"Icon",
            "icon":{"set":"ThreeArrows","index":0}
        }))
        .unwrap_err();
        assert_eq!(error.code, "UnsupportedOperation");
        assert!(error.message.contains("Icon"));
    }
}
