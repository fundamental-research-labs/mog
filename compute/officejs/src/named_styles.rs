//! Office.js named cell styles.
//!
//! The JavaScript side exposes the pinned Workbook.styles, StyleCollection,
//! and Style surface. This module owns the host extension operations and
//! delegates all reads and mutations to the production WorkbookStyles facade.
//! Style application copies the persisted CellFormat into the target range,
//! matching Excel's value semantics: changing a style later does not mutate
//! cells that already received it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use compute_api::{CellRange, CellStyleDef, ComputeApiError, Workbook};
use domain_types::CellFormat;
use serde_json::{Map, Value, json};

use crate::dispatch::{ExtensionHandler, ExtensionObject, HostDispatchContext};
use crate::host::{BatchError, RangeRef};

const STYLE_SCALARS: &[&str] = &[
    "autoIndent",
    "builtIn",
    "formulaHidden",
    "horizontalAlignment",
    "includeAlignment",
    "includeBorder",
    "includeFont",
    "includeNumber",
    "includePatterns",
    "includeProtection",
    "indentLevel",
    "locked",
    "name",
    "numberFormat",
    "numberFormatLocal",
    "readingOrder",
    "shrinkToFit",
    "textOrientation",
    "verticalAlignment",
    "wrapText",
];

const STYLE_INCLUDE_PROPERTIES: &[&str] = &[
    "includeAlignment",
    "includeBorder",
    "includeFont",
    "includeNumber",
    "includePatterns",
    "includeProtection",
];

const STYLE_METADATA_KEY: &str = "mog.officejs.style.includeFlags";

const BORDER_KEYS: &[&str] = &[
    "EdgeTop",
    "EdgeBottom",
    "EdgeLeft",
    "EdgeRight",
    "InsideVertical",
    "InsideHorizontal",
    "DiagonalDown",
    "DiagonalUp",
];

static NEXT_STYLE_ID: AtomicU64 = AtomicU64::new(1);

