//! Office.js `RangeFormat` layout properties.
//!
//! `CellFormat` deliberately contains visual cell properties only.  Row
//! heights and column widths live in the sheet layout index, so this adapter
//! translates the Office.js units at the boundary and delegates every change
//! to the production `Sheet::layout()` facade.  A range such as `4:8` or
//! `C:F` is retained as a tagged [`RangeAddress`]; it is never expanded to a
//! worksheet-sized cell matrix.
//!
//! The host integration stores one [`FormatDimensionsRef`] alongside its
//! ordinary format reference for a `RangeFormat` proxy.  Generic `load` and
//! `set` operations route the four dimension properties here.  The JavaScript
//! extension emits `rangeFormatAutofit { id, axis }` for `autofitRows()` and
//! `autofitColumns()`; the host calls [`FormatDimensionsRef::autofit`].
//!
//! The pinned Office.js contract exposes both row height and column width in
//! points.  The compute-api layout facade uses pixels for rendering reads and
//! writes, while the persisted column representation is OOXML character
//! width.  This adapter therefore converts Office points to the production
//! pixel boundary; the engine's MDW/padding quantization remains authoritative
//! for the resulting layout.  Standard-width resets use the typed canonical
//! character-width methods so they do not drift through that pixel inverse.

use std::collections::HashMap;

use compute_api::{ComputeApiError, Sheet};
use serde_json::{json, Map, Value};

use crate::range_navigation::{parse_range_address, RangeAddress};

const EXCEL_MAX_ROWS: u32 = 1_048_576;
const MAX_ROW_HEIGHT_POINTS: f64 = 409.0;
const SCREEN_DPI: f64 = 96.0;
const POINTS_PER_INCH: f64 = 72.0;

/// Errors returned by the layout/format projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FormatDimensionsError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

impl FormatDimensionsError {
    fn invalid(message: impl Into<String>) -> Self {
        Self {
            code: "InvalidArgument",
            message: message.into(),
        }
    }

    fn unsupported(message: impl Into<String>) -> Self {
        // The embedded host uses InvalidArgument for a member that is part of
        // the Microsoft surface but has no production representation.
        Self::invalid(message)
    }

    fn engine(error: impl std::fmt::Display) -> Self {
        Self {
            code: "GeneralException",
            message: error.to_string(),
        }
    }
}

