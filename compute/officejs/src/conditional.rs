//! Range.conditionalFormats host operations.

use std::collections::HashMap;

use domain_types::ConditionalFormat;
use serde_json::{Value, json};

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_navigation::parse_range_address;

pub(crate) struct ConditionalHandler;

impl ExtensionHandler for ConditionalHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(operation, "cfAdd" | "cfQuery" | "set")
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
            "cfQuery" => handle_query(operation, context),
            "cfAdd" => {
                let id = required_str(operation, "id")?;
                let range = context.range(required_str(operation, "rangeId")?)?;
                let cf_type = operation
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("CellValue");
                let object = ConditionalFormatRef::add(&range, cf_type, id)?;
                context.bind_object(id, std::sync::Arc::new(object));
                Ok(true)
            }
            "set" => {
                let Some(id) = operation.get("id").and_then(Value::as_str) else {
                    return Ok(false);
                };
                let Ok(object) = context.extension_object::<ConditionalFormatRef>(id) else {
                    return Ok(false);
                };
                let property = required_str(operation, "property")?;
                object.set(property, operation.get("value").unwrap_or(&Value::Null))?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

struct ConditionalFormatRef {
    sheet: compute_api::Sheet,
    format_id: String,
}

impl ConditionalFormatRef {
    fn add(range: &RangeRef, cf_type: &str, _format_id: &str) -> Result<Self, BatchError> {
        let bounds = range_bounds(range)?;
        let format_id = uuid::Uuid::new_v4().to_string();
        let rule = default_rule(cf_type, &format_id)?;
        let state = json!({
            "id": format_id,
            "sheetId": range.sheet().id().to_uuid_string(),
            "ranges": [{
                "startRow": bounds.0,
                "startCol": bounds.1,
                "endRow": bounds.2,
                "endCol": bounds.3,
            }],
            "rules": [rule],
        });
        persist(&range.sheet(), &state)?;
        Ok(Self {
            sheet: range.sheet(),
            format_id,
        })
    }

    fn state(&self) -> Result<Value, BatchError> {
        let format = self
            .sheet
            .conditional_formats()
            .get_all_rules()
            .map_err(engine)?
            .into_iter()
            .find(|f| f.id == self.format_id)
            .ok_or_else(missing)?;
        serde_json::to_value(format).map_err(engine)
    }

    fn apply_property(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        let mut state = self.state()?;
        apply_to_state(&mut state, property, value)?;
        self.sheet
            .conditional_formats()
            .update_rule(&self.format_id, state)
            .map_err(engine)?;
        Ok(())
    }
}

impl ExtensionObject for ConditionalFormatRef {
    fn object_type(&self) -> &'static str {
        "ConditionalFormat"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let state = self.state()?;
        let rule = &state["rules"][0];
        properties
            .iter()
            .map(|name| {
                let value = match name.as_str() {
                    "id" => json!(self.format_id),
                    "type" => json!(match rule["type"].as_str().unwrap_or("") {
                        "cellValue" => "CellValue",
                        "colorScale" => "ColorScale",
                        "dataBar" => "DataBar",
                        "iconSet" => "IconSet",
                        "containsText" => "ContainsText",
                        "expression" => "Custom",
                        "top10" => "TopBottom",
                        _ => "PresetCriteria",
                    }),
                    "priority" => rule["priority"].clone(),
                    "stopIfTrue" => json!(rule["stopIfTrue"].as_bool().unwrap_or(false)),
                    _ => {
                        return Err(invalid(format!(
                            "Unknown ConditionalFormat property: {name}"
                        )));
                    }
                };
                Ok((name.clone(), value))
            })
            .collect()
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.apply_property(property, value)
    }
}

fn missing() -> BatchError {
    BatchError {
        code: "ItemNotFound",
        message: "The conditional format was not found".into(),
    }
}

