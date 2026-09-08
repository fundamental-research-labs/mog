//! Office.js chart collection and chart core bindings.
//!
//! The Office.js layer keeps request-context proxy IDs separate from the
//! persisted floating-object IDs used by the compute engine.  `ChartRef`
//! therefore stores the engine chart ID and resolves the current chart for
//! every operation.  This is what keeps a chart proxy valid after a chart is
//! renamed or its worksheet position changes.
//!
//! The JavaScript adapter's host wire contract is intentionally small:
//! `getChartCollection { id, worksheetId }`, `chartAdd { id, collectionId,
//! worksheetId, type, rangeId, seriesBy }`, `chartGetItem { id,
//! collectionId, worksheetId, name, orNullObject }`, `chartGetItemAt { id,
//! collectionId, worksheetId, index }`, `chartCollectionGetCount {
//! collectionId, worksheetId, resultId }`, `chartSetData { id, rangeId,
//! seriesBy }`, `chartSetPosition { id, startRangeId|startAddress,
//! endRangeId|endAddress }`, and `chartDelete { id }`.  Core scalar writes
//! use the shared `set { id, property, value }` operation.  Collection and
//! chart loads use the shared `load { id, properties }` operation.

use std::collections::HashMap;

use compute_api::{CellRange, Sheet};
use serde::Serialize;
use serde_json::{json, Value};

/// Errors returned by the chart Office.js adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// A chart item in a `ChartCollection` hydration response.
///
/// The JavaScript collection helper uses `key` to enter the normal
/// `ChartCollection.getItem` path, then hydrates the returned chart proxy with
/// the listed scalar properties.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ChartCollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A host-side chart reference anchored by the engine's stable object ID.
#[derive(Clone)]
pub(crate) struct ChartRef {
    sheet: Sheet,
    stable_id: String,
}

/// A worksheet-scoped chart collection.
#[derive(Clone)]
pub(crate) struct ChartCollectionRef {
    sheet: Sheet,
}

const DEFAULT_CHART_PROPERTIES: &[&str] =
    &["id", "name", "chartType", "height", "left", "top", "width"];

impl ChartCollectionRef {
    /// Construct a worksheet-scoped chart collection.
    pub(crate) fn new(sheet: Sheet) -> Self {
        Self { sheet }
    }

