//! Production extension handlers for the Office.js object families.
//!
//! `host.rs` owns the request queue and the legacy object maps.  This module
//! owns the operation-to-reference bridge for the newer object families.  A
//! family reference remains in its implementation module; the adapters below
//! only turn its family error into `BatchError` and bind the resulting proxy
//! through `HostDispatchContext`.
//!
//! The dispatcher deliberately uses proxy IDs for operation fields and stores
//! persisted IDs only inside the typed references.  Child operations first
//! resolve a parent extension binding when possible, then fall back to an
//! explicit worksheet plus persisted ID supplied by the JavaScript proxy.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::application::ApplicationHandler;
use crate::chart_core::{ChartCollectionRef, ChartError, ChartRef};
use crate::chart_series::{ChartSeriesCollectionRef, ChartSeriesError, ChartSeriesRef};
use crate::conditional_basic::{
    ConditionalBorderSide, ConditionalChildKind, ConditionalFormatChildRef,
    ConditionalFormatCollectionRef, ConditionalFormatError, ConditionalFormatRef,
};
use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

/// Register the family bridge with a host.  The host owner calls this once
/// while constructing a `Host`, before any script batch is evaluated.
pub(crate) fn register(host: &crate::host::Host) {
    host.register_extension(HostObjectsHandler);
    host.register_extension(ApplicationHandler);
}

/// The single registration point for the object-family operation names.  The
/// implementation intentionally stays stateless; all state belongs to the
/// bound typed references held by the host extension map.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct HostObjectsHandler;

impl ExtensionHandler for HostObjectsHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            // Charts and chart series.
            "getChartCollection"
                | "chartCollectionGetItem"
                | "chartCollectionGetItemAt"
                | "chartCollectionGetCount"
                | "chartAdd"
                | "chartGetItem"
                | "chartGetItemAt"
                | "chartDelete"
                | "chartSetData"
                | "chartSetPosition"
                | "chartActivate"
                | "getChartSeriesCollection"
                | "chartSeriesCollectionGetItem"
                | "chartSeriesCollectionGetCount"
                | "chartSeriesCollectionAdd"
                | "chartSeriesDelete"
                | "chartSeriesGetDimensionDataSourceString"
                | "chartSeriesGetDimensionDataSourceType"
                | "chartSeriesGetDimensionValues"
                | "chartSeriesSetDimensionSource"
                // Conditional formats.
                | "getConditionalFormatCollection"
                | "conditionalFormatCollectionGetCount"
                | "conditionalFormatCollectionGetItem"
                | "conditionalFormatCollectionAdd"
                | "conditionalFormatCollectionClearAll"
                | "conditionalFormatChild"
                | "conditionalFormatDelete"
                | "conditionalFormatGetRange"
                | "conditionalFormatSetRanges"
                | "conditionalFormatChangeRule"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let op = required_string(operation, "op")?;
        match op {
            "getChartCollection"
            | "chartCollectionGetItem"
            | "chartCollectionGetItemAt"
            | "chartCollectionGetCount"
            | "chartAdd"
            | "chartGetItem"
            | "chartGetItemAt"
            | "chartDelete"
            | "chartSetData"
            | "chartSetPosition"
            | "chartActivate" => handle_chart_operation(operation, context),
            "getChartSeriesCollection"
            | "chartSeriesCollectionGetItem"
            | "chartSeriesCollectionGetCount"
            | "chartSeriesCollectionAdd"
            | "chartSeriesDelete"
            | "chartSeriesGetDimensionDataSourceString"
            | "chartSeriesGetDimensionDataSourceType"
            | "chartSeriesGetDimensionValues"
            | "chartSeriesSetDimensionSource" => handle_chart_series_operation(operation, context),
            "getConditionalFormatCollection"
            | "conditionalFormatCollectionGetCount"
            | "conditionalFormatCollectionGetItem"
            | "conditionalFormatCollectionAdd"
            | "conditionalFormatCollectionClearAll"
            | "conditionalFormatChild"
            | "conditionalFormatDelete"
            | "conditionalFormatGetRange"
            | "conditionalFormatSetRanges"
            | "conditionalFormatChangeRule" => handle_conditional_operation(operation, context),
            _ => Ok(false),
        }
    }
}

// -------------------------------------------------------------------------
// Shared extension object adapters
// -------------------------------------------------------------------------

