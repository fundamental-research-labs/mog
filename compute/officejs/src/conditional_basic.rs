//! Office.js conditional-formatting adapters.
//!
//! The compute engine stores one `ConditionalFormat` record containing one or
//! more canonical `CFRule`s.  Excel's Office.js object model presents a
//! collection of format objects, each with a typed child (`cellValue`,
//! `custom`, `textComparison`, and so on).  This module is the translation
//! boundary between those two representations.  The host must keep the
//! references below keyed by the *Office proxy id*; the `format_id` inside a
//! reference is the persisted engine id and must never be used as a proxy id.
//!
//! Host routing contract (the JavaScript module queues these operations):
//!
//! * `getConditionalFormatCollection { id, rangeId }` binds a collection to a
//!   real Range.  Generic `load` on that collection calls `collection_items`;
//!   the response is `loaded[id].items = [{ key, properties }]`.
//! * `conditionalFormatCollectionGetCount { collectionId, resultId }`,
//!   `conditionalFormatCollectionGetItem { id, collectionId, key, byIndex,
//!   orNullObject }`, `conditionalFormatCollectionAdd { id, collectionId,
//!   type }`, and `conditionalFormatCollectionClearAll { collectionId }` map
//!   to the collection methods below.
//! * `conditionalFormatChild { id, parentId, kind, orNullObject, side }`
//!   binds a typed child.  `kind` is one of the lower-case wire values emitted
//!   by [`ConditionalChildKind::as_wire`].  Child refs use generic `load` and
//!   `set` operations after this binding.
//! * `conditionalFormatDelete { id }`, `conditionalFormatGetRange { id,
//!   rangeId, orNullObject }`, `conditionalFormatSetRanges { id, ranges }`,
//!   and `conditionalFormatChangeRule { id, type, rule }` implement the base
//!   `ConditionalFormat` methods.  For `getRange`, the host stores a normal
//!   `RangeRef` under `rangeId` using the address returned by
//!   [`ConditionalFormatRef::get_range_address`].
//!
//! `ConditionalFormatChildRef::load` returns Office-shaped rule/style values;
//! its `set` method accepts the canonical JSON rule object produced by
//! `conditional_basic.js` for rule updates.  Style updates use the
//! `backgroundColor`, `fontColor`, `underlineType`, `numberFormat`, and
//! per-side border fields from `CFStyle`.  This means no shadow CF state is
//! kept in the Office host.

use std::collections::HashMap;

use compute_api::{CellRange, ComputeApiError, Sheet};
use domain_types::domain::conditional_format::{CFCellRange, CFRule, ConditionalFormat};
use serde::Serialize;
use serde_json::{Map, Value, json};

/// Error returned by an Office.js conditional-formatting host operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConditionalFormatError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Typed children of an Office conditional format.
///
/// The first group mirrors the public Office.js child classes.  The second
/// group is the nested format object hierarchy.  Color scale, data bar, and
/// icon set constructors are registered by the scale-family JavaScript
/// adapter, while the same Rust child reference handles their persisted
/// state and host operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConditionalChildKind {
    CellValue,
    Custom,
    TextComparison,
    TopBottom,
    Preset,
    ColorScale,
    DataBar,
    IconSet,
    Format,
    Font,
    Fill,
    BorderCollection,
    Border,
    Rule,
}

impl ConditionalChildKind {
    pub(crate) fn from_wire(value: &str) -> Result<Self, ConditionalFormatError> {
        match value {
            "cellValue" => Ok(Self::CellValue),
            "custom" => Ok(Self::Custom),
            "textComparison" => Ok(Self::TextComparison),
            "topBottom" => Ok(Self::TopBottom),
            "preset" => Ok(Self::Preset),
            "colorScale" => Ok(Self::ColorScale),
            "dataBar" => Ok(Self::DataBar),
            "iconSet" => Ok(Self::IconSet),
            "format" => Ok(Self::Format),
            "font" => Ok(Self::Font),
            "fill" => Ok(Self::Fill),
            "borderCollection" => Ok(Self::BorderCollection),
            "border" => Ok(Self::Border),
            "rule" => Ok(Self::Rule),
            other => Err(invalid(format!(
                "Unsupported conditional-format child kind '{other}'"
            ))),
        }
    }

    pub(crate) fn as_wire(self) -> &'static str {
        match self {
            Self::CellValue => "cellValue",
            Self::Custom => "custom",
            Self::TextComparison => "textComparison",
            Self::TopBottom => "topBottom",
            Self::Preset => "preset",
            Self::ColorScale => "colorScale",
            Self::DataBar => "dataBar",
            Self::IconSet => "iconSet",
            Self::Format => "format",
            Self::Font => "font",
            Self::Fill => "fill",
            Self::BorderCollection => "borderCollection",
            Self::Border => "border",
            Self::Rule => "rule",
        }
    }

    fn is_format_child(self) -> bool {
        matches!(
            self,
            Self::Format | Self::Font | Self::Fill | Self::BorderCollection | Self::Border
        )
    }
}

/// A range-bound conditional-format collection.
#[derive(Clone)]
pub(crate) struct ConditionalFormatCollectionRef {
    sheet: Sheet,
    address: String,
}

/// One item in a conditional-format collection load response.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ConditionalFormatCollectionItem {
    pub(crate) key: String,
    pub(crate) properties: HashMap<String, Value>,
}

/// A proxy reference to a persisted conditional format.
#[derive(Clone)]
pub(crate) struct ConditionalFormatRef {
    sheet: Sheet,
    format_id: String,
    null_object: bool,
}

/// A proxy reference to a typed conditional-format child or nested style
/// object.  `side` is populated only for a `Border` child.
#[derive(Clone)]
pub(crate) struct ConditionalFormatChildRef {
    parent: ConditionalFormatRef,
    kind: ConditionalChildKind,
    side: Option<ConditionalBorderSide>,
    null_object: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConditionalBorderSide {
    Top,
    Bottom,
    Left,
    Right,
}

impl ConditionalBorderSide {
    pub(crate) fn from_wire(value: Option<&str>) -> Result<Option<Self>, ConditionalFormatError> {
        let Some(value) = value else { return Ok(None) };
        let side = match value {
            "top" | "EdgeTop" => Self::Top,
            "bottom" | "EdgeBottom" => Self::Bottom,
            "left" | "EdgeLeft" => Self::Left,
            "right" | "EdgeRight" => Self::Right,
            other => {
                return Err(invalid(format!(
                    "Unsupported conditional border side '{other}'"
                )));
            }
        };
        Ok(Some(side))
    }

