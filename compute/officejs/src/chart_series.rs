//! Office.js chart series and series collection bindings.
//!
//! A series does not have a persisted identity in the compute engine.  The
//! adapter therefore keeps only the chart's stable ID and the current ordinal
//! position.  Every operation reads the chart again before it acts.  This is
//! deliberate: inserting or deleting a series must immediately be visible to
//! all existing proxies, and a proxy must never carry a second, stale series
//! list in the Office.js host.

use crate::chart_core::{ChartError, ChartRef};
use compute_api::{CellRange, Sheet, Workbook};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::HashMap;

/// Errors returned by the chart series Office.js adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartSeriesError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// A series item in a `ChartSeriesCollection` hydration response.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ChartSeriesCollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A worksheet/chart scoped series collection.
///
/// `Workbook` is retained for resolving a formula that names another
/// worksheet.  `ChartRef` remains the owner of chart persistence and lookup;
/// the collection does not cache a copied series vector.
#[derive(Clone)]
pub(crate) struct ChartSeriesCollectionRef {
    workbook: Workbook,
    chart: ChartRef,
}

/// A series proxy anchored by the chart's stable engine ID and current index.
#[derive(Clone)]
pub(crate) struct ChartSeriesRef {
    workbook: Workbook,
    chart: ChartRef,
    index: usize,
}

const DEFAULT_SERIES_PROPERTIES: &[&str] = &["name", "axisGroup", "chartType"];

impl ChartSeriesCollectionRef {
    /// Construct a series collection owned by `chart`.
    pub(crate) fn new(workbook: Workbook, chart: ChartRef) -> Self {
        Self { workbook, chart }
    }

    /// Construct a collection from a workbook/sheet/stable chart ID tuple.
    /// This is useful to host dispatchers that store only the chart identity.
    pub(crate) fn from_parts(
        workbook: Workbook,
        sheet: Sheet,
        chart_id: impl Into<String>,
    ) -> Self {
        Self::new(workbook, ChartRef::new(sheet, chart_id))
    }

    pub(crate) fn chart(&self) -> ChartRef {
        self.chart.clone()
    }

    /// Return the current number of series in the persisted chart.
    pub(crate) fn count(&self) -> Result<usize, ChartSeriesError> {
        Ok(read_series(&self.chart_snapshot()?).len())
    }

    /// Alias for hosts that model collection count as `getCount`.
    pub(crate) fn get_count(&self) -> Result<usize, ChartSeriesError> {
        self.count()
    }

    /// Return a series proxy for a zero-based current collection position.
    pub(crate) fn get_item_at(&self, index: i64) -> Result<ChartSeriesRef, ChartSeriesError> {
        let series = read_series(&self.chart_snapshot()?);
        let index = checked_index(index, series.len())?;
        Ok(self.series_ref(index))
    }

    /// Add a new series and return its newly inserted proxy.
    pub(crate) fn add(
        &self,
        name: Option<&str>,
        index: Option<i64>,
    ) -> Result<ChartSeriesRef, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let mut series = read_series(&snapshot);
        let insertion_index = match index {
            Some(index) => checked_insertion_index(index, series.len())?,
            None => series.len(),
        };