struct ChartCollectionObject(ChartCollectionRef);
struct ChartObject(ChartRef);
struct ChartSeriesCollectionObject(ChartSeriesCollectionRef);
struct ChartSeriesObject(ChartSeriesRef);
struct ConditionalFormatCollectionObject(ConditionalFormatCollectionRef);
struct ConditionalFormatObject(ConditionalFormatRef);
struct ConditionalFormatChildObject(ConditionalFormatChildRef);

impl ExtensionObject for ChartCollectionObject {
    fn object_type(&self) -> &'static str {
        "ChartCollection"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        let (wants_items, item_properties) = collection_item_properties(properties)?;
        let mut result = std::collections::HashMap::new();
        for property in properties {
            match property.as_str() {
                "count" => {
                    result.insert(
                        "count".to_string(),
                        json!(self.0.count().map_err(chart_error)?),
                    );
                }
                "isNullObject" => {
                    result.insert("isNullObject".to_string(), Value::Bool(false));
                }
                "items" => {}
                item_path if item_path.starts_with("items/") => {}
                other => return Err(invalid(format!("ChartCollection.{other} is unsupported"))),
            }
        }
        if wants_items {
            let descriptors = self
                .0
                .collection_items(&item_properties)
                .map_err(chart_error)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(descriptors).map_err(|error| BatchError {
                    code: "GeneralException",
                    message: format!("failed to encode chart collection items: {error}"),
                })?,
            );
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(invalid(format!("ChartCollection.{property} is read-only")))
    }
}

impl ExtensionObject for ChartObject {
    fn object_type(&self) -> &'static str {
        "Chart"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        self.0.load(properties).map_err(chart_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.0.set(property, value).map_err(chart_error)
    }
}

impl ExtensionObject for ChartSeriesCollectionObject {
    fn object_type(&self) -> &'static str {
        "ChartSeriesCollection"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        self.0.load(properties).map_err(chart_series_error)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(invalid(format!(
            "ChartSeriesCollection.{property} is read-only"
        )))
    }
}

impl ExtensionObject for ChartSeriesObject {
    fn object_type(&self) -> &'static str {
        "ChartSeries"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        self.0.load(properties).map_err(chart_series_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.0.set(property, value).map_err(chart_series_error)
    }
}

impl ExtensionObject for ConditionalFormatCollectionObject {
    fn object_type(&self) -> &'static str {
        "ConditionalFormatCollection"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        let (wants_items, item_properties) = collection_item_properties(properties)?;
        let mut result = std::collections::HashMap::new();
        for property in properties {
            match property.as_str() {
                "count" => {
                    result.insert(
                        "count".to_string(),
                        json!(self.0.count().map_err(conditional_error)?),
                    );
                }
                "isNullObject" | "items" => {}
                other if other.starts_with("items/") => {}
                other => {
                    return Err(invalid(format!(
                        "ConditionalFormatCollection.{other} is unsupported"
                    )))
                }
            }
        }
        if wants_items {
            let descriptors = self
                .0
                .collection_items(&item_properties)
                .map_err(conditional_error)?;
            result.insert(
                "items".to_string(),
                serde_json::to_value(descriptors).map_err(|error| BatchError {
                    code: "GeneralException",
                    message: format!("failed to encode conditional-format items: {error}"),
                })?,
            );
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(invalid(format!(
            "ConditionalFormatCollection.{property} is read-only"
        )))
    }
}

impl ExtensionObject for ConditionalFormatObject {
    fn object_type(&self) -> &'static str {
        "ConditionalFormat"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        self.0.load(properties).map_err(conditional_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.0.set(property, value).map_err(conditional_error)
    }
}

impl ExtensionObject for ConditionalFormatChildObject {
    fn object_type(&self) -> &'static str {
        "ConditionalFormatChild"
    }

    fn load(
        &self,
        properties: &[String],
    ) -> Result<std::collections::HashMap<String, Value>, BatchError> {
        self.0.load(properties).map_err(conditional_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.0.set(property, value).map_err(conditional_error)
    }
}

// -------------------------------------------------------------------------
// Chart core/series operations
// -------------------------------------------------------------------------

