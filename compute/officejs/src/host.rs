use std::collections::HashMap;
use std::sync::Mutex;

use compute_api::{CellAddress, Sheet, Workbook};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use value_types::CellValue;

#[derive(Debug, Deserialize)]
#[serde(tag = "op")]
enum Op {
    #[serde(rename = "getItem")]
    GetItem { id: String, name: String },
    #[serde(rename = "getActiveWorksheet")]
    GetActiveWorksheet { id: String },
    #[serde(rename = "addWorksheet")]
    AddWorksheet { id: String, name: Option<String> },
    #[serde(rename = "getRange")]
    GetRange {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        address: String,
    },
    #[serde(rename = "addName")]
    AddName {
        #[serde(rename = "id")]
        _id: String,
        name: String,
        #[serde(rename = "rangeId")]
        range_id: Option<String>,
        formula: Option<String>,
    },
    #[serde(rename = "addChart")]
    AddChart {
        id: String,
        #[serde(rename = "worksheetId")]
        worksheet_id: String,
        #[serde(rename = "chartType")]
        chart_type: String,
        #[serde(rename = "sourceRangeId")]
        source_range_id: String,
    },
    #[serde(rename = "set")]
    Set {
        id: String,
        property: String,
        value: Value,
    },
    #[serde(rename = "load")]
    Load { id: String, properties: Vec<String> },
}

#[derive(Debug, Serialize)]
struct BatchError {
    code: &'static str,
    message: String,
}

#[derive(Debug, Serialize)]
struct BatchResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BatchError>,
    #[serde(default)]
    loaded: HashMap<String, HashMap<String, Value>>,
}

struct RangeRef {
    sheet: Sheet,
    bounds: (u32, u32, u32, u32),
}

struct ChartRef {
    sheet: Sheet,
    chart_id: String,
    title: Option<String>,
    category_title: Option<String>,
    value_title: Option<String>,
}

pub(crate) struct Host {
    workbook: Workbook,
    sheets: Mutex<HashMap<String, Sheet>>,
    ranges: Mutex<HashMap<String, RangeRef>>,
    charts: Mutex<HashMap<String, ChartRef>>,
    stdout: Mutex<String>,
}

impl Host {
    pub(crate) fn new(workbook: Workbook) -> Self {
        Self {
            workbook,
            sheets: Mutex::new(HashMap::new()),
            ranges: Mutex::new(HashMap::new()),
            charts: Mutex::new(HashMap::new()),
            stdout: Mutex::new(String::new()),
        }
    }

    pub(crate) fn log(&self, line: &str) {
        let mut stdout = self.stdout.lock().expect("stdout lock");
        if !stdout.is_empty() {
            stdout.push('\n');
        }
        stdout.push_str(line);
        println!("{line}");
    }

    pub(crate) fn take_stdout(&self) -> String {
        self.stdout.lock().expect("stdout lock").clone()
    }

    pub(crate) fn apply_json(&self, raw: &str) -> String {
        match self.apply_ops(raw) {
            Ok(result) => serde_json::to_string(&result).unwrap_or_else(|_| {
                json!({
                    "error": { "code": "GeneralException", "message": "failed to encode sync result" }
                })
                .to_string()
            }),
            Err(err) => serde_json::to_string(&BatchResult {
                error: Some(err),
                loaded: HashMap::new(),
            })
            .expect("batch error encodes"),
        }
    }

    fn apply_ops(&self, raw: &str) -> Result<BatchResult, BatchError> {
        let ops: Vec<Op> = serde_json::from_str(raw).map_err(|e| BatchError {
            code: "InvalidArgument",
            message: format!("invalid Office.js batch: {e}"),
        })?;

        if !ops.iter().any(|op| {
            matches!(
                op,
                Op::AddWorksheet { .. } | Op::Set { .. } | Op::AddName { .. } | Op::AddChart { .. }
            )
        }) {
            return self.apply_batch(ops);
        }

        // One mutating context.sync() is one user action. Nesting lets callers
        // combine several syncs with an explicit WorkbookHistory group.
        let history = self.workbook.history();
        history.begin_undo_group().map_err(engine_error)?;
        let result = self.apply_batch(ops);
        let end_result = history.end_undo_group().map_err(engine_error);

        // A failed batch retains its successful prefix. Close the group even
        // on that path, and preserve the original operation's error.
        match result {
            Ok(batch) => {
                end_result?;
                Ok(batch)
            }
            Err(error) => Err(error),
        }
    }