        let mut new_series = Map::new();
        if let Some(name) = name {
            new_series.insert(
                "name".to_string(),
                Value::String(validate_series_name(name)?.to_string()),
            );
        }
        series.insert(insertion_index, Value::Object(new_series));
        self.persist_series(series)?;
        Ok(self.series_ref(insertion_index))
    }

    /// Load collection properties, including `items` descriptors.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ChartSeriesError> {
        let requested = if properties.is_empty() {
            vec!["count".to_string()]
        } else {
            properties.to_vec()
        };
        let snapshot = self.chart_snapshot()?;
        let series = read_series(&snapshot);
        let mut result = HashMap::new();
        let mut item_properties = Vec::new();
        let mut load_items = false;

        for property in requested {
            match property.as_str() {
                "count" => {
                    result.insert(property, json!(series.len()));
                }
                "isNullObject" => {
                    result.insert(property, Value::Bool(false));
                }
                "items" => {
                    load_items = true;
                }
                item_path if item_path.starts_with("items/") => {
                    let item_property = item_path.trim_start_matches("items/");
                    if item_property.is_empty() || item_property.contains('/') {
                        return Err(invalid(format!(
                            "Invalid ChartSeriesCollection item property '{item_path}'"
                        )));
                    }
                    load_items = true;
                    item_properties.push(item_property.to_string());
                }
                other => {
                    return Err(unsupported_collection_property(other));
                }
            }
        }

        if load_items {
            if item_properties.is_empty() {
                item_properties = DEFAULT_SERIES_PROPERTIES
                    .iter()
                    .map(|property| (*property).to_string())
                    .collect();
            }
            let items = series
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    Ok(ChartSeriesCollectionItem {
                        key: index.to_string(),
                        properties: project_series(
                            &snapshot,
                            item,
                            index,
                            &item_properties,
                            &self.workbook,
                            &self.chart.sheet(),
                        )?,
                    })
                })
                .collect::<Result<Vec<_>, ChartSeriesError>>()?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(items).map_err(encoding)?,
            );
        }

        Ok(result)
    }

    /// Return item descriptors for collection hydration helpers.
    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<ChartSeriesCollectionItem>, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let series = read_series(&snapshot);
        let properties = if properties.is_empty() {
            DEFAULT_SERIES_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };
        series
            .iter()
            .enumerate()
            .map(|(index, item)| {
                Ok(ChartSeriesCollectionItem {
                    key: index.to_string(),
                    properties: project_series(
                        &snapshot,
                        item,
                        index,
                        &properties,
                        &self.workbook,
                        &self.chart.sheet(),
                    )?,
                })
            })
            .collect()
    }

    fn series_ref(&self, index: usize) -> ChartSeriesRef {
        ChartSeriesRef {
            workbook: self.workbook.clone(),
            chart: self.chart.clone(),
            index,
        }
    }

    fn chart_snapshot(&self) -> Result<Value, ChartSeriesError> {
        self.chart.snapshot().map_err(from_chart_error)
    }

    fn persist_series(&self, series: Vec<Value>) -> Result<(), ChartSeriesError> {
        self.chart
            .update_fields(&json!({ "series": series }))
            .map_err(from_chart_error)
    }
}

impl ChartSeriesRef {
    pub(crate) fn new(workbook: Workbook, chart: ChartRef, index: usize) -> Self {
        Self {
            workbook,
            chart,
            index,
        }
    }

    pub(crate) fn chart(&self) -> ChartRef {
        self.chart.clone()
    }

    pub(crate) fn index(&self) -> usize {
        self.index
    }

