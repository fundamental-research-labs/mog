//! Office.js conditional-format visual children.
//!
//! Reads resolve the current canonical conditional-format document and writes
//! go through SheetConditionalFormats. There is deliberately no cached JSON
//! shadow: a fresh request context observes the durable engine state and the
//! engine remains responsible for evaluation and recalculation.

use std::collections::HashMap;
use std::sync::Arc;

use compute_api::Sheet;
use serde_json::{Map, Value, json};

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::BatchError;

/// Error returned by a conditional-format visual child operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConditionalScaleError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl ConditionalScaleError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: "ItemNotFound",
            message: message.into(),
        }
    }

    fn engine(error: impl std::fmt::Display) -> Self {
        Self {
            code: "GeneralException",
            message: error.to_string(),
        }
    }

    fn encoding(error: impl std::fmt::Display) -> Self {
        Self {
            code: "GeneralException",
            message: format!("conditional-format conversion failed: {error}"),
        }
    }
}

/// The visual object represented by a proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConditionalScaleKind {
    ColorScale,
    DataBar,
    DataBarPositive,
    DataBarNegative,
    IconSet,
}

impl ConditionalScaleKind {
    pub(crate) fn parse(value: &str) -> Result<Self, ConditionalScaleError> {
        match value {
            "colorScale" | "ColorScale" | "colorScaleConditionalFormat" => Ok(Self::ColorScale),
            "dataBar" | "DataBar" | "dataBarConditionalFormat" => Ok(Self::DataBar),
            "dataBarPositive" | "positiveFormat" | "ConditionalDataBarPositiveFormat" => {
                Ok(Self::DataBarPositive)
            }
            "dataBarNegative" | "negativeFormat" | "ConditionalDataBarNegativeFormat" => {
                Ok(Self::DataBarNegative)
            }
            "iconSet" | "IconSet" | "iconSetConditionalFormat" => Ok(Self::IconSet),
            other => Err(Self::invalid(format!(
                "Unsupported conditional-format visual kind '{other}'"
            ))),
        }
    }

    fn invalid(message: impl Into<String>) -> ConditionalScaleError {
        ConditionalScaleError::invalid(message)
    }

    fn parent_rule_type(self) -> &'static str {
        match self {
            Self::ColorScale => "colorScale",
            Self::DataBar | Self::DataBarPositive | Self::DataBarNegative => "dataBar",
            Self::IconSet => "iconSet",
        }
    }

    fn object_type(self) -> &'static str {
        match self {
            Self::ColorScale => "ColorScaleConditionalFormat",
            Self::DataBar => "DataBarConditionalFormat",
            Self::DataBarPositive => "ConditionalDataBarPositiveFormat",
            Self::DataBarNegative => "ConditionalDataBarNegativeFormat",
            Self::IconSet => "IconSetConditionalFormat",
        }
    }
}

/// A host-side visual conditional-format proxy.
#[derive(Clone)]
pub(crate) struct ConditionalFormatRef {
    sheet: Sheet,
    format_id: String,
    rule_id: Option<String>,
    kind: ConditionalScaleKind,
}

#[derive(Clone)]
struct LocatedRule {
    format_id: String,
    format: Value,
    rule_index: usize,
    rule: Value,
}

impl ConditionalFormatRef {
    pub(crate) fn new(
        sheet: Sheet,
        format_id: impl Into<String>,
        rule_id: Option<String>,
        kind: &str,
    ) -> Result<Self, ConditionalScaleError> {
        let format_id = format_id.into();
        if format_id.trim().is_empty() {
            return Err(ConditionalScaleError::invalid(
                "Conditional-format visual child requires a format ID",
            ));
        }
        Ok(Self {
            sheet,
            format_id,
            rule_id,
            kind: ConditionalScaleKind::parse(kind)?,
        })
    }

    pub(crate) fn kind(&self) -> ConditionalScaleKind {
        self.kind
    }

    pub(crate) fn format_id(&self) -> &str {
        &self.format_id
    }

    pub(crate) fn rule_id(&self) -> Option<&str> {
        self.rule_id.as_deref()
    }

    pub(crate) fn exists(&self) -> Result<bool, ConditionalScaleError> {
        Ok(self.resolve_rule().is_ok())
    }

