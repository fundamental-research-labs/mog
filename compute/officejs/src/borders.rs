//! Office.js `RangeBorder` and `RangeBorderCollection` projection.
//!
//! The compute engine stores borders as `CellBorders`, while Office.js
//! exposes a stable eight-item collection whose members describe the outer,
//! inner, and diagonal lines of a range.  This module owns that projection and
//! emits the JSON form of the production `BorderPatchOperation` primitive for
//! the host router to deserialize and apply.
//!
//! The JavaScript extension uses these host operations:
//!
//! * `getRangeBorderCollection { id, rangeId }` binds a range collection.
//! * `getRangeBorder { id, collectionId, index }` binds one exact selector.
//! * Generic `load { id, properties }` routes to [`BorderCollectionRef::load`]
//!   or [`BorderRef::load`]. Collection responses contain
//!   `items: [{ key, properties }]` descriptors; the shared runtime invokes
//!   the normal `getItem` factory for each descriptor.
//! * Generic `set { id, property, value }` routes to [`BorderRef::apply_set`]
//!   or [`BorderCollectionRef::set`], which build and apply production border
//!   patches.

use std::collections::HashMap;

use compute_api::{CellRange, Sheet};
use serde_json::{Map, Value, json};

/// Error returned while projecting or validating Office.js border objects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BorderError {
    pub code: &'static str,
    pub message: String,
}

impl BorderError {
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

    fn engine(error: impl std::fmt::Display) -> Self {
        Self {
            code: "GeneralException",
            message: error.to_string(),
        }
    }
}

/// The eight `Excel.BorderIndex` values and their observable collection order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum BorderIndex {
    EdgeTop,
    EdgeBottom,
    EdgeLeft,
    EdgeRight,
    InsideVertical,
    InsideHorizontal,
    DiagonalDown,
    DiagonalUp,
}

impl BorderIndex {
    pub(crate) const ALL: [Self; 8] = [
        Self::EdgeTop,
        Self::EdgeBottom,
        Self::EdgeLeft,
        Self::EdgeRight,
        Self::InsideVertical,
        Self::InsideHorizontal,
        Self::DiagonalDown,
        Self::DiagonalUp,
    ];

    pub(crate) fn parse(value: &str) -> Result<Self, BorderError> {
        match value {
            "EdgeTop" => Ok(Self::EdgeTop),
            "EdgeBottom" => Ok(Self::EdgeBottom),
            "EdgeLeft" => Ok(Self::EdgeLeft),
            "EdgeRight" => Ok(Self::EdgeRight),
            "InsideVertical" => Ok(Self::InsideVertical),
            "InsideHorizontal" => Ok(Self::InsideHorizontal),
            "DiagonalDown" => Ok(Self::DiagonalDown),
            "DiagonalUp" => Ok(Self::DiagonalUp),
            other => Err(BorderError::invalid(format!(
                "Unsupported BorderIndex value '{other}'"
            ))),
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::EdgeTop => "EdgeTop",
            Self::EdgeBottom => "EdgeBottom",
            Self::EdgeLeft => "EdgeLeft",
            Self::EdgeRight => "EdgeRight",
            Self::InsideVertical => "InsideVertical",
            Self::InsideHorizontal => "InsideHorizontal",
            Self::DiagonalDown => "DiagonalDown",
            Self::DiagonalUp => "DiagonalUp",
        }
    }

    /// The `CellBorders` member used by this Office.js side.
    const fn field(self) -> &'static str {
        match self {
            Self::EdgeTop => "top",
            Self::EdgeBottom => "bottom",
            Self::EdgeLeft => "left",
            Self::EdgeRight => "right",
            Self::InsideVertical => "vertical",
            Self::InsideHorizontal => "horizontal",
            Self::DiagonalDown | Self::DiagonalUp => "diagonal",
        }
    }

    const fn diagonal_flag(self) -> Option<&'static str> {
        match self {
            Self::DiagonalDown => Some("diagonalDown"),
            Self::DiagonalUp => Some("diagonalUp"),
            _ => None,
        }
    }
}

/// A range-level border collection host proxy.
#[derive(Clone)]
pub(crate) struct BorderCollectionRef {
    sheet: Sheet,
    address: String,
}

