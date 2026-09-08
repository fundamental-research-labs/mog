//! Office.js chart axes and axis-title bindings.
//!
//! Axis state is persisted as the chart's `AxisData` object.  The adapter
//! reads that object for every request and writes a patched copy back through
//! `ChartRef::update_fields`; this keeps a proxy read-after-write coherent and
//! avoids a second in-memory axis store.  The JavaScript adapter sends a
//! stable chart ID and worksheet proxy ID with each family operation.  The
//! chart host integrator registers [`ChartAxesHandler`] with the common
//! extension dispatcher.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Map, Value, json};

use crate::chart_core::{ChartCollectionRef, ChartRef};
use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

/// Axis kind understood by the Office.js `ChartAxisType` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChartAxisKind {
    Category,
    Value,
    Series,
}

impl ChartAxisKind {
    fn parse(value: &str) -> Result<Self, ChartError> {
        match value {
            "Category" | "category" => Ok(Self::Category),
            "Value" | "value" => Ok(Self::Value),
            "Series" | "series" => Ok(Self::Series),
            "Invalid" | "invalid" => {
                Err(invalid("ChartAxisType.Invalid does not identify an axis"))
            }
            other => Err(invalid(format!(
                "ChartAxes.getItem type must be Category, Value, or Series; got '{other}'"
            ))),
        }
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Category => "Category",
            Self::Value => "Value",
            Self::Series => "Series",
        }
    }

    fn persisted_key(self, group: ChartAxisGroup) -> &'static str {
        match (self, group) {
            (Self::Category, ChartAxisGroup::Primary) => "categoryAxis",
            (Self::Category, ChartAxisGroup::Secondary) => "secondaryCategoryAxis",
            (Self::Value, ChartAxisGroup::Primary) => "valueAxis",
            (Self::Value, ChartAxisGroup::Secondary) => "secondaryValueAxis",
            (Self::Series, _) => "seriesAxis",
        }
    }

    fn ooxml_type(self) -> &'static str {
        match self {
            Self::Category => "catAx",
            Self::Value => "valAx",
            Self::Series => "serAx",
        }
    }
}

/// Primary or secondary chart axis group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChartAxisGroup {
    Primary,
    Secondary,
}

impl ChartAxisGroup {
    fn parse(value: Option<&str>) -> Result<Self, ChartError> {
        match value.unwrap_or("Primary") {
            "Primary" | "primary" => Ok(Self::Primary),
            "Secondary" | "secondary" => Ok(Self::Secondary),
            other => Err(invalid(format!(
                "ChartAxisGroup must be Primary or Secondary; got '{other}'"
            ))),
        }
    }

    fn wire_name(self) -> &'static str {
        match self {
            Self::Primary => "Primary",
            Self::Secondary => "Secondary",
        }
    }
}

/// Errors produced by chart-axis translation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChartError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Collection reference behind `Chart.axes`.
#[derive(Clone)]
pub(crate) struct ChartAxesRef {
    chart: ChartRef,
}

impl ChartAxesRef {
    pub(crate) fn new(chart: ChartRef) -> Self {
        Self { chart }
    }

    pub(crate) fn chart(&self) -> ChartRef {
        self.chart.clone()
    }

    pub(crate) fn axis(
        &self,
        kind: ChartAxisKind,
        group: ChartAxisGroup,
    ) -> Result<ChartAxisRef, ChartError> {
        let axis = ChartAxisRef {
            chart: self.chart.clone(),
            kind,
            group,
        };
        axis.ensure_available()?;
        Ok(axis)
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, ChartError> {
        let mut result = HashMap::new();
        for property in properties {
            if property != "isNullObject" {
                return Err(unsupported_load_property("ChartAxes", property));
            }
            result.insert(property.clone(), Value::Bool(false));
        }
        Ok(result)
    }
}

/// A chart axis bound to a persisted chart ID and axis slot.
#[derive(Clone)]
pub(crate) struct ChartAxisRef {
    chart: ChartRef,
    kind: ChartAxisKind,
    group: ChartAxisGroup,
}

impl ChartAxisRef {
    pub(crate) fn new(
        chart: ChartRef,
        kind: ChartAxisKind,
        group: ChartAxisGroup,
    ) -> Result<Self, ChartError> {
        let axis = Self { chart, kind, group };
        axis.ensure_available()?;
        Ok(axis)
    }

    pub(crate) fn title(&self) -> ChartAxisTitleRef {
        ChartAxisTitleRef { axis: self.clone() }
    }

    pub(crate) fn kind(&self) -> ChartAxisKind {
        self.kind
    }

    pub(crate) fn group(&self) -> ChartAxisGroup {
        self.group
    }

    fn ensure_available(&self) -> Result<(), ChartError> {
        let snapshot = self.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.kind, self.group)
    }

    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, ChartError> {
        let snapshot = self.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.kind, self.group)?;
        let axis = persisted_axis(&snapshot, self.kind, self.group);
        let mut result = HashMap::new();
        for property in properties {
            let value = load_axis_property(property, axis, self.kind, self.group)?;
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ChartError> {
        let mut snapshot = self.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.kind, self.group)?;
        let axis = ensure_axis_map(&mut snapshot, self.kind, self.group)?;
        set_axis_property(axis, property, value)?;
        self.persist_axis(&snapshot)
    }