    /// Load current scalar series properties from the engine-backed chart.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let series = current_series(&snapshot, self.index)?;
        let properties = if properties.is_empty() {
            DEFAULT_SERIES_PROPERTIES
                .iter()
                .map(|property| (*property).to_string())
                .collect::<Vec<_>>()
        } else {
            properties.to_vec()
        };
        project_series(
            &snapshot,
            series,
            self.index,
            &properties,
            &self.workbook,
            &self.chart.sheet(),
        )
    }

    /// Set a writable scalar series property and persist the complete series
    /// vector through the chart owner.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let mut series = read_series(&snapshot);
        let target = series
            .get_mut(self.index)
            .ok_or_else(|| item_not_found(self.index))?;
        let target = target
            .as_object_mut()
            .ok_or_else(|| invalid("Persisted chart series must be an object"))?;

        match property {
            "name" => {
                let name = value
                    .as_str()
                    .ok_or_else(|| invalid("ChartSeries.name must be a string"))?;
                target.insert(
                    "name".to_string(),
                    Value::String(validate_series_name(name)?.to_string()),
                );
            }
            "axisGroup" => {
                let axis_group = value
                    .as_str()
                    .ok_or_else(|| invalid("ChartSeries.axisGroup must be a string"))?;
                let axis_index = match axis_group {
                    "Primary" => 0,
                    "Secondary" => 1,
                    other => {
                        return Err(invalid(format!(
                            "ChartSeries.axisGroup must be Primary or Secondary; got '{other}'"
                        )));
                    }
                };
                target.insert("yAxisIndex".to_string(), json!(axis_index));
            }
            "chartType" => {
                let chart_type = value
                    .as_str()
                    .ok_or_else(|| invalid("ChartSeries.chartType must be a string"))?;
                if chart_type.trim().is_empty() {
                    return Err(invalid("ChartSeries.chartType must be a non-empty string"));
                }
                target.insert(
                    "type".to_string(),
                    Value::String(internal_chart_type(chart_type)),
                );
            }
            "filtered" | "smooth" => {
                let value = value
                    .as_bool()
                    .ok_or_else(|| invalid(format!("ChartSeries.{property} must be a boolean")))?;
                target.insert(property.to_string(), Value::Bool(value));
            }
            "plotOrder" => {
                let value = value
                    .as_i64()
                    .ok_or_else(|| invalid("ChartSeries.plotOrder must be an integer"))?;
                if value < 0 {
                    return Err(invalid("ChartSeries.plotOrder must be non-negative"));
                }
                target.insert("plotOrder".to_string(), json!(value));
            }
            "isNullObject" => {
                return Err(invalid("ChartSeries.isNullObject is read-only"));
            }
            other => return Err(unsupported_series_property(other)),
        }

        self.persist_series(series)
    }

    /// Delete this series from the current chart.
    pub(crate) fn delete(&self) -> Result<(), ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let mut series = read_series(&snapshot);
        if self.index >= series.len() {
            return Err(item_not_found(self.index));
        }
        series.remove(self.index);
        self.persist_series(series)
    }

    /// Get a formula/source string for one of the chart's data dimensions.
    pub(crate) fn get_dimension_data_source_string(
        &self,
        dimension: &str,
    ) -> Result<String, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let series = current_series(&snapshot, self.index)?;
        dimension_source(&snapshot, series, dimension).map(|source| source.unwrap_or_default())
    }

    /// Return the source kind used by one chart data dimension.
    pub(crate) fn get_dimension_data_source_type(
        &self,
        dimension: &str,
    ) -> Result<String, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let series = current_series(&snapshot, self.index)?;
        let source = dimension_source(&snapshot, series, dimension)?;
        Ok(source_type(source.as_deref()))
    }

    /// Resolve one chart data dimension to display strings from the source
    /// range.  A cached chart point is used only when no source formula exists.
    pub(crate) fn get_dimension_values(
        &self,
        dimension: &str,
    ) -> Result<Vec<String>, ChartSeriesError> {
        let snapshot = self.chart_snapshot()?;
        let series = current_series(&snapshot, self.index)?;
        let source = dimension_source(&snapshot, series, dimension)?;
        if let Some(source) = source {
            return resolve_source_values(&self.workbook, &self.chart.sheet(), &source);
        }
        Ok(cached_dimension_values(series, dimension))
    }

    /// Bind a chart data dimension to an Office.js Range proxy's source.
    pub(crate) fn set_dimension_source(
        &self,
        dimension: &str,
        source_sheet: &Sheet,
        source_address: &str,
    ) -> Result<(), ChartSeriesError> {
        let source = source_formula(source_sheet, source_address)?;
        let snapshot = self.chart_snapshot()?;
        let mut series = read_series(&snapshot);
        let target = series
            .get_mut(self.index)
            .ok_or_else(|| item_not_found(self.index))?;
        let target = target
            .as_object_mut()
            .ok_or_else(|| invalid("Persisted chart series must be an object"))?;

        match dimension {
            "Categories" => {
                target.insert("categories".to_string(), Value::String(source));
            }
            "Values" | "YValues" => {
                target.insert("values".to_string(), Value::String(source));
            }
            "XValues" => {
                target.insert("categories".to_string(), Value::String(source));
                target.insert(
                    "xRole".to_string(),
                    Value::String("quantitative".to_string()),
                );
            }
            "BubbleSizes" => {
                target.insert("bubbleSize".to_string(), Value::String(source));
            }
            other => return Err(unsupported_dimension(other)),
        }
        self.persist_series(series)
    }

    // Concise aliases make the host adapter insensitive to whether it names
    // these operations after the Office.js method or the persisted dimension.
    pub(crate) fn dimension_source_string(
        &self,
        dimension: &str,
    ) -> Result<String, ChartSeriesError> {
        self.get_dimension_data_source_string(dimension)
    }

    pub(crate) fn dimension_source_type(
        &self,
        dimension: &str,
    ) -> Result<String, ChartSeriesError> {
        self.get_dimension_data_source_type(dimension)
    }

    pub(crate) fn dimension_values(
        &self,
        dimension: &str,
    ) -> Result<Vec<String>, ChartSeriesError> {
        self.get_dimension_values(dimension)
    }

    fn chart_snapshot(&self) -> Result<Value, ChartSeriesError> {
        self.chart.snapshot().map_err(from_chart_error)
    }

    fn persist_series(&self, series: Vec<Value>) -> Result<(), ChartSeriesError> {
        self.chart
            .update_fields(&json!({ "series": series }))
            .map_err(from_chart_error)
    }
}