fn handle_chart_operation(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let op = required_string(operation, "op")?;
    match op {
        "getChartCollection" => {
            let id = required_string(operation, "id")?;
            let worksheet_id = required_string(operation, "worksheetId")?;
            let worksheet = context.worksheet(worksheet_id)?;
            context.bind_object(
                id,
                Arc::new(ChartCollectionObject(ChartCollectionRef::new(
                    worksheet.sheet(),
                ))),
            );
        }
        "chartCollectionGetItem" | "chartCollectionGetItemAt" => {
            let collection = chart_collection_from_operation(operation, context)?;
            let by_index = op == "chartCollectionGetItemAt";
            let or_null = operation
                .get("orNullObject")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let chart = if by_index {
                collection
                    .get_item_at(required_i64(operation, "index")?)
                    .map(Some)
                    .map_err(chart_error)?
            } else if or_null {
                collection
                    .get_item_or_null_object(required_string(operation, "name")?)
                    .map_err(chart_error)?
            } else {
                collection
                    .get_item(required_string(operation, "name")?)
                    .map(Some)
                    .map_err(chart_error)?
            };
            let id = required_string(operation, "id")?;
            match chart {
                Some(chart) => context.bind_object(id, Arc::new(ChartObject(chart))),
                None if or_null => context.bind_null_object(id),
                None => {
                    return Err(invalid(
                        "ChartCollection.getItem returned no chart without OrNullObject",
                    ))
                }
            }
        }
        "chartCollectionGetCount" => {
            let collection = chart_collection_from_operation(operation, context)?;
            let result_id = required_string(operation, "resultId")?;
            context.set_result(result_id, json!(collection.count().map_err(chart_error)?));
        }
        "chartAdd" => {
            let id = required_string(operation, "id")?;
            let collection = chart_collection_from_operation(operation, context)?;
            let range = range_from_operation(operation, context, "rangeId", "sourceData")?;
            let chart = collection
                .add(
                    required_string(operation, "type")?,
                    range.address().ok_or_else(|| {
                        invalid("ChartCollection.add requires a bounded source Range")
                    })?,
                    operation.get("seriesBy").and_then(Value::as_str),
                )
                .map_err(chart_error)?;
            context.bind_object(id, Arc::new(ChartObject(chart)));
        }
        "chartGetItem" | "chartGetItemAt" => {
            // The collection lookup operation is the only supported path for
            // ChartCollection.getItem. Keep this branch for older proxies that
            // send the operation name directly with a worksheet/chart scope.
            let collection = chart_collection_from_operation(operation, context)?;
            let id = required_string(operation, "id")?;
            let or_null = operation
                .get("orNullObject")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let chart = if op == "chartGetItemAt" {
                collection
                    .get_item_at(required_i64(operation, "index")?)
                    .map(Some)
                    .map_err(chart_error)?
            } else if or_null {
                collection
                    .get_item_or_null_object(required_string(operation, "name")?)
                    .map_err(chart_error)?
            } else {
                collection
                    .get_item(required_string(operation, "name")?)
                    .map(Some)
                    .map_err(chart_error)?
            };
            match chart {
                Some(chart) => context.bind_object(id, Arc::new(ChartObject(chart))),
                None if or_null => context.bind_null_object(id),
                None => return Err(invalid("Chart lookup returned no chart")),
            }
        }
        "chartDelete" => {
            let chart = chart_from_operation(operation, context)?;
            chart.delete().map_err(chart_error)?;
        }
        "chartSetData" => {
            let chart = chart_from_operation(operation, context)?;
            let range = range_from_operation(operation, context, "rangeId", "sourceData")?;
            chart
                .set_data(
                    range
                        .address()
                        .ok_or_else(|| invalid("Chart.setData requires a bounded source Range"))?,
                    operation.get("seriesBy").and_then(Value::as_str),
                )
                .map_err(chart_error)?;
        }
        "chartSetPosition" => {
            let chart = chart_from_operation(operation, context)?;
            let start = address_from_operation(operation, context, "startRangeId", "startAddress")?;
            let end =
                optional_address_from_operation(operation, context, "endRangeId", "endAddress")?;
            chart
                .set_position(&start, end.as_deref())
                .map_err(chart_error)?;
        }
        "chartActivate" => {
            return Err(unsupported(
                "Chart.activate requires an interactive Excel window",
            ));
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn handle_chart_series_operation(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let op = required_string(operation, "op")?;
    match op {
        "getChartSeriesCollection" => {
            let id = required_string(operation, "id")?;
            let chart = chart_from_operation(operation, context)?;
            let collection = ChartSeriesCollectionRef::new(context.workbook(), chart);
            context.bind_object(id, Arc::new(ChartSeriesCollectionObject(collection)));
        }
        "chartSeriesCollectionGetItem" => {
            let collection = chart_series_collection_from_operation(operation, context)?;
            let item = collection
                .get_item_at(required_i64(operation, "index")?)
                .map_err(chart_series_error)?;
            context.bind_object(
                required_string(operation, "id")?,
                Arc::new(ChartSeriesObject(item)),
            );
        }
        "chartSeriesCollectionGetCount" => {
            let collection = chart_series_collection_from_operation(operation, context)?;
            context.set_result(
                required_string(operation, "resultId")?,
                json!(collection.count().map_err(chart_series_error)?),
            );
        }
        "chartSeriesCollectionAdd" => {
            let collection = chart_series_collection_from_operation(operation, context)?;
            let name = operation.get("name").and_then(Value::as_str);
            let index = operation.get("index").and_then(Value::as_i64);
            let item = collection.add(name, index).map_err(chart_series_error)?;
            context.bind_object(
                required_string(operation, "id")?,
                Arc::new(ChartSeriesObject(item)),
            );
        }
        "chartSeriesDelete" => {
            let item = chart_series_from_operation(operation, context)?;
            item.delete().map_err(chart_series_error)?;
        }
        "chartSeriesGetDimensionDataSourceString"
        | "chartSeriesGetDimensionDataSourceType"
        | "chartSeriesGetDimensionValues" => {
            let item = chart_series_from_operation(operation, context)?;
            let dimension = required_string(operation, "dimension")?;
            let value = match op {
                "chartSeriesGetDimensionDataSourceString" => Value::String(
                    item.get_dimension_data_source_string(dimension)
                        .map_err(chart_series_error)?,
                ),
                "chartSeriesGetDimensionDataSourceType" => Value::String(
                    item.get_dimension_data_source_type(dimension)
                        .map_err(chart_series_error)?,
                ),
                _ => json!(item
                    .get_dimension_values(dimension)
                    .map_err(chart_series_error)?),
            };
            context.set_result(required_string(operation, "resultId")?, value);
        }
        "chartSeriesSetDimensionSource" => {
            let item = chart_series_from_operation(operation, context)?;
            let range = range_from_operation(operation, context, "rangeId", "address")?;
            item.set_dimension_source(
                required_string(operation, "dimension")?,
                &range.sheet(),
                range.address().ok_or_else(|| {
                    invalid("ChartSeries dimension source requires a bounded Range")
                })?,
            )
            .map_err(chart_series_error)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn chart_collection_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartCollectionRef, BatchError> {
    if let Some(collection_id) = operation.get("collectionId").and_then(Value::as_str) {
        if let Ok(collection) = context.extension_object::<ChartCollectionObject>(collection_id) {
            return Ok(collection.0.clone());
        }
    }
    let worksheet_id = required_string(operation, "worksheetId")?;
    Ok(ChartCollectionRef::new(
        context.worksheet(worksheet_id)?.sheet(),
    ))
}

fn chart_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartRef, BatchError> {
    for field in ["chartId", "parentId", "chartObjectId"] {
        if let Some(id) = operation.get(field).and_then(Value::as_str) {
            if let Ok(chart) = context.extension_object::<ChartObject>(id) {
                return Ok(chart.0.clone());
            }
        }
    }
    let worksheet_id = required_string(operation, "worksheetId")?;
    let chart_id = required_string(operation, "chartId")?;
    Ok(ChartRef::new(
        context.worksheet(worksheet_id)?.sheet(),
        chart_id,
    ))
}

fn chart_series_collection_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartSeriesCollectionRef, BatchError> {
    if let Some(collection_id) = operation.get("collectionId").and_then(Value::as_str) {
        if let Ok(collection) =
            context.extension_object::<ChartSeriesCollectionObject>(collection_id)
        {
            return Ok(collection.0.clone());
        }
    }
    Ok(ChartSeriesCollectionRef::new(
        context.workbook(),
        chart_from_operation(operation, context)?,
    ))
}

fn chart_series_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartSeriesRef, BatchError> {
    if let Some(id) = operation.get("id").and_then(Value::as_str) {
        if let Ok(item) = context.extension_object::<ChartSeriesObject>(id) {
            return Ok(item.0.clone());
        }
    }
    let collection = chart_series_collection_from_operation(operation, context)?;
    collection
        .get_item_at(required_i64(operation, "index")?)
        .map_err(chart_series_error)
}

// -------------------------------------------------------------------------
// Conditional-format operations
// -------------------------------------------------------------------------

fn handle_conditional_operation(
    operation: &Value,
    context: &mut HostDispatchContext<'_>,
) -> Result<bool, BatchError> {
    let op = required_string(operation, "op")?;
    match op {
        "getConditionalFormatCollection" => {
            let range = context.range(required_string(operation, "rangeId")?)?;
            let address = range
                .address()
                .ok_or_else(|| invalid("ConditionalFormatCollection requires a bounded Range"))?;
            let collection = ConditionalFormatCollectionRef::new(range.sheet(), address)
                .map_err(conditional_error)?;
            context.bind_object(
                required_string(operation, "id")?,
                Arc::new(ConditionalFormatCollectionObject(collection)),
            );
        }
        "conditionalFormatCollectionGetCount" => {
            let collection = conditional_collection_from_operation(operation, context)?;
            context.set_result(
                required_string(operation, "resultId")?,
                json!(collection.count().map_err(conditional_error)?),
            );
        }
        "conditionalFormatCollectionGetItem" => {
            let collection = conditional_collection_from_operation(operation, context)?;
            let item = collection
                .get_item(
                    required_string(operation, "key")?,
                    operation
                        .get("byIndex")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    operation
                        .get("orNullObject")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                )
                .map_err(conditional_error)?;
            let id = required_string(operation, "id")?;
            if item.is_null_object() {
                context.bind_null_object(id);
            } else {
                context.bind_object(id, Arc::new(ConditionalFormatObject(item)));
            }
        }
        "conditionalFormatCollectionAdd" => {
            let collection = conditional_collection_from_operation(operation, context)?;
            let item = collection
                .add(required_string(operation, "type")?)
                .map_err(conditional_error)?;
            context.bind_object(
                required_string(operation, "id")?,
                Arc::new(ConditionalFormatObject(item)),
            );
        }
        "conditionalFormatCollectionClearAll" => {
            conditional_collection_from_operation(operation, context)?
                .clear_all()
                .map_err(conditional_error)?;
        }
        "conditionalFormatChild" => {
            let parent_id = required_string(operation, "parentId")?;
            let parent = context.extension_object::<ConditionalFormatObject>(parent_id)?;
            let kind = ConditionalChildKind::from_wire(required_string(operation, "kind")?)
                .map_err(conditional_error)?;
            let side =
                ConditionalBorderSide::from_wire(operation.get("side").and_then(Value::as_str))
                    .map_err(conditional_error)?;
            let child = parent
                .0
                .child(
                    kind,
                    side,
                    operation
                        .get("orNullObject")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                )
                .map_err(conditional_error)?;
            let id = required_string(operation, "id")?;
            if child.is_null_object() {
                context.bind_null_object(id);
            } else {
                context.bind_object(id, Arc::new(ConditionalFormatChildObject(child)));
            }
        }
        "conditionalFormatDelete" => {
            conditional_from_operation(operation, context)?
                .delete()
                .map_err(conditional_error)?;
        }
        "conditionalFormatGetRange" => {
            // The common dispatcher owns RangeRef construction.  The current
            // context deliberately exposes only rebinding of an existing
            // RangeRef, so this operation is kept explicit until the host
            // owner adds its address-to-Range binding hook.
            return Err(unsupported(
                "ConditionalFormat.getRange requires the host Range binding hook",
            ));
        }
        "conditionalFormatSetRanges" => {
            let ranges = conditional_ranges_from_operation(operation, context)?;
            conditional_from_operation(operation, context)?
                .set_ranges(ranges)
                .map_err(conditional_error)?;
        }
        "conditionalFormatChangeRule" => {
            conditional_from_operation(operation, context)?
                .change_rule(required_string(operation, "type")?, operation.get("rule"))
                .map_err(conditional_error)?;
        }
        _ => return Ok(false),
    }
    Ok(true)
}

fn conditional_collection_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ConditionalFormatCollectionRef, BatchError> {
    let id = operation
        .get("collectionId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Conditional-format operation requires collectionId"))?;
    Ok(context
        .extension_object::<ConditionalFormatCollectionObject>(id)?
        .0
        .clone())
}

fn conditional_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ConditionalFormatRef, BatchError> {
    let id = required_string(operation, "id")?;
    if let Ok(item) = context.extension_object::<ConditionalFormatObject>(id) {
        return Ok(item.0.clone());
    }
    let sheet = context
        .worksheet(required_string(operation, "worksheetId")?)?
        .sheet();
    Ok(ConditionalFormatRef::new(
        sheet,
        required_string(operation, "formatId")?,
    ))
}

fn conditional_ranges_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<Vec<compute_api::CFCellRange>, BatchError> {
    let values = operation
        .get("ranges")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("ConditionalFormat.setRanges requires a ranges array"))?;
    if values.is_empty() {
        return Err(invalid("ConditionalFormat.setRanges requires at least one range"));
    }
    values
        .iter()
        .map(|value| {
            let object = value
                .as_object()
                .ok_or_else(|| invalid("ConditionalFormat.setRanges range must be an object"))?;
            if let Some(range_id) = object.get("rangeId").and_then(Value::as_str) {
                let range = context.range(range_id)?;
                if range.is_null_object() {
                    return Err(invalid("ConditionalFormat.setRanges cannot use a null Range"));
                }
                let address = range.address().ok_or_else(|| {
                    invalid("ConditionalFormat.setRanges requires bounded Range objects")
                })?;
                return cf_cell_range(&range.sheet(), address);
            }
            let address = object
                .get("address")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    invalid("ConditionalFormat.setRanges range requires rangeId or address")
                })?;
            let sheet_id = operation
                .get("worksheetId")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    invalid("ConditionalFormat.setRanges address requires worksheetId")
                })?;
            let sheet = context.worksheet(sheet_id)?.sheet();
            cf_cell_range(&sheet, address)
        })
        .collect()
}