    pub(crate) fn set_custom_display_unit(&self, value: &Value) -> Result<(), ChartError> {
        let value = finite_number(value, "ChartAxis.setCustomDisplayUnit value")?;
        if value <= 0.0 {
            return Err(invalid(
                "ChartAxis.setCustomDisplayUnit value must be greater than zero",
            ));
        }
        let mut snapshot = self.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.kind, self.group)?;
        let axis = ensure_axis_map(&mut snapshot, self.kind, self.group)?;
        insert_number(axis, "customDisplayUnit", value);
        axis.insert(
            "displayUnit".to_string(),
            Value::String("custom".to_string()),
        );
        self.persist_axis(&snapshot)
    }

    pub(crate) fn set_position_at(&self, value: &Value) -> Result<(), ChartError> {
        let value = finite_number(value, "ChartAxis.setPositionAt value")?;
        let mut snapshot = self.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.kind, self.group)?;
        let axis = ensure_axis_map(&mut snapshot, self.kind, self.group)?;
        axis.insert("crossesAt".to_string(), Value::String("custom".to_string()));
        insert_number(axis, "crossesAtValue", value);
        self.persist_axis(&snapshot)
    }

    fn persist_axis(&self, snapshot: &Value) -> Result<(), ChartError> {
        let axis = snapshot
            .get("axis")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));
        self.chart
            .update_fields(&json!({ "axis": axis }))
            .map_err(chart_error)
    }
}

/// Axis title reference.  Title values are kept inside the owning axis so a
/// title mutation cannot affect another axis or the chart's main title.
#[derive(Clone)]
pub(crate) struct ChartAxisTitleRef {
    axis: ChartAxisRef,
}

impl ChartAxisTitleRef {
    pub(crate) fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, ChartError> {
        let snapshot = self.axis.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.axis.kind, self.axis.group)?;
        let axis = persisted_axis(&snapshot, self.axis.kind, self.axis.group);
        let text = string_value(axis, "title").unwrap_or_default();
        let title_visible = axis
            .and_then(|axis| axis.get("titleVisible"))
            .and_then(Value::as_bool)
            .unwrap_or(!text.is_empty());
        let orientation = number_value(axis, "textOrientation").unwrap_or(0.0);
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "text" => Value::String(text.clone()),
                "visible" => Value::Bool(title_visible),
                "textOrientation" => number_json(orientation),
                "isNullObject" => Value::Bool(false),
                other => return Err(unsupported_load_property("ChartAxisTitle", other)),
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ChartError> {
        let mut snapshot = self.axis.chart.snapshot().map_err(chart_error)?;
        ensure_axis_available(&snapshot, self.axis.kind, self.axis.group)?;
        let axis = ensure_axis_map(&mut snapshot, self.axis.kind, self.axis.group)?;
        match property {
            "text" => {
                let text = value
                    .as_str()
                    .ok_or_else(|| invalid("ChartAxisTitle.text must be a string".to_string()))?;
                if text.is_empty() {
                    axis.remove("title");
                    axis.insert("titleVisible".to_string(), Value::Bool(false));
                } else {
                    axis.insert("title".to_string(), Value::String(text.to_string()));
                    // A newly-authored title is visible by default.  Preserve
                    // an explicit titleVisible=false set by the caller.
                    if !axis.contains_key("titleVisible") {
                        axis.insert("titleVisible".to_string(), Value::Bool(true));
                    }
                }
            }
            "visible" => {
                let visible = value.as_bool().ok_or_else(|| {
                    invalid("ChartAxisTitle.visible must be a boolean".to_string())
                })?;
                axis.insert("titleVisible".to_string(), Value::Bool(visible));
            }
            "textOrientation" => {
                let orientation = text_orientation(value, "ChartAxisTitle.textOrientation")?;
                insert_number(axis, "textOrientation", orientation);
            }
            "format" => {
                return Err(unsupported_set_property(
                    "ChartAxisTitle.format is not supported by this host",
                ));
            }
            other => return Err(unsupported_set_property(format!("ChartAxisTitle.{other}"))),
        }
        self.axis.persist_axis(&snapshot)
    }
}

impl ExtensionObject for ChartAxesRef {
    fn object_type(&self) -> &'static str {
        "ChartAxes"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        ChartAxesRef::load(self, properties).map_err(batch_error)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(batch_error(unsupported_set_property(format!(
            "ChartAxes.{property} is read-only or unsupported"
        ))))
    }
}

impl ExtensionObject for ChartAxisRef {
    fn object_type(&self) -> &'static str {
        "ChartAxis"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        ChartAxisRef::load(self, properties).map_err(batch_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        ChartAxisRef::set(self, property, value).map_err(batch_error)
    }
}

impl ExtensionObject for ChartAxisTitleRef {
    fn object_type(&self) -> &'static str {
        "ChartAxisTitle"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        ChartAxisTitleRef::load(self, properties).map_err(batch_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        ChartAxisTitleRef::set(self, property, value).map_err(batch_error)
    }
}