    fn apply_batch(&self, ops: Vec<Op>) -> Result<BatchResult, BatchError> {
        let mut loaded = HashMap::new();
        for op in ops {
            match op {
                Op::GetItem { id, name } => {
                    let sheet = self.workbook.sheet_by_name(&name).map_err(|_| BatchError {
                        code: "ItemNotFound",
                        message: format!("The requested resource doesn't exist. Name: {name}"),
                    })?;
                    self.sheets.lock().expect("sheets lock").insert(id, sheet);
                }
                Op::GetActiveWorksheet { id } => {
                    let names = self.workbook.sheet_names().map_err(engine_error)?;
                    let name = names.first().ok_or_else(|| BatchError {
                        code: "ItemNotFound",
                        message: "The workbook has no worksheets.".to_string(),
                    })?;
                    let sheet = self.workbook.sheet_by_name(name).map_err(engine_error)?;
                    self.sheets.lock().expect("sheets lock").insert(id, sheet);
                }
                Op::AddWorksheet { id, name } => {
                    let name = match name {
                        Some(n) if !n.is_empty() => n,
                        _ => unique_sheet_name(&self.workbook)?,
                    };
                    self.workbook
                        .sheets()
                        .create_sheet(&name)
                        .map_err(engine_error)?;
                    let sheet = self.workbook.sheet_by_name(&name).map_err(engine_error)?;
                    self.sheets.lock().expect("sheets lock").insert(id, sheet);
                }
                Op::GetRange {
                    id,
                    worksheet_id,
                    address,
                } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?;
                    // Resolve A1 at the scripting boundary. Keep compact bounds for all
                    // subsequent operations; empty ranges need no allocated cell IDs.
                    let bounds = compute_api::CellRange::from(address.as_str())
                        .resolve()
                        .map_err(|e| BatchError {
                            code: "InvalidArgument",
                            message: e.to_string(),
                        })?;
                    self.ranges
                        .lock()
                        .expect("ranges lock")
                        .insert(id, RangeRef { sheet, bounds });
                }
                Op::AddName {
                    name,
                    range_id,
                    formula,
                    _id: _,
                } => {
                    let refers_to = if let Some(range_id) = range_id {
                        let ranges = self.ranges.lock().expect("ranges lock");
                        let range = ranges.get(&range_id).ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The range object is not available.".to_string(),
                        })?;
                        let sheet_name = range.sheet.name().map_err(engine_error)?;
                        range_formula(&sheet_name, range.bounds)
                    } else {
                        let raw = formula.unwrap_or_default();
                        if raw.trim().is_empty() {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: "names.add requires a range or formula".to_string(),
                            });
                        }
                        if raw.starts_with('=') {
                            raw
                        } else {
                            format!("={raw}")
                        }
                    };
                    self.workbook
                        .names()
                        .create_named_range(compute_api::DefinedNameInput {
                            name,
                            refers_to,
                            scope: None,
                            comment: None,
                        })
                        .map_err(engine_error)?;
                }
                Op::AddChart {
                    id,
                    worksheet_id,
                    chart_type,
                    source_range_id,
                } => {
                    let sheet = self
                        .sheets
                        .lock()
                        .expect("sheets lock")
                        .get(&worksheet_id)
                        .cloned()
                        .ok_or_else(|| BatchError {
                            code: "InvalidObjectPath",
                            message: "The worksheet object is not available.".to_string(),
                        })?;
                    let ranges = self.ranges.lock().expect("ranges lock");
                    let range = ranges.get(&source_range_id).ok_or_else(|| BatchError {
                        code: "InvalidObjectPath",
                        message: "The range object is not available.".to_string(),
                    })?;
                    let sheet_name = range.sheet.name().map_err(engine_error)?;
                    let data_range = unqualified_range_formula(&sheet_name, range.bounds);
                    let config = json!({
                        "type": map_chart_type(&chart_type),
                        "dataRange": data_range,
                    });
                    let result = sheet.charts().create(&config).map_err(engine_error)?;
                    let chart_id = result
                        .data
                        .as_ref()
                        .and_then(|data| {
                            data.as_str().map(str::to_string).or_else(|| {
                                data.get("id").and_then(Value::as_str).map(str::to_string)
                            })
                        })
                        .ok_or_else(|| BatchError {
                            code: "GeneralException",
                            message: "chart creation did not return an id".to_string(),
                        })?;
                    self.charts.lock().expect("charts lock").insert(
                        id,
                        ChartRef {
                            sheet,
                            chart_id,
                            title: None,
                            category_title: None,
                            value_title: None,
                        },
                    );
                }
                Op::Set {
                    id,
                    property,
                    value,
                } => {
                    if self.charts.lock().expect("charts lock").contains_key(&id) {
                        self.set_chart_property(&id, &property, &value)?;
                        continue;
                    }
                    let ranges = self.ranges.lock().expect("ranges lock");
                    let range = ranges.get(&id).ok_or_else(|| BatchError {
                        code: "InvalidObjectPath",
                        message: "The range object is not available.".to_string(),
                    })?;
                    let grid = json_to_write_grid(&value)?;
                    match property.as_str() {
                        "values" | "formulas" => {
                            range
                                .sheet
                                .set_range(range.bounds, &grid)
                                .map_err(engine_error)?;
                        }
                        other => {
                            return Err(BatchError {
                                code: "InvalidArgument",
                                message: format!("Unsupported Range property '{other}'"),
                            });
                        }
                    }
                }
                Op::Load { id, properties } => {
                    let mut props = HashMap::new();
                    if let Some(sheet) = self.sheets.lock().expect("sheets lock").get(&id) {
                        for property in &properties {
                            if property == "name" {
                                props.insert(
                                    "name".to_string(),
                                    Value::String(sheet.name().map_err(engine_error)?),
                                );
                            }
                        }
                    }
                    if let Some(range) = self.ranges.lock().expect("ranges lock").get(&id) {
                        for property in &properties {
                            match property.as_str() {
                                "values" => {
                                    props.insert(
                                        "values".to_string(),
                                        range_values_json(&range.sheet, range.bounds)?,
                                    );
                                }
                                "formulas" => {
                                    props.insert(
                                        "formulas".to_string(),
                                        range_formulas_json(&range.sheet, range.bounds)?,
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                    if !props.is_empty() {
                        loaded.insert(id, props);
                    }
                }
            }
        }
        Ok(BatchResult {
            error: None,
            loaded,
        })
    }

    fn set_chart_property(
        &self,
        id: &str,
        property: &str,
        value: &Value,
    ) -> Result<(), BatchError> {
        let mut charts = self.charts.lock().expect("charts lock");
        let chart = charts.get_mut(id).ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "The chart object is not available.".to_string(),
        })?;
        let text = match value {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        match property {
            "title.text" => chart.title = Some(text),
            "axes.categoryAxis.title.text" => chart.category_title = Some(text),
            "axes.valueAxis.title.text" => chart.value_title = Some(text),
            other => {
                return Err(BatchError {
                    code: "InvalidArgument",
                    message: format!("Unsupported Chart property '{other}'"),
                });
            }
        }
        let mut config = json!({});
        if let Some(title) = &chart.title {
            config["title"] = json!(title);
        }
        let mut axes = json!({});
        if let Some(title) = &chart.category_title {
            axes["categoryAxis"] = json!({ "title": title, "visible": true });
        }
        if let Some(title) = &chart.value_title {
            axes["valueAxis"] = json!({ "title": title, "visible": true });
        }
        if axes.as_object().is_some_and(|obj| !obj.is_empty()) {
            // ChartData JSON uses `axis` (singular); ChartSpec uses `axes`.
            config["axis"] = axes;
        }
        chart
            .sheet
            .charts()
            .update(&chart.chart_id, &config)
            .map_err(engine_error)?;
        Ok(())
    }
}