/// A single border host proxy anchored to a collection and side selector.
#[derive(Clone)]
pub(crate) struct BorderRef {
    collection: BorderCollectionRef,
    index: BorderIndex,
}

impl BorderCollectionRef {
    pub(crate) fn new(sheet: Sheet, address: String) -> Result<Self, BorderError> {
        validate_address(&address)?;
        Ok(Self { sheet, address })
    }

    pub(crate) fn get_item(&self, index: &str) -> Result<BorderRef, BorderError> {
        Ok(BorderRef {
            collection: self.clone(),
            index: BorderIndex::parse(index)?,
        })
    }

    /// Read collection scalar fields and item descriptors.
    ///
    /// The returned `items` value follows the shared Office.js collection
    /// contract: each descriptor has a stable selector key and a properties
    /// object containing only fields requested by the caller.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, BorderError> {
        let mut result = HashMap::new();
        let mut item_properties = Vec::new();
        let mut load_items = false;
        let mut load_all_items = false;

        for property in properties {
            match property.as_str() {
                "count" => {
                    result.insert("count".to_string(), json!(BorderIndex::ALL.len()));
                }
                "tintAndShade" => {
                    let mut values = Vec::with_capacity(BorderIndex::ALL.len());
                    for index in BorderIndex::ALL {
                        let border = self.get_item(index.as_str())?;
                        let loaded = border.load(&["tintAndShade".to_string()])?;
                        values.push(loaded.get("tintAndShade").cloned().unwrap_or(Value::Null));
                    }
                    result.insert("tintAndShade".to_string(), aggregate_values(values));
                }
                // Office's default collection item projection is the child
                // object's declared scalar surface.  `items` therefore has
                // the same child fields as `items/$all`; an explicit
                // `items/<property>` remains a narrow projection.
                "items" => {
                    load_items = true;
                    load_all_items = true;
                }
                "items/$all" | "$all" => {
                    load_items = true;
                    load_all_items = true;
                }
                name if name.starts_with("items/") => {
                    load_items = true;
                    let item_property = &name["items/".len()..];
                    if item_property == "$all" {
                        load_all_items = true;
                    } else if item_property.contains('/') {
                        return Err(BorderError::unsupported(format!(
                            "Unsupported RangeBorderCollection item load property '{name}'"
                        )));
                    } else {
                        validate_border_property(item_property)?;
                        if !item_properties.iter().any(|item| item == item_property) {
                            item_properties.push(item_property.to_string());
                        }
                    }
                }
                // Be liberal for host integrations that pass item scalar
                // names directly instead of the normalized items/<name> path.
                name if BORDER_PROPERTY_NAMES.contains(&name) => {
                    load_items = true;
                    if !item_properties.iter().any(|item| item == name) {
                        item_properties.push(name.to_string());
                    }
                }
                other => {
                    return Err(BorderError::unsupported(format!(
                        "Unsupported RangeBorderCollection load property '{other}'"
                    )));
                }
            }
        }

        if load_items {
            if load_all_items {
                item_properties = BORDER_PROPERTY_NAMES
                    .iter()
                    .map(|name| (*name).to_string())
                    .collect();
            }
            let mut items = Vec::with_capacity(BorderIndex::ALL.len());
            for index in BorderIndex::ALL {
                let border = self.get_item(index.as_str())?;
                let properties = border.load(&item_properties)?;
                items.push(json!({
                    "key": index.as_str(),
                    "properties": properties,
                }));
            }
            result.insert("items".to_string(), Value::Array(items));
        }