/// Host extension handler for all chart-axis operations emitted by
/// `chart_axes.js`.
///
/// The chart core handler should bind `ChartRef` using the stable chart ID
/// before this handler is reached.  Axis operations also carry `chartId` so
/// they remain valid when a chart proxy is recreated in a later request
/// context.  `worksheetId` is deliberately resolved through the host's
/// worksheet map rather than by worksheet name.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct ChartAxesHandler;

impl ExtensionHandler for ChartAxesHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "chartAxesGet"
                | "chartAxisGet"
                | "chartAxisTitleGet"
                | "chartAxisSetCategoryNames"
                | "chartAxisSetCustomDisplayUnit"
                | "chartAxisSetPositionAt"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let op = operation
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| batch_error(invalid("Chart axis operation has no op")))?;
        match op {
            "chartAxesGet" => {
                let id = required_operation_string(operation, "id")?;
                let chart = chart_from_operation(operation, context)?;
                context.bind_object(&id, Arc::new(ChartAxesRef::new(chart)));
            }
            "chartAxisGet" => {
                let id = required_operation_string(operation, "id")?;
                let chart = chart_from_operation(operation, context)?;
                let kind = ChartAxisKind::parse(required_operation_string(operation, "axisType")?)
                    .map_err(batch_error)?;
                let group =
                    ChartAxisGroup::parse(operation.get("axisGroup").and_then(Value::as_str))
                        .map_err(batch_error)?;
                let axis = ChartAxisRef::new(chart, kind, group).map_err(batch_error)?;
                context.bind_object(&id, Arc::new(axis));
            }
            "chartAxisTitleGet" => {
                let id = required_operation_string(operation, "id")?;
                let chart = chart_from_operation(operation, context)?;
                let kind = ChartAxisKind::parse(required_operation_string(operation, "axisType")?)
                    .map_err(batch_error)?;
                let group =
                    ChartAxisGroup::parse(operation.get("axisGroup").and_then(Value::as_str))
                        .map_err(batch_error)?;
                let axis = ChartAxisRef::new(chart, kind, group).map_err(batch_error)?;
                context.bind_object(&id, Arc::new(axis.title()));
            }
            "chartAxisSetCustomDisplayUnit" => {
                let chart = chart_from_operation(operation, context)?;
                let kind = ChartAxisKind::parse(required_operation_string(operation, "axisType")?)
                    .map_err(batch_error)?;
                let group =
                    ChartAxisGroup::parse(operation.get("axisGroup").and_then(Value::as_str))
                        .map_err(batch_error)?;
                ChartAxisRef::new(chart, kind, group)
                    .map_err(batch_error)?
                    .set_custom_display_unit(operation.get("value").ok_or_else(|| {
                        batch_error(invalid(
                            "ChartAxis.setCustomDisplayUnit has no value".to_string(),
                        ))
                    })?)
                    .map_err(batch_error)?;
            }
            "chartAxisSetPositionAt" => {
                let chart = chart_from_operation(operation, context)?;
                let kind = ChartAxisKind::parse(required_operation_string(operation, "axisType")?)
                    .map_err(batch_error)?;
                let group =
                    ChartAxisGroup::parse(operation.get("axisGroup").and_then(Value::as_str))
                        .map_err(batch_error)?;
                ChartAxisRef::new(chart, kind, group)
                    .map_err(batch_error)?
                    .set_position_at(operation.get("value").ok_or_else(|| {
                        batch_error(invalid("ChartAxis.setPositionAt has no value".to_string()))
                    })?)
                    .map_err(batch_error)?;
            }
            "chartAxisSetCategoryNames" => {
                let chart = chart_from_operation(operation, context)?;
                let range_id = required_operation_string(operation, "rangeId")?;
                let range = context.range(&range_id)?;
                if range.is_null_object() {
                    return Err(BatchError {
                        code: "InvalidObjectPath",
                        message: "ChartAxis.setCategoryNames cannot use a null Range.".to_string(),
                    });
                }
                let address = range.address().ok_or_else(|| BatchError {
                    code: "InvalidArgument",
                    message: "ChartAxis.setCategoryNames requires a bounded Range.".to_string(),
                })?;
                let chart_sheet = chart.sheet();
                if chart_sheet.id() != range.sheet().id() {
                    return Err(BatchError {
                        code: "InvalidArgument",
                        message:
                            "ChartAxis.setCategoryNames Range must belong to the chart worksheet."
                                .to_string(),
                    });
                }
                let kind = ChartAxisKind::parse(required_operation_string(operation, "axisType")?)
                    .map_err(batch_error)?;
                let group =
                    ChartAxisGroup::parse(operation.get("axisGroup").and_then(Value::as_str))
                        .map_err(batch_error)?;
                let axis = ChartAxisRef::new(chart, kind, group).map_err(batch_error)?;
                axis.chart
                    .update_fields(&json!({ "categoryRange": address }))
                    .map_err(chart_error)
                    .map_err(batch_error)?;
            }
            _ => unreachable!("can_handle and handle operation names differ"),
        }
        Ok(true)
    }
}