    /// Return the worksheet backing this collection.
    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    /// Create a chart from an Office.js chart type and source range.
    ///
    /// The compute API owns ID allocation, timestamps, and persistence.  The
    /// Office.js adapter only translates the source range and series
    /// orientation into the engine's chart configuration.
    pub(crate) fn add(
        &self,
        chart_type: &str,
        source_data: &str,
        series_by: Option<&str>,
    ) -> Result<ChartRef, ChartError> {
        let chart_type = required_string(chart_type, "ChartCollection.add type")?;
        validate_range(source_data, "ChartCollection.add sourceData")?;
        let series_orientation = series_orientation(series_by)?;

        let mut config = json!({
            "chartType": chart_type,
            "dataRange": source_data,
            "width": 400.0,
            "height": 300.0,
            "widthPt": 400.0,
            "heightPt": 300.0,
            "leftPt": 0.0,
            "topPt": 0.0,
        });
        if let Some(orientation) = series_orientation {
            config["seriesOrientation"] = Value::String(orientation.to_string());
        }

        let result = self.sheet.charts().create(&config).map_err(compute_error)?;
        let stable_id = result
            .data
            .as_ref()
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| encoding("ChartCollection.add did not return a chart ID"))?;
        Ok(ChartRef::new(self.sheet.clone(), stable_id))
    }

    /// Resolve a chart by its name or stable engine ID.
    pub(crate) fn get_item(&self, key: &str) -> Result<ChartRef, ChartError> {
        let key = required_string(key, "ChartCollection.getItem name")?;
        let chart = self
            .charts()?
            .into_iter()
            .find(|chart| {
                chart_id(chart).eq_ignore_ascii_case(key)
                    || chart_name(chart).eq_ignore_ascii_case(key)
            })
            .ok_or_else(|| item_not_found(key))?;
        Ok(ChartRef::new(self.sheet.clone(), chart_id(&chart)))
    }

    /// Resolve a chart by name or ID, returning `None` for a missing item.
    pub(crate) fn get_item_or_null_object(
        &self,
        key: &str,
    ) -> Result<Option<ChartRef>, ChartError> {
        let key = required_string(key, "ChartCollection.getItemOrNullObject name")?;
        Ok(self
            .charts()?
            .into_iter()
            .find(|chart| {
                chart_id(chart).eq_ignore_ascii_case(key)
                    || chart_name(chart).eq_ignore_ascii_case(key)
            })
            .map(|chart| ChartRef::new(self.sheet.clone(), chart_id(&chart))))
    }

    /// Resolve a chart by zero-based collection position.
    pub(crate) fn get_item_at(&self, index: i64) -> Result<ChartRef, ChartError> {
        let charts = self.charts()?;
        let index = checked_collection_index(index, charts.len(), "chart")?;
        Ok(ChartRef::new(self.sheet.clone(), chart_id(&charts[index])))
    }

    /// Return the number of charts in this worksheet.
    pub(crate) fn get_count(&self) -> Result<usize, ChartError> {
        Ok(self.charts()?.len())
    }

    /// Alias used by host integrations that model collection count as a
    /// property rather than the Office.js `getCount` method.
    pub(crate) fn count(&self) -> Result<usize, ChartError> {
        self.get_count()
    }

    /// Project the properties requested by a generic Office.js `load` action.
    ///
    /// Collection items are returned as descriptors because the JavaScript
    /// collection hydrator owns the item proxy cache.  A descriptor's key is
    /// the persisted chart ID, so the following `getItem` action resolves the
    /// same chart even if its name changes between batches.
    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, ChartError> {
        let mut result = HashMap::new();
        let mut item_properties = Vec::new();
        let mut load_items = false;

        for property in properties {
            match property.as_str() {
                "count" => {
                    result.insert(property.clone(), json!(self.get_count()?));
                }
                "isNullObject" => {
                    result.insert(property.clone(), Value::Bool(false));
                }
                "items" => load_items = true,
                item_path if item_path.starts_with("items/") => {
                    let item_property = item_path.trim_start_matches("items/");
                    if item_property.is_empty() || item_property.contains('/') {
                        return Err(invalid(format!(
                            "Invalid ChartCollection item property '{item_path}'"
                        )));
                    }
                    load_items = true;
                    item_properties.push(item_property.to_string());
                }
                other => return Err(unsupported_load_property("ChartCollection", other)),
            }
        }

        if load_items {
            let items = self.collection_items(&item_properties)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(items).map_err(encoding)?,
            );
        }
        Ok(result)
    }

    /// Return descriptors for collection hydration.
    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<ChartCollectionItem>, ChartError> {
        let properties = if properties.is_empty() {
            DEFAULT_CHART_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };

        self.charts()?
            .into_iter()
            .map(|chart| {
                let key = chart_id(&chart);
                let reference = ChartRef::new(self.sheet.clone(), key.clone());
                Ok(ChartCollectionItem {
                    key,
                    properties: reference.load(&properties)?,
                })
            })
            .collect()
    }

    fn charts(&self) -> Result<Vec<Value>, ChartError> {
        self.sheet
            .charts()
            .get_all()
            .map_err(compute_error)
            .and_then(|charts| {
                charts
                    .into_iter()
                    .map(|chart| serde_json::to_value(chart).map_err(encoding))
                    .collect()
            })
    }
}

impl ChartRef {
    /// Construct a chart reference from a stable engine object ID.
    pub(crate) fn new(sheet: Sheet, stable_id: impl Into<String>) -> Self {
        Self {
            sheet,
            stable_id: stable_id.into(),
        }
    }

    /// Return the stable engine chart ID.
    pub(crate) fn stable_id(&self) -> &str {
        &self.stable_id
    }

    /// Alias for integrations that call the persisted ID simply `id`.
    pub(crate) fn id(&self) -> &str {
        self.stable_id()
    }