    /// Project Office.js properties from the current canonical rule.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ConditionalScaleError> {
        let located = self.resolve_rule()?;
        let mut result = HashMap::new();
        for property in properties {
            if property == "isNullObject" {
                result.insert(property.clone(), Value::Bool(false));
            } else {
                result.insert(
                    property.clone(),
                    read_property(self.kind, &located.rule, property)?,
                );
            }
        }
        Ok(result)
    }

    /// Apply one Office.js property through the real engine API.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ConditionalScaleError> {
        if property == "isNullObject" {
            return Err(ConditionalScaleError::invalid(
                "Conditional-format visual isNullObject is read-only",
            ));
        }
        let located = self.resolve_rule()?;
        let mut rule = located.rule;
        apply_property(self.kind, &mut rule, property, value)?;
        self.persist_rule(located, rule)
    }

    fn resolve_rule(&self) -> Result<LocatedRule, ConditionalScaleError> {
        let formats = self
            .sheet
            .conditional_formats()
            .get_all_rules()
            .map_err(ConditionalScaleError::engine)?;
        let mut by_rule_id = None;
        let mut by_format_id = None;

        for format in formats {
            let value = serde_json::to_value(format).map_err(ConditionalScaleError::encoding)?;
            let Some(format_object) = value.as_object() else {
                continue;
            };
            let Some(current_format_id) = format_object.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(rules) = format_object.get("rules").and_then(Value::as_array) else {
                continue;
            };

            for (rule_index, rule) in rules.iter().enumerate() {
                if rule_type(rule) != Some(self.kind.parent_rule_type()) {
                    continue;
                }
                let current_rule_id = rule.get("id").and_then(Value::as_str);
                let matches_rule_id = self
                    .rule_id
                    .as_deref()
                    .is_none_or(|requested| current_rule_id == Some(requested));
                if !matches_rule_id {
                    continue;
                }
                let located = LocatedRule {
                    format_id: current_format_id.to_string(),
                    format: value.clone(),
                    rule_index,
                    rule: rule.clone(),
                };
                if current_format_id == self.format_id {
                    return Ok(located);
                }
                if self
                    .rule_id
                    .as_deref()
                    .is_some_and(|requested| current_rule_id == Some(requested))
                {
                    by_rule_id = Some(located);
                } else if by_format_id.is_none() {
                    by_format_id = Some(located);
                }
            }
        }

        by_rule_id.or(by_format_id).ok_or_else(|| {
            ConditionalScaleError::not_found(format!(
                "Conditional-format visual '{}' was not found",
                self.format_id
            ))
        })
    }

    fn persist_rule(&self, located: LocatedRule, rule: Value) -> Result<(), ConditionalScaleError> {
        let mut format = located.format.as_object().cloned().ok_or_else(|| {
            ConditionalScaleError::encoding("conditional format is not an object")
        })?;
        let rules = format
            .get_mut("rules")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| ConditionalScaleError::encoding("conditional format has no rules"))?;
        let Some(slot) = rules.get_mut(located.rule_index) else {
            return Err(ConditionalScaleError::encoding(
                "conditional format rule index is no longer valid",
            ));
        };
        *slot = rule;
        self.sheet
            .conditional_formats()
            .update_rule(&located.format_id, json!({ "rules": rules }))
            .map_err(ConditionalScaleError::engine)?;
        Ok(())
    }
}

/// Extension handler for visual child binding operations.
///
/// The JS adapter queues getConditionalFormatChild with
/// {worksheetId, formatId, ruleId?, kind}. Aliases are accepted while the
/// conditional-format base object is integrated by the host owner.
pub(crate) struct ConditionalFormatHandler;