fn chart_from_operation(
    operation: &Value,
    context: &HostDispatchContext<'_>,
) -> Result<ChartRef, BatchError> {
    for field in ["parentId", "chartObjectId", "chartProxyId"] {
        if let Some(id) = operation.get(field).and_then(Value::as_str)
            && let Ok(chart) = context.extension_object::<ChartRef>(id)
        {
            return Ok((*chart).clone());
        }
    }
    let worksheet_id = required_operation_string(operation, "worksheetId")?;
    let worksheet = context.worksheet(&worksheet_id)?;
    let chart_id = operation
        .get("chartId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    if let Some(chart_id) = chart_id {
        return Ok(ChartRef::new(worksheet.sheet(), chart_id));
    }
    if let Some(index) = operation.get("chartIndex").and_then(Value::as_i64) {
        return ChartCollectionRef::new(worksheet.sheet())
            .get_item_at(index)
            .map_err(chart_error)
            .map_err(batch_error);
    }
    let chart_name = operation
        .get("chartName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| BatchError {
            code: "InvalidObjectPath",
            message: "Chart axis operation requires a chart ID or name.".to_string(),
        })?;
    ChartCollectionRef::new(worksheet.sheet())
        .get_item(chart_name)
        .map_err(chart_error)
        .map_err(batch_error)
}

fn required_operation_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("Chart axis operation requires a non-empty {field}"),
        })
}

fn persisted_axis<'a>(
    snapshot: &'a Value,
    kind: ChartAxisKind,
    group: ChartAxisGroup,
) -> Option<&'a Map<String, Value>> {
    snapshot
        .get("axis")
        .and_then(Value::as_object)
        .and_then(|axes| axes.get(kind.persisted_key(group)))
        .and_then(Value::as_object)
}

fn ensure_axis_map<'a>(
    snapshot: &'a mut Value,
    kind: ChartAxisKind,
    group: ChartAxisGroup,
) -> Result<&'a mut Map<String, Value>, ChartError> {
    let root = snapshot
        .as_object_mut()
        .ok_or_else(|| encoding("Persisted chart is not an object"))?;
    let axis = root
        .entry("axis".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let axes = axis
        .as_object_mut()
        .ok_or_else(|| encoding("Persisted chart axis data is not an object"))?;
    let key = kind.persisted_key(group).to_string();
    let target = axes.entry(key).or_insert_with(|| {
        json!({
            "axisType": kind.ooxml_type(),
            "visible": true,
        })
    });
    if !target.is_object() {
        *target = json!({
            "axisType": kind.ooxml_type(),
            "visible": true,
        });
    }
    target
        .as_object_mut()
        .ok_or_else(|| encoding("Persisted chart axis entry is not an object"))
}

fn ensure_axis_available(
    snapshot: &Value,
    kind: ChartAxisKind,
    group: ChartAxisGroup,
) -> Result<(), ChartError> {
    // A series axis is a primary-only Office.js object even if malformed or
    // imported data happens to carry a second `seriesAxis` entry.
    if kind == ChartAxisKind::Series && group == ChartAxisGroup::Secondary {
        return Err(item_not_found(format!(
            "{} {} axis",
            group.wire_name(),
            kind.wire_name()
        )));
    }
    let explicit = persisted_axis(snapshot, kind, group).is_some();
    let chart_type = chart_type_name(snapshot);
    let requires_axes = chart_type_requires_axes(&chart_type);
    let modeled_secondary = chart_has_secondary_series(snapshot);
    let available = if explicit {
        true
    } else if !requires_axes {
        false
    } else if chart_type_is_scatter_like(&chart_type) {
        kind == ChartAxisKind::Value
            && matches!(group, ChartAxisGroup::Primary | ChartAxisGroup::Secondary)
    } else {
        match (kind, group) {
            (ChartAxisKind::Category | ChartAxisKind::Value, ChartAxisGroup::Primary) => true,
            (ChartAxisKind::Series, ChartAxisGroup::Primary) => {
                chart_type_supports_series_axis(&chart_type)
            }
            (ChartAxisKind::Category | ChartAxisKind::Value, ChartAxisGroup::Secondary) => {
                modeled_secondary
            }
            (ChartAxisKind::Series, ChartAxisGroup::Secondary) => false,
        }
    };
    if available {
        Ok(())
    } else {
        Err(item_not_found(format!(
            "{} {} axis",
            group.wire_name(),
            kind.wire_name()
        )))
    }
}