    fn as_office(self) -> &'static str {
        match self {
            Self::Top => "EdgeTop",
            Self::Bottom => "EdgeBottom",
            Self::Left => "EdgeLeft",
            Self::Right => "EdgeRight",
        }
    }

    fn field(self, suffix: &str) -> String {
        let side = match self {
            Self::Top => "Top",
            Self::Bottom => "Bottom",
            Self::Left => "Left",
            Self::Right => "Right",
        };
        format!("border{side}{suffix}")
    }
}

impl ConditionalFormatCollectionRef {
    /// Bind a collection to a bounded worksheet range.
    pub(crate) fn new(
        sheet: Sheet,
        address: impl Into<String>,
    ) -> Result<Self, ConditionalFormatError> {
        let address = address.into();
        bounded_range(&address)?;
        Ok(Self { sheet, address })
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    pub(crate) fn address(&self) -> &str {
        &self.address
    }

    pub(crate) fn count(&self) -> Result<usize, ConditionalFormatError> {
        Ok(self.matching_formats()?.len())
    }

    pub(crate) fn collection_items(
        &self,
        properties: &[String],
    ) -> Result<Vec<ConditionalFormatCollectionItem>, ConditionalFormatError> {
        let formats = self.matching_formats()?;
        let item_properties = properties
            .iter()
            .filter_map(|property| {
                if property == "items" || property == "items/$all" || property == "$all" {
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
        let item_properties = if item_properties.is_empty() {
            vec![
                "id".to_string(),
                "priority".to_string(),
                "stopIfTrue".to_string(),
                "type".to_string(),
            ]
        } else {
            item_properties
        };
        formats
            .iter()
            .map(|format| {
                let format_id = format_id(format)?;
                let reference = ConditionalFormatRef::new(self.sheet.clone(), format_id.clone());
                let item_properties = reference.load(&item_properties)?;
                Ok(ConditionalFormatCollectionItem {
                    key: format_id,
                    properties: item_properties,
                })
            })
            .collect()
    }

    pub(crate) fn get_item(
        &self,
        key: &str,
        by_index: bool,
        or_null_object: bool,
    ) -> Result<ConditionalFormatRef, ConditionalFormatError> {
        let formats = self.matching_formats()?;
        let selected = if by_index {
            let index = parse_index(key)?;
            formats.get(index)
        } else {
            formats.iter().find(|format| {
                format_id(format)
                    .ok()
                    .is_some_and(|format_id| format_id.eq_ignore_ascii_case(key))
            })
        };
        match selected {
            Some(format) => Ok(ConditionalFormatRef::new(
                self.sheet.clone(),
                format_id(format)?,
            )),
            None if or_null_object => Ok(ConditionalFormatRef::null(self.sheet.clone(), key)),
            None => Err(item_not_found(format!("Conditional format '{key}'"))),
        }
    }

    /// Add a new format at the top priority for this collection's range.
    pub(crate) fn add(
        &self,
        office_type: &str,
    ) -> Result<ConditionalFormatRef, ConditionalFormatError> {
        let formats = self.matching_formats()?;
        let id = generated_format_id(&self.sheet, &formats)?;
        let rule_id = format!("{id}-rule");
        let bounds = bounded_range(&self.address)?;
        let rule = default_rule_for_type(office_type, &rule_id)?;
        let payload = json!({
            "id": id,
            "sheetId": self.sheet.id().to_uuid_string(),
            "ranges": [range_json(bounds)],
            "rules": [rule],
        });
        let conditional_format: ConditionalFormat =
            serde_json::from_value(payload).map_err(encoding)?;
        self.sheet
            .conditional_formats()
            .add_rule(conditional_format)
            .map_err(engine)?;
        Ok(ConditionalFormatRef::new(self.sheet.clone(), id))
    }

    pub(crate) fn clear_all(&self) -> Result<(), ConditionalFormatError> {
        self.sheet
            .conditional_formats()
            .clear_all()
            .map_err(engine)?;
        Ok(())
    }

    fn matching_formats(&self) -> Result<Vec<ConditionalFormat>, ConditionalFormatError> {
        let target = bounded_range(&self.address)?;
        self.sheet
            .conditional_formats()
            .get_all_rules()
            .map_err(engine)
            .map(|formats| {
                formats
                    .into_iter()
                    .filter(|format| {
                        format.ranges.iter().any(|range| {
                            ranges_intersect(
                                target,
                                Bounds {
                                    start_row: range.start_row(),
                                    start_col: range.start_col(),
                                    end_row: range.end_row(),
                                    end_col: range.end_col(),
                                },
                            )
                        })
                    })
                    .collect()
            })
    }
}

impl ConditionalFormatRef {
    pub(crate) fn new(sheet: Sheet, format_id: impl Into<String>) -> Self {
        Self {
            sheet,
            format_id: format_id.into(),
            null_object: false,
        }
    }

    pub(crate) fn null(sheet: Sheet, format_id: &str) -> Self {
        Self {
            sheet,
            format_id: format_id.to_string(),
            null_object: true,
        }
    }

    pub(crate) fn sheet(&self) -> Sheet {
        self.sheet.clone()
    }

    pub(crate) fn id(&self) -> &str {
        &self.format_id
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }

    /// Resolve the current persisted format.  Every operation resolves by id
    /// so a fresh request context sees changes made by an earlier context.
    pub(crate) fn resolve(&self) -> Result<Option<ConditionalFormat>, ConditionalFormatError> {
        if self.null_object {
            return Ok(None);
        }
        self.sheet
            .conditional_formats()
            .get_all_rules()
            .map_err(engine)
            .map(|formats| {
                formats
                    .into_iter()
                    .find(|format| format.id == self.format_id)
            })
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ConditionalFormatError> {
        let mut result = HashMap::new();
        if properties.iter().any(|property| property == "isNullObject") {
            result.insert("isNullObject".to_string(), Value::Bool(self.null_object));
        }
        if self.null_object {
            for property in properties {
                if property != "isNullObject" {
                    return Err(invalid(format!(
                        "ConditionalFormat.{property} cannot be loaded from a null object"
                    )));
                }
            }
            return Ok(result);
        }
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.format_id)))?;
        let rule = format.rules.first();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => Value::Bool(false),
                "id" => Value::String(format.id.clone()),
                "priority" => json!(rule.map(|rule| rule.priority()).unwrap_or(0)),
                "stopIfTrue" => rule
                    .and_then(|rule| rule_json(rule).ok())
                    .map(|rule| stop_if_true_for_rule(&rule))
                    .unwrap_or(Value::Bool(false)),
                "type" => Value::String(
                    rule.map(|rule| office_type_for_rule(rule).to_string())
                        .unwrap_or("Invalid")
                        .to_string(),
                ),
                other => {
                    return Err(unsupported(format!(
                        "Unsupported ConditionalFormat load property '{other}'"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ConditionalFormatError> {
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}',", self.format_id)))?;
        match property {
            "priority" => {
                let requested = value
                    .as_i64()
                    .ok_or_else(|| invalid("ConditionalFormat.priority must be an integer"))?;
                reorder_priority(&self.sheet, &format, requested)?;
            }
            "stopIfTrue" => {
                let requested = value
                    .as_bool()
                    .ok_or_else(|| invalid("ConditionalFormat.stopIfTrue must be a boolean"))?;
                let mut rule = first_rule_json(&format)?;
                if is_visual_rule(&rule) {
                    return Err(invalid(
                        "ConditionalFormat.stopIfTrue is not available for color scales, data bars, or icon sets",
                    ));
                }
                rule["stopIfTrue"] = Value::Bool(requested);
                self.update_rules(vec![rule])?;
            }
            "id" | "type" => {
                return Err(invalid(format!(
                    "ConditionalFormat.{property} is read-only"
                )));
            }
            other => {
                return Err(unsupported(format!(
                    "Unsupported ConditionalFormat property '{other}'"
                )));
            }
        }
        Ok(())
    }

    pub(crate) fn delete(&self) -> Result<(), ConditionalFormatError> {
        if self.null_object {
            return Ok(());
        }
        self.sheet
            .conditional_formats()
            .delete_rule(&self.format_id)
            .map_err(engine)?;
        Ok(())
    }

    pub(crate) fn child(
        &self,
        kind: ConditionalChildKind,
        side: Option<ConditionalBorderSide>,
        or_null_object: bool,
    ) -> Result<ConditionalFormatChildRef, ConditionalFormatError> {
        if self.null_object {
            if or_null_object {
                return Ok(ConditionalFormatChildRef::null(self.clone(), kind, side));
            }
            return Err(invalid("The conditional format is a null object"));
        }
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.format_id)))?;
        let exists = child_exists(&format, kind);
        if !exists && !kind.is_format_child() && kind != ConditionalChildKind::Rule {
            if or_null_object {
                return Ok(ConditionalFormatChildRef::null(self.clone(), kind, side));
            }
            return Err(invalid(format!(
                "ConditionalFormat does not expose a '{}' child for type '{}'",
                kind.as_wire(),
                format
                    .rules
                    .first()
                    .map(office_type_for_rule)
                    .unwrap_or("Invalid")
            )));
        }
        if kind == ConditionalChildKind::Rule
            && format.rules.first().map(office_type_for_rule) != Some("Custom")
        {
            if or_null_object {
                return Ok(ConditionalFormatChildRef::null(self.clone(), kind, side));
            }
            return Err(invalid(
                "ConditionalFormat.rule is only available for Custom",
            ));
        }
        Ok(ConditionalFormatChildRef {
            parent: self.clone(),
            kind,
            side,
            null_object: false,
        })
    }

    pub(crate) fn get_range_address(&self) -> Result<String, ConditionalFormatError> {
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.format_id)))?;
        if format.ranges.len() != 1 {
            return Err(invalid(
                "ConditionalFormat.getRange requires exactly one applied range",
            ));
        }
        Ok(range_to_a1(&format.ranges[0]))
    }