impl ExtensionHandler for ConditionalFormatHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "getConditionalFormatChild"
                | "conditionalFormatGetChild"
                | "getConditionalFormatVisual"
                | "getConditionalFormatChildOrNullObject"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let id = required_string(operation, "id")?;
        let worksheet_id = operation
            .get("worksheetId")
            .or_else(|| operation.get("sheetId"))
            .and_then(Value::as_str)
            .ok_or_else(|| batch_invalid("conditional-format child requires worksheetId"))?;
        let format_id = operation
            .get("formatId")
            .or_else(|| operation.get("conditionalFormatId"))
            .and_then(Value::as_str)
            .ok_or_else(|| batch_invalid("conditional-format child requires formatId"))?;
        let rule_id = operation
            .get("ruleId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let kind = operation
            .get("childKind")
            .or_else(|| operation.get("kind"))
            .and_then(Value::as_str)
            .ok_or_else(|| batch_invalid("conditional-format child requires kind"))?;

        let reference = ConditionalFormatRef::new(
            context.worksheet(worksheet_id)?.sheet(),
            format_id,
            rule_id,
            kind,
        )
        .map_err(scale_error)?;
        let or_null = operation
            .get("orNullObject")
            .or_else(|| operation.get("nullObject"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || operation
                .get("op")
                .and_then(Value::as_str)
                .is_some_and(|name| name.ends_with("OrNullObject"));

        if or_null && !reference.exists().map_err(scale_error)? {
            context.bind_null_object(&id);
        } else {
            context.bind_object(&id, Arc::new(reference));
        }
        Ok(true)
    }
}

impl ExtensionObject for ConditionalFormatRef {
    fn object_type(&self) -> &'static str {
        self.kind.object_type()
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        ConditionalFormatRef::load(self, properties).map_err(scale_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        ConditionalFormatRef::set(self, property, value).map_err(scale_error)
    }
}

fn rule_type(value: &Value) -> Option<&str> {
    value.get("type").and_then(Value::as_str)
}

fn read_property(
    kind: ConditionalScaleKind,
    rule: &Value,
    property: &str,
) -> Result<Value, ConditionalScaleError> {
    let payload = rule_payload(rule, kind.parent_rule_type())?;
    match (kind, property) {
        (ConditionalScaleKind::ColorScale, "criteria") => color_scale_criteria(payload),
        (ConditionalScaleKind::ColorScale, "threeColorScale") => Ok(Value::Bool(
            payload
                .get("midPoint")
                .or_else(|| payload.get("midpoint"))
                .is_some_and(|value| !value.is_null()),
        )),

        (ConditionalScaleKind::DataBar, "negativeFormat") => negative_format(payload),
        (ConditionalScaleKind::DataBar, "positiveFormat") => positive_format(payload),
        (ConditionalScaleKind::DataBar, "axisColor") => Ok(string_or_default(payload, "axisColor")),
        (ConditionalScaleKind::DataBar, "axisFormat") => Ok(json!(axis_format_token(
            payload
                .get("axisPosition")
                .or_else(|| payload.get("axisFormat"))
                .and_then(Value::as_str),
        ))),
        (ConditionalScaleKind::DataBar, "barDirection") => Ok(json!(bar_direction_token(
            payload
                .get("direction")
                .or_else(|| payload.get("barDirection"))
                .and_then(Value::as_str),
        ))),
        (ConditionalScaleKind::DataBar, "lowerBoundRule") => {
            point_to_bound_rule(payload.get("minPoint"))
        }
        (ConditionalScaleKind::DataBar, "showDataBarOnly") => Ok(Value::Bool(
            !payload
                .get("showValue")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        )),
        (ConditionalScaleKind::DataBar, "upperBoundRule") => {
            point_to_bound_rule(payload.get("maxPoint"))
        }

        (ConditionalScaleKind::DataBarPositive, "borderColor") => {
            Ok(string_or_default(payload, "borderColor"))
        }
        (ConditionalScaleKind::DataBarPositive, "fillColor") => {
            Ok(string_or_default(payload, "positiveColor"))
        }
        (ConditionalScaleKind::DataBarPositive, "gradientFill") => Ok(Value::Bool(
            payload
                .get("gradient")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        )),

        (ConditionalScaleKind::DataBarNegative, "borderColor") => {
            Ok(string_or_default(payload, "negativeBorderColor"))
        }
        (ConditionalScaleKind::DataBarNegative, "fillColor") => {
            Ok(string_or_default(payload, "negativeColor"))
        }
        (ConditionalScaleKind::DataBarNegative, "matchPositiveBorderColor") => Ok(Value::Bool(
            payload
                .get("matchPositiveBorderColor")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )),
        (ConditionalScaleKind::DataBarNegative, "matchPositiveFillColor") => Ok(Value::Bool(
            payload
                .get("matchPositiveFillColor")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )),

        (ConditionalScaleKind::IconSet, "criteria") => icon_criteria(payload),
        (ConditionalScaleKind::IconSet, "reverseIconOrder") => Ok(Value::Bool(
            payload
                .get("reverseOrder")
                .or_else(|| payload.get("reverseIconOrder"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )),
        (ConditionalScaleKind::IconSet, "showIconOnly") => Ok(Value::Bool(
            payload
                .get("showIconOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        )),
        (ConditionalScaleKind::IconSet, "style") => Ok(json!(icon_style_token(
            payload
                .get("iconSetName")
                .or_else(|| payload.get("style"))
                .and_then(Value::as_str),
        ))),

        (_, other) => Err(ConditionalScaleError::unsupported(format!(
            "Unsupported {} property '{other}'",
            kind.object_type()
        ))),
    }
}

fn apply_property(
    kind: ConditionalScaleKind,
    rule: &mut Value,
    property: &str,
    value: &Value,
) -> Result<(), ConditionalScaleError> {
    let payload = rule_payload_mut(rule, kind.parent_rule_type())?;
    match (kind, property) {
        (ConditionalScaleKind::ColorScale, "criteria") => {
            let criteria = value.as_object().ok_or_else(|| {
                ConditionalScaleError::invalid("ColorScale.criteria must be an object")
            })?;
            for name in criteria.keys() {
                if !matches!(name.as_str(), "minimum" | "midpoint" | "maximum") {
                    return Err(ConditionalScaleError::invalid(format!(
                        "Unsupported ColorScale.criteria property '{name}'"
                    )));
                }
            }
            let minimum = criteria.get("minimum").ok_or_else(|| {
                ConditionalScaleError::invalid("ColorScale.criteria.minimum is required")
            })?;
            let maximum = criteria.get("maximum").ok_or_else(|| {
                ConditionalScaleError::invalid("ColorScale.criteria.maximum is required")
            })?;
            let old_min_color = point_color(payload.get("minPoint"));
            let old_max_color = point_color(payload.get("maxPoint"));
            let min_point = criterion_to_point(
                minimum,
                old_min_color.unwrap_or_default(),
                CriterionFamily::ColorScale,
            )?;
            let max_point = criterion_to_point(
                maximum,
                old_max_color.unwrap_or_default(),
                CriterionFamily::ColorScale,
            )?;
            let midpoint = match criteria.get("midpoint") {
                Some(Value::Null) | None => None,
                Some(value) => Some(criterion_to_point(
                    value,
                    point_color(payload.get("midPoint").or_else(|| payload.get("midpoint")))
                        .unwrap_or_default(),
                    CriterionFamily::ColorScale,
                )?),
            };
            payload.insert("minPoint".to_string(), min_point.clone());
            payload.insert("maxPoint".to_string(), max_point.clone());
            if let Some(midpoint) = midpoint.clone() {
                payload.insert("midPoint".to_string(), midpoint);
            } else {
                payload.remove("midPoint");
                payload.remove("midpoint");
            }
            let mut points = vec![min_point];
            if let Some(midpoint) = midpoint {
                points.push(midpoint);
            }
            points.push(max_point);
            payload.insert("points".to_string(), Value::Array(points));
        }
        (ConditionalScaleKind::ColorScale, "threeColorScale") => {
            return Err(ConditionalScaleError::invalid(
                "ColorScale.threeColorScale is read-only",
            ));
        }

        (ConditionalScaleKind::DataBar, "negativeFormat") => {
            apply_negative_format(payload, value)?;
        }
        (ConditionalScaleKind::DataBar, "positiveFormat") => {
            apply_positive_format(payload, value)?;
        }
        (ConditionalScaleKind::DataBar, "axisColor") => {
            payload.insert("axisColor".to_string(), string_value(value, property)?);
        }
        (ConditionalScaleKind::DataBar, "axisFormat") => {
            let token = enum_string(value, property)?;
            let internal = match token {
                "Automatic" => "automatic",
                "None" => "none",
                "CellMidPoint" => "middle",
                other => {
                    return Err(ConditionalScaleError::invalid(format!(
                        "Unsupported {property} value '{other}'"
                    )));
                }
            };
            payload.insert("axisPosition".to_string(), json!(internal));
        }
        (ConditionalScaleKind::DataBar, "barDirection") => {
            let token = enum_string(value, property)?;
            let internal = match token {
                "Context" => "context",
                "LeftToRight" => "leftToRight",
                "RightToLeft" => "rightToLeft",
                other => {
                    return Err(ConditionalScaleError::invalid(format!(
                        "Unsupported {property} value '{other}'"
                    )));
                }
            };
            payload.insert("direction".to_string(), json!(internal));
        }
        (ConditionalScaleKind::DataBar, "lowerBoundRule") => {
            let color = point_color(payload.get("minPoint"))
                .or_else(|| {
                    payload
                        .get("positiveColor")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_default();
            payload.insert(
                "minPoint".to_string(),
                bound_rule_to_point(value, true, color)?,
            );
        }
        (ConditionalScaleKind::DataBar, "showDataBarOnly") => {
            payload.insert(
                "showValue".to_string(),
                Value::Bool(!bool_value(value, property)?),
            );
        }
        (ConditionalScaleKind::DataBar, "upperBoundRule") => {
            let color = point_color(payload.get("maxPoint"))
                .or_else(|| {
                    payload
                        .get("positiveColor")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_default();
            payload.insert(
                "maxPoint".to_string(),
                bound_rule_to_point(value, false, color)?,
            );
        }

        (ConditionalScaleKind::DataBarPositive, "borderColor") => {
            payload.insert("borderColor".to_string(), optional_color(value, property)?);
        }
        (ConditionalScaleKind::DataBarPositive, "fillColor") => {
            payload.insert("positiveColor".to_string(), string_value(value, property)?);
        }
        (ConditionalScaleKind::DataBarPositive, "gradientFill") => {
            payload.insert("gradient".to_string(), bool_value(value, property)?.into());
        }

        (ConditionalScaleKind::DataBarNegative, "borderColor") => {
            payload.insert(
                "negativeBorderColor".to_string(),
                optional_color(value, property)?,
            );
        }
        (ConditionalScaleKind::DataBarNegative, "fillColor") => {
            payload.insert(
                "negativeColor".to_string(),
                optional_color(value, property)?,
            );
        }
        (ConditionalScaleKind::DataBarNegative, "matchPositiveBorderColor") => {
            payload.insert(
                "matchPositiveBorderColor".to_string(),
                bool_value(value, property)?.into(),
            );
        }
        (ConditionalScaleKind::DataBarNegative, "matchPositiveFillColor") => {
            payload.insert(
                "matchPositiveFillColor".to_string(),
                bool_value(value, property)?.into(),
            );
        }

        (ConditionalScaleKind::IconSet, "criteria") => {
            let criteria = value.as_array().ok_or_else(|| {
                ConditionalScaleError::invalid("IconSet.criteria must be an array")
            })?;
            if !(2..=5).contains(&criteria.len()) {
                return Err(ConditionalScaleError::invalid(
                    "IconSet.criteria must contain between two and five criteria",
                ));
            }
            let mut custom_icons = Vec::with_capacity(criteria.len());
            for criterion in criteria {
                custom_icons.push(icon_from_criterion(criterion)?);
            }
            let thresholds = criteria[1..]
                .iter()
                .map(criterion_to_icon_threshold)
                .collect::<Result<Vec<_>, _>>()?;
            let all_percent = thresholds.iter().all(|threshold| {
                threshold
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value == "percent")
            });
            payload.insert("thresholds".to_string(), Value::Array(thresholds));
            payload.insert("customIcons".to_string(), Value::Array(custom_icons));
            payload.insert("percent".to_string(), Value::Bool(all_percent));
        }
        (ConditionalScaleKind::IconSet, "reverseIconOrder") => {
            payload.insert(
                "reverseOrder".to_string(),
                bool_value(value, property)?.into(),
            );
        }
        (ConditionalScaleKind::IconSet, "showIconOnly") => {
            payload.insert(
                "showIconOnly".to_string(),
                bool_value(value, property)?.into(),
            );
        }
        (ConditionalScaleKind::IconSet, "style") => {
            let token = enum_string(value, property)?;
            let internal = office_icon_style_to_internal(token).ok_or_else(|| {
                ConditionalScaleError::invalid(format!("Unsupported {property} value '{token}'"))
            })?;
            payload.insert("iconSetName".to_string(), json!(internal));
        }

        (_, other) => {
            return Err(ConditionalScaleError::unsupported(format!(
                "Unsupported {} property '{other}'",
                kind.object_type()
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum CriterionFamily {
    ColorScale,
    DataBar,
}

fn rule_payload<'a>(
    rule: &'a Value,
    expected_type: &str,
) -> Result<&'a Map<String, Value>, ConditionalScaleError> {
    if rule_type(rule) != Some(expected_type) {
        return Err(ConditionalScaleError::invalid(format!(
            "Expected a {expected_type} conditional-format rule"
        )));
    }
    rule.get(expected_type)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            ConditionalScaleError::encoding(format!(
                "{expected_type} conditional-format rule has no payload"
            ))
        })
}

fn rule_payload_mut<'a>(
    rule: &'a mut Value,
    expected_type: &str,
) -> Result<&'a mut Map<String, Value>, ConditionalScaleError> {
    if rule_type(rule) != Some(expected_type) {
        return Err(ConditionalScaleError::invalid(format!(
            "Expected a {expected_type} conditional-format rule"
        )));
    }
    rule.get_mut(expected_type)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            ConditionalScaleError::encoding(format!(
                "{expected_type} conditional-format rule has no payload"
            ))
        })
}

fn color_scale_criteria(payload: &Map<String, Value>) -> Result<Value, ConditionalScaleError> {
    let minimum = color_criterion(payload.get("minPoint"))?;
    let maximum = color_criterion(payload.get("maxPoint"))?;
    let mut criteria = Map::new();
    criteria.insert("minimum".to_string(), minimum);
    if let Some(midpoint) = payload.get("midPoint").or_else(|| payload.get("midpoint"))
        && !midpoint.is_null()
    {
        criteria.insert("midpoint".to_string(), color_criterion(Some(midpoint))?);
    }
    criteria.insert("maximum".to_string(), maximum);
    Ok(Value::Object(criteria))
}

fn color_criterion(point: Option<&Value>) -> Result<Value, ConditionalScaleError> {
    let point =
        point.ok_or_else(|| ConditionalScaleError::encoding("color scale point is missing"))?;
    let object = point
        .as_object()
        .ok_or_else(|| ConditionalScaleError::encoding("color scale point is not an object"))?;
    let value = object
        .get("value")
        .ok_or_else(|| ConditionalScaleError::encoding("color scale point has no value"))?;
    let (kind, formula) = value_ref_to_office(value)?;
    let mut output = Map::new();
    output.insert("type".to_string(), Value::String(kind));
    output.insert("formula".to_string(), formula);
    if let Some(color) = object.get("color") {
        output.insert("color".to_string(), color.clone());
    }
    Ok(Value::Object(output))
}

fn point_to_bound_rule(point: Option<&Value>) -> Result<Value, ConditionalScaleError> {
    let point =
        point.ok_or_else(|| ConditionalScaleError::encoding("data bar bound is missing"))?;
    let object = point
        .as_object()
        .ok_or_else(|| ConditionalScaleError::encoding("data bar bound is not an object"))?;
    let value = object
        .get("value")
        .ok_or_else(|| ConditionalScaleError::encoding("data bar bound has no value"))?;
    let (kind, formula) = value_ref_to_office(value)?;
    Ok(json!({ "type": kind, "formula": formula }))
}

fn value_ref_to_office(value: &Value) -> Result<(String, Value), ConditionalScaleError> {
    let object = value.as_object().ok_or_else(|| {
        ConditionalScaleError::encoding("conditional-format value is not an object")
    })?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::encoding("conditional-format value has no kind"))?;
    match kind {
        "num" => Ok((
            "Number".to_string(),
            number_to_formula(object.get("value"))?,
        )),
        "percent" => Ok((
            "Percent".to_string(),
            number_to_formula(object.get("value"))?,
        )),
        "percentile" => Ok((
            "Percentile".to_string(),
            number_to_formula(object.get("value"))?,
        )),
        "formula" => Ok((
            "Formula".to_string(),
            required_string_value(object.get("source"), "formula")?,
        )),
        "min" | "autoMin" => Ok(("LowestValue".to_string(), Value::Null)),
        "max" | "autoMax" => Ok(("HighestValue".to_string(), Value::Null)),
        other => Err(ConditionalScaleError::encoding(format!(
            "unsupported conditional-format value kind '{other}'"
        ))),
    }
}

fn number_to_formula(value: Option<&Value>) -> Result<Value, ConditionalScaleError> {
    let number = value.and_then(Value::as_f64).ok_or_else(|| {
        ConditionalScaleError::encoding("numeric conditional-format value is invalid")
    })?;
    if !number.is_finite() {
        return Err(ConditionalScaleError::encoding(
            "numeric conditional-format value is not finite",
        ));
    }
    Ok(Value::String(format_f64(number)))
}

fn criterion_to_point(
    criterion: &Value,
    fallback_color: String,
    family: CriterionFamily,
) -> Result<Value, ConditionalScaleError> {
    let object = criterion.as_object().ok_or_else(|| {
        ConditionalScaleError::invalid("conditional-format criterion must be an object")
    })?;
    let kind = object.get("type").and_then(Value::as_str).ok_or_else(|| {
        ConditionalScaleError::invalid("conditional-format criterion.type is required")
    })?;
    let value = office_criterion_value(object.get("formula"), kind, family)?;
    let color = object
        .get("color")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or(fallback_color);
    Ok(json!({ "value": value, "color": color }))
}

fn bound_rule_to_point(
    value: &Value,
    lower: bool,
    color: String,
) -> Result<Value, ConditionalScaleError> {
    let object = value
        .as_object()
        .ok_or_else(|| ConditionalScaleError::invalid("data bar bound rule must be an object"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid("data bar bound rule.type is required"))?;
    let effective_kind = if kind == "Automatic" {
        if lower { "LowestValue" } else { "HighestValue" }
    } else {
        kind
    };
    let value = office_criterion_value(
        object.get("formula"),
        effective_kind,
        CriterionFamily::DataBar,
    )?;
    Ok(json!({ "value": value, "color": color }))
}

fn office_criterion_value(
    formula: Option<&Value>,
    kind: &str,
    family: CriterionFamily,
) -> Result<Value, ConditionalScaleError> {
    let value_kind = match kind {
        "LowestValue" => "min",
        "HighestValue" => "max",
        "Number" => "num",
        "Percent" => "percent",
        "Percentile" => "percentile",
        "Formula" => "formula",
        "Automatic" if matches!(family, CriterionFamily::DataBar) => "min",
        "Invalid" => {
            return Err(ConditionalScaleError::invalid(
                "Invalid is not a usable conditional-format criterion type",
            ));
        }
        other => {
            return Err(ConditionalScaleError::invalid(format!(
                "Unsupported conditional-format criterion type '{other}'"
            )));
        }
    };

    match value_kind {
        "min" => Ok(json!({ "kind": "min" })),
        "max" => Ok(json!({ "kind": "max" })),
        "formula" => Ok(json!({
            "kind": "formula",
            "source": required_string_value(formula, "formula")?,
        })),
        "num" | "percent" | "percentile" => {
            let raw = required_string_value(formula, "formula")?;
            let raw = raw.as_str().unwrap_or_default().trim();
            let raw = raw.strip_prefix('=').unwrap_or(raw).trim();
            let number = raw.parse::<f64>().map_err(|_| {
                ConditionalScaleError::invalid(format!(
                    "conditional-format {kind} formula must be numeric"
                ))
            })?;
            if !number.is_finite() {
                return Err(ConditionalScaleError::invalid(
                    "conditional-format numeric formula must be finite",
                ));
            }
            Ok(json!({ "kind": value_kind, "value": number }))
        }
        _ => Err(ConditionalScaleError::encoding(
            "unhandled conditional-format value kind",
        )),
    }
}

fn positive_format(payload: &Map<String, Value>) -> Result<Value, ConditionalScaleError> {
    Ok(json!({
        "borderColor": string_or_default(payload, "borderColor"),
        "fillColor": string_or_default(payload, "positiveColor"),
        "gradientFill": payload.get("gradient").and_then(Value::as_bool).unwrap_or(true),
    }))
}

fn negative_format(payload: &Map<String, Value>) -> Result<Value, ConditionalScaleError> {
    Ok(json!({
        "borderColor": string_or_default(payload, "negativeBorderColor"),
        "fillColor": string_or_default(payload, "negativeColor"),
        "matchPositiveBorderColor": payload.get("matchPositiveBorderColor").and_then(Value::as_bool).unwrap_or(false),
        "matchPositiveFillColor": payload.get("matchPositiveFillColor").and_then(Value::as_bool).unwrap_or(false),
    }))
}

fn apply_positive_format(
    payload: &mut Map<String, Value>,
    value: &Value,
) -> Result<(), ConditionalScaleError> {
    let object = value.as_object().ok_or_else(|| {
        ConditionalScaleError::invalid("DataBar.positiveFormat must be an object")
    })?;
    for (name, value) in object {
        match name.as_str() {
            "borderColor" => {
                payload.insert("borderColor".to_string(), optional_color(value, name)?);
            }
            "fillColor" => {
                payload.insert("positiveColor".to_string(), string_value(value, name)?);
            }
            "gradientFill" => {
                payload.insert("gradient".to_string(), bool_value(value, name)?.into());
            }
            other => {
                return Err(ConditionalScaleError::invalid(format!(
                    "Unsupported DataBar.positiveFormat property '{other}'"
                )));
            }
        }
    }
    Ok(())
}

fn apply_negative_format(
    payload: &mut Map<String, Value>,
    value: &Value,
) -> Result<(), ConditionalScaleError> {
    let object = value.as_object().ok_or_else(|| {
        ConditionalScaleError::invalid("DataBar.negativeFormat must be an object")
    })?;
    for (name, value) in object {
        match name.as_str() {
            "borderColor" => {
                payload.insert(
                    "negativeBorderColor".to_string(),
                    optional_color(value, name)?,
                );
            }
            "fillColor" => {
                payload.insert("negativeColor".to_string(), optional_color(value, name)?);
            }
            "matchPositiveBorderColor" => {
                payload.insert(
                    "matchPositiveBorderColor".to_string(),
                    bool_value(value, name)?.into(),
                );
            }
            "matchPositiveFillColor" => {
                payload.insert(
                    "matchPositiveFillColor".to_string(),
                    bool_value(value, name)?.into(),
                );
            }
            other => {
                return Err(ConditionalScaleError::invalid(format!(
                    "Unsupported DataBar.negativeFormat property '{other}'"
                )));
            }
        }
    }
    Ok(())
}

fn icon_criteria(payload: &Map<String, Value>) -> Result<Value, ConditionalScaleError> {
    let style = payload
        .get("iconSetName")
        .or_else(|| payload.get("style"))
        .and_then(Value::as_str)
        .unwrap_or("3TrafficLights1");
    let expected = icon_count(style);
    let thresholds = payload
        .get("thresholds")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let custom_icons = payload
        .get("customIcons")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let has_baseline =
        thresholds.len() == expected && thresholds.first().is_some_and(is_zero_baseline);

    let mut criteria = Vec::new();
    if has_baseline {
        for (index, threshold) in thresholds.iter().enumerate() {
            criteria.push(icon_criterion(threshold, custom_icons.get(index))?);
        }
    } else if thresholds.is_empty() {
        criteria.push(json!({
            "formula": "=0",
            "operator": "GreaterThanOrEqual",
            "type": "Percent",
            "customIcon": custom_icon_to_office(custom_icons.first()),
        }));
        for index in 1..expected {
            let pct = (index as f64 / expected as f64 * 100.0).round();
            criteria.push(json!({
                "formula": format!("={}", format_f64(pct)),
                "operator": "GreaterThanOrEqual",
                "type": "Percent",
                "customIcon": custom_icon_to_office(custom_icons.get(index)),
            }));
        }
    } else {
        criteria.push(json!({
            "formula": "=0",
            "operator": "GreaterThanOrEqual",
            "type": "Percent",
            "customIcon": custom_icon_to_office(custom_icons.first()),
        }));
        for (index, threshold) in thresholds.iter().enumerate() {
            criteria.push(icon_criterion(threshold, custom_icons.get(index + 1))?);
        }
    }
    Ok(Value::Array(criteria))
}

fn icon_criterion(
    threshold: &Value,
    custom_icon: Option<&Value>,
) -> Result<Value, ConditionalScaleError> {
    let object = threshold
        .as_object()
        .ok_or_else(|| ConditionalScaleError::encoding("icon threshold is not an object"))?;
    let value_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("percent");
    let kind = office_icon_type(value_type);
    let formula = match object.get("value") {
        Some(Value::String(value)) if kind == "Formula" => value.clone(),
        Some(Value::String(value)) => format!("={value}"),
        Some(Value::Number(value)) => format!("={value}"),
        _ => "=0".to_string(),
    };
    Ok(json!({
        "formula": formula,
        "operator": if object.get("gte").and_then(Value::as_bool).unwrap_or(true) { "GreaterThanOrEqual" } else { "GreaterThan" },
        "type": kind,
        "customIcon": custom_icon_to_office(custom_icon),
    }))
}

fn criterion_to_icon_threshold(value: &Value) -> Result<Value, ConditionalScaleError> {
    let object = value
        .as_object()
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet criterion must be an object"))?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet criterion.type is required"))?;
    let internal = icon_type_to_internal(kind).ok_or_else(|| {
        ConditionalScaleError::invalid(format!("Unsupported IconSet criterion type '{kind}'"))
    })?;
    let formula = object
        .get("formula")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet criterion.formula is required"))?;
    let raw = if internal == "formula" {
        Value::String(formula.to_string())
    } else {
        let stripped = formula.trim().strip_prefix('=').unwrap_or(formula.trim());
        let number = stripped.parse::<f64>().map_err(|_| {
            ConditionalScaleError::invalid(format!(
                "IconSet criterion formula '{formula}' must be numeric for type {kind}"
            ))
        })?;
        if !number.is_finite() {
            return Err(ConditionalScaleError::invalid(
                "IconSet criterion formula must be finite",
            ));
        }
        Value::String(format_f64(number))
    };
    let operator = object
        .get("operator")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet criterion.operator is required"))?;
    let gte = match operator {
        "GreaterThanOrEqual" => true,
        "GreaterThan" => false,
        other => {
            return Err(ConditionalScaleError::invalid(format!(
                "Unsupported IconSet criterion.operator '{other}'"
            )));
        }
    };
    Ok(json!({ "type": internal, "value": raw, "gte": gte }))
}

fn icon_from_criterion(value: &Value) -> Result<Value, ConditionalScaleError> {
    let object = value
        .as_object()
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet criterion must be an object"))?;
    let Some(icon) = object.get("customIcon") else {
        return Ok(Value::Null);
    };
    if icon.is_null() {
        return Ok(Value::Null);
    }
    let icon = icon
        .as_object()
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet customIcon must be an object"))?;
    let set = icon
        .get("set")
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid("IconSet customIcon.set is required"))?;
    let index = icon.get("index").and_then(Value::as_u64).ok_or_else(|| {
        ConditionalScaleError::invalid("IconSet customIcon.index must be a non-negative integer")
    })?;
    let icon_set = office_icon_style_to_internal(set).ok_or_else(|| {
        ConditionalScaleError::invalid(format!("Unsupported IconSet customIcon.set '{set}'"))
    })?;
    Ok(json!({ "iconSet": icon_set, "iconId": index }))
}

fn custom_icon_to_office(value: Option<&Value>) -> Value {
    let Some(object) = value.and_then(Value::as_object) else {
        return Value::Null;
    };
    let Some(set) = object.get("iconSet").and_then(Value::as_str) else {
        return Value::Null;
    };
    let index = object.get("iconId").cloned().unwrap_or_else(|| json!(0));
    json!({ "set": icon_style_token(Some(set)), "index": index })
}

fn is_zero_baseline(value: &Value) -> bool {
    value
        .as_object()
        .and_then(|object| object.get("value"))
        .and_then(Value::as_str)
        .is_some_and(|value| value.trim().trim_start_matches('=').parse::<f64>().ok() == Some(0.0))
}

fn icon_type_to_internal(value: &str) -> Option<&'static str> {
    match value {
        "Number" => Some("num"),
        "Percent" => Some("percent"),
        "Formula" => Some("formula"),
        "Percentile" => Some("percentile"),
        _ => None,
    }
}

fn office_icon_type(value: &str) -> &'static str {
    match value {
        "num" => "Number",
        "formula" => "Formula",
        "percentile" => "Percentile",
        _ => "Percent",
    }
}

fn icon_count(style: &str) -> usize {
    if style.starts_with('3') {
        3
    } else if style.starts_with('4') {
        4
    } else if style.starts_with('5') {
        5
    } else {
        3
    }
}

fn axis_format_token(value: Option<&str>) -> &'static str {
    match value.unwrap_or("automatic") {
        "none" | "None" => "None",
        "middle" | "midpoint" | "CellMidPoint" => "CellMidPoint",
        _ => "Automatic",
    }
}

fn bar_direction_token(value: Option<&str>) -> &'static str {
    match value.unwrap_or("context") {
        "leftToRight" | "LeftToRight" => "LeftToRight",
        "rightToLeft" | "RightToLeft" => "RightToLeft",
        _ => "Context",
    }
}