fn handle_query(op: &Value, context: &mut HostDispatchContext<'_>) -> Result<bool, BatchError> {
    let method = required_str(op, "method")?;
    if matches!(method, "delete" | "range") {
        let object =
            context.extension_object::<ConditionalFormatRef>(required_str(op, "sourceId")?)?;
        let state = object.state()?;
        if method == "delete" {
            object
                .sheet
                .conditional_formats()
                .delete_rule(&object.format_id)
                .map_err(engine)?;
        } else {
            let ranges = state["ranges"].as_array().ok_or_else(missing)?;
            let single = ranges.len() == 1;
            if !single && op["nullable"] != true {
                return Err(BatchError {
                    code: "InvalidOperation",
                    message: "The conditional format applies to multiple ranges".into(),
                });
            }
            let address = if single {
                let r = &ranges[0];
                Some(
                    crate::range_navigation::RangeAddress::Cells {
                        start_row: r["startRow"].as_u64().ok_or_else(missing)? as u32,
                        start_column: r["startCol"].as_u64().ok_or_else(missing)? as u32,
                        end_row: r["endRow"].as_u64().ok_or_else(missing)? as u32,
                        end_column: r["endCol"].as_u64().ok_or_else(missing)? as u32,
                    }
                    .to_a1(),
                )
            } else {
                None
            };
            context.bind_range(
                required_str(op, "id")?,
                RangeRef::new(object.sheet.clone(), address, !single),
                !single,
            );
        }
        return Ok(true);
    }
    let range = context.range(required_str(op, "rangeId")?)?;
    let (sr, sc, er, ec) = range_bounds(&range)?;
    let mut formats = range
        .sheet()
        .conditional_formats()
        .get_all_rules()
        .map_err(engine)?;
    formats.retain(|f| {
        f.ranges.iter().any(|r| {
            r.start_row() <= er && r.end_row() >= sr && r.start_col() <= ec && r.end_col() >= sc
        })
    });
    // Office.js collection indices follow rule priority, including imported rules.
    formats.sort_by_key(|f| f.rules.first().map(|r| r.priority()).unwrap_or(i32::MAX));
    match method {
        "count" => context.result(required_str(op, "id")?, json!(formats.len())),
        "clear" => {
            for format in formats {
                let remaining = format
                    .ranges
                    .iter()
                    .flat_map(|r| subtract_range(*r, (sr, sc, er, ec)))
                    .collect::<Vec<_>>();
                if remaining.is_empty() {
                    range
                        .sheet()
                        .conditional_formats()
                        .delete_rule(&format.id)
                        .map_err(engine)?;
                } else {
                    range
                        .sheet()
                        .conditional_formats()
                        .update_ranges(&format.id, remaining)
                        .map_err(engine)?;
                }
            }
        }
        "item" | "at" | "itemOrNull" => {
            let format = if method == "at" {
                let index = op["key"]
                    .as_u64()
                    .ok_or_else(|| invalid("index must be a non-negative integer"))?;
                formats.into_iter().nth(index as usize)
            } else {
                formats
                    .into_iter()
                    .find(|f| Some(f.id.as_str()) == op["key"].as_str())
            };
            let id = required_str(op, "id")?;
            if let Some(format) = format {
                context.bind_object(
                    id,
                    std::sync::Arc::new(ConditionalFormatRef {
                        sheet: range.sheet(),
                        format_id: format.id,
                    }),
                );
            } else if method == "itemOrNull" {
                context.bind_null(id);
            } else {
                return Err(missing());
            }
        }
        _ => return Err(invalid("Unknown conditional format operation")),
    }
    Ok(true)
}

fn subtract_range(
    range: domain_types::CFCellRange,
    (sr, sc, er, ec): (u32, u32, u32, u32),
) -> Vec<domain_types::CFCellRange> {
    let (top, left, bottom, right) = (
        range.start_row().max(sr),
        range.start_col().max(sc),
        range.end_row().min(er),
        range.end_col().min(ec),
    );
    if top > bottom || left > right {
        return vec![range];
    }
    let mut result = Vec::new();
    if range.start_row() < top {
        result.push(domain_types::CFCellRange::new(
            range.start_row(),
            range.start_col(),
            top - 1,
            range.end_col(),
        ));
    }
    if bottom < range.end_row() {
        result.push(domain_types::CFCellRange::new(
            bottom + 1,
            range.start_col(),
            range.end_row(),
            range.end_col(),
        ));
    }
    if range.start_col() < left {
        result.push(domain_types::CFCellRange::new(
            top,
            range.start_col(),
            bottom,
            left - 1,
        ));
    }
    if right < range.end_col() {
        result.push(domain_types::CFCellRange::new(
            top,
            right + 1,
            bottom,
            range.end_col(),
        ));
    }
    result
}

fn persist(sheet: &compute_api::Sheet, state: &Value) -> Result<(), BatchError> {
    let format: ConditionalFormat =
        serde_json::from_value(state.clone()).map_err(|error| BatchError {
            code: "InvalidArgument",
            message: format!("invalid conditional format: {error}"),
        })?;
    let existing = sheet
        .conditional_formats()
        .get_all_rules()
        .map_err(engine)?;
    if existing.iter().any(|item| item.id == format.id) {
        sheet
            .conditional_formats()
            .delete_rule(&format.id)
            .map_err(engine)?;
    }
    sheet
        .conditional_formats()
        .add_rule(format)
        .map_err(engine)?;
    Ok(())
}