    pub(crate) fn get_range_address_or_null(
        &self,
    ) -> Result<Option<String>, ConditionalFormatError> {
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.format_id)))?;
        Ok((format.ranges.len() == 1).then(|| range_to_a1(&format.ranges[0])))
    }

    pub(crate) fn set_ranges(
        &self,
        ranges: Vec<CFCellRange>,
    ) -> Result<(), ConditionalFormatError> {
        if ranges.is_empty() {
            return Err(invalid(
                "ConditionalFormat.setRanges requires at least one range",
            ));
        }
        self.sheet
            .conditional_formats()
            .update_ranges(&self.format_id, ranges)
            .map_err(engine)?;
        Ok(())
    }

    pub(crate) fn change_rule(
        &self,
        office_type: &str,
        rule: Option<&Value>,
    ) -> Result<(), ConditionalFormatError> {
        let format = self
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.format_id)))?;
        let previous = first_rule_json(&format)?;
        let id = previous
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| encoding_message("conditional format rule has no id"))?;
        let priority = previous
            .get("priority")
            .and_then(Value::as_i64)
            .unwrap_or(1);
        let stop = previous.get("stopIfTrue").cloned();
        let style = previous.get("style").cloned().unwrap_or_else(|| json!({}));
        let mut replacement = default_rule_for_type(office_type, id)?;
        replacement["priority"] = json!(priority);
        if let Some(stop) = stop {
            replacement["stopIfTrue"] = stop;
        }
        replacement["style"] = style;
        if let Some(rule) = rule {
            merge_rule_properties(&mut replacement, rule)?;
        }
        self.update_rules(vec![replacement])
    }

    fn update_rules(&self, rules: Vec<Value>) -> Result<(), ConditionalFormatError> {
        self.sheet
            .conditional_formats()
            .update_rule(&self.format_id, json!({ "rules": rules }))
            .map_err(engine)?;
        Ok(())
    }
}

impl ConditionalFormatChildRef {
    pub(crate) fn null(
        parent: ConditionalFormatRef,
        kind: ConditionalChildKind,
        side: Option<ConditionalBorderSide>,
    ) -> Self {
        Self {
            parent,
            kind,
            side,
            null_object: true,
        }
    }

    pub(crate) fn parent(&self) -> ConditionalFormatRef {
        self.parent.clone()
    }

    pub(crate) fn kind(&self) -> ConditionalChildKind {
        self.kind
    }

    pub(crate) fn side(&self) -> Option<ConditionalBorderSide> {
        self.side
    }

    pub(crate) fn is_null_object(&self) -> bool {
        self.null_object
    }