/// Host-facing translation failure. Keeping the Rich API code at this
/// boundary prevents compute-api errors from leaking into the Office router.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StyleError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl StyleError {
    fn invalid(message: impl Into<String>) -> Self {
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

    fn read_only(property: &str) -> Self {
        Self::invalid(format!("Style.{property} is read-only"))
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

fn style_error(error: StyleError) -> BatchError {
    BatchError {
        code: error.code,
        message: error.message,
    }
}

fn api_error(error: ComputeApiError) -> StyleError {
    StyleError::engine(error)
}

fn encoding(error: impl std::fmt::Display) -> StyleError {
    StyleError::engine(format!("style format conversion failed: {error}"))
}

fn style_id() -> String {
    // CellStyleDef documents a UUID-shaped stable ID. The engine only needs
    // an opaque map key, so a process-unique UUID-shaped value keeps this
    // adapter independent of an additional random-ID dependency while still
    // satisfying the persisted ID contract.
    let value = NEXT_STYLE_ID.fetch_add(1, Ordering::Relaxed);
    format!("00000000-0000-0000-0000-{value:012x}")
}

fn all_styles(workbook: &Workbook) -> Result<Vec<CellStyleDef>, StyleError> {
    workbook
        .styles()
        .get_all_custom_cell_styles()
        .map_err(api_error)
}

fn style_by_id(workbook: &Workbook, id: &str) -> Result<CellStyleDef, StyleError> {
    all_styles(workbook)?
        .into_iter()
        .find(|style| style.id == id)
        .ok_or_else(|| StyleError::not_found(format!("Style '{id}' was not found")))
}

fn style_by_name(workbook: &Workbook, name: &str) -> Result<Option<CellStyleDef>, StyleError> {
    Ok(all_styles(workbook)?
        .into_iter()
        .find(|style| style.name.eq_ignore_ascii_case(name)))
}

fn style_from_name(workbook: &Workbook, name: &str) -> Result<CellStyleDef, StyleError> {
    style_by_name(workbook, name)?
        .ok_or_else(|| StyleError::not_found(format!("Style '{name}' was not found")))
}

fn ensure_custom(style: &CellStyleDef) -> Result<(), StyleError> {
    if style.built_in {
        Err(StyleError::unsupported(
            "Built-in styles cannot be changed or deleted",
        ))
    } else {
        Ok(())
    }
}

fn metadata_flags(format: &CellFormat) -> Map<String, Value> {
    format
        .extensions
        .as_ref()
        .and_then(|extensions| extensions.get(STYLE_METADATA_KEY))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

fn include_flag(format: &CellFormat, property: &str) -> Value {
    metadata_flags(format)
        .get(property)
        .cloned()
        .unwrap_or_else(|| json!(true))
}

fn set_include_flag(
    format: &mut CellFormat,
    property: &str,
    value: &Value,
) -> Result<(), StyleError> {
    let value = value
        .as_bool()
        .ok_or_else(|| StyleError::invalid(format!("{property} must be a boolean")))?;
    let extensions = format.extensions.get_or_insert_with(Default::default);
    let flags = extensions
        .entry(STYLE_METADATA_KEY.to_string())
        .or_insert_with(|| json!({}));
    let flags = flags
        .as_object_mut()
        .ok_or_else(|| encoding("style include metadata is not an object"))?;
    flags.insert(property.to_string(), json!(value));
    Ok(())
}

/// Remove adapter-only include metadata before a style is copied into cells.
fn format_for_application(mut format: CellFormat) -> CellFormat {
    if let Some(extensions) = format.extensions.as_mut() {
        extensions.remove(STYLE_METADATA_KEY);
        if extensions.is_empty() {
            format.extensions = None;
        }
    }
    format
}

fn format_value(format: &CellFormat) -> Result<Value, StyleError> {
    serde_json::to_value(format).map_err(encoding)
}

fn format_from_value(value: Value) -> Result<CellFormat, StyleError> {
    serde_json::from_value(value).map_err(encoding)
}

fn format_field(format: &Value, field: &str, default: Value) -> Value {
    format
        .as_object()
        .and_then(|format| format.get(field))
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or(default)
}

fn map_internal_token(
    value: Value,
    property: &str,
    mappings: &[(&str, &str)],
) -> Result<Value, StyleError> {
    let token = value
        .as_str()
        .ok_or_else(|| StyleError::engine(format!("The engine returned an invalid {property}")))?;
    mappings
        .iter()
        .find_map(|(internal, office)| (*internal == token).then(|| json!(office)))
        .ok_or_else(|| {
            StyleError::engine(format!("The engine returned unsupported {property} '{token}'"))
        })
}

fn enum_value(
    value: &Value,
    property: &str,
    mappings: &[(&str, &str)],
) -> Result<Value, StyleError> {
    let token = value
        .as_str()
        .ok_or_else(|| StyleError::invalid(format!("{property} must be a string enum value")))?;
    mappings
        .iter()
        .find_map(|(office, internal)| (*office == token).then(|| json!(internal)))
        .ok_or_else(|| StyleError::invalid(format!("Unsupported {property} value '{token}'")))
}

fn bool_value(value: &Value, property: &str) -> Result<Value, StyleError> {
    value
        .as_bool()
        .map(Value::Bool)
        .ok_or_else(|| StyleError::invalid(format!("{property} must be a boolean")))
}

fn string_value(value: &Value, property: &str, allow_empty: bool) -> Result<Value, StyleError> {
    let value = value
        .as_str()
        .ok_or_else(|| StyleError::invalid(format!("{property} must be a string")))?;
    if !allow_empty && value.is_empty() {
        return Err(StyleError::invalid(format!("{property} cannot be empty")));
    }
    Ok(json!(value))
}

fn finite_number(value: &Value, property: &str) -> Result<f64, StyleError> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| StyleError::invalid(format!("{property} must be a finite number")))
}

fn integer(value: &Value, property: &str) -> Result<i64, StyleError> {
    let value = finite_number(value, property)?;
    if value.fract() != 0.0 || value < i64::MIN as f64 || value > i64::MAX as f64 {
        return Err(StyleError::invalid(format!("{property} must be an integer")));
    }
    Ok(value as i64)
}

fn tint(value: &Value, property: &str) -> Result<Value, StyleError> {
    let value = finite_number(value, property)?;
    if !(-1.0..=1.0).contains(&value) {
        return Err(StyleError::invalid(format!("{property} must be between -1 and 1")));
    }
    Ok(json!(value))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StyleFormatKind {
    Format,
    Font,
    Fill,
    Protection,
}

fn read_format_property(
    kind: StyleFormatKind,
    property: &str,
    format: &Value,
) -> Result<Value, StyleError> {
    let value = match (kind, property) {
        (StyleFormatKind::Format, "horizontalAlignment") => map_internal_token(
            format_field(format, "horizontalAlign", json!("general")),
            property,
            &[
                ("general", "General"),
                ("left", "Left"),
                ("center", "Center"),
                ("right", "Right"),
                ("fill", "Fill"),
                ("justify", "Justify"),
                ("centerContinuous", "CenterAcrossSelection"),
                ("distributed", "Distributed"),
            ],
        )?,
        (StyleFormatKind::Format, "verticalAlignment") => map_internal_token(
            format_field(format, "verticalAlign", json!("bottom")),
            property,
            &[
                ("top", "Top"),
                ("middle", "Center"),
                ("bottom", "Bottom"),
                ("justify", "Justify"),
                ("distributed", "Distributed"),
            ],
        )?,
        (StyleFormatKind::Format, "wrapText") => {
            format_field(format, "wrapText", json!(false))
        }
        (StyleFormatKind::Format, "autoIndent") => {
            format_field(format, "autoIndent", json!(false))
        }
        (StyleFormatKind::Format, "indentLevel") => format_field(format, "indent", json!(0)),
        (StyleFormatKind::Format, "shrinkToFit") => {
            format_field(format, "shrinkToFit", json!(false))
        }
        (StyleFormatKind::Format, "textOrientation") => {
            format_field(format, "textRotation", json!(0))
        }
        (StyleFormatKind::Format, "readingOrder") => map_internal_token(
            format_field(format, "readingOrder", json!("context")),
            property,
            &[
                ("context", "Context"),
                ("ltr", "LeftToRight"),
                ("rtl", "RightToLeft"),
            ],
        )?,
        (StyleFormatKind::Font, "bold") => format_field(format, "bold", json!(false)),
        (StyleFormatKind::Font, "color") => {
            format_field(format, "fontColor", json!("#000000"))
        }
        (StyleFormatKind::Font, "italic") => format_field(format, "italic", json!(false)),
        (StyleFormatKind::Font, "name") => {
            format_field(format, "fontFamily", json!("Calibri"))
        }
        (StyleFormatKind::Font, "size") => format_field(format, "fontSize", json!(11.0)),
        (StyleFormatKind::Font, "underline") => map_internal_token(
            format_field(format, "underlineType", json!("none")),
            property,
            &[
                ("none", "None"),
                ("single", "Single"),
                ("double", "Double"),
                ("singleAccounting", "SingleAccountant"),
                ("doubleAccounting", "DoubleAccountant"),
            ],
        )?,
        (StyleFormatKind::Font, "strikethrough") => {
            format_field(format, "strikethrough", json!(false))
        }
        (StyleFormatKind::Font, "subscript") => {
            format_field(format, "subscript", json!(false))
        }
        (StyleFormatKind::Font, "superscript") => {
            format_field(format, "superscript", json!(false))
        }
        (StyleFormatKind::Font, "tintAndShade") => {
            format_field(format, "fontColorTint", json!(0.0))
        }
        (StyleFormatKind::Fill, "color") => {
            format_field(format, "backgroundColor", Value::Null)
        }
        (StyleFormatKind::Fill, "pattern") => map_internal_token(
            format_field(format, "patternType", json!("none")),
            property,
            &[
                ("none", "None"),
                ("solid", "Solid"),
                ("mediumGray", "Gray50"),
                ("darkGray", "Gray75"),
                ("lightGray", "Gray25"),
                ("darkHorizontal", "Horizontal"),
                ("darkVertical", "Vertical"),
                ("darkDown", "Down"),
                ("darkUp", "Up"),
                ("darkGrid", "Checker"),
                ("darkTrellis", "SemiGray75"),
                ("lightHorizontal", "LightHorizontal"),
                ("lightVertical", "LightVertical"),
                ("lightDown", "LightDown"),
                ("lightUp", "LightUp"),
                ("lightGrid", "Grid"),
                ("lightTrellis", "CrissCross"),
                ("gray125", "Gray16"),
                ("gray0625", "Gray8"),
            ],
        )?,
        (StyleFormatKind::Fill, "patternColor") => {
            format_field(format, "patternForegroundColor", Value::Null)
        }
        (StyleFormatKind::Fill, "patternTintAndShade") => {
            format_field(format, "patternForegroundColorTint", json!(0.0))
        }
        (StyleFormatKind::Fill, "tintAndShade") => {
            format_field(format, "backgroundColorTint", json!(0.0))
        }
        (StyleFormatKind::Protection, "locked") => {
            format_field(format, "locked", json!(true))
        }
        (StyleFormatKind::Protection, "formulaHidden") => {
            format_field(format, "hidden", json!(false))
        }
        _ => {
            return Err(StyleError::unsupported(format!(
                "Unsupported {kind:?} property '{property}'"
            )))
        }
    };
    Ok(value)
}

fn write_format_property(
    kind: StyleFormatKind,
    property: &str,
    value: &Value,
) -> Result<(&'static str, Value), StyleError> {
    if value.is_null() {
        return Err(StyleError::invalid(format!("{property} cannot be null")));
    }
    let mapped = match (kind, property) {
        (StyleFormatKind::Format, "horizontalAlignment") => (
            "horizontalAlign",
            enum_value(
                value,
                property,
                &[
                    ("General", "general"),
                    ("Left", "left"),
                    ("Center", "center"),
                    ("Right", "right"),
                    ("Fill", "fill"),
                    ("Justify", "justify"),
                    ("CenterAcrossSelection", "centerContinuous"),
                    ("Distributed", "distributed"),
                ],
            )?,
        ),
        (StyleFormatKind::Format, "verticalAlignment") => (
            "verticalAlign",
            enum_value(
                value,
                property,
                &[
                    ("Top", "top"),
                    ("Center", "middle"),
                    ("Bottom", "bottom"),
                    ("Justify", "justify"),
                    ("Distributed", "distributed"),
                ],
            )?,
        ),
        (StyleFormatKind::Format, "wrapText") => ("wrapText", bool_value(value, property)?),
        (StyleFormatKind::Format, "autoIndent") => ("autoIndent", bool_value(value, property)?),
        (StyleFormatKind::Format, "indentLevel") => {
            let value = integer(value, property)?;
            if !(0..=250).contains(&value) {
                return Err(StyleError::invalid("indentLevel must be between 0 and 250"));
            }
            ("indent", json!(value))
        }
        (StyleFormatKind::Format, "shrinkToFit") => {
            ("shrinkToFit", bool_value(value, property)?)
        }
        (StyleFormatKind::Format, "textOrientation") => {
            let value = integer(value, property)?;
            if !((-90..=90).contains(&value) || value == 180) {
                return Err(StyleError::invalid(
                    "textOrientation must be -90 through 90, or 180",
                ));
            }
            ("textRotation", json!(value))
        }
        (StyleFormatKind::Format, "readingOrder") => (
            "readingOrder",
            enum_value(
                value,
                property,
                &[
                    ("Context", "context"),
                    ("LeftToRight", "ltr"),
                    ("RightToLeft", "rtl"),
                ],
            )?,
        ),
        (StyleFormatKind::Font, "bold") => ("bold", bool_value(value, property)?),
        (StyleFormatKind::Font, "color") => {
            ("fontColor", string_value(value, property, false)?)
        }
        (StyleFormatKind::Font, "italic") => ("italic", bool_value(value, property)?),
        (StyleFormatKind::Font, "name") => {
            let value = value
                .as_str()
                .filter(|value| !value.is_empty() && value.chars().count() <= 31)
                .ok_or_else(|| StyleError::invalid("name must contain 1 through 31 characters"))?;
            ("fontFamily", json!(value))
        }
        (StyleFormatKind::Font, "size") => {
            let value = finite_number(value, property)?;
            if !(1.0..=409.0).contains(&value) {
                return Err(StyleError::invalid("size must be between 1 and 409 points"));
            }
            ("fontSize", json!(value))
        }
        (StyleFormatKind::Font, "underline") => (
            "underlineType",
            enum_value(
                value,
                property,
                &[
                    ("None", "none"),
                    ("Single", "single"),
                    ("Double", "double"),
                    ("SingleAccountant", "singleAccounting"),
                    ("DoubleAccountant", "doubleAccounting"),
                ],
            )?,
        ),
        (StyleFormatKind::Font, "strikethrough") => {
            ("strikethrough", bool_value(value, property)?)
        }
        (StyleFormatKind::Font, "subscript") => ("subscript", bool_value(value, property)?),
        (StyleFormatKind::Font, "superscript") => {
            ("superscript", bool_value(value, property)?)
        }
        (StyleFormatKind::Font, "tintAndShade") => {
            ("fontColorTint", tint(value, property)?)
        }
        (StyleFormatKind::Fill, "color") => {
            ("backgroundColor", string_value(value, property, false)?)
        }
        (StyleFormatKind::Fill, "pattern") => (
            "patternType",
            enum_value(
                value,
                property,
                &[
                    ("None", "none"),
                    ("Solid", "solid"),
                    ("Gray50", "mediumGray"),
                    ("Gray75", "darkGray"),
                    ("Gray25", "lightGray"),
                    ("Horizontal", "darkHorizontal"),
                    ("Vertical", "darkVertical"),
                    ("Down", "darkDown"),
                    ("Up", "darkUp"),
                    ("Checker", "darkGrid"),
                    ("SemiGray75", "darkTrellis"),
                    ("LightHorizontal", "lightHorizontal"),
                    ("LightVertical", "lightVertical"),
                    ("LightDown", "lightDown"),
                    ("LightUp", "lightUp"),
                    ("Grid", "lightGrid"),
                    ("CrissCross", "lightTrellis"),
                    ("Gray16", "gray125"),
                    ("Gray8", "gray0625"),
                ],
            )?,
        ),
        (StyleFormatKind::Fill, "patternColor") => (
            "patternForegroundColor",
            string_value(value, property, false)?,
        ),
        (StyleFormatKind::Fill, "patternTintAndShade") => {
            ("patternForegroundColorTint", tint(value, property)?)
        }
        (StyleFormatKind::Fill, "tintAndShade") => {
            ("backgroundColorTint", tint(value, property)?)
        }
        (StyleFormatKind::Protection, "locked") => {
            ("locked", bool_value(value, property)?)
        }
        (StyleFormatKind::Protection, "formulaHidden") => {
            ("hidden", bool_value(value, property)?)
        }
        _ => {
            return Err(StyleError::unsupported(format!(
                "Unsupported {kind:?} property '{property}'"
            )))
        }
    };
    Ok(mapped)
}

fn style_scalar(format: &CellFormat, property: &str) -> Result<Value, StyleError> {
    let encoded = format_value(format)?;
    match property {
        "builtIn" | "name" => Err(StyleError::unsupported(format!(
            "{property} is not a CellFormat property"
        ))),
        property if STYLE_INCLUDE_PROPERTIES.contains(&property) => {
            Ok(include_flag(format, property))
        }
        "formulaHidden" => {
            read_format_property(StyleFormatKind::Protection, "formulaHidden", &encoded)
        }
        "locked" => read_format_property(StyleFormatKind::Protection, "locked", &encoded),
        "numberFormat" | "numberFormatLocal" => {
            Ok(format_field(&encoded, "numberFormat", json!("General")))
        }
        property => read_format_property(StyleFormatKind::Format, property, &encoded),
    }
}

fn set_style_scalar(
    format: &mut CellFormat,
    property: &str,
    value: &Value,
) -> Result<(), StyleError> {
    if STYLE_INCLUDE_PROPERTIES.contains(&property) {
        return set_include_flag(format, property, value);
    }
    let kind = match property {
        "formulaHidden" | "locked" => StyleFormatKind::Protection,
        "numberFormat" | "numberFormatLocal" => {
            let value = string_value(value, property, true)?;
            let mut encoded = format_value(format)?;
            encoded
                .as_object_mut()
                .expect("CellFormat serializes as object")
                .insert("numberFormat".to_string(), value);
            *format = format_from_value(encoded)?;
            return Ok(());
        }
        _ => StyleFormatKind::Format,
    };
    let (field, value) = write_format_property(kind, property, value)?;
    let mut encoded = format_value(format)?;
    encoded
        .as_object_mut()
        .expect("CellFormat serializes as object")
        .insert(field.to_string(), value);
    *format = format_from_value(encoded)?;
    Ok(())
}

fn update_style(
    workbook: &Workbook,
    current: CellStyleDef,
    format: CellFormat,
) -> Result<(), StyleError> {
    ensure_custom(&current)?;
    let updated = CellStyleDef { format, ..current };
    workbook
        .styles()
        .update_custom_cell_style(&updated.id, updated)
        .map(|_| ())
        .map_err(api_error)
}

fn update_style_format(
    workbook: &Workbook,
    id: &str,
    mutate: impl FnOnce(&mut CellFormat) -> Result<(), StyleError>,
) -> Result<(), StyleError> {
    let style = style_by_id(workbook, id)?;
    ensure_custom(&style)?;
    let mut format = style.format;
    mutate(&mut format)?;
    update_style(workbook, style, format)
}

// ---------------------------------------------------------------------------
// Style collection and style objects
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub(crate) struct StyleCollectionRef {
    workbook: Workbook,
}

impl StyleCollectionRef {
    fn new(workbook: Workbook) -> Self {
        Self { workbook }
    }

    fn add(&self, name: &str) -> Result<(), StyleError> {
        if name.is_empty() {
            return Err(StyleError::invalid("StyleCollection.add name cannot be empty"));
        }
        if style_by_name(&self.workbook, name)?.is_some() {
            return Err(StyleError::invalid(format!("Style '{name}' already exists")));
        }
        self.workbook
            .styles()
            .create_custom_cell_style(CellStyleDef {
                id: style_id(),
                name: name.to_string(),
                category: None,
                format: CellFormat::default(),
                built_in: false,
            })
            .map(|_| ())
            .map_err(api_error)
    }

    fn get_or_null(&self, name: &str) -> Result<Option<StyleRef>, StyleError> {
        Ok(style_by_name(&self.workbook, name)?
            .map(|style| StyleRef::new(self.workbook.clone(), style.id)))
    }

    fn get_at(&self, index: usize) -> Result<StyleRef, StyleError> {
        let styles = all_styles(&self.workbook)?;
        styles
            .get(index)
            .map(|style| StyleRef::new(self.workbook.clone(), style.id.clone()))
            .ok_or_else(|| StyleError::not_found(format!("Style index {index} is out of range")))
    }

    fn count(&self) -> Result<usize, StyleError> {
        all_styles(&self.workbook).map(|styles| styles.len())
    }

    fn items(&self, properties: &[String]) -> Result<Vec<Value>, StyleError> {
        let requested = normalize_item_properties(properties)?;
        all_styles(&self.workbook)?
            .into_iter()
            .map(|style| {
                let item = StyleRef::new(self.workbook.clone(), style.id.clone());
                let values = item.load(&requested)?;
                Ok(json!({ "key": style.name, "properties": values }))
            })
            .collect()
    }
}

impl ExtensionObject for StyleCollectionRef {
    fn object_type(&self) -> &'static str {
        "StyleCollection"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        let mut result = HashMap::new();
        let mut load_items = false;
        let mut item_properties = Vec::new();
        let mut all_item_properties = false;
        for property in properties {
            match property.as_str() {
                "isNullObject" => {}
                "items" | "items/$all" | "$all" => {
                    load_items = true;
                    all_item_properties = true;
                }
                property if property.starts_with("items/") => {
                    load_items = true;
                    let property = &property["items/".len()..];
                    if property == "$all" {
                        all_item_properties = true;
                    } else if STYLE_SCALARS.contains(&property) {
                        item_properties.push(property.to_string());
                    } else {
                        return Err(style_error(StyleError::unsupported(format!(
                            "Unsupported StyleCollection item load property '{property}'"
                        ))));
                    }
                }
                other => {
                    return Err(style_error(StyleError::unsupported(format!(
                        "Unsupported StyleCollection load property '{other}'"
                    ))));
                }
            }
        }
        if load_items {
            if all_item_properties || item_properties.is_empty() {
                item_properties = STYLE_SCALARS
                    .iter()
                    .map(|property| (*property).to_string())
                    .collect();
            }
            result.insert(
                "items".to_string(),
                Value::Array(self.items(&item_properties).map_err(style_error)?),
            );
        }
        Ok(result)
    }

    fn set(&self, property: &str, _value: &Value) -> Result<(), BatchError> {
        Err(style_error(StyleError::unsupported(format!(
            "StyleCollection.{property} is read-only or unsupported"
        ))))
    }
}

#[derive(Clone)]
pub(crate) struct StyleRef {
    workbook: Workbook,
    id: String,
}

impl StyleRef {
    fn new(workbook: Workbook, id: String) -> Self {
        Self { workbook, id }
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, StyleError> {
        let style = style_by_id(&self.workbook, &self.id)?;
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "isNullObject" => continue,
                "name" => json!(style.name),
                "builtIn" => json!(style.built_in),
                property => style_scalar(&style.format, property)?,
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), StyleError> {
        if matches!(property, "name" | "builtIn") {
            return Err(StyleError::read_only(property));
        }
        update_style_format(&self.workbook, &self.id, |format| {
            set_style_scalar(format, property, value)
        })
    }

    fn delete(&self) -> Result<(), StyleError> {
        let style = style_by_id(&self.workbook, &self.id)?;
        ensure_custom(&style)?;
        self.workbook
            .styles()
            .delete_custom_cell_style(&self.id)
            .map(|_| ())
            .map_err(api_error)
    }
}

impl ExtensionObject for StyleRef {
    fn object_type(&self) -> &'static str {
        "Style"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load(properties).map_err(style_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.set(property, value).map_err(style_error)
    }
}

#[derive(Clone)]
pub(crate) struct StyleFormatRef {
    workbook: Workbook,
    style_id: String,
    kind: StyleFormatKind,
}

impl StyleFormatRef {
    fn new(workbook: Workbook, style_id: String, kind: StyleFormatKind) -> Self {
        Self {
            workbook,
            style_id,
            kind,
        }
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, StyleError> {
        let style = style_by_id(&self.workbook, &self.style_id)?;
        let format = format_value(&style.format)?;
        properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .map(|property| {
                Ok((
                    property.clone(),
                    read_format_property(self.kind, property, &format)?,
                ))
            })
            .collect()
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), StyleError> {
        update_style_format(&self.workbook, &self.style_id, |format| {
            let (field, value) = write_format_property(self.kind, property, value)?;
            let mut encoded = format_value(format)?;
            encoded
                .as_object_mut()
                .expect("CellFormat serializes as object")
                .insert(field.to_string(), value);
            *format = format_from_value(encoded)?;
            Ok(())
        })
    }
}

impl ExtensionObject for StyleFormatRef {
    fn object_type(&self) -> &'static str {
        match self.kind {
            StyleFormatKind::Font => "RangeFont",
            StyleFormatKind::Fill => "RangeFill",
            StyleFormatKind::Protection => "FormatProtection",
            StyleFormatKind::Format => "RangeFormat",
        }
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load(properties).map_err(style_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.set(property, value).map_err(style_error)
    }
}

// ---------------------------------------------------------------------------
// Style borders
// ---------------------------------------------------------------------------

fn border_field(index: &str) -> Result<(&'static str, Option<&'static str>), StyleError> {
    match index {
        "EdgeTop" => Ok(("top", None)),
        "EdgeBottom" => Ok(("bottom", None)),
        "EdgeLeft" => Ok(("left", None)),
        "EdgeRight" => Ok(("right", None)),
        "InsideVertical" => Ok(("vertical", None)),
        "InsideHorizontal" => Ok(("horizontal", None)),
        "DiagonalDown" => Ok(("diagonal", Some("diagonalDown"))),
        "DiagonalUp" => Ok(("diagonal", Some("diagonalUp"))),
        other => Err(StyleError::invalid(format!(
            "Unsupported BorderIndex value '{other}'"
        ))),
    }
}

fn office_style_weight(token: &str) -> Result<(&'static str, &'static str), StyleError> {
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
        other => Err(StyleError::engine(format!(
            "The engine returned unsupported border style token '{other}'"
        ))),
    }
}

fn internal_style_for_pair(style: &str, weight: &str) -> Result<&'static str, StyleError> {
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
        _ => Err(StyleError::unsupported(format!(
            "BorderLineStyle '{style}' with BorderWeight '{weight}' has no lossless engine representation"
        ))),
    }
}