    /// Return the worksheet containing this chart.
    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    /// Load the core Chart scalar properties supported by this adapter.
    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, ChartError> {
        let chart = self.snapshot()?;
        let properties = if properties.is_empty() {
            DEFAULT_CHART_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };

        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "id" => Value::String(chart_id(&chart)),
                "name" => Value::String(chart_name(&chart)),
                "chartType" => chart_type(&chart)?,
                "height" => number_property(&chart, "/height", "Chart.height")?,
                "width" => number_property(&chart, "/width", "Chart.width")?,
                "left" => {
                    chart_position(&self.sheet, &chart, "left", "/anchor/anchorColOffsetEmu")?
                }
                "top" => chart_position(&self.sheet, &chart, "top", "/anchor/anchorRowOffsetEmu")?,
                "isNullObject" => Value::Bool(false),
                other => return Err(unsupported_load_property(other)),
            };
            result.insert(property, value);
        }
        Ok(result)
    }

    /// Return the complete current chart snapshot for child adapters.
    pub(crate) fn snapshot(&self) -> Result<Value, ChartError> {
        let chart = self
            .sheet
            .charts()
            .get(&self.stable_id)
            .map_err(compute_error)?
            .ok_or_else(|| item_not_found(&self.stable_id))?;
        serde_json::to_value(chart).map_err(encoding)
    }

    /// Apply a partial chart update through the persisted compute-api chart
    /// facade. Child adapters use this helper for chart-owned nested fields.
    pub(crate) fn update_fields(&self, updates: &Value) -> Result<(), ChartError> {
        if !updates.is_object() {
            return Err(invalid("Chart updates must be an object"));
        }
        self.ensure_exists()?;
        self.sheet
            .charts()
            .update(&self.stable_id, updates)
            .map_err(compute_error)?;
        Ok(())
    }

    /// Set a writable core Chart property.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ChartError> {
        let updates = match property {
            "name" => json!({ "name": required_value_string(value, "Chart.name")? }),
            "chartType" => {
                json!({ "chartType": required_value_string(value, "Chart.chartType")? })
            }
            "height" => {
                let value = required_finite_number(value, "Chart.height")?;
                json!({ "height": value, "heightPt": value })
            }
            "width" => {
                let value = required_finite_number(value, "Chart.width")?;
                json!({ "width": value, "widthPt": value })
            }
            "left" => {
                let value = required_finite_number(value, "Chart.left")?;
                json!({ "leftPt": value })
            }
            "top" => {
                let value = required_finite_number(value, "Chart.top")?;
                json!({ "topPt": value })
            }
            "id" => {
                return Err(ChartError {
                    code: "InvalidArgument",
                    message: "Chart.id is read-only".to_string(),
                });
            }
            other => {
                return Err(ChartError {
                    code: "InvalidArgument",
                    message: format!("Chart.{other} is read-only or unsupported"),
                });
            }
        };
        self.update_fields(&updates)
    }

    /// Reset the source data range and optional series orientation.
    pub(crate) fn set_data(
        &self,
        source_data: &str,
        series_by: Option<&str>,
    ) -> Result<(), ChartError> {
        validate_range(source_data, "Chart.setData sourceData")?;
        let mut updates = json!({ "dataRange": source_data });
        if series_by.is_some() {
            updates["seriesOrientation"] = match series_by {
                Some("Rows") => Value::String("rows".to_string()),
                Some("Columns") => Value::String("columns".to_string()),
                Some("Auto") => Value::Null,
                Some(other) => {
                    return Err(invalid(format!(
                        "Chart seriesBy must be Auto, Rows, or Columns; got '{other}'"
                    )));
                }
                None => unreachable!("series_by.is_some() was checked above"),
            };
        }
        self.update_fields(&updates)
    }

    /// Position the chart from worksheet cell/range addresses.
    ///
    /// The engine stores anchor coordinates as zero-based rows and columns.
    /// The chart's point position is projected from the worksheet layout.  If
    /// an end range is supplied, the chart is resized to cover the current
    /// persisted dimensions of the covered cells and is switched to a
    /// two-cell anchor.
    pub(crate) fn set_position(
        &self,
        start_cell: &str,
        end_cell: Option<&str>,
    ) -> Result<(), ChartError> {
        let start = resolve_range(start_cell, "Chart.setPosition startCell")?;
        let (start_row, start_col, _, _) = start;
        let left = (0..start_col).try_fold(0.0, |total, column| {
            self.sheet
                .layout()
                .get_col_width(column)
                .map(|width| total + width)
                .map_err(compute_error)
        })?;
        let top = (0..start_row).try_fold(0.0, |total, row| {
            self.sheet
                .layout()
                .get_row_height(row)
                .map(|height| total + height)
                .map_err(compute_error)
        })?;
        let mut updates = json!({
            "anchor": {
                "anchorRow": start_row,
                "anchorCol": start_col,
                "anchorMode": "oneCell",
            },
            "leftPt": left,
            "topPt": top,
        });

        if let Some(end_cell) = end_cell {
            let end = resolve_range(end_cell, "Chart.setPosition endCell")?;
            let (_, _, end_row, end_col) = end;
            if end_row < start_row || end_col < start_col {
                return Err(invalid(
                    "Chart.setPosition endCell must be at or below and to the right of startCell"
                        .to_string(),
                ));
            }
            let width = (start_col..=end_col).try_fold(0.0, |total, column| {
                self.sheet
                    .layout()
                    .get_col_width(column)
                    .map(|width| total + width)
                    .map_err(compute_error)
            })?;
            let height = (start_row..=end_row).try_fold(0.0, |total, row| {
                self.sheet
                    .layout()
                    .get_row_height(row)
                    .map(|height| total + height)
                    .map_err(compute_error)
            })?;
            updates["anchor"]["endRow"] = json!(end_row);
            updates["anchor"]["endCol"] = json!(end_col);
            updates["anchor"]["anchorMode"] = Value::String("twoCell".to_string());
            updates["width"] = json!(width);
            updates["height"] = json!(height);
            updates["widthPt"] = json!(width);
            updates["heightPt"] = json!(height);
        }
        self.update_fields(&updates)
    }

    /// Delete the chart from its worksheet.
    pub(crate) fn delete(&self) -> Result<(), ChartError> {
        self.ensure_exists()?;
        self.sheet
            .charts()
            .delete(&self.stable_id)
            .map_err(compute_error)?;
        Ok(())
    }

    fn ensure_exists(&self) -> Result<(), ChartError> {
        self.sheet
            .charts()
            .get(&self.stable_id)
            .map_err(compute_error)?
            .map(|_| ())
            .ok_or_else(|| item_not_found(&self.stable_id))
    }
}