    pub(crate) fn child(
        &self,
        kind: ConditionalChildKind,
        side: Option<ConditionalBorderSide>,
        or_null_object: bool,
    ) -> Result<Self, ConditionalFormatError> {
        if self.null_object {
            if or_null_object {
                return Ok(Self::null(self.parent.clone(), kind, side));
            }
            return Err(invalid("The conditional-format child is a null object"));
        }
        let valid = match (self.kind, kind) {
            (ConditionalChildKind::CellValue, ConditionalChildKind::Format)
            | (ConditionalChildKind::Custom, ConditionalChildKind::Format)
            | (ConditionalChildKind::TextComparison, ConditionalChildKind::Format)
            | (ConditionalChildKind::TopBottom, ConditionalChildKind::Format)
            | (ConditionalChildKind::Preset, ConditionalChildKind::Format)
            | (ConditionalChildKind::ColorScale, ConditionalChildKind::Format)
            | (ConditionalChildKind::DataBar, ConditionalChildKind::Format)
            | (ConditionalChildKind::IconSet, ConditionalChildKind::Format)
            | (ConditionalChildKind::Format, ConditionalChildKind::Font)
            | (ConditionalChildKind::Format, ConditionalChildKind::Fill)
            | (ConditionalChildKind::Format, ConditionalChildKind::BorderCollection)
            | (ConditionalChildKind::BorderCollection, ConditionalChildKind::Border)
            | (ConditionalChildKind::Custom, ConditionalChildKind::Rule) => true,
            _ => false,
        };
        if !valid {
            if or_null_object {
                return Ok(Self::null(self.parent.clone(), kind, side));
            }
            return Err(invalid(format!(
                "Conditional-format child '{}' is not available below '{}'",
                kind.as_wire(),
                self.kind.as_wire()
            )));
        }
        Ok(Self {
            parent: self.parent.clone(),
            kind,
            side,
            null_object: false,
        })
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, ConditionalFormatError> {
        let mut result = HashMap::new();
        if properties.iter().any(|property| property == "isNullObject") {
            result.insert("isNullObject".to_string(), Value::Bool(self.null_object));
        }
        if self.null_object {
            for property in properties {
                if property != "isNullObject" {
                    return Err(invalid(format!(
                        "Conditional-format child {} cannot be loaded from a null object",
                        self.kind.as_wire()
                    )));
                }
            }
            return Ok(result);
        }
        let format = self
            .parent
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.parent.id())))?;
        let rule = first_rule_json(&format)?;
        for property in properties {
            let value = match self.kind {
                ConditionalChildKind::CellValue
                | ConditionalChildKind::TextComparison
                | ConditionalChildKind::TopBottom
                | ConditionalChildKind::Preset => {
                    if property == "rule" {
                        office_rule_for_child(&rule, self.kind)?
                    } else if property == "isNullObject" {
                        Value::Bool(false)
                    } else {
                        return Err(unsupported(format!(
                            "Unsupported {} conditional-format load property '{property}'",
                            self.kind.as_wire()
                        )));
                    }
                }
                ConditionalChildKind::Custom => {
                    if property == "isNullObject" {
                        Value::Bool(false)
                    } else {
                        return Err(unsupported(format!(
                            "CustomConditionalFormat.{property} is a navigation property"
                        )));
                    }
                }
                ConditionalChildKind::Rule => match property.as_str() {
                    "formula" | "formulaLocal" | "formulaR1C1" => Value::String(
                        rule.get("formula")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    ),
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalFormatRule.{other} is unsupported"
                        )));
                    }
                },
                ConditionalChildKind::Format => match property.as_str() {
                    "numberFormat" => style_value(&rule, "numberFormat"),
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeFormat.{other} is a navigation property or unsupported"
                        )));
                    }
                },
                ConditionalChildKind::Font => match property.as_str() {
                    "bold" => style_value_or(&rule, "bold", Value::Bool(false)),
                    "color" => style_value_or(&rule, "fontColor", Value::String(String::new())),
                    "italic" => style_value_or(&rule, "italic", Value::Bool(false)),
                    "strikethrough" => style_value_or(&rule, "strikethrough", Value::Bool(false)),
                    "underline" => office_underline(&rule),
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeFont.{other} is unsupported"
                        )));
                    }
                },
                ConditionalChildKind::Fill => match property.as_str() {
                    "color" => {
                        style_value_or(&rule, "backgroundColor", Value::String(String::new()))
                    }
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeFill.{other} is unsupported"
                        )));
                    }
                },
                ConditionalChildKind::BorderCollection => match property.as_str() {
                    "count" => json!(4),
                    "items" | "items/$all" | "$all" => Value::Array(self.border_items(&rule)?),
                    property if property.starts_with("items/") => {
                        let child_property = property.trim_start_matches("items/");
                        if child_property.is_empty() || child_property == "$all" {
                            Value::Array(self.border_items(&rule)?)
                        } else {
                            let mut items = Vec::new();
                            for item in self.border_items(&rule)? {
                                let key = item.get("key").cloned().unwrap_or(Value::Null);
                                let value = item
                                    .get("properties")
                                    .and_then(Value::as_object)
                                    .and_then(|properties| properties.get(child_property))
                                    .cloned()
                                    .unwrap_or(Value::Null);
                                let mut selected = Map::new();
                                selected.insert(child_property.to_string(), value);
                                items.push(json!({
                                    "key": key,
                                    "properties": selected,
                                }));
                            }
                            Value::Array(items)
                        }
                    }
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeBorderCollection.{other} is unsupported"
                        )));
                    }
                },
                ConditionalChildKind::Border => match property.as_str() {
                    "color" => {
                        let side = self
                            .side
                            .ok_or_else(|| invalid("ConditionalRangeBorder has no side"))?;
                        style_value_or(&rule, &side.field("Color"), Value::String(String::new()))
                    }
                    "style" => {
                        let side = self
                            .side
                            .ok_or_else(|| invalid("ConditionalRangeBorder has no side"))?;
                        office_border_style(&rule, side)
                    }
                    "sideIndex" => self
                        .side
                        .map(|side| Value::String(side.as_office().to_string()))
                        .unwrap_or(Value::Null),
                    "isNullObject" => Value::Bool(false),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeBorder.{other} is unsupported"
                        )));
                    }
                },
                ConditionalChildKind::ColorScale
                | ConditionalChildKind::DataBar
                | ConditionalChildKind::IconSet => {
                    return Err(unsupported(format!(
                        "Conditional child '{}' is implemented by the scale-family adapter",
                        self.kind.as_wire()
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), ConditionalFormatError> {
        if self.null_object {
            return Err(invalid("Cannot set a null conditional-format child"));
        }
        let format = self
            .parent
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.parent.id())))?;
        match self.kind {
            ConditionalChildKind::CellValue
            | ConditionalChildKind::TextComparison
            | ConditionalChildKind::TopBottom
            | ConditionalChildKind::Preset => {
                if property != "rule" {
                    return Err(unsupported(format!(
                        "Unsupported {} conditional-format property '{property}'",
                        self.kind.as_wire()
                    )));
                }
                let mut rule = first_rule_json(&format)?;
                merge_rule_properties(&mut rule, value)?;
                self.parent.update_rules(vec![rule])?;
            }
            ConditionalChildKind::Custom => {
                if property != "rule" {
                    return Err(unsupported(format!(
                        "CustomConditionalFormat.{property} is a navigation property"
                    )));
                }
                let mut rule = first_rule_json(&format)?;
                merge_rule_properties(&mut rule, value)?;
                self.parent.update_rules(vec![rule])?;
            }
            ConditionalChildKind::Rule => {
                let mut rule = first_rule_json(&format)?;
                match property {
                    "formula" | "formulaLocal" | "formulaR1C1" => {
                        let formula = value.as_str().ok_or_else(|| {
                            invalid(format!("ConditionalFormatRule.{property} must be a string"))
                        })?;
                        rule["formula"] = Value::String(formula.to_string());
                    }
                    "clear" => rule["formula"] = Value::String(String::new()),
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalFormatRule.{other} is read-only or unsupported"
                        )));
                    }
                }
                self.parent.update_rules(vec![rule])?;
            }
            ConditionalChildKind::Format => {
                if property == "clearFormat" || property == "clear" {
                    let mut rule = first_rule_json(&format)?;
                    rule["style"] = json!({});
                    self.parent.update_rules(vec![rule])?;
                } else if property == "numberFormat" {
                    self.update_style_field("numberFormat", value.clone())?;
                } else {
                    return Err(unsupported(format!(
                        "ConditionalRangeFormat.{property} is a navigation property or unsupported"
                    )));
                }
            }
            ConditionalChildKind::Font => {
                if property == "clear" {
                    self.clear_style_fields(&[
                        "bold",
                        "fontColor",
                        "italic",
                        "strikethrough",
                        "underlineType",
                    ])?;
                } else {
                    let (field, mapped) = match property {
                        "bold" | "italic" | "strikethrough" => {
                            (property, required_bool(value, property)?)
                        }
                        "color" => (
                            "fontColor",
                            Value::String(required_string(value, property)?),
                        ),
                        "underline" => ("underlineType", office_to_underline(value)?),
                        other => {
                            return Err(unsupported(format!(
                                "ConditionalRangeFont.{other} is unsupported"
                            )));
                        }
                    };
                    self.update_style_field(field, mapped)?;
                }
            }
            ConditionalChildKind::Fill => {
                if property == "clear" {
                    self.clear_style_fields(&["backgroundColor"])?;
                } else if property == "color" {
                    self.update_style_field(
                        "backgroundColor",
                        Value::String(required_string(value, property)?),
                    )?;
                } else {
                    return Err(unsupported(format!(
                        "ConditionalRangeFill.{property} is unsupported"
                    )));
                }
            }
            ConditionalChildKind::BorderCollection => {
                if property == "clear" {
                    self.clear_style_fields(&[
                        "borderColor",
                        "borderStyle",
                        "borderTopColor",
                        "borderTopStyle",
                        "borderBottomColor",
                        "borderBottomStyle",
                        "borderLeftColor",
                        "borderLeftStyle",
                        "borderRightColor",
                        "borderRightStyle",
                    ])?;
                } else {
                    return Err(unsupported(format!(
                        "ConditionalRangeBorderCollection.{property} is unsupported"
                    )));
                }
            }
            ConditionalChildKind::Border => {
                let side = self
                    .side
                    .ok_or_else(|| invalid("ConditionalRangeBorder has no side"))?;
                let field = match property {
                    "color" => side.field("Color"),
                    "style" => side.field("Style"),
                    "clear" => {
                        self.clear_style_fields(&[&side.field("Color"), &side.field("Style")])?;
                        return Ok(());
                    }
                    "sideIndex" => {
                        return Err(invalid("ConditionalRangeBorder.sideIndex is read-only"));
                    }
                    other => {
                        return Err(unsupported(format!(
                            "ConditionalRangeBorder.{other} is unsupported"
                        )));
                    }
                };
                let mapped = if property == "style" {
                    office_to_border_style(value)?
                } else {
                    Value::String(required_string(value, property)?)
                };
                self.update_style_field(field, mapped)?;
            }
            ConditionalChildKind::ColorScale
            | ConditionalChildKind::DataBar
            | ConditionalChildKind::IconSet => {
                return Err(unsupported(format!(
                    "Conditional child '{}' is implemented by the scale-family adapter",
                    self.kind.as_wire()
                )));
            }
        }
        Ok(())
    }

    fn update_style_field(&self, field: &str, value: Value) -> Result<(), ConditionalFormatError> {
        let format = self
            .parent
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.parent.id())))?;
        let mut rule = first_rule_json(&format)?;
        let style = rule
            .as_object_mut()
            .expect("rule object")
            .entry("style")
            .or_insert_with(|| json!({}));
        let style = style
            .as_object_mut()
            .ok_or_else(|| encoding_message("conditional format style is not an object"))?;
        if value.is_null() {
            style.remove(field);
        } else {
            style.insert(field.to_string(), value);
        }
        self.parent.update_rules(vec![rule])
    }

    fn clear_style_fields(&self, fields: &[&str]) -> Result<(), ConditionalFormatError> {
        let format = self
            .parent
            .resolve()?
            .ok_or_else(|| item_not_found(format!("Conditional format '{}'", self.parent.id())))?;
        let mut rule = first_rule_json(&format)?;
        if let Some(style) = rule.get_mut("style").and_then(Value::as_object_mut) {
            for field in fields {
                style.remove(*field);
            }
        }
        self.parent.update_rules(vec![rule])
    }

    fn border_items(&self, rule: &Value) -> Result<Vec<Value>, ConditionalFormatError> {
        let sides = [
            ConditionalBorderSide::Top,
            ConditionalBorderSide::Bottom,
            ConditionalBorderSide::Left,
            ConditionalBorderSide::Right,
        ];
        Ok(sides
            .iter()
            .map(|side| {
                json!({
                    "key": side.as_office(),
                    "properties": {
                        "sideIndex": side.as_office(),
                        "color": style_value_or(rule, &side.field("Color"), Value::String(String::new())),
                        "style": office_border_style(rule, *side),
                    }
                })
            })
            .collect())
    }
}

