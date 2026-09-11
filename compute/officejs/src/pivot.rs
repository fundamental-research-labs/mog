//! Workbook.pivotTables host operations.

use std::collections::HashMap;
use std::sync::Mutex;

use domain_types::domain::analytics::AggregateFunction;
use domain_types::domain::pivot::{
    PivotField, PivotFieldArea, PivotFieldPlacementFlat, PivotTableConfig,
};
use serde_json::{Value, json};
use value_types::CellValue;

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::{BatchError, RangeRef};
use crate::range_navigation::parse_range_address;

pub(crate) struct PivotHandler;

impl ExtensionHandler for PivotHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(operation, "pivotAdd" | "pivotHierarchyAdd" | "set")
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
            "pivotAdd" => {
                let id = required_str(operation, "id")?;
                let name = required_str(operation, "name")?;
                let source = context.range(required_str(operation, "sourceRangeId")?)?;
                let dest = context.range(required_str(operation, "destinationRangeId")?)?;
                let object = PivotRef::create(name, &source, &dest)?;
                context.bind_object(id, std::sync::Arc::new(object));
                Ok(true)
            }
            "pivotHierarchyAdd" => {
                let pivot_id = required_str(operation, "pivotId")?;
                let object = context.extension_object::<PivotRef>(pivot_id)?;
                let area = required_str(operation, "area")?;
                let field = required_str(operation, "field")?;
                object.add_hierarchy(area, field)?;
                Ok(true)
            }
            "set" => {
                let Some(id) = operation.get("id").and_then(Value::as_str) else {
                    return Ok(false);
                };
                let Ok(object) = context.extension_object::<PivotRef>(id) else {
                    return Ok(false);
                };
                object.set(
                    required_str(operation, "property")?,
                    operation.get("value").unwrap_or(&Value::Null),
                )?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }
}

struct PivotRef {
    sheet: compute_api::Sheet,
    config: Mutex<PivotTableConfig>,
}

impl PivotRef {
    fn create(name: &str, source: &RangeRef, dest: &RangeRef) -> Result<Self, BatchError> {
        let source_bounds = range_bounds(source)?;
        let dest_bounds = range_bounds(dest)?;
        let fields = detect_fields(source, source_bounds)?;
        let config_json = json!({
            "id": "",
            "name": name,
            "sourceSheetId": source.sheet().id().to_uuid_string(),
            "sourceSheetName": source.sheet().name().map_err(engine)?,
            "sourceRange": {
                "startRow": source_bounds.0,
                "startCol": source_bounds.1,
                "endRow": source_bounds.2,
                "endCol": source_bounds.3,
            },
            "outputSheetId": dest.sheet().id().to_uuid_string(),
            "outputSheetName": dest.sheet().name().map_err(engine)?,
            "outputLocation": { "row": dest_bounds.0, "col": dest_bounds.1 },
            "fields": fields,
            "filters": [],
            "layout": {
                "showRowGrandTotals": true,
                "showColumnGrandTotals": true,
                "rowHeaderCaption": "Row Labels",
                "colHeaderCaption": "Column Labels",
            }
        });
        let config: PivotTableConfig = serde_json::from_value(config_json).map_err(engine)?;
        dest.sheet().pivots().create(config).map_err(engine)?;
        let stored = dest
            .sheet()
            .pivots()
            .get_all()
            .map_err(engine)?
            .into_iter()
            .find(|item| item.name == name)
            .ok_or_else(|| engine("pivot create did not persist a config"))?;
        Ok(Self {
            sheet: dest.sheet(),
            config: Mutex::new(stored),
        })
    }