fn icon_style_token(value: Option<&str>) -> &'static str {
    match value.unwrap_or("3TrafficLights1") {
        "3Arrows" => "ThreeArrows",
        "3ArrowsGray" => "ThreeArrowsGray",
        "3Flags" => "ThreeFlags",
        "3TrafficLights1" => "ThreeTrafficLights1",
        "3TrafficLights2" => "ThreeTrafficLights2",
        "3Signs" => "ThreeSigns",
        "3Symbols" => "ThreeSymbols",
        "3Symbols2" => "ThreeSymbols2",
        "4Arrows" => "FourArrows",
        "4ArrowsGray" => "FourArrowsGray",
        "4RedToBlack" => "FourRedToBlack",
        "4Rating" => "FourRating",
        "4TrafficLights" => "FourTrafficLights",
        "5Arrows" => "FiveArrows",
        "5ArrowsGray" => "FiveArrowsGray",
        "5Rating" => "FiveRating",
        "5Quarters" => "FiveQuarters",
        "3Stars" => "ThreeStars",
        "3Triangles" => "ThreeTriangles",
        "5Boxes" => "FiveBoxes",
        "ThreeArrows" => "ThreeArrows",
        "ThreeArrowsGray" => "ThreeArrowsGray",
        "ThreeFlags" => "ThreeFlags",
        "ThreeTrafficLights1" => "ThreeTrafficLights1",
        "ThreeTrafficLights2" => "ThreeTrafficLights2",
        "ThreeSigns" => "ThreeSigns",
        "ThreeSymbols" => "ThreeSymbols",
        "ThreeSymbols2" => "ThreeSymbols2",
        "FourArrows" => "FourArrows",
        "FourArrowsGray" => "FourArrowsGray",
        "FourRedToBlack" => "FourRedToBlack",
        "FourRating" => "FourRating",
        "FourTrafficLights" => "FourTrafficLights",
        "FiveArrows" => "FiveArrows",
        "FiveArrowsGray" => "FiveArrowsGray",
        "FiveRating" => "FiveRating",
        "FiveQuarters" => "FiveQuarters",
        "ThreeStars" => "ThreeStars",
        "ThreeTriangles" => "ThreeTriangles",
        "FiveBoxes" => "FiveBoxes",
        _ => "Invalid",
    }
}