#[derive(Debug, Clone, Copy)]
struct Bounds {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

fn bounded_range(address: &str) -> Result<Bounds, ConditionalFormatError> {
    let (start_row, start_col, end_row, end_col) = CellRange::from(address)
        .resolve()
        .map_err(|error| invalid(error.to_string()))?;
    Ok(Bounds {
        start_row,
        start_col,
        end_row,
        end_col,
    })
}

fn ranges_intersect(a: Bounds, b: Bounds) -> bool {
    a.start_row <= b.end_row
        && a.end_row >= b.start_row
        && a.start_col <= b.end_col
        && a.end_col >= b.start_col
}

fn range_json(bounds: Bounds) -> Value {
    json!({
        "startRow": bounds.start_row,
        "startCol": bounds.start_col,
        "endRow": bounds.end_row,
        "endCol": bounds.end_col,
    })
}

fn range_to_a1(range: &CFCellRange) -> String {
    let start = format!(
        "{}{}",
        column_name(range.start_col()),
        range.start_row() + 1
    );
    let end = format!("{}{}", column_name(range.end_col()), range.end_row() + 1);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn column_name(mut column: u32) -> String {
    let mut result = String::new();
    loop {
        let digit = (column % 26) as u8;
        result.insert(0, (b'A' + digit) as char);
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    result
}

fn parse_index(value: &str) -> Result<usize, ConditionalFormatError> {
    let index = value
        .parse::<i64>()
        .map_err(|_| invalid("ConditionalFormatCollection.getItemAt index must be an integer"))?;
    if index < 0 {
        return Err(item_not_found(format!("Conditional format index {index}")));
    }
    usize::try_from(index).map_err(|_| item_not_found(format!("Conditional format index {index}")))
}

fn generated_format_id(
    sheet: &Sheet,
    formats: &[ConditionalFormat],
) -> Result<String, ConditionalFormatError> {
    let mut next = 1u32;
    loop {
        let candidate = format!("cf-officejs-{next}");
        if !formats.iter().any(|format| format.id == candidate) {
            return Ok(candidate);
        }
        next = next
            .checked_add(1)
            .ok_or_else(|| invalid("Conditional format id space is exhausted"))?;
        if next == u32::MAX {
            // The sheet argument is intentionally used in the signature so
            // callers cannot accidentally generate IDs for another workbook;
            // avoid an unused-argument warning without inventing global state.
            let _ = sheet.id();
        }
    }
}

fn format_id(format: &ConditionalFormat) -> Result<String, ConditionalFormatError> {
    if format.id.is_empty() {
        Err(encoding_message("conditional format has no id"))
    } else {
        Ok(format.id.clone())
    }
}

fn rule_json(rule: &CFRule) -> Result<Value, ConditionalFormatError> {
    serde_json::to_value(rule).map_err(encoding)
}

fn first_rule_json(format: &ConditionalFormat) -> Result<Value, ConditionalFormatError> {
    format
        .rules
        .first()
        .ok_or_else(|| invalid("Conditional format has no rule"))
        .and_then(rule_json)
}

fn office_type_for_rule(rule: &CFRule) -> &'static str {
    match rule {
        CFRule::CellValue { .. } => "CellValue",
        CFRule::Formula { .. } => "Custom",
        CFRule::ColorScale { .. } => "ColorScale",
        CFRule::DataBar { .. } => "DataBar",
        CFRule::IconSet { .. } => "IconSet",
        CFRule::Top10 { .. } => "TopBottom",
        CFRule::AboveAverage { .. }
        | CFRule::DuplicateValues { .. }
        | CFRule::ContainsBlanks { .. }
        | CFRule::ContainsErrors { .. }
        | CFRule::TimePeriod { .. } => "PresetCriteria",
        CFRule::ContainsText { .. } => "ContainsText",
    }
}

fn child_exists(format: &ConditionalFormat, kind: ConditionalChildKind) -> bool {
    let Some(rule) = format.rules.first() else {
        return false;
    };
    match kind {
        ConditionalChildKind::CellValue => matches!(rule, CFRule::CellValue { .. }),
        ConditionalChildKind::Custom => matches!(rule, CFRule::Formula { .. }),
        ConditionalChildKind::TextComparison => {
            matches!(rule, CFRule::ContainsText { .. })
        }
        ConditionalChildKind::TopBottom => matches!(rule, CFRule::Top10 { .. }),
        ConditionalChildKind::Preset => matches!(
            rule,
            CFRule::AboveAverage { .. }
                | CFRule::DuplicateValues { .. }
                | CFRule::ContainsBlanks { .. }
                | CFRule::ContainsErrors { .. }
                | CFRule::TimePeriod { .. }
        ),
        ConditionalChildKind::ColorScale => matches!(rule, CFRule::ColorScale { .. }),
        ConditionalChildKind::DataBar => matches!(rule, CFRule::DataBar { .. }),
        ConditionalChildKind::IconSet => matches!(rule, CFRule::IconSet { .. }),
        ConditionalChildKind::Format => true,
        ConditionalChildKind::Rule => matches!(rule, CFRule::Formula { .. }),
        ConditionalChildKind::Font
        | ConditionalChildKind::Fill
        | ConditionalChildKind::BorderCollection
        | ConditionalChildKind::Border => true,
    }
}

fn is_visual_rule(rule: &Value) -> bool {
    matches!(
        rule.get("type").and_then(Value::as_str),
        Some("colorScale") | Some("dataBar") | Some("iconSet")
    )
}

fn stop_if_true_for_rule(rule: &Value) -> Value {
    if is_visual_rule(rule) {
        Value::Null
    } else {
        rule.get("stopIfTrue")
            .cloned()
            .unwrap_or(Value::Bool(false))
    }
}

fn default_rule_for_type(
    office_type: &str,
    rule_id: &str,
) -> Result<Value, ConditionalFormatError> {
    let base = |type_name: &str, style: Value| {
        json!({
            "type": type_name,
            "id": rule_id,
            "priority": 1,
            "stopIfTrue": false,
            "style": style,
        })
    };
    let rule = match office_type {
        "CellValue" => {
            let mut rule = base("cellValue", json!({}));
            rule["operator"] = json!("greaterThan");
            rule["value1"] = json!("0");
            rule
        }
        "Custom" => {
            let mut rule = base("formula", json!({}));
            rule["formula"] = json!("=FALSE()");
            rule
        }
        "ContainsText" => {
            let mut rule = base("containsText", json!({}));
            rule["operator"] = json!("containsText");
            rule["text"] = json!("");
            rule
        }
        "TopBottom" => {
            let mut rule = base("top10", json!({}));
            rule["rank"] = json!(10);
            rule["percent"] = json!(false);
            rule["bottom"] = json!(false);
            rule
        }
        "PresetCriteria" => {
            let mut rule = base("containsBlanks", json!({}));
            rule["blanks"] = json!(true);
            rule
        }
        "ColorScale" => {
            json!({
                "type": "colorScale",
                "id": rule_id,
                "priority": 1,
                "colorScale": {
                    "points": [],
                    "minPoint": {"value": {"kind": "min"}, "color": "#F8696B"},
                    "maxPoint": {"value": {"kind": "max"}, "color": "#63BE7B"}
                }
            })
        }
        "DataBar" => {
            json!({
                "type": "dataBar",
                "id": rule_id,
                "priority": 1,
                "dataBar": {
                    "minPoint": {"value": {"kind": "min"}, "color": ""},
                    "maxPoint": {"value": {"kind": "max"}, "color": ""},
                    "positiveColor": "#638EC6",
                    "showValue": true
                }
            })
        }
        "IconSet" => {
            json!({
                "type": "iconSet",
                "id": rule_id,
                "priority": 1,
                "iconSet": {
                    "iconSetName": "3TrafficLights1",
                    "thresholds": [],
                    "customIcons": []
                }
            })
        }
        other => {
            return Err(invalid(format!(
                "Unsupported ConditionalFormatType '{other}'"
            )));
        }
    };
    Ok(rule)
}

fn office_rule_for_child(
    rule: &Value,
    kind: ConditionalChildKind,
) -> Result<Value, ConditionalFormatError> {
    let object = rule
        .as_object()
        .ok_or_else(|| encoding_message("conditional format rule is not an object"))?;
    match kind {
        ConditionalChildKind::CellValue => {
            let operator = object
                .get("operator")
                .and_then(Value::as_str)
                .ok_or_else(|| encoding_message("cell value rule has no operator"))?;
            let mut result = Map::new();
            result.insert(
                "operator".to_string(),
                Value::String(office_cell_operator(operator)?.to_string()),
            );
            result.insert(
                "formula1".to_string(),
                office_formula_value(object.get("value1")),
            );
            if let Some(value2) = object.get("value2") {
                result.insert("formula2".to_string(), office_formula_value(Some(value2)));
            }
            Ok(Value::Object(result))
        }
        ConditionalChildKind::TextComparison => {
            let operator = object
                .get("operator")
                .and_then(Value::as_str)
                .ok_or_else(|| encoding_message("text rule has no operator"))?;
            Ok(json!({
                "operator": office_text_operator(operator)?,
                "text": object.get("text").and_then(Value::as_str).unwrap_or("")
            }))
        }
        ConditionalChildKind::TopBottom => {
            let rank = object.get("rank").cloned().unwrap_or_else(|| json!(10));
            let percent = object
                .get("percent")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let bottom = object
                .get("bottom")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let type_name = match (bottom, percent) {
                (false, false) => "TopItems",
                (false, true) => "TopPercent",
                (true, false) => "BottomItems",
                (true, true) => "BottomPercent",
            };
            Ok(json!({"rank": rank, "type": type_name}))
        }
        ConditionalChildKind::Preset => Ok(json!({
            "criterion": preset_criterion(object)?
        })),
        _ => Err(unsupported(format!(
            "Rule projection is unsupported for '{}'",
            kind.as_wire()
        ))),
    }
}

fn office_formula_value(value: Option<&Value>) -> Value {
    match value {
        Some(Value::String(value)) => Value::String(value.clone()),
        Some(Value::Number(value)) => Value::String(value.to_string()),
        Some(Value::Bool(value)) => Value::String(value.to_string().to_uppercase()),
        Some(Value::Null) | None => Value::String(String::new()),
        Some(value) => Value::String(value.to_string()),
    }
}

fn office_cell_operator(value: &str) -> Result<&'static str, ConditionalFormatError> {
    match value {
        "between" => Ok("Between"),
        "notBetween" => Ok("NotBetween"),
        "equal" => Ok("EqualTo"),
        "notEqual" => Ok("NotEqualTo"),
        "greaterThan" => Ok("GreaterThan"),
        "lessThan" => Ok("LessThan"),
        "greaterThanOrEqual" => Ok("GreaterThanOrEqual"),
        "lessThanOrEqual" => Ok("LessThanOrEqual"),
        other => Err(invalid(format!(
            "Unsupported cell value operator '{other}'"
        ))),
    }
}

fn office_text_operator(value: &str) -> Result<&'static str, ConditionalFormatError> {
    match value {
        "containsText" => Ok("Contains"),
        "notContains" => Ok("NotContains"),
        "beginsWith" => Ok("BeginsWith"),
        "endsWith" => Ok("EndsWith"),
        other => Err(invalid(format!("Unsupported text operator '{other}'"))),
    }
}