impl From<ComputeApiError> for FormatDimensionsError {
    fn from(error: ComputeApiError) -> Self {
        match error {
            ComputeApiError::InvalidAddress { .. }
            | ComputeApiError::InvalidRange { .. }
            | ComputeApiError::InvalidOperation(_)
            | ComputeApiError::Compute(value_types::ComputeError::InvalidInput { .. }) => {
                Self::invalid(error.to_string())
            }
            other => Self::engine(other),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DimensionAxis {
    Rows,
    Columns,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutofitAxis {
    Rows,
    Columns,
}

impl AutofitAxis {
    pub(crate) fn parse(value: &str) -> Result<Self, FormatDimensionsError> {
        match value {
            "rows" => Ok(Self::Rows),
            "columns" => Ok(Self::Columns),
            other => Err(FormatDimensionsError::invalid(format!(
                "Unsupported RangeFormat autofit axis '{other}'"
            ))),
        }
    }
}

/// A `RangeFormat` layout reference retaining the range's original shape.
#[derive(Clone)]
pub(crate) struct FormatDimensionsRef {
    sheet: Sheet,
    address: String,
    range: RangeAddress,
}

impl FormatDimensionsRef {
    /// Bind a layout reference to a canonical or sheet-qualified A1 range.
    pub(crate) fn new(sheet: Sheet, address: String) -> Result<Self, FormatDimensionsError> {
        // Use the Office.js range parser so full rows/columns remain tagged
        // and a cross-sheet qualifier is rejected at the host boundary.
        let range = parse_range_address(&sheet, &address).map_err(|error| {
            FormatDimensionsError::invalid(format!("invalid range address: {}", error.message))
        })?;
        Ok(Self {
            sheet,
            address,
            range,
        })
    }

    pub(crate) fn address(&self) -> &str {
        &self.address
    }

    pub(crate) fn range(&self) -> &RangeAddress {
        &self.range
    }

    /// Load layout scalar properties into Office.js-shaped values.
    pub(crate) fn load(
        &self,
        properties: &[String],
    ) -> Result<HashMap<String, Value>, FormatDimensionsError> {
        let mut result = HashMap::new();
        for property in properties {
            let value = match property.as_str() {
                "rowHeight" => json!(self.uniform_row_height()?),
                "columnWidth" => self.uniform_column_width()?,
                "useStandardHeight" => self.standard_height()?,
                "useStandardWidth" => self.standard_width()?,
                other => {
                    return Err(FormatDimensionsError::unsupported(format!(
                        "Unsupported RangeFormat layout property '{other}'"
                    )));
                }
            };
            result.insert(property.clone(), value);
        }
        Ok(result)
    }

    /// Apply one queued dimension property.
    pub(crate) fn set(&self, property: &str, value: &Value) -> Result<(), FormatDimensionsError> {
        match property {
            "rowHeight" => self.set_row_height(value),
            "columnWidth" => self.set_column_width(value),
            // Microsoft documents these setters as intended only for `true`.
            // `false` is deliberately a no-op and must not reset a custom
            // dimension.
            "useStandardHeight" => self.set_standard_height(value),
            "useStandardWidth" => self.set_standard_width(value),
            other => Err(FormatDimensionsError::unsupported(format!(
                "Unsupported RangeFormat layout property '{other}'"
            ))),
        }
    }

    /// Compute and set best-fit dimensions for the selected range axis.
    pub(crate) fn autofit(&self, axis: AutofitAxis) -> Result<(), FormatDimensionsError> {
        match axis {
            AutofitAxis::Rows => {
                let (start, end) = self.axis_bounds(DimensionAxis::Rows)?;
                self.ensure_rows_enumerable(start, end, "autofitRows")?;
                let rows = (start..=end).collect::<Vec<_>>();
                self.sheet
                    .layout()
                    .auto_fit_rows_and_set(rows)
                    .map(|_| ())
                    .map_err(FormatDimensionsError::from)
            }
            AutofitAxis::Columns => {
                let (start, end) = self.axis_bounds(DimensionAxis::Columns)?;
                // 16,384 column identities are a bounded layout axis and the
                // production autofit primitive consumes that list directly.
                // This never expands rows or cells.
                let columns = (start..=end).collect::<Vec<_>>();
                self.sheet
                    .layout()
                    .auto_fit_columns_and_set(columns)
                    .map(|_| ())
                    .map_err(FormatDimensionsError::from)
            }
        }
    }

    fn set_row_height(&self, value: &Value) -> Result<(), FormatDimensionsError> {
        let points = finite_number(value, "rowHeight")?;
        if !(0.0 < points && points <= MAX_ROW_HEIGHT_POINTS) {
            return Err(FormatDimensionsError::invalid(format!(
                "rowHeight must be greater than 0 and at most {MAX_ROW_HEIGHT_POINTS} points"
            )));
        }
        let (start, end) = self.axis_bounds(DimensionAxis::Rows)?;
        self.ensure_rows_enumerable(start, end, "rowHeight")?;
        // SheetLayout speaks rendering pixels.  Office.js rowHeight speaks
        // points.  The conversion is the engine's documented 96-DPI screen
        // contract, not a font or content measurement.
        let pixels = points_to_pixels(points);
        for row in start..=end {
            self.sheet
                .layout()
                .set_row_height(row, pixels)
                .map_err(FormatDimensionsError::from)?;
        }
        Ok(())
    }

    fn set_column_width(&self, value: &Value) -> Result<(), FormatDimensionsError> {
        let points = finite_number(value, "columnWidth")?;
        if points <= 0.0 {
            return Err(FormatDimensionsError::invalid(format!(
                "columnWidth must be greater than 0 points"
            )));
        }
        let pixels = points_to_pixels(points);
        if !pixels.is_finite() {
            return Err(FormatDimensionsError::invalid(
                "columnWidth is outside the supported point range",
            ));
        }
        let (start, end) = self.axis_bounds(DimensionAxis::Columns)?;
        let columns = (start..=end)
            .map(|column| (column, pixels))
            .collect::<Vec<_>>();
        // Office.js columnWidth is point-based. SheetLayout's pixel setter
        // performs the production MDW/padding conversion into canonical
        // character units; do not substitute an invented character heuristic.
        self.sheet
            .layout()
            .set_col_widths(columns)
            .map(|_| ())
            .map_err(FormatDimensionsError::from)
    }

    fn set_standard_height(&self, value: &Value) -> Result<(), FormatDimensionsError> {
        let use_standard = value
            .as_bool()
            .ok_or_else(|| FormatDimensionsError::invalid("useStandardHeight must be a boolean"))?;
        if !use_standard {
            return Ok(());
        }
        let default_pixels = self
            .sheet
            .layout()
            .get_default_row_height()
            .map_err(FormatDimensionsError::from)?;
        let (start, end) = self.axis_bounds(DimensionAxis::Rows)?;
        self.ensure_rows_enumerable(start, end, "useStandardHeight")?;
        for row in start..=end {
            self.sheet
                .layout()
                .set_row_height(row, default_pixels)
                .map_err(FormatDimensionsError::from)?;
        }
        Ok(())
    }

    fn set_standard_width(&self, value: &Value) -> Result<(), FormatDimensionsError> {
        let use_standard = value
            .as_bool()
            .ok_or_else(|| FormatDimensionsError::invalid("useStandardWidth must be a boolean"))?;
        if !use_standard {
            return Ok(());
        }
        let default_width = self
            .sheet
            .layout()
            .get_default_col_width_chars()
            .map_err(FormatDimensionsError::from)?;
        let (start, end) = self.axis_bounds(DimensionAxis::Columns)?;
        let columns = (start..=end)
            .map(|column| (column, default_width))
            .collect::<Vec<_>>();
        self.sheet
            .layout()
            .set_col_widths_chars(columns)
            .map(|_| ())
            .map_err(FormatDimensionsError::from)
    }

    fn uniform_row_height(&self) -> Result<Option<f64>, FormatDimensionsError> {
        let (start, end) = self.axis_bounds(DimensionAxis::Rows)?;
        self.ensure_rows_enumerable(start, end, "rowHeight")?;
        let mut values = (start..=end).map(|row| {
            self.sheet
                .layout()
                .get_row_height(row)
                .map(|pixels| pixels_to_points(pixels))
                .map_err(FormatDimensionsError::from)
        });
        let Some(first) = values.next() else {
            return Ok(None);
        };
        let first = first?;
        for value in values {
            if value? != first {
                return Ok(None);
            }
        }
        Ok(Some(first))
    }

    fn uniform_column_width(&self) -> Result<Value, FormatDimensionsError> {
        let (start, end) = self.axis_bounds(DimensionAxis::Columns)?;
        let mut values = (start..=end).map(|column| {
            self.sheet
                .layout()
                .get_col_width(column)
                .map(|pixels| pixels_to_points(pixels))
                .map_err(FormatDimensionsError::from)
        });
        let Some(first) = values.next() else {
            return Ok(Value::Null);
        };
        let first = first?;
        for value in values {
            if value? != first {
                return Ok(Value::Null);
            }
        }
        Ok(json!(first))
    }

    fn standard_height(&self) -> Result<Value, FormatDimensionsError> {
        let default_pixels = self
            .sheet
            .layout()
            .get_default_row_height()
            .map_err(FormatDimensionsError::from)?;
        let default_points = pixels_to_points(default_pixels);
        let height = self.uniform_row_height()?;
        Ok(match height {
            Some(value) => json!(value == default_points),
            None => Value::Null,
        })
    }

    fn standard_width(&self) -> Result<Value, FormatDimensionsError> {
        let default_pixels = self
            .sheet
            .layout()
            .get_default_col_width()
            .map_err(FormatDimensionsError::from)?;
        let default_points = pixels_to_points(default_pixels);
        let width = self.uniform_column_width()?;
        Ok(match width {
            Value::Number(value) => json!(value.as_f64() == Some(default_points)),
            Value::Null => Value::Null,
            _ => Value::Null,
        })
    }

    fn axis_bounds(&self, axis: DimensionAxis) -> Result<(u32, u32), FormatDimensionsError> {
        let (start_row, start_col, end_row, end_col) = self.range.bounds();
        Ok(match axis {
            DimensionAxis::Rows => (start_row, end_row),
            DimensionAxis::Columns => (start_col, end_col),
        })
    }

    fn ensure_rows_enumerable(
        &self,
        start: u32,
        end: u32,
        operation: &str,
    ) -> Result<(), FormatDimensionsError> {
        // A full column/worksheet selection has one million rows.  The
        // production layout facade has per-row/autofit calls, so expanding
        // this axis in the Office.js host would be both incorrect and an
        // avoidable memory spike.  Keep the operation explicit until a true
        // sparse row-range primitive exists.
        if end - start + 1 >= EXCEL_MAX_ROWS {
            return Err(FormatDimensionsError::unsupported(format!(
                "RangeFormat.{operation} cannot enumerate the entire worksheet row axis"
            )));
        }
        Ok(())
    }
}

fn points_to_pixels(points: f64) -> f64 {
    points * SCREEN_DPI / POINTS_PER_INCH
}

fn pixels_to_points(pixels: f64) -> f64 {
    pixels * POINTS_PER_INCH / SCREEN_DPI
}

/// A sparse row/column format target used by the host for full-axis ranges.
///
/// The normal `FormatRef` intentionally accepts bounded cell ranges only.  A
/// full row or column can still carry a real format layer in the engine, and
/// the row/column format facades apply it without creating one million cells.
/// This helper covers mutations for the existing RangeFormat/RangeFont/
/// RangeFill/FormatProtection scalar surface.  Bounded ranges continue to
/// use `format.rs`, which owns their complete mixed-value projection.
#[derive(Clone)]
pub(crate) struct SparseFormatRef {
    dimensions: FormatDimensionsRef,
}

impl SparseFormatRef {
    pub(crate) fn new(sheet: Sheet, address: String) -> Result<Self, FormatDimensionsError> {
        Ok(Self {
            dimensions: FormatDimensionsRef::new(sheet, address)?,
        })
    }

    pub(crate) fn is_axis_range(&self) -> bool {
        self.dimensions.range().is_entire_row() || self.dimensions.range().is_entire_column()
    }

    /// Apply one visual format scalar to each selected sparse row/column.
    ///
    /// This is deliberately a patch operation.  Omitted format fields remain
    /// untouched and `fill.clear` clears only fill fields.  The conversion is
    /// kept here rather than routing through a finite max-row/max-column cell
    /// rectangle.
    pub(crate) fn set(
        &self,
        kind: &str,
        property: &str,
        value: &Value,
    ) -> Result<(), FormatDimensionsError> {
        let (format, clear_fields) = sparse_property_patch(kind, property, value)?;
        // Type inference keeps the Office adapter on compute-api's public
        // surface while still passing the production CellFormat type to the
        // row/column format methods.
        let format = serde_json::from_value(format).map_err(FormatDimensionsError::engine)?;
        match self.dimensions.range() {
            RangeAddress::Rows { start, end } => {
                self.dimensions
                    .ensure_rows_enumerable(*start, *end, "sparse format")?;
                for row in *start..=*end {
                    self.dimensions
                        .sheet
                        .formats()
                        .patch_row_format(row, format.clone(), clear_fields.clone())
                        .map_err(FormatDimensionsError::from)?;
                }
                Ok(())
            }
            RangeAddress::Columns { start, end } => {
                for column in *start..=*end {
                    self.dimensions
                        .sheet
                        .formats()
                        .patch_col_format(*column, format.clone(), clear_fields.clone())
                        .map_err(FormatDimensionsError::from)?;
                }
                Ok(())
            }
            RangeAddress::WholeSheet => Err(FormatDimensionsError::unsupported(
                "Whole-worksheet format patches require a row or column range",
            )),
            RangeAddress::Cells { .. } => Err(FormatDimensionsError::unsupported(
                "Sparse format patches require a full row or column range",
            )),
        }
    }

    pub(crate) fn dimensions(&self) -> &FormatDimensionsRef {
        &self.dimensions
    }
}

/// Convert one Office.js scalar to a sparse `CellFormat` patch.  The JSON
/// boundary lets this adapter use compute-api's public typed methods without
/// importing a private engine format type.
fn sparse_property_patch(
    kind: &str,
    property: &str,
    value: &Value,
) -> Result<(Value, Vec<String>), FormatDimensionsError> {
    if kind == "fill" && property == "clear" {
        return Ok((
            json!({}),
            vec![
                "backgroundColor".to_string(),
                "backgroundColorTint".to_string(),
                "patternType".to_string(),
                "patternForegroundColor".to_string(),
                "patternForegroundColorTint".to_string(),
                "gradientFill".to_string(),
            ],
        ));
    }
    if value.is_null() {
        return Err(FormatDimensionsError::invalid(format!(
            "{property} cannot be null"
        )));
    }

    let (field, value) = match (kind, property) {
        ("format", "horizontalAlignment") => (
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
        ("format", "verticalAlignment") => (
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
        ("format", "wrapText") => ("wrapText", boolean(value, property)?),
        ("format", "autoIndent") => ("autoIndent", boolean(value, property)?),
        ("format", "indentLevel") => {
            let indent = integer(value, property)?;
            if !(0..=250).contains(&indent) {
                return Err(FormatDimensionsError::invalid(
                    "indentLevel must be between 0 and 250",
                ));
            }
            ("indent", json!(indent))
        }
        ("format", "shrinkToFit") => ("shrinkToFit", boolean(value, property)?),
        ("format", "textOrientation") => {
            let orientation = integer(value, property)?;
            if !((-90..=90).contains(&orientation) || orientation == 180) {
                return Err(FormatDimensionsError::invalid(
                    "textOrientation must be -90 through 90, or 180",
                ));
            }
            ("textRotation", json!(orientation))
        }
        ("format", "readingOrder") => (
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
        ("font", "bold") => ("bold", boolean(value, property)?),
        ("font", "color") => ("fontColor", non_empty_string(value, property)?),
        ("font", "italic") => ("italic", boolean(value, property)?),
        ("font", "name") => {
            let name = value
                .as_str()
                .ok_or_else(|| FormatDimensionsError::invalid("name must be a string"))?;
            if name.is_empty() || name.chars().count() > 31 {
                return Err(FormatDimensionsError::invalid(
                    "name must contain 1 through 31 characters",
                ));
            }
            ("fontFamily", json!(name))
        }
        ("font", "size") => {
            let size = finite_number(value, property)?;
            if !(1.0..=409.0).contains(&size) {
                return Err(FormatDimensionsError::invalid(
                    "size must be between 1 and 409 points",
                ));
            }
            ("fontSize", json!(size))
        }
        ("font", "underline") => (
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
        ("font", "strikethrough") => ("strikethrough", boolean(value, property)?),
        ("font", "subscript") => ("subscript", boolean(value, property)?),
        ("font", "superscript") => ("superscript", boolean(value, property)?),
        ("font", "tintAndShade") => ("fontColorTint", bounded_tint(value, property)?),
        ("fill", "color") => ("backgroundColor", non_empty_string(value, property)?),
        ("fill", "pattern") => (
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
        ("fill", "patternColor") => ("patternForegroundColor", non_empty_string(value, property)?),
        ("fill", "patternTintAndShade") => {
            ("patternForegroundColorTint", bounded_tint(value, property)?)
        }
        ("fill", "tintAndShade") => ("backgroundColorTint", bounded_tint(value, property)?),
        ("protection", "locked") => ("locked", boolean(value, property)?),
        ("protection", "formulaHidden") => ("hidden", boolean(value, property)?),
        _ => {
            return Err(FormatDimensionsError::unsupported(format!(
                "Unsupported sparse {kind}.{property} property"
            )));
        }
    };

    let mut patch = Map::new();
    patch.insert(field.to_string(), value);
    Ok((Value::Object(patch), Vec::new()))
}

fn enum_value(
    value: &Value,
    property: &str,
    mappings: &[(&str, &str)],
) -> Result<Value, FormatDimensionsError> {
    let token = value.as_str().ok_or_else(|| {
        FormatDimensionsError::invalid(format!("{property} must be a string enum value"))
    })?;
    mappings
        .iter()
        .find_map(|(office, internal)| (*office == token).then(|| json!(internal)))
        .ok_or_else(|| {
            FormatDimensionsError::invalid(format!("Unsupported {property} value '{token}'"))
        })
}

fn boolean(value: &Value, property: &str) -> Result<Value, FormatDimensionsError> {
    value
        .as_bool()
        .map(Value::Bool)
        .ok_or_else(|| FormatDimensionsError::invalid(format!("{property} must be a boolean")))
}

fn non_empty_string(value: &Value, property: &str) -> Result<Value, FormatDimensionsError> {
    let value = value
        .as_str()
        .ok_or_else(|| FormatDimensionsError::invalid(format!("{property} must be a string")))?;
    if value.is_empty() {
        return Err(FormatDimensionsError::invalid(format!(
            "{property} cannot be empty"
        )));
    }
    Ok(json!(value))
}

fn finite_number(value: &Value, property: &str) -> Result<f64, FormatDimensionsError> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| {
            FormatDimensionsError::invalid(format!("{property} must be a finite number"))
        })
}

fn integer(value: &Value, property: &str) -> Result<i64, FormatDimensionsError> {
    let number = finite_number(value, property)?;
    if number.fract() != 0.0 || number < i64::MIN as f64 || number > i64::MAX as f64 {
        return Err(FormatDimensionsError::invalid(format!(
            "{property} must be an integer"
        )));
    }
    Ok(number as i64)
}

fn bounded_tint(value: &Value, property: &str) -> Result<Value, FormatDimensionsError> {
    let tint = finite_number(value, property)?;
    if !(-1.0..=1.0).contains(&tint) {
        return Err(FormatDimensionsError::invalid(format!(
            "{property} must be between -1 and 1"
        )));
    }
    Ok(json!(tint))
}