fn cf_cell_range(
    sheet: &compute_api::Sheet,
    address: &str,
) -> Result<compute_api::CFCellRange, BatchError> {
    let parsed = crate::range_navigation::parse_range_address(sheet, address).map_err(|error| {
        BatchError {
            code: error.code,
            message: error.message,
        }
    })?;
    let (start_row, start_col, end_row, end_col) = match parsed {
        crate::range_navigation::RangeAddress::Cells {
            start_row,
            start_column,
            end_row,
            end_column,
        } => (start_row, start_column, end_row, end_column),
        _ => return Err(invalid("ConditionalFormat.setRanges requires bounded ranges")),
    };
    Ok(compute_api::CFCellRange::new(
        start_row,
        start_col,
        end_row,
        end_col,
    ))
}

// -------------------------------------------------------------------------
// Wire helpers and error conversion
// -------------------------------------------------------------------------

fn collection_item_properties(properties: &[String]) -> Result<(bool, Vec<String>), BatchError> {
    let mut wants_items = false;
    let mut item_properties = Vec::new();
    for property in properties {
        if property == "items" {
            wants_items = true;
        } else if let Some(item_property) = property.strip_prefix("items/") {
            if item_property.is_empty() || item_property.contains('/') {
                return Err(invalid(format!(
                    "Invalid collection item property '{property}'"
                )));
            }
            wants_items = true;
            if !item_properties
                .iter()
                .any(|existing| existing == item_property)
            {
                item_properties.push(item_property.to_string());
            }
        }
    }
    Ok((wants_items, item_properties))
}