fn side_object<'a>(encoded: &'a Value, field: &str) -> Option<&'a Map<String, Value>> {
    encoded
        .get("borders")
        .and_then(Value::as_object)
        .and_then(|borders| borders.get(field))
        .and_then(Value::as_object)
}

fn border_value(encoded: &Value, index: &str, property: &str) -> Result<Value, StyleError> {
    let (field, diagonal_flag) = border_field(index)?;
    let enabled = diagonal_flag
        .map(|flag| {
            encoded
                .get("borders")
                .and_then(Value::as_object)
                .and_then(|borders| borders.get(flag))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .unwrap_or(true);
    let side = if enabled { side_object(encoded, field) } else { None };
    match property {
        "sideIndex" => Ok(json!(index)),
        "color" => Ok(side
            .and_then(|side| side.get("color"))
            .cloned()
            .unwrap_or(Value::Null)),
        "tintAndShade" => Ok(side
            .and_then(|side| side.get("colorTint"))
            .cloned()
            .unwrap_or_else(|| json!(0.0))),
        "style" => {
            let token = side
                .and_then(|side| side.get("style"))
                .and_then(Value::as_str)
                .unwrap_or("none");
            office_style_weight(token).map(|(style, _)| json!(style))
        }
        "weight" => {
            let token = side
                .and_then(|side| side.get("style"))
                .and_then(Value::as_str)
                .unwrap_or("none");
            office_style_weight(token).map(|(_, weight)| json!(weight))
        }
        other => Err(StyleError::unsupported(format!(
            "Unsupported RangeBorder property '{other}'"
        ))),
    }
}

#[derive(Clone)]
pub(crate) struct StyleBorderCollectionRef {
    workbook: Workbook,
    style_id: String,
}

impl StyleBorderCollectionRef {
    fn new(workbook: Workbook, style_id: String) -> Self {
        Self { workbook, style_id }
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, StyleError> {
        let style = style_by_id(&self.workbook, &self.style_id)?;
        let encoded = format_value(&style.format)?;
        let mut item_properties = Vec::new();
        let mut load_items = false;
        let mut all_items = false;
        let mut result = HashMap::new();
        for property in properties {
            match property.as_str() {
                "isNullObject" => {}
                "count" => {
                    result.insert("count".to_string(), json!(BORDER_KEYS.len()));
                }
                "tintAndShade" => {
                    let values = BORDER_KEYS
                        .iter()
                        .map(|index| border_value(&encoded, index, "tintAndShade"))
                        .collect::<Result<Vec<_>, _>>()?;
                    result.insert("tintAndShade".to_string(), aggregate(values));
                }
                "items" | "items/$all" | "$all" => {
                    load_items = true;
                    all_items = true;
                }
                property if property.starts_with("items/") => {
                    load_items = true;
                    let property = &property["items/".len()..];
                    if property == "$all" {
                        all_items = true;
                    } else if ["color", "sideIndex", "style", "tintAndShade", "weight"]
                        .contains(&property)
                    {
                        item_properties.push(property.to_string());
                    } else {
                        return Err(StyleError::unsupported(format!(
                            "Unsupported RangeBorderCollection item property '{property}'"
                        )));
                    }
                }
                other => {
                    return Err(StyleError::unsupported(format!(
                        "Unsupported RangeBorderCollection property '{other}'"
                    )));
                }
            }
        }
        if load_items {
            if all_items || item_properties.is_empty() {
                item_properties = ["color", "sideIndex", "style", "tintAndShade", "weight"]
                    .iter()
                    .map(|property| (*property).to_string())
                    .collect();
            }
            let items = BORDER_KEYS
                .iter()
                .map(|index| {
                    let properties = item_properties
                        .iter()
                        .map(|property| {
                            Ok((
                                property.clone(),
                                border_value(&encoded, index, property)?,
                            ))
                        })
                        .collect::<Result<Map<String, Value>, StyleError>>()?;
                    Ok(json!({ "key": *index, "properties": properties }))
                })
                .collect::<Result<Vec<_>, StyleError>>()?;
            result.insert("items".to_string(), Value::Array(items));
        }
        Ok(result)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), StyleError> {
        if property != "tintAndShade" {
            return Err(StyleError::unsupported(format!(
                "RangeBorderCollection.{property} is read-only or unsupported"
            )));
        }
        let value = tint(value, property)?;
        update_style_format(&self.workbook, &self.style_id, |format| {
            let mut encoded = format_value(format)?;
            let borders = encoded
                .as_object_mut()
                .expect("CellFormat serializes as object")
                .entry("borders")
                .or_insert_with(|| json!({}));
            let borders = borders
                .as_object_mut()
                .ok_or_else(|| encoding("style borders is not an object"))?;
            for index in BORDER_KEYS {
                let (field, _) = border_field(index)?;
                let side = borders.entry(field.to_string()).or_insert_with(|| json!({}));
                if let Some(side) = side.as_object_mut() {
                    side.insert("colorTint".to_string(), value.clone());
                }
            }
            *format = format_from_value(encoded)?;
            Ok(())
        })
    }
}

impl ExtensionObject for StyleBorderCollectionRef {
    fn object_type(&self) -> &'static str {
        "RangeBorderCollection"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load(properties).map_err(style_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.set(property, value).map_err(style_error)
    }
}

#[derive(Clone)]
pub(crate) struct StyleBorderRef {
    workbook: Workbook,
    style_id: String,
    index: String,
}

impl StyleBorderRef {
    fn new(workbook: Workbook, style_id: String, index: String) -> Result<Self, StyleError> {
        border_field(&index)?;
        Ok(Self {
            workbook,
            style_id,
            index,
        })
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, StyleError> {
        let style = style_by_id(&self.workbook, &self.style_id)?;
        let encoded = format_value(&style.format)?;
        properties
            .iter()
            .filter(|property| property.as_str() != "isNullObject")
            .map(|property| {
                Ok((
                    property.clone(),
                    border_value(&encoded, &self.index, property)?,
                ))
            })
            .collect()
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), StyleError> {
        let index = self.index.clone();
        update_style_format(&self.workbook, &self.style_id, |format| {
            let (field, diagonal_flag) = border_field(&index)?;
            let mut encoded = format_value(format)?;
            let borders = encoded
                .as_object_mut()
                .expect("CellFormat serializes as object")
                .entry("borders")
                .or_insert_with(|| json!({}));
            let borders = borders
                .as_object_mut()
                .ok_or_else(|| encoding("style borders is not an object"))?;
            let side = borders.entry(field.to_string()).or_insert_with(|| json!({}));
            let side = side
                .as_object_mut()
                .ok_or_else(|| encoding("style border side is not an object"))?;
            match property {
                "sideIndex" => return Err(StyleError::read_only("sideIndex")),
                "color" => {
                    side.insert("color".to_string(), string_value(value, property, false)?);
                }
                "tintAndShade" => {
                    side.insert("colorTint".to_string(), tint(value, property)?);
                }
                "style" => {
                    let style = value.as_str().ok_or_else(|| {
                        StyleError::invalid("style must be a string enum value")
                    })?;
                    let weight = side
                        .get("style")
                        .and_then(Value::as_str)
                        .map(office_style_weight)
                        .transpose()?
                        .map(|(_, weight)| weight)
                        .unwrap_or("Thin");
                    side.insert(
                        "style".to_string(),
                        json!(internal_style_for_pair(style, weight)?),
                    );
                    if let Some(flag) = diagonal_flag {
                        borders.insert(flag.to_string(), json!(style != "None"));
                    }
                }
                "weight" => {
                    let weight = value.as_str().ok_or_else(|| {
                        StyleError::invalid("weight must be a string enum value")
                    })?;
                    let style = side
                        .get("style")
                        .and_then(Value::as_str)
                        .map(office_style_weight)
                        .transpose()?
                        .map(|(style, _)| style)
                        .ok_or_else(|| {
                            StyleError::unsupported(
                                "RangeBorder.weight cannot create a border when style is None",
                            )
                        })?;
                    side.insert(
                        "style".to_string(),
                        json!(internal_style_for_pair(style, weight)?),
                    );
                }
                other => {
                    return Err(StyleError::unsupported(format!(
                        "Unsupported RangeBorder property '{other}'"
                    )))
                }
            }
            *format = format_from_value(encoded)?;
            Ok(())
        })
    }
}

impl ExtensionObject for StyleBorderRef {
    fn object_type(&self) -> &'static str {
        "RangeBorder"
    }

    fn load(&self, properties: &[String]) -> Result<HashMap<String, Value>, BatchError> {
        self.load(properties).map_err(style_error)
    }

    fn set(&self, property: &str, value: &Value) -> Result<(), BatchError> {
        self.set(property, value).map_err(style_error)
    }
}

fn aggregate(values: Vec<Value>) -> Value {
    let Some(first) = values.first() else {
        return Value::Null;
    };
    if values.iter().all(|value| value == first) {
        first.clone()
    } else {
        Value::Null
    }
}

fn normalize_item_properties(properties: &[String]) -> Result<Vec<String>, StyleError> {
    if properties.is_empty() {
        return Ok(STYLE_SCALARS
            .iter()
            .map(|property| (*property).to_string())
            .collect());
    }
    let mut normalized = Vec::new();
    for property in properties {
        if property == "isNullObject" {
            continue;
        }
        if STYLE_SCALARS.contains(&property.as_str()) {
            if !normalized.contains(property) {
                normalized.push(property.clone());
            }
        } else {
            return Err(StyleError::unsupported(format!(
                "Unsupported Style item property '{property}'"
            )));
        }
    }
    Ok(normalized)
}

// ---------------------------------------------------------------------------
// Extension operation handler
// ---------------------------------------------------------------------------

/// Handler installed by the Office.js runtime owner. The central host keeps
/// generic load/set routing and object maps; this handler only owns custom
/// named-style operations and binds the typed objects those operations create.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct NamedStylesHandler;

impl NamedStylesHandler {
    pub(crate) fn new() -> Self {
        Self
    }
}

fn operation_string<'a>(operation: &'a Value, field: &str) -> Result<&'a str, BatchError> {
    operation
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| BatchError {
            code: "InvalidArgument",
            message: format!("style operation requires a string '{field}'"),
        })
}