        Ok(result)
    }

    /// Apply a collection tint to each of the eight range-border sides.
    ///
    /// `CellBorders` stores tint on a side, rather than on the collection, so
    /// the Office collection setter expands into one complete side operation
    /// per selector.  Each operation is built from a fresh projection and
    /// carries the existing color/style/weight values; the production batch
    /// then validates and applies all operations atomically.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), BorderError> {
        if property != "tintAndShade" {
            return Err(BorderError::unsupported(format!(
                "RangeBorderCollection.{property} is read-only or unsupported"
            )));
        }
        validate_tint(value)?;

        let mut operations = Vec::with_capacity(BorderIndex::ALL.len());
        for index in BorderIndex::ALL {
            let border = self.get_item(index.as_str())?;
            operations.extend(border.set("tintAndShade", value)?);
        }

        // Keep production deserialization here, beside the collection-level
        // expansion.  The expected argument of `patch_borders` supplies the
        // concrete bridge type without adding a private compute-core import
        // to the Office.js adapter.
        let operations = operations
            .into_iter()
            .map(|operation| serde_json::from_value(operation).map_err(BorderError::engine))
            .collect::<Result<Vec<_>, _>>()?;
        self.sheet
            .formats()
            .patch_borders(operations)
            .map_err(BorderError::engine)?;
        Ok(())
    }
}