fn range_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
    id_field: &str,
    address_field: &str,
) -> Result<crate::host::RangeRef, BatchError> {
    if let Some(id) = operation.get(id_field).and_then(Value::as_str) {
        return context.range(id);
    }
    let _ = address_field;
    Err(invalid(format!("Operation requires {id_field}")))
}

fn address_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
    range_field: &str,
    address_field: &str,
) -> Result<String, BatchError> {
    if let Some(id) = operation.get(range_field).and_then(Value::as_str) {
        let range = context.range(id)?;
        return range
            .address()
            .map(ToOwned::to_owned)
            .ok_or_else(|| invalid(format!("Operation {range_field} requires a bounded Range")));
    }
    required_string(operation, address_field).map(ToOwned::to_owned)
}

fn optional_address_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
    range_field: &str,
    address_field: &str,
) -> Result<Option<String>, BatchError> {
    if let Some(id) = operation.get(range_field).and_then(Value::as_str) {
        let range = context.range(id)?;
        return range
            .address()
            .map(|address| Some(address.to_string()))
            .ok_or_else(|| invalid(format!("Operation {range_field} requires a bounded Range")));
    }
    Ok(operation
        .get(address_field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned))
}

fn required_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid(format!("Operation requires a non-empty {field}")))
}

fn required_i64(value: &Value, field: &str) -> Result<i64, BatchError> {
    value
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid(format!("Operation requires integer {field}")))
}

fn invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "ApiNotFound",
        message: message.into(),
    }
}

fn chart_error(error: ChartError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn chart_series_error(error: ChartSeriesError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn conditional_error(error: ConditionalFormatError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}