fn default_rule(cf_type: &str, id: &str) -> Result<Value, BatchError> {
    let token = normalize_type(cf_type);
    Ok(match token.as_str() {
        "CellValue" => json!({
            "type": "cellValue",
            "id": format!("{id}-rule"),
            "priority": 1,
            "operator": "greaterThan",
            "value1": "0",
            "style": {},
        }),
        "ColorScale" => json!({
            "type": "colorScale",
            "id": format!("{id}-rule"),
            "priority": 1,
            "colorScale": {
                "minPoint": { "value": { "kind": "min" }, "color": "#F8696B" },
                "midPoint": { "value": { "kind": "percentile", "value": 50.0 }, "color": "#FFEB84" },
                "maxPoint": { "value": { "kind": "max" }, "color": "#63BE7B" },
            }
        }),
        "DataBar" => json!({
            "type": "dataBar",
            "id": format!("{id}-rule"),
            "priority": 1,
            "dataBar": {
                "minPoint": { "value": { "kind": "min" }, "color": "#638EC6" },
                "maxPoint": { "value": { "kind": "max" }, "color": "#638EC6" },
                "positiveColor": "#638EC6",
            }
        }),
        "IconSet" => json!({
            "type": "iconSet",
            "id": format!("{id}-rule"),
            "priority": 1,
            "iconSet": { "iconSetName": "3TrafficLights1", "thresholds": [] }
        }),
        "PresetCriteria" => json!({
            "type": "aboveAverage",
            "id": format!("{id}-rule"),
            "priority": 1,
            "aboveAverage": true,
            "style": {},
        }),
        "ContainsText" => json!({
            "type": "containsText",
            "id": format!("{id}-rule"),
            "priority": 1,
            "operator": "containsText",
            "text": "",
            "style": {},
        }),
        other => {
            return Err(invalid(format!(
                "Unsupported ConditionalFormatType '{other}'"
            )));
        }
    })
}

fn apply_to_state(state: &mut Value, property: &str, value: &Value) -> Result<(), BatchError> {
    let rule = state
        .get_mut("rules")
        .and_then(Value::as_array_mut)
        .and_then(|rules| rules.first_mut())
        .ok_or_else(|| invalid("conditional format has no rule"))?;
    match property {
        "cellValue.rule" => apply_cell_value_rule(rule, value)?,
        "cellValue.format.fill.color" => {
            set_style_field(rule, "backgroundColor", map_color(value))?
        }
        "cellValue.format.font.bold"
        | "textComparison.format.font.bold"
        | "preset.format.font.bold" => set_style_field(rule, "bold", value.clone())?,
        "cellValue.format.font.color"
        | "textComparison.format.font.color"
        | "preset.format.font.color" => set_style_field(rule, "fontColor", map_color(value))?,
        "preset.format.fill.color" | "textComparison.format.fill.color" => {
            set_style_field(rule, "backgroundColor", map_color(value))?
        }
        "colorScale.criteria" => apply_color_scale(rule, value)?,
        "iconSet.style" => {
            if let Some(name) = value.as_str() {
                rule["iconSet"]["iconSetName"] = json!(map_icon_set(name));
            }
        }
        "preset.rule" => apply_preset(rule, value)?,
        "textComparison.rule" => apply_text_rule(rule, value)?,
        _ => {}
    }
    Ok(())
}

fn apply_cell_value_rule(rule: &mut Value, value: &Value) -> Result<(), BatchError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("cellValue.rule must be an object"))?;
    if let Some(operator) = object.get("operator").and_then(Value::as_str) {
        rule["operator"] = json!(map_operator(operator));
    }
    if let Some(formula1) = object.get("formula1") {
        rule["value1"] = formula_value(formula1);
    }
    if let Some(formula2) = object.get("formula2") {
        rule["value2"] = formula_value(formula2);
    }
    Ok(())
}

fn apply_preset(rule: &mut Value, value: &Value) -> Result<(), BatchError> {
    let criterion = value
        .get("criterion")
        .and_then(Value::as_str)
        .unwrap_or("AboveAverage");
    match criterion {
        "AboveAverage" | "aboveAverage" => {
            rule["type"] = json!("aboveAverage");
            rule["aboveAverage"] = json!(true);
        }
        "BelowAverage" | "belowAverage" => {
            rule["type"] = json!("aboveAverage");
            rule["aboveAverage"] = json!(false);
        }
        _ => {}
    }
    Ok(())
}

fn apply_text_rule(rule: &mut Value, value: &Value) -> Result<(), BatchError> {
    if let Some(operator) = value.get("operator").and_then(Value::as_str) {
        rule["operator"] = json!(map_text_operator(operator));
    }
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        rule["text"] = json!(text);
    }
    Ok(())
}

fn apply_color_scale(rule: &mut Value, value: &Value) -> Result<(), BatchError> {
    let scale = &mut rule["colorScale"];
    if let Some(minimum) = value.get("minimum") {
        scale["minPoint"] = color_point(minimum, "min")?;
    }
    if let Some(midpoint) = value.get("midpoint") {
        scale["midPoint"] = color_point(midpoint, "percentile")?;
    }
    if let Some(maximum) = value.get("maximum") {
        scale["maxPoint"] = color_point(maximum, "max")?;
    }
    Ok(())
}