fn chart_type_name(snapshot: &Value) -> String {
    snapshot
        .get("chartType")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn chart_type_is_scatter_like(chart_type: &str) -> bool {
    chart_type.contains("scatter") || chart_type.contains("bubble")
}

fn chart_type_requires_axes(chart_type: &str) -> bool {
    !(chart_type.contains("pie") || chart_type.contains("doughnut") || chart_type.contains("ofpie"))
}

fn chart_type_supports_series_axis(chart_type: &str) -> bool {
    chart_type.contains("3d")
        && (chart_type.contains("bar")
            || chart_type.contains("column")
            || chart_type.contains("line")
            || chart_type.contains("area"))
        || chart_type.contains("surface")
}

fn chart_has_secondary_series(snapshot: &Value) -> bool {
    snapshot
        .get("series")
        .and_then(Value::as_array)
        .is_some_and(|series| {
            series.iter().any(|item| {
                item.get("yAxisIndex")
                    .and_then(Value::as_u64)
                    .is_some_and(|index| index == 1)
            })
        })
}

fn load_axis_property(
    property: &str,
    axis: Option<&Map<String, Value>>,
    kind: ChartAxisKind,
    group: ChartAxisGroup,
) -> Result<Value, ChartError> {
    let get_bool = |key: &str, default| bool_value(axis, key).unwrap_or(default);
    let get_number = |key: &str, default| number_value(axis, key).unwrap_or(default);
    let value = match property {
        "isNullObject" => Value::Bool(false),
        "alignment" => token_value(
            axis,
            "alignment",
            "Center",
            &[
                ("ctr", "Center"),
                ("center", "Center"),
                ("l", "Left"),
                ("left", "Left"),
                ("r", "Right"),
                ("right", "Right"),
            ],
        ),
        "axisGroup" => Value::String(group.wire_name().to_string()),
        "baseTimeUnit" => token_value(
            axis,
            "baseTimeUnit",
            "Days",
            &[("days", "Days"), ("months", "Months"), ("years", "Years")],
        ),
        "categoryType" => token_value(
            axis,
            "categoryType",
            "Automatic",
            &[
                ("automatic", "Automatic"),
                ("text", "TextAxis"),
                ("textAxis", "TextAxis"),
                ("date", "DateAxis"),
                ("dateAxis", "DateAxis"),
            ],
        ),
        "customDisplayUnit" => number_json(get_number("customDisplayUnit", 0.0)),
        "displayUnit" => {
            if number_value(axis, "customDisplayUnit").is_some() {
                Value::String("Custom".to_string())
            } else {
                token_value(axis, "displayUnit", "None", display_unit_tokens())
            }
        }
        "isBetweenCategories" => Value::Bool(
            bool_value(axis, "isBetweenCategories")
                .or_else(|| string_value(axis, "crossBetween").map(|value| value == "between"))
                .unwrap_or(false),
        ),
        "linkNumberFormat" => Value::Bool(get_bool("linkNumberFormat", false)),
        "logBase" => number_json(get_number("logBase", 10.0)),
        "majorTickMark" => token_value(axis, "tickMarks", "Cross", tick_mark_tokens()),
        "majorTimeUnitScale" => token_value(axis, "majorTimeUnit", "Days", time_unit_tokens()),
        "majorUnit" => number_json(get_number("majorUnit", 0.0)),
        "maximum" => number_json(get_number("max", 0.0)),
        "minimum" => number_json(get_number("min", 0.0)),
        "minorTickMark" => token_value(axis, "minorTickMarks", "Cross", tick_mark_tokens()),
        "minorTimeUnitScale" => token_value(axis, "minorTimeUnit", "Days", time_unit_tokens()),
        "minorUnit" => number_json(get_number("minorUnit", 0.0)),
        "multiLevel" => Value::Bool(
            bool_value(axis, "noMultiLevelLabels")
                .map(|value| !value)
                .unwrap_or(false),
        ),
        "numberFormat" => Value::String(
            string_value(axis, "numberFormat").unwrap_or_else(|| "General".to_string()),
        ),
        "offset" => json!(number_value(axis, "labelOffset").unwrap_or(0.0) as u32),
        "position" => token_value(axis, "crossesAt", "Automatic", position_tokens()),
        "positionAt" => number_json(number_value(axis, "crossesAtValue").unwrap_or(0.0)),
        "reversePlotOrder" => Value::Bool(get_bool("reverse", false)),
        "scaleType" => {
            let logarithmic = string_value(axis, "scaleType")
                .map(|value| value.eq_ignore_ascii_case("logarithmic"))
                .unwrap_or_else(|| number_value(axis, "logBase").is_some());
            Value::String(if logarithmic { "Logarithmic" } else { "Linear" }.to_string())
        }
        "showDisplayUnitLabel" => Value::Bool(
            string_value(axis, "displayUnitLabel").is_some()
                || bool_value(axis, "showDisplayUnitLabel").unwrap_or(false),
        ),
        "textOrientation" => number_json(get_number("textOrientation", 0.0)),
        "tickLabelPosition" => token_value(
            axis,
            "tickLabelPosition",
            "NextToAxis",
            tick_label_position_tokens(),
        ),
        "tickLabelSpacing" => json!(number_value(axis, "tickLabelSpacing").unwrap_or(1.0) as u32),
        "tickMarkSpacing" => json!(number_value(axis, "tickMarkSpacing").unwrap_or(1.0) as u32),
        "type" => Value::String(kind.wire_name().to_string()),
        "visible" => Value::Bool(effective_visible(axis)),
        // Geometry is not represented by the persisted chart model.  Keep
        // those declarations explicit instead of returning fabricated sizes.
        "height" | "left" | "top" | "width" => {
            return Err(unsupported_load_property("ChartAxis", property));
        }
        other => return Err(unsupported_load_property("ChartAxis", other)),
    };
    Ok(value)
}

fn set_axis_property(
    axis: &mut Map<String, Value>,
    property: &str,
    value: &Value,
) -> Result<(), ChartError> {
    match property {
        "alignment" => {
            let value = enum_string(value, "ChartAxis.alignment")?;
            let normalized = normalize_token(
                value,
                "ChartAxis.alignment",
                &[("Center", "ctr"), ("Left", "l"), ("Right", "r")],
            )?;
            axis.insert(
                "alignment".to_string(),
                Value::String(normalized.to_string()),
            );
        }
        "baseTimeUnit" => {
            let value = enum_string(value, "ChartAxis.baseTimeUnit")?;
            insert_enum(
                axis,
                "baseTimeUnit",
                value,
                time_unit_tokens(),
                "ChartAxis.baseTimeUnit",
            )?;
        }
        "categoryType" => {
            let value = enum_string(value, "ChartAxis.categoryType")?;
            let normalized = normalize_token(
                value,
                "ChartAxis.categoryType",
                &[
                    ("Automatic", "automatic"),
                    ("TextAxis", "text"),
                    ("DateAxis", "date"),
                ],
            )?;
            axis.insert(
                "categoryType".to_string(),
                Value::String(normalized.to_string()),
            );
        }
        "displayUnit" => {
            let value = enum_string(value, "ChartAxis.displayUnit")?;
            insert_enum(
                axis,
                "displayUnit",
                value,
                display_unit_tokens(),
                "ChartAxis.displayUnit",
            )?;
            if !value.eq_ignore_ascii_case("Custom") {
                axis.remove("customDisplayUnit");
            }
        }
        "isBetweenCategories" => {
            let value = value.as_bool().ok_or_else(|| {
                invalid("ChartAxis.isBetweenCategories must be a boolean".to_string())
            })?;
            axis.insert("isBetweenCategories".to_string(), Value::Bool(value));
            axis.insert(
                "crossBetween".to_string(),
                Value::String(if value { "between" } else { "midCat" }.to_string()),
            );
        }
        "linkNumberFormat" => {
            let value = value.as_bool().ok_or_else(|| {
                invalid("ChartAxis.linkNumberFormat must be a boolean".to_string())
            })?;
            axis.insert("linkNumberFormat".to_string(), Value::Bool(value));
        }
        "logBase" => {
            let value = finite_number(value, "ChartAxis.logBase")?;
            if value <= 1.0 {
                return Err(invalid(
                    "ChartAxis.logBase must be greater than 1".to_string(),
                ));
            }
            insert_number(axis, "logBase", value);
            axis.insert(
                "scaleType".to_string(),
                Value::String("logarithmic".to_string()),
            );
        }
        "majorTickMark" => {
            let value = enum_string(value, "ChartAxis.majorTickMark")?;
            insert_enum(
                axis,
                "tickMarks",
                value,
                tick_mark_tokens(),
                "ChartAxis.majorTickMark",
            )?;
        }
        "majorTimeUnitScale" => {
            let value = enum_string(value, "ChartAxis.majorTimeUnitScale")?;
            insert_enum(
                axis,
                "majorTimeUnit",
                value,
                time_unit_tokens(),
                "ChartAxis.majorTimeUnitScale",
            )?;
        }
        "majorUnit" => set_number_or_auto(axis, "majorUnit", value, "ChartAxis.majorUnit", true)?,
        "maximum" => set_number_or_auto(axis, "max", value, "ChartAxis.maximum", false)?,
        "minimum" => set_number_or_auto(axis, "min", value, "ChartAxis.minimum", false)?,
        "minorTickMark" => {
            let value = enum_string(value, "ChartAxis.minorTickMark")?;
            insert_enum(
                axis,
                "minorTickMarks",
                value,
                tick_mark_tokens(),
                "ChartAxis.minorTickMark",
            )?;
        }
        "minorTimeUnitScale" => {
            let value = enum_string(value, "ChartAxis.minorTimeUnitScale")?;
            insert_enum(
                axis,
                "minorTimeUnit",
                value,
                time_unit_tokens(),
                "ChartAxis.minorTimeUnitScale",
            )?;
        }
        "minorUnit" => set_number_or_auto(axis, "minorUnit", value, "ChartAxis.minorUnit", true)?,
        "multiLevel" => {
            let value = value
                .as_bool()
                .ok_or_else(|| invalid("ChartAxis.multiLevel must be a boolean".to_string()))?;
            axis.insert("noMultiLevelLabels".to_string(), Value::Bool(!value));
        }
        "numberFormat" => {
            let value = value
                .as_str()
                .ok_or_else(|| invalid("ChartAxis.numberFormat must be a string".to_string()))?;
            axis.insert("numberFormat".to_string(), Value::String(value.to_string()));
        }
        "offset" => {
            let value = bounded_integer(value, "ChartAxis.offset", 0, 1000)?;
            axis.insert("labelOffset".to_string(), json!(value));
        }
        "position" => {
            let value = enum_string(value, "ChartAxis.position")?;
            insert_enum(
                axis,
                "crossesAt",
                value,
                position_tokens(),
                "ChartAxis.position",
            )?;
            if !value.eq_ignore_ascii_case("Custom") {
                axis.remove("crossesAtValue");
            }
        }
        "reversePlotOrder" => {
            let value = value.as_bool().ok_or_else(|| {
                invalid("ChartAxis.reversePlotOrder must be a boolean".to_string())
            })?;
            axis.insert("reverse".to_string(), Value::Bool(value));
        }
        "scaleType" => {
            let value = enum_string(value, "ChartAxis.scaleType")?;
            match value {
                "Linear" => {
                    axis.insert("scaleType".to_string(), Value::String("linear".to_string()));
                    axis.remove("logBase");
                }
                "Logarithmic" => {
                    axis.insert(
                        "scaleType".to_string(),
                        Value::String("logarithmic".to_string()),
                    );
                    if !axis.contains_key("logBase") {
                        insert_number(axis, "logBase", 10.0);
                    }
                }
                other => {
                    return Err(invalid(format!(
                        "ChartAxis.scaleType must be Linear or Logarithmic; got '{other}'"
                    )));
                }
            }
        }
        "showDisplayUnitLabel" => {
            let value = value.as_bool().ok_or_else(|| {
                invalid("ChartAxis.showDisplayUnitLabel must be a boolean".to_string())
            })?;
            if value {
                axis.entry("displayUnitLabel".to_string())
                    .or_insert_with(|| Value::String("Display Unit".to_string()));
            } else {
                axis.remove("displayUnitLabel");
            }
            axis.insert("showDisplayUnitLabel".to_string(), Value::Bool(value));
        }
        "textOrientation" => {
            let value = text_orientation(value, "ChartAxis.textOrientation")?;
            insert_number(axis, "textOrientation", value);
        }
        "tickLabelPosition" => {
            let value = enum_string(value, "ChartAxis.tickLabelPosition")?;
            insert_enum(
                axis,
                "tickLabelPosition",
                value,
                tick_label_position_tokens(),
                "ChartAxis.tickLabelPosition",
            )?;
        }
        "tickLabelSpacing" => {
            if value.as_str() == Some("") {
                axis.remove("tickLabelSpacing");
            } else {
                let value = bounded_integer(value, "ChartAxis.tickLabelSpacing", 1, 31999)?;
                axis.insert("tickLabelSpacing".to_string(), json!(value));
            }
        }
        "tickMarkSpacing" => {
            let value = bounded_integer(value, "ChartAxis.tickMarkSpacing", 1, u32::MAX)?;
            axis.insert("tickMarkSpacing".to_string(), json!(value));
        }
        "visible" => {
            let value = value
                .as_bool()
                .ok_or_else(|| invalid("ChartAxis.visible must be a boolean".to_string()))?;
            axis.insert("visible".to_string(), Value::Bool(value));
            axis.insert("visibleExplicit".to_string(), Value::Bool(true));
        }
        "axisGroup" | "customDisplayUnit" | "height" | "left" | "positionAt" | "top" | "type"
        | "width" => {
            return Err(unsupported_set_property(format!(
                "ChartAxis.{property} is read-only"
            )));
        }
        "format" | "majorGridlines" | "minorGridlines" | "title" => {
            return Err(unsupported_set_property(format!(
                "ChartAxis.{property} is handled by its child object"
            )));
        }
        other => return Err(unsupported_set_property(format!("ChartAxis.{other}"))),
    }
    Ok(())
}

fn effective_visible(axis: Option<&Map<String, Value>>) -> bool {
    let visible = bool_value(axis, "visible").unwrap_or(true);
    visible || !bool_value(axis, "visibleExplicit").unwrap_or(false)
}

fn set_number_or_auto(
    axis: &mut Map<String, Value>,
    key: &str,
    value: &Value,
    property: &str,
    positive: bool,
) -> Result<(), ChartError> {
    if value.as_str() == Some("") {
        axis.remove(key);
        return Ok(());
    }
    let value = finite_number(value, property)?;
    if positive && value <= 0.0 {
        return Err(invalid(format!("{property} must be greater than zero")));
    }
    insert_number(axis, key, value);
    Ok(())
}

fn bounded_integer(
    value: &Value,
    property: &str,
    minimum: u32,
    maximum: u32,
) -> Result<u32, ChartError> {
    let value = value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .or_else(|| {
            value.as_f64().and_then(|value| {
                (value.is_finite() && value.fract() == 0.0 && value >= 0.0)
                    .then_some(value as u64)
                    .and_then(|value| u32::try_from(value).ok())
            })
        })
        .ok_or_else(|| invalid(format!("{property} must be an integer")))?;
    if value < minimum || value > maximum {
        return Err(invalid(format!(
            "{property} must be between {minimum} and {maximum}"
        )));
    }
    Ok(value)
}

fn text_orientation(value: &Value, property: &str) -> Result<f64, ChartError> {
    let value = finite_number(value, property)?;
    if value.fract() != 0.0 || (value < -90.0 || value > 90.0) && value != 180.0 {
        return Err(invalid(format!(
            "{property} must be an integer from -90 to 90 or 180"
        )));
    }
    Ok(value)
}

fn enum_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, ChartError> {
    value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a string")))
}

fn insert_enum(
    axis: &mut Map<String, Value>,
    key: &str,
    value: &str,
    choices: &[(&str, &str)],
    property: &str,
) -> Result<(), ChartError> {
    let normalized = choices
        .iter()
        .find(|(wire, output)| {
            wire.eq_ignore_ascii_case(value) || output.eq_ignore_ascii_case(value)
        })
        .map(|(wire, _)| *wire)
        .ok_or_else(|| invalid(format!("{property} has an invalid value '{value}'")))?;
    axis.insert(key.to_string(), Value::String(normalized.to_string()));
    Ok(())
}

fn normalize_token<'a>(
    value: &str,
    property: &str,
    choices: &'a [(&'a str, &'a str)],
) -> Result<&'a str, ChartError> {
    choices
        .iter()
        .find(|(wire, _)| wire.eq_ignore_ascii_case(value))
        .map(|(_, normalized)| *normalized)
        .ok_or_else(|| invalid(format!("{property} has an invalid value '{value}'")))
}

