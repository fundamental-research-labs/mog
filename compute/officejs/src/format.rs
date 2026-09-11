use std::collections::HashMap;

use compute_api::{CellRange, Sheet};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatError {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FormatKind {
    Format,
    Font,
    Fill,
    Protection,
}

#[derive(Clone)]
pub(crate) struct FormatRef {
    sheet: Sheet,
    address: String,
    kind: FormatKind,
}

impl FormatRef {
    pub(crate) fn new(sheet: Sheet, address: String, kind: &str) -> Result<Self, FormatError> {
        let kind = match kind {
            "format" => FormatKind::Format,
            "font" => FormatKind::Font,
            "fill" => FormatKind::Fill,
            "protection" => FormatKind::Protection,
            _ => return Err(invalid(format!("Unsupported range format kind '{kind}'"))),
        };
        CellRange::from(address.as_str())
            .resolve()
            .map_err(|error| invalid(error.to_string()))?;
        Ok(Self {
            sheet,
            address,
            kind,
        })
    }

    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, FormatError> {
        let (start_row, start_col, end_row, end_col) = self.bounds()?;
        let mut result = HashMap::new();
        for property in properties {
            if self.kind == FormatKind::Format
                && matches!(property.as_str(), "columnWidth" | "rowHeight")
            {
                result.insert(
                    property.clone(),
                    self.load_layout(property, start_row, start_col, end_row, end_col)?,
                );
                continue;
            }
            let mut aggregate: Option<Value> = None;
            let mut mixed = false;
            'cells: for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let format = self
                        .sheet
                        .formats()
                        .get_cell_format(row, col)
                        .map_err(engine)?;
                    let format = serde_json::to_value(format).map_err(encoding)?;
                    let value = read_property(self.kind, property, &format)?;
                    match &aggregate {
                        None => aggregate = Some(value),
                        Some(first) if first == &value => {}
                        Some(_) => {
                            mixed = true;
                            break 'cells;
                        }
                    }
                }
            }
            result.insert(
                property.clone(),
                if mixed {
                    Value::Null
                } else {
                    aggregate.unwrap_or(Value::Null)
                },
            );
        }
        Ok(result)
    }

    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), FormatError> {
        if self.kind == FormatKind::Format && matches!(property, "columnWidth" | "rowHeight") {
            return self.set_layout(property, value);
        }
        if self.kind == FormatKind::Fill && property == "clear" {
            self.sheet
                .formats()
                .patch_format_for_ranges(
                    vec![self.bounds()?],
                    serde_json::from_value(json!({})).map_err(encoding)?,
                    vec![
                        "backgroundColor".to_string(),
                        "backgroundColorTint".to_string(),
                        "patternType".to_string(),
                        "patternForegroundColor".to_string(),
                        "patternForegroundColorTint".to_string(),
                        "gradientFill".to_string(),
                    ],
                )
                .map_err(engine)?;
            return Ok(());
        }

        let (field, value) = write_property(self.kind, property, value)?;
        let mut patch = Map::new();
        patch.insert(field.to_string(), value);
        self.sheet
            .formats()
            .patch_format_for_ranges(
                vec![self.bounds()?],
                serde_json::from_value(Value::Object(patch)).map_err(encoding)?,
                Vec::new(),
            )
            .map_err(engine)?;
        Ok(())
    }

    fn bounds(&self) -> Result<(u32, u32, u32, u32), FormatError> {
        CellRange::from(self.address.as_str())
            .resolve()
            .map_err(|error| invalid(error.to_string()))
    }

    fn load_layout(
        &self,
        property: &str,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<Value, FormatError> {
        let layout = self.sheet.layout();
        let mut aggregate: Option<f64> = None;
        if property == "columnWidth" {
            for col in start_col..=end_col {
                let points = pixels_to_points(layout.get_col_width(col).map_err(engine)?);
                match aggregate {
                    None => aggregate = Some(points),
                    Some(first) if (first - points).abs() < 1e-6 => {}
                    Some(_) => return Ok(Value::Null),
                }
            }
        } else {
            for row in start_row..=end_row {
                let points = pixels_to_points(layout.get_row_height(row).map_err(engine)?);
                match aggregate {
                    None => aggregate = Some(points),
                    Some(first) if (first - points).abs() < 1e-6 => {}
                    Some(_) => return Ok(Value::Null),
                }
            }
        }
        Ok(aggregate.map(Value::from).unwrap_or(Value::Null))
    }

    fn set_layout(&self, property: &str, value: &Value) -> Result<(), FormatError> {
        let points = finite_number(value, property)?;
        if points < 0.0 {
            return Err(invalid(format!("{property} must be non-negative")));
        }
        let pixels = points_to_pixels(points);
        let (start_row, start_col, end_row, end_col) = self.bounds()?;
        let layout = self.sheet.layout();
        if property == "columnWidth" {
            for col in start_col..=end_col {
                layout.set_col_width(col, pixels).map_err(engine)?;
            }
        } else {
            for row in start_row..=end_row {
                layout.set_row_height(row, pixels).map_err(engine)?;
            }
        }
        Ok(())
    }
}