fn color_point(source: &Value, default_kind: &str) -> Result<Value, BatchError> {
    let kind = source
        .get("type")
        .and_then(Value::as_str)
        .map(map_cfvo)
        .unwrap_or(default_kind);
    let mut point = json!({
        "value": { "kind": kind },
        "color": map_color_str(source.get("color").and_then(Value::as_str).unwrap_or("#000000")),
    });
    if let Some(formula) = source.get("formula") {
        if let Some(number) = formula.as_f64() {
            point["value"] = json!({ "kind": kind, "value": number });
        } else if let Some(text) = formula.as_str() {
            if let Ok(number) = text.parse::<f64>() {
                point["value"] = json!({ "kind": kind, "value": number });
            } else if !text.is_empty() {
                point["value"] = json!({ "kind": "formula", "source": text });
            }
        }
    }
    Ok(point)
}

fn set_style_field(rule: &mut Value, field: &str, value: Value) -> Result<(), BatchError> {
    if !rule.get("style").map(Value::is_object).unwrap_or(false) {
        rule["style"] = json!({});
    }
    rule["style"][field] = value;
    Ok(())
}

fn formula_value(value: &Value) -> Value {
    if let Some(text) = value.as_str() {
        json!(text)
    } else {
        value.clone()
    }
}

fn map_color(value: &Value) -> Value {
    Value::String(map_color_str(value.as_str().unwrap_or("")))
}

fn map_color_str(color: &str) -> String {
    match color.to_ascii_lowercase().as_str() {
        "yellow" => "#FFFF00".to_string(),
        "lightblue" => "#ADD8E6".to_string(),
        "red" => "#FF0000".to_string(),
        "green" => "#00FF00".to_string(),
        "blue" => "#0000FF".to_string(),
        other if other.starts_with('#') => other.to_ascii_uppercase(),
        other => other.to_string(),
    }
}

fn map_operator(token: &str) -> &'static str {
    match token {
        "GreaterThan" | "greaterThan" => "greaterThan",
        "GreaterThanOrEqual" | "greaterThanOrEqual" => "greaterThanOrEqual",
        "LessThan" | "lessThan" => "lessThan",
        "LessThanOrEqual" | "lessThanOrEqual" => "lessThanOrEqual",
        "Equal" | "equalTo" | "EqualTo" => "equal",
        "NotEqual" | "notEqual" => "notEqual",
        "Between" | "between" => "between",
        "NotBetween" | "notBetween" => "notBetween",
        _ => "greaterThan",
    }
}

fn map_text_operator(token: &str) -> &'static str {
    match token {
        "Contains" | "contains" | "ContainsText" => "containsText",
        "NotContains" | "notContains" => "notContains",
        "BeginsWith" | "beginsWith" => "beginsWith",
        "EndsWith" | "endsWith" => "endsWith",
        _ => "containsText",
    }
}

fn map_cfvo(token: &str) -> &'static str {
    match token {
        "LowestValue" | "lowestValue" => "min",
        "HighestValue" | "highestValue" => "max",
        "Percentile" | "percentile" => "percentile",
        "Percent" | "percent" => "percent",
        "Number" | "number" => "num",
        "Formula" | "formula" => "formula",
        _ => "num",
    }
}

fn map_icon_set(token: &str) -> String {
    match token {
        "ThreeTrafficLights1" | "threeTrafficLights1" | "3TrafficLights1" => {
            "3TrafficLights1".to_string()
        }
        "ThreeArrows" | "threeArrows" => "3Arrows".to_string(),
        other => other.to_string(),
    }
}

fn normalize_type(cf_type: &str) -> String {
    match cf_type {
        "CellValue" | "cellValue" => "CellValue".to_string(),
        "ColorScale" | "colorScale" => "ColorScale".to_string(),
        "DataBar" | "dataBar" => "DataBar".to_string(),
        "IconSet" | "iconSet" => "IconSet".to_string(),
        "PresetCriteria" | "presetCriteria" => "PresetCriteria".to_string(),
        "ContainsText" | "containsText" => "ContainsText".to_string(),
        other => other.to_string(),
    }
}

fn range_bounds(range: &RangeRef) -> Result<(u32, u32, u32, u32), BatchError> {
    let address = range
        .address()
        .ok_or_else(|| invalid("conditional formats require a bounded range"))?;
    let parsed = parse_range_address(&range.sheet(), address).map_err(|error| BatchError {
        code: error.code,
        message: error.message,
    })?;
    Ok(parsed.bounds())
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