fn preset_criterion(rule: &Map<String, Value>) -> Result<&'static str, ConditionalFormatError> {
    let type_name = rule.get("type").and_then(Value::as_str).unwrap_or_default();
    match type_name {
        "containsBlanks" => Ok(
            if rule.get("blanks").and_then(Value::as_bool).unwrap_or(true) {
                "Blanks"
            } else {
                "NonBlanks"
            },
        ),
        "containsErrors" => Ok(
            if rule.get("errors").and_then(Value::as_bool).unwrap_or(true) {
                "Errors"
            } else {
                "NonErrors"
            },
        ),
        "duplicateValues" => Ok(
            if rule.get("unique").and_then(Value::as_bool).unwrap_or(false) {
                "UniqueValues"
            } else {
                "DuplicateValues"
            },
        ),
        "aboveAverage" => {
            let above = rule
                .get("aboveAverage")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let equal = rule
                .get("equalAverage")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let std_dev = rule.get("stdDev").and_then(Value::as_i64);
            Ok(match (above, equal, std_dev) {
                (true, true, None) => "EqualOrAboveAverage",
                (false, true, None) => "EqualOrBelowAverage",
                (true, false, Some(1)) => "OneStdDevAboveAverage",
                (false, false, Some(1)) => "OneStdDevBelowAverage",
                (true, false, Some(2)) => "TwoStdDevAboveAverage",
                (false, false, Some(2)) => "TwoStdDevBelowAverage",
                (true, false, Some(3)) => "ThreeStdDevAboveAverage",
                (false, false, Some(3)) => "ThreeStdDevBelowAverage",
                (true, _, _) => "AboveAverage",
                (false, _, _) => "BelowAverage",
            })
        }
        "timePeriod" => rule
            .get("timePeriod")
            .and_then(Value::as_str)
            .map(time_period_office)
            .ok_or_else(|| encoding_message("time period rule has no period")),
        other => Err(invalid(format!("Unsupported preset rule type '{other}'"))),
    }
}