fn office_icon_style_to_internal(value: &str) -> Option<&'static str> {
    Some(match value {
        "Invalid" => "NoIcons",
        "ThreeArrows" => "3Arrows",
        "ThreeArrowsGray" => "3ArrowsGray",
        "ThreeFlags" => "3Flags",
        "ThreeTrafficLights1" => "3TrafficLights1",
        "ThreeTrafficLights2" => "3TrafficLights2",
        "ThreeSigns" => "3Signs",
        "ThreeSymbols" => "3Symbols",
        "ThreeSymbols2" => "3Symbols2",
        "FourArrows" => "4Arrows",
        "FourArrowsGray" => "4ArrowsGray",
        "FourRedToBlack" => "4RedToBlack",
        "FourRating" => "4Rating",
        "FourTrafficLights" => "4TrafficLights",
        "FiveArrows" => "5Arrows",
        "FiveArrowsGray" => "5ArrowsGray",
        "FiveRating" => "5Rating",
        "FiveQuarters" => "5Quarters",
        "ThreeStars" => "3Stars",
        "ThreeTriangles" => "3Triangles",
        "FiveBoxes" => "5Boxes",
        _ => return None,
    })
}

fn point_color(point: Option<&Value>) -> Option<String> {
    point
        .and_then(Value::as_object)
        .and_then(|object| object.get("color"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn string_or_default(payload: &Map<String, Value>, name: &str) -> Value {
    payload
        .get(name)
        .filter(|value| value.is_string())
        .cloned()
        .unwrap_or_else(|| json!(""))
}

fn enum_string<'a>(value: &'a Value, property: &str) -> Result<&'a str, ConditionalScaleError> {
    value.as_str().ok_or_else(|| {
        ConditionalScaleError::invalid(format!("{property} must be a string enum value"))
    })
}

fn string_value(value: &Value, property: &str) -> Result<Value, ConditionalScaleError> {
    value
        .as_str()
        .map(|value| Value::String(value.to_string()))
        .ok_or_else(|| ConditionalScaleError::invalid(format!("{property} must be a string")))
}

fn optional_color(value: &Value, property: &str) -> Result<Value, ConditionalScaleError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    string_value(value, property)
}

fn bool_value(value: &Value, property: &str) -> Result<bool, ConditionalScaleError> {
    value
        .as_bool()
        .ok_or_else(|| ConditionalScaleError::invalid(format!("{property} must be a boolean")))
}

fn required_string_value(
    value: Option<&Value>,
    property: &str,
) -> Result<Value, ConditionalScaleError> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| ConditionalScaleError::invalid(format!("{property} must be a string")))?;
    if value.is_empty() {
        return Err(ConditionalScaleError::invalid(format!(
            "{property} cannot be empty"
        )));
    }
    Ok(Value::String(value.to_string()))
}

fn format_f64(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e16 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn required_string(value: &Value, property: &str) -> Result<String, BatchError> {
    value
        .get(property)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| batch_invalid(format!("conditional-format child requires {property}")))
}

fn batch_invalid(message: impl Into<String>) -> BatchError {
    BatchError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn scale_error(error: ConditionalScaleError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}