fn map_chart_type(chart_type: &str) -> &'static str {
    match chart_type.to_ascii_lowercase().as_str() {
        "columnclustered" | "column" | "columnclusteredchart" => "column",
        "barclustered" | "bar" => "bar",
        "line" => "line",
        "pie" => "pie",
        "area" => "area",
        "scatter" | "xyscatter" => "scatter",
        other if other.contains("column") => "column",
        _ => "column",
    }
}

fn col_letter(mut col: u32) -> String {
    let mut out = String::new();
    col += 1;
    while col > 0 {
        col -= 1;
        out.insert(0, (b'A' + (col % 26) as u8) as char);
        col /= 26;
    }
    out
}

fn range_formula(sheet_name: &str, bounds: (u32, u32, u32, u32)) -> String {
    let (sr, sc, er, ec) = bounds;
    format!(
        "='{sheet_name}'!${}${}:${}${}",
        col_letter(sc),
        sr + 1,
        col_letter(ec),
        er + 1
    )
}

fn unqualified_range_formula(sheet_name: &str, bounds: (u32, u32, u32, u32)) -> String {
    let (sr, sc, er, ec) = bounds;
    format!(
        "{sheet_name}!{}{}:{}{}",
        col_letter(sc),
        sr + 1,
        col_letter(ec),
        er + 1
    )
}