fn read_series(chart: &Value) -> Vec<Value> {
    chart
        .get("series")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn current_series(chart: &Value, index: usize) -> Result<&Value, ChartSeriesError> {
    chart
        .get("series")
        .and_then(Value::as_array)
        .and_then(|series| series.get(index))
        .ok_or_else(|| item_not_found(index))
}

fn project_series(
    chart: &Value,
    series: &Value,
    index: usize,
    properties: &[String],
    workbook: &Workbook,
    default_sheet: &Sheet,
) -> Result<HashMap<String, Value>, ChartSeriesError> {
    let mut result = HashMap::new();
    for property in properties {
        let value = match property.as_str() {
            "name" => Value::String(series_name(series, index, workbook, default_sheet)),
            "axisGroup" => Value::String(axis_group(series)),
            "chartType" => Value::String(series_chart_type(chart, series)),
            "filtered" => Value::Bool(
                series
                    .get("filtered")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
            "smooth" => Value::Bool(
                series
                    .get("smooth")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
            "plotOrder" => series
                .get("plotOrder")
                .cloned()
                .unwrap_or_else(|| json!(index)),
            "isNullObject" => Value::Bool(false),
            other => return Err(unsupported_series_property(other)),
        };
        result.insert(property.clone(), value);
    }
    Ok(result)
}

fn series_name(series: &Value, index: usize, workbook: &Workbook, default_sheet: &Sheet) -> String {
    if let Some(name) = series.get("name").and_then(Value::as_str) {
        return name.to_string();
    }
    if let Some(name_ref) = series.get("nameRef").and_then(Value::as_str)
        && let Ok(values) = resolve_source_values(workbook, default_sheet, name_ref)
        && let Some(name) = values.into_iter().find(|value| !value.is_empty())
    {
        return name;
    }
    format!("Series{}", index + 1)
}

fn axis_group(series: &Value) -> String {
    if series
        .get("yAxisIndex")
        .and_then(Value::as_i64)
        .is_some_and(|index| index > 0)
    {
        "Secondary".to_string()
    } else {
        "Primary".to_string()
    }
}

fn series_chart_type(chart: &Value, series: &Value) -> String {
    let token = series
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| chart.get("chartType").and_then(Value::as_str))
        .unwrap_or("ColumnClustered");
    office_chart_type(token)
}

fn office_chart_type(token: &str) -> String {
    match token {
        // Domain chart type tokens.
        "column" => "ColumnClustered",
        "column3D" => "3DColumnClustered",
        "bar" => "BarClustered",
        "bar3D" => "3DBarClustered",
        "line" => "Line",
        "line3D" => "3DLine",
        "pie" => "Pie",
        "pie3D" => "3DPie",
        "doughnut" => "Doughnut",
        "scatter" => "XYScatter",
        "area" => "Area",
        "area3D" => "3DArea",
        "radar" => "Radar",
        "bubble" => "Bubble",
        "stock" => "StockHLC",
        "surface" => "Surface",
        "surface3D" => "3DSurface",
        "ofPie" => "PieOfPie",
        "waterfall" => "Waterfall",
        "treemap" => "Treemap",
        "sunburst" => "Sunburst",
        "funnel" => "Funnel",
        "regionMap" => "RegionMap",
        "histogram" => "Histogram",
        "pareto" => "Pareto",
        "boxplot" => "Boxwhisker",
        _ => token,
    }
    .to_string()
}

fn internal_chart_type(token: &str) -> String {
    // `ChartType::Unknown` intentionally preserves Office's richer series
    // subtype tokens (ColumnStacked, XYScatterSmooth, and so on).  Storing
    // the token verbatim therefore keeps a series subtype round-trippable;
    // the read path maps only the domain's coarse chart tokens to Office's
    // public defaults.
    token.to_string()
}

fn dimension_source<'a>(
    chart: &'a Value,
    series: &'a Value,
    dimension: &str,
) -> Result<Option<String>, ChartSeriesError> {
    let field = match dimension {
        "Categories" => "categories",
        "Values" | "YValues" => "values",
        "XValues" => "categories",
        "BubbleSizes" => "bubbleSize",
        other => return Err(unsupported_dimension(other)),
    };
    if let Some(source) = series.get(field).and_then(Value::as_str) {
        return Ok(Some(source.to_string()));
    }
    if dimension == "Categories"
        && let Some(source) = chart.get("categoryRange").and_then(Value::as_str)
    {
        return Ok(Some(source.to_string()));
    }
    Ok(None)
}

fn source_type(source: Option<&str>) -> String {
    let Some(source) = source
        .map(str::trim)
        .map(|source| source.trim_start_matches('=').trim())
        .filter(|source| !source.is_empty())
    else {
        return "Unknown".to_string();
    };
    if source.contains('[') {
        "ExternalRange".to_string()
    } else if source.contains('!') || CellRange::from(source).resolve().is_ok() {
        "LocalRange".to_string()
    } else if source.contains(',') {
        "List".to_string()
    } else {
        "Unknown".to_string()
    }
}

fn cached_dimension_values(series: &Value, dimension: &str) -> Vec<String> {
    let field = match dimension {
        "Categories" => "categoriesValues",
        "Values" | "YValues" => "valuesValues",
        "XValues" => "xValuesValues",
        "BubbleSizes" => "bubbleSizeValues",
        _ => return Vec::new(),
    };
    let legacy_values = series
        .get(field)
        .and_then(Value::as_array)
        .map(|values| values.iter().map(value_to_string).collect::<Vec<_>>());
    if let Some(values) = legacy_values {
        return values;
    }

    let cache_field = match dimension {
        "Categories" | "XValues" => "categoryCache",
        "Values" | "YValues" => "valueCache",
        "BubbleSizes" => "bubbleSizeCache",
        _ => return Vec::new(),
    };
    series
        .get(cache_field)
        .and_then(|cache| cache.get("points"))
        .and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .filter_map(|point| point.get("value"))
                .map(value_to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn source_formula(sheet: &Sheet, address: &str) -> Result<String, ChartSeriesError> {
    let address = address.trim();
    let (start_row, start_col, end_row, end_col) =
        CellRange::from(address).resolve().map_err(compute_error)?;
    if start_row > end_row || start_col > end_col {
        return Err(invalid("ChartSeries source range must be non-empty"));
    }
    let sheet_name = sheet.name().map_err(compute_error)?;
    Ok(format!("{}!{}", quote_sheet_name(&sheet_name), address))
}

fn resolve_source_values(
    workbook: &Workbook,
    default_sheet: &Sheet,
    source: &str,
) -> Result<Vec<String>, ChartSeriesError> {
    let source = source.trim().trim_start_matches('=').trim();
    if source.contains('[') {
        return Err(unsupported_source(
            "External chart series sources are not available",
        ));
    }
    if !source.contains('!') && CellRange::from(source).resolve().is_err() && source.contains(',') {
        return Ok(source
            .split(',')
            .map(str::trim)
            .map(|value| {
                if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
                    value[1..value.len() - 1].replace("\"\"", "\"")
                } else {
                    value.to_string()
                }
            })
            .collect());
    }
    let (sheet, address) = split_source_reference(source, workbook, default_sheet)?;
    let values = sheet
        .get_range_values_2d(CellRange::from(address.as_str()))
        .map_err(compute_error)?;
    Ok(values
        .into_iter()
        .flatten()
        .map(|value| value.to_string())
        .collect())
}

fn split_source_reference(
    source: &str,
    workbook: &Workbook,
    default_sheet: &Sheet,
) -> Result<(Sheet, String), ChartSeriesError> {
    let Some(separator) = source.rfind('!') else {
        validate_bounded_range(source)?;
        return Ok((default_sheet.clone(), source.to_string()));
    };
    let sheet_token = source[..separator].trim();
    let address = source[separator + 1..].trim();
    if sheet_token.is_empty() || address.is_empty() {
        return Err(invalid(format!("Invalid chart series source '{source}'")));
    }
    let sheet_name = unquote_sheet_name(sheet_token);
    let sheet_count = workbook.sheet_count().map_err(compute_error)?;
    for index in 0..sheet_count {
        let sheet = workbook.sheet_by_index(index).map_err(compute_error)?;
        if sheet
            .name()
            .map_err(compute_error)?
            .eq_ignore_ascii_case(&sheet_name)
        {
            validate_bounded_range(address)?;
            return Ok((sheet, address.to_string()));
        }
    }
    Err(ChartSeriesError {
        code: "ItemNotFound",
        message: format!("The chart series source worksheet '{sheet_name}' does not exist"),
    })
}

fn validate_bounded_range(address: &str) -> Result<(), ChartSeriesError> {
    let (start_row, start_col, end_row, end_col) =
        CellRange::from(address).resolve().map_err(compute_error)?;
    if start_row > end_row || start_col > end_col {
        return Err(invalid("ChartSeries source range must be non-empty"));
    }
    Ok(())
}

fn quote_sheet_name(name: &str) -> String {
    if name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        name.to_string()
    } else {
        format!("'{}'", name.replace('\'', "''"))
    }
}

fn unquote_sheet_name(name: &str) -> String {
    let name = name.trim();
    if name.len() >= 2 && name.starts_with('\'') && name.ends_with('\'') {
        name[1..name.len() - 1].replace("''", "'")
    } else {
        name.to_string()
    }
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        _ => value.to_string(),
    }
}