    fn add_hierarchy(&self, area: &str, field: &str) -> Result<(), BatchError> {
        let mut config = self.config.lock().expect("pivot config");
        let area = match area {
            "row" => PivotFieldArea::Row,
            "column" => PivotFieldArea::Column,
            "filter" => PivotFieldArea::Filter,
            "data" | "value" => PivotFieldArea::Value,
            other => {
                return Err(invalid(format!(
                    "Unsupported pivot hierarchy area '{other}'"
                )));
            }
        };
        let position = config
            .placements
            .iter()
            .filter(|placement| placement.area == area)
            .count();
        let mut placement: PivotFieldPlacementFlat = serde_json::from_value(json!({
            "fieldId": field,
            "area": match area {
                PivotFieldArea::Row => "row",
                PivotFieldArea::Column => "column",
                PivotFieldArea::Filter => "filter",
                PivotFieldArea::Value => "value",
                _ => "row",
            },
            "position": position,
        }))
        .map_err(engine)?;
        if area == PivotFieldArea::Value {
            placement.aggregate_function = Some(AggregateFunction::Sum);
        }
        config.placements.push(placement);
        self.sheet
            .pivots()
            .update_and_materialize(&config.id, config.clone())
            .map_err(engine)?;
        Ok(())
    }

    fn apply_set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        let mut config = self.config.lock().expect("pivot config");
        match property {
            "name" => {
                let name = value
                    .as_str()
                    .ok_or_else(|| invalid("PivotTable.name must be a string"))?;
                config.name = name.to_string();
            }
            "summarizeBy" => {
                let field = value
                    .get("field")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("summarizeBy requires a field"))?;
                let function = value
                    .get("function")
                    .and_then(Value::as_str)
                    .unwrap_or("Sum");
                for placement in &mut config.placements {
                    if placement.area == PivotFieldArea::Value
                        && placement.field_id.as_str() == field
                    {
                        placement.aggregate_function = Some(map_aggregate(function));
                    }
                }
            }
            _ => return Ok(()),
        }
        self.sheet
            .pivots()
            .update_and_materialize(&config.id, config.clone())
            .map_err(engine)?;
        Ok(())
    }
}

impl ExtensionObject for PivotRef {
    fn object_type(&self) -> &'static str {
        "PivotTable"
    }

    fn load(&self, _properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        Ok(HashMap::new())
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.apply_set(property, value)
    }
}

fn detect_fields(
    source: &RangeRef,
    bounds: (u32, u32, u32, u32),
) -> Result<Vec<PivotField>, BatchError> {
    let values = source
        .sheet()
        .get_range_values_2d(format_a1(bounds).as_str())
        .map_err(engine)?;
    let Some(headers) = values.first() else {
        return Ok(Vec::new());
    };
    Ok(headers
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let name = cell_text(value);
            PivotField {
                id: name.clone().into(),
                name,
                source_column: index as u32,
                data_type: domain_types::domain::analytics::DetectedDataType::String,
                ..PivotField::default()
            }
        })
        .collect())
}

fn cell_text(value: &CellValue) -> String {
    match value {
        CellValue::Text(text) => text.to_string(),
        other => other.to_string(),
    }
}

fn map_aggregate(token: &str) -> AggregateFunction {
    match token {
        // Excel pivot "Count" on a text field is COUNTA (non-empty cells).
        "Count" | "count" => AggregateFunction::CountA,
        "Average" | "average" => AggregateFunction::Average,
        "Max" | "max" => AggregateFunction::Max,
        "Min" | "min" => AggregateFunction::Min,
        "CountNumbers" | "countNumbers" => AggregateFunction::Count,
        _ => AggregateFunction::Sum,
    }
}

fn range_bounds(range: &RangeRef) -> Result<(u32, u32, u32, u32), BatchError> {
    let address = range
        .address()
        .ok_or_else(|| invalid("pivot tables require a bounded range"))?;
    let parsed = parse_range_address(&range.sheet(), address).map_err(|error| BatchError {
        code: error.code,
        message: error.message,
    })?;
    Ok(parsed.bounds())
}

fn format_a1(bounds: (u32, u32, u32, u32)) -> String {
    fn col_name(mut col: u32) -> String {
        let mut out = String::new();
        col += 1;
        while col > 0 {
            col -= 1;
            out.insert(0, (b'A' + (col % 26) as u8) as char);
            col /= 26;
        }
        out
    }
    let (sr, sc, er, ec) = bounds;
    format!("{}{}:{}{}", col_name(sc), sr + 1, col_name(ec), er + 1)
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