fn token_value(
    axis: Option<&Map<String, Value>>,
    key: &str,
    default: &str,
    choices: &[(&str, &str)],
) -> Value {
    let raw = string_value(axis, key).unwrap_or_else(|| default.to_string());
    let mapped = choices
        .iter()
        .find(|(wire, output)| wire.eq_ignore_ascii_case(&raw) || output.eq_ignore_ascii_case(&raw))
        .map(|(_, output)| *output)
        .unwrap_or(default);
    Value::String(mapped.to_string())
}

fn tick_mark_tokens() -> &'static [(&'static str, &'static str)] {
    &[
        ("none", "None"),
        ("cross", "Cross"),
        ("in", "Inside"),
        ("out", "Outside"),
    ]
}

fn tick_label_position_tokens() -> &'static [(&'static str, &'static str)] {
    &[
        ("nextTo", "NextToAxis"),
        ("high", "High"),
        ("low", "Low"),
        ("none", "None"),
    ]
}

fn time_unit_tokens() -> &'static [(&'static str, &'static str)] {
    &[("days", "Days"), ("months", "Months"), ("years", "Years")]
}

fn display_unit_tokens() -> &'static [(&'static str, &'static str)] {
    &[
        ("none", "None"),
        ("hundreds", "Hundreds"),
        ("thousands", "Thousands"),
        ("tenThousands", "TenThousands"),
        ("hundredThousands", "HundredThousands"),
        ("millions", "Millions"),
        ("tenMillions", "TenMillions"),
        ("hundredMillions", "HundredMillions"),
        ("billions", "Billions"),
        ("trillions", "Trillions"),
        ("custom", "Custom"),
    ]
}