fn checked_index(index: i64, length: usize) -> Result<usize, ChartSeriesError> {
    let index = usize::try_from(index).map_err(|_| item_not_found(index))?;
    if index >= length {
        return Err(item_not_found(index));
    }
    Ok(index)
}

fn checked_insertion_index(index: i64, length: usize) -> Result<usize, ChartSeriesError> {
    let index = usize::try_from(index)
        .map_err(|_| invalid("ChartSeries.add index must be non-negative"))?;
    if index > length {
        return Err(invalid(format!(
            "ChartSeries.add index {index} is outside the insertion range 0..={length}"
        )));
    }
    Ok(index)
}

fn validate_series_name(name: &str) -> Result<&str, ChartSeriesError> {
    if name.chars().count() > 255 {
        return Err(invalid("ChartSeries.name cannot exceed 255 characters"));
    }
    Ok(name)
}

fn from_chart_error(error: ChartError) -> ChartSeriesError {
    ChartSeriesError {
        code: error.code,
        message: error.message,
    }
}

fn compute_error(error: compute_api::ComputeApiError) -> ChartSeriesError {
    ChartSeriesError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: impl std::fmt::Display) -> ChartSeriesError {
    ChartSeriesError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn item_not_found(index: impl std::fmt::Display) -> ChartSeriesError {
    ChartSeriesError {
        code: "ItemNotFound",
        message: format!("The requested chart series index {index} does not exist"),
    }
}

fn invalid(message: impl Into<String>) -> ChartSeriesError {
    ChartSeriesError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported_collection_property(property: &str) -> ChartSeriesError {
    invalid(format!(
        "ChartSeriesCollection.{property} is unsupported or read-only"
    ))
}

fn unsupported_series_property(property: &str) -> ChartSeriesError {
    invalid(format!(
        "ChartSeries.{property} is unsupported by this Office.js host"
    ))
}

fn unsupported_dimension(dimension: &str) -> ChartSeriesError {
    invalid(format!(
        "Unsupported ChartSeriesDimension '{dimension}'; expected Categories, Values, XValues, YValues, or BubbleSizes"
    ))
}

fn unsupported_source(message: &str) -> ChartSeriesError {
    ChartSeriesError {
        code: "NotSupported",
        message: message.to_string(),
    }
}