impl BorderRef {
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, BorderError> {
        let projection = self.projection(false)?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "sideIndex" => json!(self.index.as_str()),
                "color" => projection.color.to_value(),
                "style" => projection.style.to_value(),
                "tintAndShade" => projection.tint.to_value(),
                "weight" => projection.weight.to_value(),
                other => {
                    return Err(BorderError::unsupported(format!(
                        "Unsupported RangeBorder load property '{other}'"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Build the JSON form of one production `BorderPatchOperation`.
    ///
    /// [`Self::apply_set`] deserializes this value and calls
    /// `SheetFormats::patch_borders`. Keeping the conversion here means all
    /// geometry, enum, and mixed-range rules are shared by direct and
    /// collection-created border proxies.
    ///
    /// InsideHorizontal/InsideVertical expand to the per-cell left/right or
    /// top/bottom edges Excel stores. A 1×N or N×1 range has no interior, so
    /// those selectors are no-ops.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<Vec<Value>, BorderError> {
        let patches = border_targets(self.index, self.bounds()?);
        if patches.is_empty() {
            return Ok(Vec::new());
        }

        // DiagonalDown and DiagonalUp share one CellBorders.diagonal side but
        // carry independent direction flags.  A mutation must inspect that
        // shared side even when the selected direction is currently disabled;
        // otherwise clearing one direction could erase the style used by the
        // other direction.
        let projection = self.projection(true)?;
        let mut side = Map::new();

        match property {
            "color" => {
                let color = value
                    .as_str()
                    .filter(|color| !color.is_empty())
                    .ok_or_else(|| {
                        BorderError::invalid("RangeBorder.color must be a non-empty string")
                    })?;
                ensure_preservable(&projection, property, &["style", "weight", "tintAndShade"])?;
                if let Some(style) = internal_style_for_projection(&projection)? {
                    side.insert("style".to_string(), json!(style));
                }
                if let Some(color_tint) = projection.tint.value_if_uniform() {
                    if *color_tint != 0.0 {
                        side.insert("colorTint".to_string(), json!(color_tint));
                    }
                }
                side.insert("color".to_string(), json!(color));
            }
            "style" => {
                let style = value.as_str().ok_or_else(|| {
                    BorderError::invalid("RangeBorder.style must be a string enum value")
                })?;
                validate_style(style)?;
                // CellBorders stores style and width in one OOXML token. A
                // style-only write therefore needs a uniform current width
                // and complete-side values for the production replacement.
                let internal = if style == "None" {
                    "none"
                } else {
                    let weight = projection
                        .weight
                        .value_if_uniform()
                        .map(String::as_str)
                        .ok_or_else(|| {
                            BorderError::unsupported(
                                "RangeBorder.style cannot preserve mixed weight values across the range",
                            )
                    })?;
                    internal_style_for_pair(style, weight)?
                };
                ensure_preservable(&projection, property, &["color", "tintAndShade"])?;
                side.insert("style".to_string(), json!(internal));
                if let Some(color) = projection
                    .color
                    .value_if_uniform()
                    .and_then(|color| color.as_ref())
                {
                    side.insert("color".to_string(), json!(color));
                }
                if let Some(color_tint) = projection.tint.value_if_uniform() {
                    if *color_tint != 0.0 {
                        side.insert("colorTint".to_string(), json!(color_tint));
                    }
                }
            }
            "tintAndShade" => {
                let tint = validate_tint(value)?;
                ensure_preservable(&projection, property, &["style", "weight", "color"])?;
                if let Some(style) = internal_style_for_projection(&projection)? {
                    side.insert("style".to_string(), json!(style));
                }
                if let Some(color) = projection
                    .color
                    .value_if_uniform()
                    .and_then(|color| color.as_ref())
                {
                    side.insert("color".to_string(), json!(color));
                }
                side.insert("colorTint".to_string(), json!(tint));
            }
            "weight" => {
                let weight = value.as_str().ok_or_else(|| {
                    BorderError::invalid("RangeBorder.weight must be a string enum value")
                })?;
                validate_weight(weight)?;
                ensure_preservable(&projection, property, &["style", "color", "tintAndShade"])?;
                // Width is encoded into the stored style token. A complete
                // side replacement is required because patch_borders treats
                // each supplied side as one value.
                let style = projection
                    .style
                    .value_if_uniform()
                    .map(String::as_str)
                    .ok_or_else(|| {
                        BorderError::unsupported(
                            "RangeBorder.weight cannot preserve mixed style values across the range",
                        )
                    })?;
                if style == "None" {
                    return Err(BorderError::unsupported(
                        "RangeBorder.weight cannot create a border when the current style is None",
                    ));
                }
                let internal = internal_style_for_pair(style, weight)?;
                side.insert("style".to_string(), json!(internal));
                if let Some(color) = projection
                    .color
                    .value_if_uniform()
                    .and_then(|color| color.as_ref())
                {
                    side.insert("color".to_string(), json!(color));
                }
                if let Some(color_tint) = projection.tint.value_if_uniform() {
                    if *color_tint != 0.0 {
                        side.insert("colorTint".to_string(), json!(color_tint));
                    }
                }
            }
            other => {
                return Err(BorderError::unsupported(format!(
                    "RangeBorder.{other} is read-only or unsupported"
                )));
            }
        }

        // Setting style None on a diagonal side turns off that direction while
        // retaining the other diagonal direction.  For all other sides the
        // side value itself is enough to represent the operation.
        let mut operations = Vec::with_capacity(patches.len());
        for (field, (start_row, start_col, end_row, end_col)) in patches {
            let mut borders = Map::new();
            if !(self.index.diagonal_flag().is_some()
                && property == "style"
                && value.as_str() == Some("None"))
            {
                borders.insert(field.to_string(), Value::Object(side.clone()));
            }
            if let Some(flag) = self.index.diagonal_flag() {
                let enable = if property == "style" {
                    value.as_str() != Some("None")
                } else {
                    true
                };
                borders.insert(flag.to_string(), json!(enable));
            }
            operations.push(json!({
                "target": {
                    "kind": "cells",
                    "startRow": start_row,
                    "startCol": start_col,
                    "endRow": end_row,
                    "endCol": end_col,
                },
                "borders": borders,
                "clearFields": [],
            }));
        }
        Ok(operations)
    }

    /// Apply one border property through the production border mutation API.
    ///
    /// The JSON construction remains in [`Self::set`] so the wire operation is
    /// inspectable at the host boundary, while this helper owns deserialization
    /// and dispatch. Type inference obtains the concrete
    /// `compute_core::bridge_types::BorderPatchOperation` from
    /// `SheetFormats::patch_borders` without adding a private crate dependency
    /// to the Office.js adapter.
    pub(crate) fn apply_set(&self, property: &str, value: &Value) -> Result<(), BorderError> {
        let operations = self.set(property, value)?;
        if operations.is_empty() {
            return Ok(());
        }
        let operations = operations
            .into_iter()
            .map(|operation| serde_json::from_value(operation).map_err(BorderError::engine))
            .collect::<Result<Vec<_>, _>>()?;
        self.collection
            .sheet
            .formats()
            .patch_borders(operations)
            .map_err(BorderError::engine)?;
        Ok(())
    }

    fn bounds(&self) -> Result<(u32, u32, u32, u32), BorderError> {
        parse_bounds(&self.collection.address)
    }

    fn projection(&self, include_disabled_diagonal: bool) -> Result<BorderProjection, BorderError> {
        let bounds = self.bounds()?;
        let mut projection = BorderProjection::default();
        for_each_sample(bounds, self.index, |row, col, field| {
            let format = self
                .collection
                .sheet
                .formats()
                .get_cell_format(row, col)
                .map_err(BorderError::engine)?;
            let value = serde_json::to_value(format).map_err(BorderError::engine)?;
            projection.observe(sample_side(
                &value,
                field,
                self.index.diagonal_flag(),
                include_disabled_diagonal,
            )?);
            Ok::<(), BorderError>(())
        })?;
        Ok(projection)
    }
}

const BORDER_PROPERTY_NAMES: [&str; 5] = ["color", "sideIndex", "style", "tintAndShade", "weight"];

fn validate_border_property(property: &str) -> Result<(), BorderError> {
    if BORDER_PROPERTY_NAMES.contains(&property) {
        Ok(())
    } else {
        Err(BorderError::unsupported(format!(
            "Unsupported RangeBorder property '{property}'"
        )))
    }
}

fn validate_address(address: &str) -> Result<(), BorderError> {
    parse_bounds(address).map(|_| ())
}

fn parse_bounds(address: &str) -> Result<(u32, u32, u32, u32), BorderError> {
    CellRange::from(address)
        .resolve()
        .map_err(|error| BorderError::invalid(error.to_string()))
}

/// Run a sample over the cells whose effective border contributes to one
/// range-level Office.js side. The visitor also receives the stored
/// `CellBorders` field for that sample so Inside* selectors read the
/// interior left/right or top/bottom edges Excel writes.
fn for_each_sample(
    bounds: (u32, u32, u32, u32),
    index: BorderIndex,
    mut visit: impl FnMut(u32, u32, &'static str) -> Result<(), BorderError>,
) -> Result<(), BorderError> {
    let (start_row, start_col, end_row, end_col) = bounds;
    match index {
        BorderIndex::EdgeTop => {
            for col in start_col..=end_col {
                visit(start_row, col, "top")?;
            }
        }
        BorderIndex::EdgeBottom => {
            for col in start_col..=end_col {
                visit(end_row, col, "bottom")?;
            }
        }
        BorderIndex::EdgeLeft => {
            for row in start_row..=end_row {
                visit(row, start_col, "left")?;
            }
        }
        BorderIndex::EdgeRight => {
            for row in start_row..=end_row {
                visit(row, end_col, "right")?;
            }
        }
        BorderIndex::InsideVertical => {
            if start_col < end_col {
                for row in start_row..=end_row {
                    for col in start_col..end_col {
                        visit(row, col, "right")?;
                    }
                    for col in (start_col + 1)..=end_col {
                        visit(row, col, "left")?;
                    }
                }
            }
        }
        BorderIndex::InsideHorizontal => {
            if start_row < end_row {
                for col in start_col..=end_col {
                    for row in start_row..end_row {
                        visit(row, col, "bottom")?;
                    }
                    for row in (start_row + 1)..=end_row {
                        visit(row, col, "top")?;
                    }
                }
            }
        }
        BorderIndex::DiagonalDown | BorderIndex::DiagonalUp => {
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    visit(row, col, "diagonal")?;
                }
            }
        }
    }
    Ok(())
}

/// Patch targets for one Office.js border selector.
///
/// InsideVertical/InsideHorizontal expand to the interior left/right or
/// top/bottom edges of the range. A single-row or single-column range has
/// no interior, so those selectors yield no targets.
fn border_targets(
    index: BorderIndex,
    bounds: (u32, u32, u32, u32),
) -> Vec<(&'static str, (u32, u32, u32, u32))> {
    let (start_row, start_col, end_row, end_col) = bounds;
    match index {
        BorderIndex::EdgeTop => vec![("top", (start_row, start_col, start_row, end_col))],
        BorderIndex::EdgeBottom => vec![("bottom", (end_row, start_col, end_row, end_col))],
        BorderIndex::EdgeLeft => vec![("left", (start_row, start_col, end_row, start_col))],
        BorderIndex::EdgeRight => vec![("right", (start_row, end_col, end_row, end_col))],
        BorderIndex::InsideVertical if start_col < end_col => vec![
            ("right", (start_row, start_col, end_row, end_col - 1)),
            ("left", (start_row, start_col + 1, end_row, end_col)),
        ],
        BorderIndex::InsideHorizontal if start_row < end_row => vec![
            ("bottom", (start_row, start_col, end_row - 1, end_col)),
            ("top", (start_row + 1, start_col, end_row, end_col)),
        ],
        BorderIndex::InsideVertical | BorderIndex::InsideHorizontal => Vec::new(),
        BorderIndex::DiagonalDown | BorderIndex::DiagonalUp => {
            vec![(index.field(), bounds)]
        }
    }
}

#[derive(Debug, Clone, Default)]
struct BorderProjection {
    color: Uniform<Option<String>>,
    style: Uniform<String>,
    tint: Uniform<f64>,
    weight: Uniform<String>,
}

impl BorderProjection {
    fn observe(&mut self, sample: BorderSample) {
        self.color.observe(sample.color);
        self.style.observe(sample.style);
        self.tint.observe(sample.tint);
        self.weight.observe(sample.weight);
    }
}

#[derive(Debug, Clone)]
struct BorderSample {
    color: Option<String>,
    style: String,
    tint: f64,
    weight: String,
}

#[derive(Debug, Clone)]
struct Uniform<T> {
    value: Option<T>,
    uniform: bool,
}

impl<T> Default for Uniform<T> {
    fn default() -> Self {
        Self {
            value: None,
            uniform: true,
        }
    }
}

impl<T: PartialEq + Clone> Uniform<T> {
    fn observe(&mut self, next: T) {
        match &self.value {
            None => self.value = Some(next),
            Some(previous) if previous == &next => {}
            Some(_) => self.uniform = false,
        }
    }

    fn value_if_uniform(&self) -> Option<&T> {
        self.uniform.then_some(self.value.as_ref()).flatten()
    }

    fn to_value(&self) -> Value
    where
        T: serde::Serialize,
    {
        if self.uniform {
            self.value
                .as_ref()
                .map(|value| serde_json::to_value(value).unwrap_or(Value::Null))
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        }
    }
}

fn sample_side(
    format: &Value,
    field: &str,
    diagonal_flag: Option<&str>,
    include_disabled_diagonal: bool,
) -> Result<BorderSample, BorderError> {
    let borders = format.get("borders").and_then(Value::as_object);
    let direction_enabled = diagonal_flag
        .map(|flag| {
            include_disabled_diagonal
                || borders
                    .and_then(|borders| borders.get(flag))
                    .and_then(Value::as_bool)
                    == Some(true)
        })
        .unwrap_or(true);
    let side = if direction_enabled {
        borders
            .and_then(|borders| borders.get(field))
            .and_then(Value::as_object)
    } else {
        None
    };
    let style_token = side
        .and_then(|side| side.get("style"))
        .and_then(Value::as_str)
        .unwrap_or("none");
    let (style, weight) = office_style_weight(style_token)?;
    let color = side
        .and_then(|side| side.get("color"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let tint = side
        .and_then(|side| side.get("colorTint"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    Ok(BorderSample {
        color,
        style: style.to_string(),
        tint,
        weight: weight.to_string(),
    })
}

fn aggregate_values(values: Vec<Value>) -> Value {
    let Some(first) = values.first() else {
        return Value::Null;
    };
    if values.iter().all(|value| value == first) {
        first.clone()
    } else {
        Value::Null
    }
}

fn ensure_preservable(
    projection: &BorderProjection,
    changed: &str,
    fields: &[&str],
) -> Result<(), BorderError> {
    for field in fields {
        let uniform = match *field {
            "color" => projection.color.uniform,
            "style" => projection.style.uniform,
            "tintAndShade" => projection.tint.uniform,
            "weight" => projection.weight.uniform,
            _ => true,
        };
        if !uniform {
            return Err(BorderError::unsupported(format!(
                "RangeBorder.{changed} cannot preserve mixed {field} values across the range"
            )));
        }
    }
    Ok(())
}

fn internal_style_for_projection(
    projection: &BorderProjection,
) -> Result<Option<&'static str>, BorderError> {
    let Some(style) = projection.style.value_if_uniform() else {
        return Err(BorderError::unsupported(
            "RangeBorder mutation cannot preserve a mixed style",
        ));
    };
    let Some(weight) = projection.weight.value_if_uniform() else {
        return Err(BorderError::unsupported(
            "RangeBorder mutation cannot preserve a mixed weight",
        ));
    };
    if style == "None" {
        // A color or tint can exist on a no-style side without making the
        // border visible; omitting style preserves that sparse representation.
        Ok(None)
    } else {
        internal_style_for_pair(style, weight).map(Some)
    }
}

fn validate_style(style: &str) -> Result<(), BorderError> {
    if OFFICE_STYLES.contains(&style) {
        Ok(())
    } else {
        Err(BorderError::invalid(format!(
            "Unsupported BorderLineStyle value '{style}'"
        )))
    }
}

fn validate_weight(weight: &str) -> Result<(), BorderError> {
    if OFFICE_WEIGHTS.contains(&weight) {
        Ok(())
    } else {
        Err(BorderError::invalid(format!(
            "Unsupported BorderWeight value '{weight}'"
        )))
    }
}

fn validate_tint(value: &Value) -> Result<f64, BorderError> {
    value
        .as_f64()
        .filter(|tint| tint.is_finite() && (-1.0..=1.0).contains(tint))
        .ok_or_else(|| BorderError::invalid("RangeBorder.tintAndShade must be between -1 and 1"))
}

const OFFICE_STYLES: [&str; 8] = [
    "None",
    "Continuous",
    "Dash",
    "DashDot",
    "DashDotDot",
    "Dot",
    "Double",
    "SlantDashDot",
];

const OFFICE_WEIGHTS: [&str; 4] = ["Hairline", "Thin", "Medium", "Thick"];

/// Convert the engine's OOXML border style token to Office's independent
/// style/weight pair.  The pair is intentionally explicit: the engine has no
/// second storage field for width, so unsupported combinations are rejected at
/// mutation time instead of silently dropping width.
fn office_style_weight(token: &str) -> Result<(&'static str, &'static str), BorderError> {
    match token {
        "none" => Ok(("None", "Thin")),
        "thin" => Ok(("Continuous", "Thin")),
        "medium" => Ok(("Continuous", "Medium")),
        "thick" => Ok(("Continuous", "Thick")),
        "hair" => Ok(("Continuous", "Hairline")),
        "dashed" => Ok(("Dash", "Thin")),
        "mediumDashed" => Ok(("Dash", "Medium")),
        "dotted" => Ok(("Dot", "Thin")),
        "dashDot" => Ok(("DashDot", "Thin")),
        "mediumDashDot" => Ok(("DashDot", "Medium")),
        "dashDotDot" => Ok(("DashDotDot", "Thin")),
        "mediumDashDotDot" => Ok(("DashDotDot", "Medium")),
        "double" => Ok(("Double", "Thin")),
        "slantDashDot" => Ok(("SlantDashDot", "Thin")),
        other => Err(BorderError::engine(format!(
            "The engine returned unsupported border style token '{other}'"
        ))),
    }
}

fn internal_style_for_pair(style: &str, weight: &str) -> Result<&'static str, BorderError> {
    validate_style(style)?;
    validate_weight(weight)?;
    match (style, weight) {
        ("None", _) => Ok("none"),
        ("Continuous", "Hairline") => Ok("hair"),
        ("Continuous", "Thin") => Ok("thin"),
        ("Continuous", "Medium") => Ok("medium"),
        ("Continuous", "Thick") => Ok("thick"),
        ("Dash", "Thin") => Ok("dashed"),
        ("Dash", "Medium") => Ok("mediumDashed"),
        ("DashDot", "Thin") => Ok("dashDot"),
        ("DashDot", "Medium") => Ok("mediumDashDot"),
        ("DashDotDot", "Thin") => Ok("dashDotDot"),
        ("DashDotDot", "Medium") => Ok("mediumDashDotDot"),
        ("Dot", "Thin") => Ok("dotted"),
        ("Double", "Thin") => Ok("double"),
        ("SlantDashDot", "Thin") => Ok("slantDashDot"),
        _ => Err(BorderError::unsupported(format!(
            "BorderLineStyle '{style}' with BorderWeight '{weight}' has no lossless engine representation"
        ))),
    }
}