fn time_period_office(value: &str) -> &'static str {
    match value {
        "yesterday" => "Yesterday",
        "today" => "Today",
        "tomorrow" => "Tomorrow",
        "last7Days" => "LastSevenDays",
        "lastWeek" => "LastWeek",
        "thisWeek" => "ThisWeek",
        "nextWeek" => "NextWeek",
        "lastMonth" => "LastMonth",
        "thisMonth" => "ThisMonth",
        "nextMonth" => "NextMonth",
        _ => "Invalid",
    }
}

fn merge_rule_properties(rule: &mut Value, updates: &Value) -> Result<(), ConditionalFormatError> {
    let updates = updates
        .as_object()
        .ok_or_else(|| invalid("Conditional-format rule must be an object"))?;
    let rule = rule
        .as_object_mut()
        .ok_or_else(|| encoding_message("conditional format rule is not an object"))?;
    for (key, value) in updates {
        match key.as_str() {
            // JS normalizes these to canonical fields.  Keep this whitelist
            // explicit so a typo cannot silently become persisted state.
            "operator" | "value1" | "value2" | "text" | "formula" | "rank" | "percent"
            | "bottom" | "criterion" | "blanks" | "errors" | "unique" | "aboveAverage"
            | "equalAverage" | "stdDev" | "timePeriod" | "style" | "stopIfTrue" => {
                rule.insert(key.clone(), value.clone());
            }
            "type" => {
                // The JavaScript normalizer emits the canonical variant here
                // for preset criteria (for example `containsBlanks` ->
                // `duplicateValues`).  Other typed children emit their
                // existing variant.  Keeping the field lets one Preset
                // object change from blanks to averages without inventing a
                // second public operation.
                rule.insert(key.clone(), value.clone());
            }
            "id" | "priority" => {
                // Id and priority are controlled by the parent object.
                // Ignore them in a typed child update just as Office ignores
                // read-only fields passed to set when throwOnReadOnly=false.
            }
            other => {
                return Err(invalid(format!(
                    "Unsupported conditional-format rule property '{other}'"
                )));
            }
        }
    }
    Ok(())
}