impl ExtensionHandler for NamedStylesHandler {
    fn can_handle(&self, operation: &str) -> bool {
        matches!(
            operation,
            "getStyleCollection"
                | "styleAdd"
                | "styleGetCount"
                | "styleGetItem"
                | "styleGetItemAt"
                | "styleDelete"
                | "getStyleFormat"
                | "getStyleBorderCollection"
                | "getStyleBorder"
        )
    }

    fn handle(
        &self,
        operation: &Value,
        context: &mut HostDispatchContext<'_>,
    ) -> Result<bool, BatchError> {
        let name = operation
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| BatchError {
                code: "InvalidArgument",
                message: "style operation is missing op".to_string(),
            })?;
        let workbook = context.workbook();
        match name {
            "getStyleCollection" => {
                let id = operation_string(operation, "id")?;
                context.bind_object(id, Arc::new(StyleCollectionRef::new(workbook)));
            }
            "styleAdd" => {
                let collection_id = operation_string(operation, "collectionId")?;
                let collection = context.extension_object::<StyleCollectionRef>(collection_id)?;
                collection
                    .add(operation_string(operation, "name")?)
                    .map_err(style_error)?;
            }
            "styleGetCount" => {
                let result_id = operation_string(operation, "resultId")?;
                let collection = operation
                    .get("collectionId")
                    .and_then(Value::as_str)
                    .map(|id| context.extension_object::<StyleCollectionRef>(id))
                    .transpose()?
                    .unwrap_or_else(|| Arc::new(StyleCollectionRef::new(workbook.clone())));
                context.set_result(result_id, json!(collection.count().map_err(style_error)?));
            }
            "styleGetItem" => {
                let id = operation_string(operation, "id")?;
                let name = operation_string(operation, "name")?;
                let or_null = operation
                    .get("orNullObject")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let collection = operation
                    .get("collectionId")
                    .and_then(Value::as_str)
                    .map(|id| context.extension_object::<StyleCollectionRef>(id))
                    .transpose()?
                    .unwrap_or_else(|| Arc::new(StyleCollectionRef::new(workbook.clone())));
                match collection.get_or_null(name).map_err(style_error)? {
                    Some(style) => context.bind_object(id, Arc::new(style)),
                    None if or_null => context.bind_null_object(id),
                    None => {
                        return Err(style_error(StyleError::not_found(format!(
                            "Style '{name}' was not found"
                        ))))
                    }
                }
            }
            "styleGetItemAt" => {
                let id = operation_string(operation, "id")?;
                let index = operation
                    .get("index")
                    .and_then(Value::as_i64)
                    .filter(|index| *index >= 0)
                    .ok_or_else(|| BatchError {
                        code: "InvalidArgument",
                        message: "StyleCollection.getItemAt requires a non-negative integer index"
                            .to_string(),
                    })? as usize;
                let collection = operation
                    .get("collectionId")
                    .and_then(Value::as_str)
                    .map(|id| context.extension_object::<StyleCollectionRef>(id))
                    .transpose()?
                    .unwrap_or_else(|| Arc::new(StyleCollectionRef::new(workbook.clone())));
                context.bind_object(id, Arc::new(collection.get_at(index).map_err(style_error)?));
            }
            "styleDelete" => {
                let id = operation_string(operation, "id")?;
                let style = context.extension_object::<StyleRef>(id)?;
                style.delete().map_err(style_error)?;
            }
            "getStyleFormat" => {
                let id = operation_string(operation, "id")?;
                let style_id = operation_string(operation, "styleId")?;
                let kind = match operation_string(operation, "kind")? {
                    "font" => StyleFormatKind::Font,
                    "fill" => StyleFormatKind::Fill,
                    "protection" => StyleFormatKind::Protection,
                    "format" => StyleFormatKind::Format,
                    other => {
                        return Err(style_error(StyleError::unsupported(format!(
                            "Unsupported style format kind '{other}'"
                        ))))
                    }
                };
                context.bind_object(
                    id,
                    Arc::new(StyleFormatRef::new(workbook, style_id.to_string(), kind)),
                );
            }
            "getStyleBorderCollection" => {
                let id = operation_string(operation, "id")?;
                let style_id = operation_string(operation, "styleId")?;
                context.bind_object(
                    id,
                    Arc::new(StyleBorderCollectionRef::new(workbook, style_id.to_string())),
                );
            }
            "getStyleBorder" => {
                let id = operation_string(operation, "id")?;
                let style_id = operation_string(operation, "styleId")?;
                let index = operation_string(operation, "index")?;
                let border =
                    StyleBorderRef::new(workbook, style_id.to_string(), index.to_string())
                        .map_err(style_error)?;
                context.bind_object(id, Arc::new(border));
            }
            _ => return Ok(false),
        }
        Ok(true)
    }
}