const EMU_PER_POINT: f64 = 12_700.0;

fn chart_id(chart: &Value) -> String {
    chart
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn chart_name(chart: &Value) -> String {
    chart
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn chart_type(chart: &Value) -> Result<Value, ChartError> {
    chart
        .get("chartType")
        .cloned()
        .ok_or_else(|| encoding("Persisted chart has no chartType"))
}

fn number_property(chart: &Value, pointer: &str, property: &str) -> Result<Value, ChartError> {
    chart
        .pointer(pointer)
        .and_then(Value::as_f64)
        .and_then(serde_json::Number::from_f64)
        .map(Value::Number)
        .ok_or_else(|| encoding(format!("Persisted chart has no finite {property}")))
}

fn chart_position(
    sheet: &Sheet,
    chart: &Value,
    side: &str,
    anchor_pointer: &str,
) -> Result<Value, ChartError> {
    if let Some(value) = chart
        .get(match side {
            "left" => "leftPt",
            "top" => "topPt",
            _ => unreachable!("chart position side is validated by callers"),
        })
        .and_then(Value::as_f64)
        .and_then(serde_json::Number::from_f64)
    {
        return Ok(Value::Number(value));
    }

    // A chart created from a cell anchor may carry only EMU offsets. Resolve
    // the cell origin through the persisted worksheet layout, then expose the
    // result in the Office.js point unit used by `left` and `top`.
    let anchor = chart.get("anchor");
    let anchor_index = anchor
        .and_then(|anchor| {
            anchor
                .get(if side == "left" {
                    "anchorCol"
                } else {
                    "anchorRow"
                })
                .and_then(Value::as_u64)
        })
        .and_then(|index| u32::try_from(index).ok())
        .unwrap_or(0);
    let origin = if side == "left" {
        (0..anchor_index).try_fold(0.0, |total, column| {
            sheet
                .layout()
                .get_col_width(column)
                .map(|width| total + width)
                .map_err(compute_error)
        })?
    } else {
        (0..anchor_index).try_fold(0.0, |total, row| {
            sheet
                .layout()
                .get_row_height(row)
                .map(|height| total + height)
                .map_err(compute_error)
        })?
    };
    let emu = chart
        .pointer(anchor_pointer)
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    serde_json::Number::from_f64(origin + emu / EMU_PER_POINT)
        .map(Value::Number)
        .ok_or_else(|| encoding(format!("Persisted chart has no finite Chart.{side}")))
}

fn resolve_range(address: &str, property: &str) -> Result<(u32, u32, u32, u32), ChartError> {
    validate_range(address, property)?;
    CellRange::from(address).resolve().map_err(compute_error)
}

fn validate_range(address: &str, property: &str) -> Result<(), ChartError> {
    let (start_row, start_col, end_row, end_col) =
        CellRange::from(address).resolve().map_err(compute_error)?;
    if start_row > end_row || start_col > end_col {
        return Err(invalid(format!("{property} must be a non-empty range")));
    }
    Ok(())
}

fn series_orientation(series_by: Option<&str>) -> Result<Option<&'static str>, ChartError> {
    match series_by {
        None | Some("Auto") => Ok(None),
        Some("Rows") => Ok(Some("rows")),
        Some("Columns") => Ok(Some("columns")),
        Some(other) => Err(invalid(format!(
            "Chart seriesBy must be Auto, Rows, or Columns; got '{other}'"
        ))),
    }
}

fn required_string<'a>(value: &'a str, property: &str) -> Result<&'a str, ChartError> {
    if value.trim().is_empty() {
        Err(invalid(format!("{property} must be a non-empty string")))
    } else {
        Ok(value)
    }
}