fn position_tokens() -> &'static [(&'static str, &'static str)] {
    &[
        ("automatic", "Automatic"),
        ("max", "Maximum"),
        ("min", "Minimum"),
        ("custom", "Custom"),
    ]
}

fn bool_value(axis: Option<&Map<String, Value>>, key: &str) -> Option<bool> {
    axis.and_then(|axis| axis.get(key)).and_then(Value::as_bool)
}

fn number_value(axis: Option<&Map<String, Value>>, key: &str) -> Option<f64> {
    axis.and_then(|axis| axis.get(key)).and_then(Value::as_f64)
}

fn string_value(axis: Option<&Map<String, Value>>, key: &str) -> Option<String> {
    axis.and_then(|axis| axis.get(key))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn finite_number(value: &Value, property: &str) -> Result<f64, ChartError> {
    let value = value
        .as_f64()
        .ok_or_else(|| invalid(format!("{property} must be a number")))?;
    if !value.is_finite() {
        return Err(invalid(format!("{property} must be finite")));
    }
    Ok(value)
}

fn insert_number(axis: &mut Map<String, Value>, key: &str, value: f64) {
    axis.insert(key.to_string(), number_json(value));
}

fn number_json(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn batch_error(error: ChartError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn chart_error(error: crate::chart_core::ChartError) -> ChartError {
    ChartError {
        code: error.code,
        message: error.message,
    }
}

fn encoding(message: impl Into<String>) -> ChartError {
    ChartError {
        code: "GeneralException",
        message: message.into(),
    }
}

fn invalid(message: impl Into<String>) -> ChartError {
    ChartError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn item_not_found(message: impl Into<String>) -> ChartError {
    ChartError {
        code: "ItemNotFound",
        message: format!(
            "The requested chart axis does not exist: {}",
            message.into()
        ),
    }
}

fn unsupported_load_property(object: &str, property: &str) -> ChartError {
    ChartError {
        code: "InvalidArgument",
        message: format!("{object}.{property} is not supported by this Office.js host"),
    }
}

fn unsupported_set_property(message: impl Into<String>) -> ChartError {
    ChartError {
        code: "InvalidArgument",
        message: message.into(),
    }
}