fn points_to_pixels(points: f64) -> f64 {
    points * 96.0 / 72.0
}

fn pixels_to_points(pixels: f64) -> f64 {
    pixels * 72.0 / 96.0
}

fn read_property(kind: FormatKind, property: &str, format: &Value) -> Result<Value, FormatError> {
    let get = |field: &str, default: Value| {
        format
            .get(field)
            .filter(|value| !value.is_null())
            .cloned()
            .unwrap_or(default)
    };
    let value = match (kind, property) {
        (FormatKind::Format, "horizontalAlignment") => map_token(
            get("horizontalAlign", json!("general")),
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
        (FormatKind::Format, "verticalAlignment") => map_token(
            get("verticalAlign", json!("bottom")),
            &[
                ("top", "Top"),
                ("middle", "Center"),
                ("bottom", "Bottom"),
                ("justify", "Justify"),
                ("distributed", "Distributed"),
            ],
        )?,
        (FormatKind::Format, "wrapText") => get("wrapText", json!(false)),
        (FormatKind::Format, "autoIndent") => get("autoIndent", json!(false)),
        (FormatKind::Format, "indentLevel") => get("indent", json!(0)),
        (FormatKind::Format, "shrinkToFit") => get("shrinkToFit", json!(false)),
        (FormatKind::Format, "textOrientation") => get("textRotation", json!(0)),
        (FormatKind::Format, "readingOrder") => map_token(
            get("readingOrder", json!("context")),
            &[
                ("context", "Context"),
                ("ltr", "LeftToRight"),
                ("rtl", "RightToLeft"),
            ],
        )?,
        (FormatKind::Font, "bold") => get("bold", json!(false)),
        (FormatKind::Font, "color") => get("fontColor", json!("#000000")),
        (FormatKind::Font, "italic") => get("italic", json!(false)),
        (FormatKind::Font, "name") => get("fontFamily", json!("Calibri")),
        (FormatKind::Font, "size") => get("fontSize", json!(11.0)),
        (FormatKind::Font, "underline") => map_token(
            get("underlineType", json!("none")),
            &[
                ("none", "None"),
                ("single", "Single"),
                ("double", "Double"),
                ("singleAccounting", "SingleAccountant"),
                ("doubleAccounting", "DoubleAccountant"),
            ],
        )?,
        (FormatKind::Font, "strikethrough") => get("strikethrough", json!(false)),
        (FormatKind::Font, "subscript") => get("subscript", json!(false)),
        (FormatKind::Font, "superscript") => get("superscript", json!(false)),
        (FormatKind::Font, "tintAndShade") => get("fontColorTint", json!(0.0)),
        (FormatKind::Fill, "color") => get("backgroundColor", Value::Null),
        (FormatKind::Fill, "pattern") => map_token(
            get("patternType", json!("none")),
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
        (FormatKind::Fill, "patternColor") => get("patternForegroundColor", Value::Null),
        (FormatKind::Fill, "patternTintAndShade") => get("patternForegroundColorTint", json!(0.0)),
        (FormatKind::Fill, "tintAndShade") => get("backgroundColorTint", json!(0.0)),
        (FormatKind::Protection, "locked") => get("locked", json!(true)),
        (FormatKind::Protection, "formulaHidden") => get("hidden", json!(false)),
        _ => return Err(unsupported(kind, property)),
    };
    Ok(value)
}

fn write_property(
    kind: FormatKind,
    property: &str,
    value: &Value,
) -> Result<(&'static str, Value), FormatError> {
    if value.is_null() {
        return Err(invalid(format!("{property} cannot be null")));
    }
    let mapped = match (kind, property) {
        (FormatKind::Format, "horizontalAlignment") => (
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
        (FormatKind::Format, "verticalAlignment") => (
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
        (FormatKind::Format, "wrapText") => ("wrapText", boolean(value, property)?),
        (FormatKind::Format, "autoIndent") => ("autoIndent", boolean(value, property)?),
        (FormatKind::Format, "indentLevel") => {
            let number = integer(value, property)?;
            if !(0..=250).contains(&number) {
                return Err(invalid("indentLevel must be between 0 and 250"));
            }
            ("indent", json!(number))
        }
        (FormatKind::Format, "shrinkToFit") => ("shrinkToFit", boolean(value, property)?),
        (FormatKind::Format, "textOrientation") => {
            let number = integer(value, property)?;
            if !((-90..=90).contains(&number) || number == 180) {
                return Err(invalid("textOrientation must be -90 through 90, or 180"));
            }
            ("textRotation", json!(number))
        }
        (FormatKind::Format, "readingOrder") => (
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
        (FormatKind::Font, "bold") => ("bold", boolean(value, property)?),
        (FormatKind::Font, "color") => ("fontColor", string(value, property)?),
        (FormatKind::Font, "italic") => ("italic", boolean(value, property)?),
        (FormatKind::Font, "name") => {
            let name = value
                .as_str()
                .ok_or_else(|| invalid("name must be a string"))?;
            if name.is_empty() || name.chars().count() > 31 {
                return Err(invalid("name must contain 1 through 31 characters"));
            }
            ("fontFamily", json!(name))
        }
        (FormatKind::Font, "size") => {
            let size = finite_number(value, property)?;
            if !(1.0..=409.0).contains(&size) {
                return Err(invalid("size must be between 1 and 409 points"));
            }
            ("fontSize", json!(size))
        }
        (FormatKind::Font, "underline") => (
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
        (FormatKind::Font, "strikethrough") => ("strikethrough", boolean(value, property)?),
        (FormatKind::Font, "subscript") => ("subscript", boolean(value, property)?),
        (FormatKind::Font, "superscript") => ("superscript", boolean(value, property)?),
        (FormatKind::Font, "tintAndShade") => ("fontColorTint", bounded_tint(value, property)?),
        (FormatKind::Fill, "color") => ("backgroundColor", string(value, property)?),
        (FormatKind::Fill, "pattern") => (
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
        (FormatKind::Fill, "patternColor") => ("patternForegroundColor", string(value, property)?),
        (FormatKind::Fill, "patternTintAndShade") => {
            ("patternForegroundColorTint", bounded_tint(value, property)?)
        }
        (FormatKind::Fill, "tintAndShade") => {
            ("backgroundColorTint", bounded_tint(value, property)?)
        }
        (FormatKind::Protection, "locked") => ("locked", boolean(value, property)?),
        (FormatKind::Protection, "formulaHidden") => ("hidden", boolean(value, property)?),
        _ => return Err(unsupported(kind, property)),
    };
    Ok(mapped)
}

fn map_token(value: Value, mappings: &[(&str, &str)]) -> Result<Value, FormatError> {
    let token = value.as_str().ok_or_else(|| FormatError {
        code: "GeneralException",
        message: "The engine returned an invalid format token".to_string(),
    })?;
    mappings
        .iter()
        .find_map(|(internal, office)| (*internal == token).then(|| json!(office)))
        .ok_or_else(|| FormatError {
            code: "GeneralException",
            message: format!("The engine returned unsupported format token '{token}'"),
        })
}

fn enum_value(
    value: &Value,
    property: &str,
    mappings: &[(&str, &str)],
) -> Result<Value, FormatError> {
    let token = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a string enum value")))?;
    mappings
        .iter()
        .find_map(|(office, internal)| (*office == token).then(|| json!(internal)))
        .ok_or_else(|| invalid(format!("Unsupported {property} value '{token}'")))
}

fn boolean(value: &Value, property: &str) -> Result<Value, FormatError> {
    value
        .as_bool()
        .map(Value::Bool)
        .ok_or_else(|| invalid(format!("{property} must be a boolean")))
}

fn string(value: &Value, property: &str) -> Result<Value, FormatError> {
    let string = value
        .as_str()
        .ok_or_else(|| invalid(format!("{property} must be a string")))?;
    if string.is_empty() {
        return Err(invalid(format!("{property} cannot be empty")));
    }
    Ok(json!(string))
}

fn finite_number(value: &Value, property: &str) -> Result<f64, FormatError> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| invalid(format!("{property} must be a finite number")))
}

fn integer(value: &Value, property: &str) -> Result<i64, FormatError> {
    let number = finite_number(value, property)?;
    if number.fract() != 0.0 || number < i64::MIN as f64 || number > i64::MAX as f64 {
        return Err(invalid(format!("{property} must be an integer")));
    }
    Ok(number as i64)
}

fn bounded_tint(value: &Value, property: &str) -> Result<Value, FormatError> {
    let tint = finite_number(value, property)?;
    if !(-1.0..=1.0).contains(&tint) {
        return Err(invalid(format!("{property} must be between -1 and 1")));
    }
    Ok(json!(tint))
}

fn unsupported(kind: FormatKind, property: &str) -> FormatError {
    FormatError {
        code: "InvalidArgument",
        message: format!("Unsupported {:?} property '{property}'", kind),
    }
}

fn invalid(message: impl Into<String>) -> FormatError {
    FormatError {
        code: "InvalidArgument",
        message: message.into(),
    }
}

fn engine(error: impl std::fmt::Display) -> FormatError {
    FormatError {
        code: "GeneralException",
        message: error.to_string(),
    }
}

fn encoding(error: impl std::fmt::Display) -> FormatError {
    FormatError {
        code: "GeneralException",
        message: format!("format conversion failed: {error}"),
    }
}