fn required_value_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, ChartError> {
    value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a string")))
        .and_then(|value| required_string(value, property))
}

fn required_finite_number(value: &Value, property: &str) -> Result<f64, ChartError> {
    let number = value
        .as_f64()
        .ok_or_else(|| invalid(format!("{property} must be a number")))?;
    if !number.is_finite() {
        return Err(invalid(format!("{property} must be finite")));
    }
    Ok(number)
}

fn checked_collection_index(index: i64, length: usize, kind: &str) -> Result<usize, ChartError> {
    let index = usize::try_from(index).map_err(|_| item_not_found(&index.to_string()))?;
    if index >= length {
        return Err(ChartError {
            code: "ItemNotFound",
            message: format!("The requested {kind} index {index} is outside the collection."),
        });
    }
    Ok(index)
}

fn compute_error(error: compute_api::ComputeApiError) -> ChartError {
    let code = match &error {
        compute_api::ComputeApiError::SheetNotFound { .. } => "ItemNotFound",
        compute_api::ComputeApiError::InvalidAddress { .. }
        | compute_api::ComputeApiError::InvalidRange { .. } => "InvalidArgument",
        compute_api::ComputeApiError::InvalidOperation(_) => "InvalidOperation",
        _ => "GeneralException",
    };
    ChartError {
        code,
        message: error.to_string(),
    }
}

fn encoding(error: impl std::fmt::Display) -> ChartError {
    ChartError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn item_not_found(key: &str) -> ChartError {
    ChartError {
        code: "ItemNotFound",
        message: format!("The requested chart doesn't exist. Name or ID: {key}"),
    }
}

fn invalid(message: String) -> ChartError {
    ChartError {
        code: "InvalidArgument",
        message,
    }
}

fn unsupported_load_property(property: &str) -> ChartError {
    ChartError {
        code: "InvalidArgument",
        message: format!("Chart.{property} is not supported by this Office.js host"),
    }
}