fn unique_sheet_name(workbook: &Workbook) -> Result<String, BatchError> {
    let names = workbook.sheet_names().map_err(engine_error)?;
    for i in 1..10_000 {
        let candidate = format!("Sheet{i}");
        if !names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            return Ok(candidate);
        }
    }
    Err(BatchError {
        code: "GeneralException",
        message: "Unable to generate a unique worksheet name".to_string(),
    })
}

fn engine_error(err: impl std::fmt::Display) -> BatchError {
    BatchError {
        code: "GeneralException",
        message: err.to_string(),
    }
}

fn json_to_write_grid(value: &Value) -> Result<Vec<Vec<String>>, BatchError> {
    let rows = value.as_array().ok_or_else(|| BatchError {
        code: "InvalidArgument",
        message: "Range.values and Range.formulas require a 2-dimensional array".to_string(),
    })?;
    let mut grid = Vec::with_capacity(rows.len());
    for row in rows {
        let cells = row.as_array().ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: "Range.values and Range.formulas require a 2-dimensional array".to_string(),
        })?;
        let mut out_row = Vec::with_capacity(cells.len());
        for cell in cells {
            out_row.push(js_cell_to_write(cell));
        }
        grid.push(out_row);
    }
    Ok(grid)
}

fn js_cell_to_write(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(true) => "TRUE".to_string(),
        Value::Bool(false) => "FALSE".to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn range_values_json(sheet: &Sheet, bounds: (u32, u32, u32, u32)) -> Result<Value, BatchError> {
    let (sr, sc, er, ec) = bounds;
    let values = sheet
        .get_range_values_2d(compute_api::CellRange::Bounds(sr, sc, er, ec))
        .map_err(engine_error)?;
    Ok(Value::Array(
        values
            .into_iter()
            .map(|row| Value::Array(row.into_iter().map(cell_to_js).collect()))
            .collect(),
    ))
}

fn range_formulas_json(sheet: &Sheet, bounds: (u32, u32, u32, u32)) -> Result<Value, BatchError> {
    let (sr, sc, er, ec) = bounds;
    let mut rows = Vec::new();
    for row in sr..=er {
        let mut cells = Vec::new();
        for col in sc..=ec {
            let addr = CellAddress::Position(row, col);
            if let Some(formula) = sheet.get_formula(addr.clone()).map_err(engine_error)? {
                cells.push(Value::String(formula));
            } else {
                cells.push(cell_to_js(
                    sheet.get_cell_value(addr).map_err(engine_error)?,
                ));
            }
        }
        rows.push(Value::Array(cells));
    }
    Ok(Value::Array(rows))
}

fn cell_to_js(value: CellValue) -> Value {
    match value {
        CellValue::Null => Value::Null,
        CellValue::Boolean(b) => Value::Bool(b),
        CellValue::Number(_) => value.as_number().map(|n| json!(n)).unwrap_or(Value::Null),
        CellValue::Text(s) => Value::String(s.to_string()),
        CellValue::Error(err, _) => Value::String(err.to_string()),
        other => Value::String(other.to_string()),
    }
}