fn reorder_priority(
    sheet: &Sheet,
    current: &ConditionalFormat,
    requested: i64,
) -> Result<(), ConditionalFormatError> {
    let formats = sheet
        .conditional_formats()
        .get_all_rules()
        .map_err(engine)?;
    let Some(current_index) = formats.iter().position(|format| format.id == current.id) else {
        return Err(item_not_found(format!(
            "Conditional format '{}'",
            current.id
        )));
    };
    let count = formats.len();
    if count == 0 {
        return Ok(());
    }
    let mut target = if requested < 0 {
        let distance = requested.unsigned_abs() as usize;
        count.saturating_sub(distance.max(1))
    } else {
        usize::try_from(requested.saturating_sub(1)).unwrap_or(0)
    };
    target = target.min(count - 1);
    if target == current_index {
        return Ok(());
    }
    let mut ids = formats
        .into_iter()
        .map(|format| format.id)
        .collect::<Vec<_>>();
    let id = ids.remove(current_index);
    ids.insert(target, id);
    sheet
        .conditional_formats()
        .reorder_rules(ids)
        .map_err(engine)?;
    Ok(())
}

fn style_value(rule: &Value, field: &str) -> Value {
    rule.get("style")
        .and_then(|style| style.get(field))
        .cloned()
        .unwrap_or(Value::Null)
}

fn style_value_or(rule: &Value, field: &str, default: Value) -> Value {
    let value = style_value(rule, field);
    if value.is_null() { default } else { value }
}

fn office_underline(rule: &Value) -> Value {
    match style_value(rule, "underlineType") {
        Value::String(value) => Value::String(match value.as_str() {
            "single" => "Single".to_string(),
            "double" => "Double".to_string(),
            _ => "None".to_string(),
        }),
        _ => match rule
            .get("style")
            .and_then(|style| style.get("underline"))
            .and_then(Value::as_bool)
        {
            Some(true) => Value::String("Single".to_string()),
            _ => Value::String("None".to_string()),
        },
    }
}

fn office_border_style(rule: &Value, side: ConditionalBorderSide) -> Value {
    let field = side.field("Style");
    let value = style_value(rule, &field);
    let value = if value.is_null() {
        style_value(rule, "borderStyle")
    } else {
        value
    };
    Value::String(match value.as_str().unwrap_or("none") {
        "none" => "None",
        "thin" | "hair" => "Continuous",
        "medium" | "thick" => "Continuous",
        "dashed" | "mediumDashed" => "Dash",
        "dotted" => "Dot",
        "dashDot" | "mediumDashDot" => "DashDot",
        "dashDotDot" | "mediumDashDotDot" => "DashDotDot",
        _ => "None",
    })
}

fn office_to_underline(value: &Value) -> Result<Value, ConditionalFormatError> {
    let value = required_string(value, "underline")?;
    match value.as_str() {
        "None" => Ok(json!("none")),
        "Single" => Ok(json!("single")),
        "Double" => Ok(json!("double")),
        other => Err(invalid(format!(
            "Unsupported conditional underline '{other}'"
        ))),
    }
}

fn office_to_border_style(value: &Value) -> Result<Value, ConditionalFormatError> {
    let value = required_string(value, "style")?;
    let mapped = match value.as_str() {
        "None" => "none",
        "Continuous" => "thin",
        "Dash" => "dashed",
        "DashDot" => "dashDot",
        "DashDotDot" => "dashDotDot",
        "Dot" => "dotted",
        other => {
            return Err(invalid(format!(
                "Unsupported conditional border style '{other}'"
            )));
        }
    };
    Ok(Value::String(mapped.to_string()))
}

fn required_string(value: &Value, property: &str) -> Result<String, ConditionalFormatError> {
    value
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| invalid(format!("{property} must be a string")))
}

fn required_bool(value: &Value, property: &str) -> Result<Value, ConditionalFormatError> {
    value
        .as_bool()
        .map(Value::Bool)
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn engine(error: ComputeApiError) -> ConditionalFormatError {
    ConditionalFormatError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: serde_json::Error) -> ConditionalFormatError {
    encoding_message(error.to_string())
}

fn encoding_message(message: impl Into<String>) -> ConditionalFormatError {
    ConditionalFormatError {
        code: "GeneralException",
        message: message.into(),
    }
}

fn invalid(message: impl Into<String>) -> ConditionalFormatError {
    ConditionalFormatError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn unsupported(message: impl Into<String>) -> ConditionalFormatError {
    ConditionalFormatError {
        code: "ApiNotFound",
        message: message.into(),
    }
}

fn item_not_found(message: impl Into<String>) -> ConditionalFormatError {
    ConditionalFormatError {
        code: "ItemNotFound",
        message: message.into(),
    }
}
