//! Canonical cell formatting types.
//!
//! `CellFormat` is the single source of truth for cell visual formatting
//! across the entire Rust layer stack (XLSX parse, Yrs storage, runtime,
//! export). All fields are `Option<T>` for sparse representation and
//! format-inheritance merging.

use ooxml_types::styles::{
    BorderStyle, HorizontalAlign as OoxmlHorizontalAlign, PatternType as OoxmlPatternType,
    UnderlineStyle, VerticalAlign as OoxmlVerticalAlign,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

// ---------------------------------------------------------------------------
// FontSize newtype — compile-time unit safety for millipoints vs points
// ---------------------------------------------------------------------------

/// Font size with explicit millipoint storage and point-based serde.
///
/// Internal representation is millipoints (u32) for sub-point precision.
/// Serde serializes as **points** (f64) for IPC/JSON compatibility.
/// Deserialization auto-detects legacy millipoint values (>= 1000) vs points.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FontSize(u32); // millipoints

impl FontSize {
    /// Construct from raw millipoints (e.g. 11000 for 11pt).
    pub fn from_millipoints(mp: u32) -> Self {
        Self(mp)
    }

    /// Construct from points (e.g. 11.0 for 11pt).
    pub fn from_points(pt: f64) -> Self {
        Self((pt * 1000.0).round() as u32)
    }

    /// Get the raw millipoint value.
    pub fn millipoints(self) -> u32 {
        self.0
    }

    /// Get the point value (e.g. 11.0 for 11pt).
    pub fn points(self) -> f64 {
        self.0 as f64 / 1000.0
    }
}

impl std::fmt::Display for FontSize {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}pt", self.points())
    }
}

impl From<f64> for FontSize {
    fn from(pt: f64) -> Self {
        Self::from_points(pt)
    }
}

impl From<FontSize> for f64 {
    fn from(fs: FontSize) -> Self {
        fs.points()
    }
}

impl PartialOrd for FontSize {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for FontSize {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.cmp(&other.0)
    }
}

impl Serialize for FontSize {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_f64(self.points())
    }
}

impl<'de> Deserialize<'de> for FontSize {
    /// Deserialize with auto-detection: values >= 1000 are legacy millipoints,
    /// values < 1000 are points. Safe because max Excel font = 409pt, min
    /// millipoint for 1pt = 1000 — the ranges don't overlap.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let v = f64::deserialize(deserializer)?;
        if v >= 1000.0 {
            // Legacy millipoints (e.g. 11000 → 11pt)
            Ok(FontSize(v.round() as u32))
        } else {
            // Points (e.g. 11.0 → 11000 millipoints)
            Ok(FontSize((v * 1000.0).round() as u32))
        }
    }
}

// ---------------------------------------------------------------------------
// CellVerticalAlign — kernel/API vocabulary, distinct from OOXML
// ---------------------------------------------------------------------------

/// Vertical cell alignment in the kernel/API contract.
///
/// OOXML names the vertical center token `"center"`. Mog's kernel/API uses
/// `"middle"` for the same concept, matching the UI/rendering vocabulary.
/// Convert at XLSX boundaries with [`Self::from_ooxml_token`] and
/// [`Self::to_ooxml`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CellVerticalAlign {
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "middle")]
    Middle,
    #[serde(rename = "bottom")]
    #[default]
    Bottom,
    #[serde(rename = "justify")]
    Justify,
    #[serde(rename = "distributed")]
    Distributed,
}

impl CellVerticalAlign {
    pub fn from_kernel_token(s: &str) -> Option<Self> {
        Some(match s {
            "top" => Self::Top,
            "middle" => Self::Middle,
            "bottom" => Self::Bottom,
            "justify" => Self::Justify,
            "distributed" => Self::Distributed,
            _ => return None,
        })
    }

    pub fn to_kernel_token(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Middle => "middle",
            Self::Bottom => "bottom",
            Self::Justify => "justify",
            Self::Distributed => "distributed",
        }
    }

    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "top" => Self::Top,
            "center" => Self::Middle,
            "bottom" => Self::Bottom,
            "justify" => Self::Justify,
            "distributed" => Self::Distributed,
            _ => return None,
        })
    }

    pub fn to_ooxml(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Middle => "center",
            Self::Bottom => "bottom",
            Self::Justify => "justify",
            Self::Distributed => "distributed",
        }
    }

    pub fn to_ooxml_align(self) -> OoxmlVerticalAlign {
        match self {
            Self::Top => OoxmlVerticalAlign::Top,
            Self::Middle => OoxmlVerticalAlign::Center,
            Self::Bottom => OoxmlVerticalAlign::Bottom,
            Self::Justify => OoxmlVerticalAlign::Justify,
            Self::Distributed => OoxmlVerticalAlign::Distributed,
        }
    }
}

impl From<OoxmlVerticalAlign> for CellVerticalAlign {
    fn from(value: OoxmlVerticalAlign) -> Self {
        match value {
            OoxmlVerticalAlign::Top => Self::Top,
            OoxmlVerticalAlign::Center => Self::Middle,
            OoxmlVerticalAlign::Bottom => Self::Bottom,
            OoxmlVerticalAlign::Justify => Self::Justify,
            OoxmlVerticalAlign::Distributed => Self::Distributed,
        }
    }
}

// ---------------------------------------------------------------------------
// CellBorderSide / CellBorders — ECMA-376 border model
// ---------------------------------------------------------------------------

/// A single border edge (style + color).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellBorderSide {
    /// Border line style (ECMA-376 ST_BorderStyle). Serializes as OOXML
    /// tokens like `"thin"`, `"medium"`, `"dashed"` — byte-identical to
    /// the legacy `Option<String>` wire format.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<BorderStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Tint modifier for border color (-1.0 to +1.0, ECMA-376).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
}

/// Manual `Eq` impl: treats NaN-bit-identical f64 fields as equal via `to_bits()`.
impl Eq for CellBorderSide {}

impl std::hash::Hash for CellBorderSide {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.style.hash(state);
        self.color.hash(state);
        match &self.color_tint {
            Some(f) => {
                1u8.hash(state);
                f.to_bits().hash(state);
            }
            None => 0u8.hash(state),
        }
    }
}

/// Full border specification for a cell (ECMA-376 §18.8.4).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellBorders {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_up: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_down: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<CellBorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
}

// ---------------------------------------------------------------------------
// CellFormat — the unified cell formatting struct
// ---------------------------------------------------------------------------

/// Cell format properties (visual formatting).
///
/// All fields are optional so that partial formats can be stored and merged.
/// Matches the TypeScript `CellFormat` contract with snake_case field names
/// serialized as camelCase for JSON compatibility.
///
/// Field groups follow ECMA-376 §18.8.1 (xf) structure:
/// font, alignment, number format, fill, border, protection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CellFormat {
    // -- Font properties ---------------------------------------------------
    /// Font family name (e.g. "Calibri").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    /// Font size. Internal millipoints, serialized as points for IPC.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<FontSize>,
    /// Font color as hex string (e.g. "#000000").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color: Option<String>,
    /// Font color tint modifier (-1.0 to +1.0). Applied on top of font_color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_color_tint: Option<f64>,
    /// Whether text is bold.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    /// Whether text is italic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underline style (ECMA-376 ST_UnderlineValues). Serializes as OOXML
    /// tokens like `"none"`, `"single"`, `"double"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline_type: Option<UnderlineStyle>,
    /// Whether text has strikethrough.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    /// Superscript vertical alignment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superscript: Option<bool>,
    /// Subscript vertical alignment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscript: Option<bool>,
    /// Font outline effect (ECMA-376 §18.8.23).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_outline: Option<bool>,
    /// Font shadow effect (ECMA-376 §18.8.36).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_shadow: Option<bool>,
    /// Theme font reference (e.g. "major", "minor").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_theme: Option<String>,
    /// Font character set (ECMA-376 §18.8.6).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_charset: Option<u32>,
    /// Font family type / pitch family (ECMA-376 §18.8.18).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family_type: Option<u32>,

    // -- Alignment properties ----------------------------------------------
    /// Horizontal alignment (ECMA-376 ST_HorizontalAlignment). Serializes as
    /// OOXML tokens like `"general"`, `"left"`, `"center"`, `"right"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_align: Option<OoxmlHorizontalAlign>,
    /// Vertical alignment in the kernel/API vocabulary. Serializes as
    /// `"top"`, `"middle"`, `"bottom"`, `"justify"`, or `"distributed"`.
    /// XLSX import/export maps `"middle"` to OOXML `"center"` at the boundary.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<CellVerticalAlign>,
    /// Whether text wraps within the cell.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    /// Text indent level.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<u32>,
    /// Text rotation angle in degrees.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_rotation: Option<i32>,
    /// Shrink text to fit cell width (ECMA-376 §18.8.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shrink_to_fit: Option<bool>,
    /// Reading order for bidirectional text (e.g. "context", "ltr", "rtl").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<String>,
    /// Auto-indent flag (ECMA-376 CT_CellAlignment/@autoIndent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_indent: Option<bool>,

    // -- Number format -----------------------------------------------------
    /// Number format string (e.g. "0.00", "#,##0").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,

    // -- Fill properties ---------------------------------------------------
    /// Background fill color as hex string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    /// Background color tint modifier (-1.0 to +1.0). Applied on top of background_color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color_tint: Option<f64>,
    /// Pattern fill type (ECMA-376 ST_PatternType). Serializes as OOXML
    /// tokens like `"solid"`, `"gray125"`, `"none"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_type: Option<OoxmlPatternType>,
    /// Pattern foreground color as hex string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_foreground_color: Option<String>,
    /// Pattern foreground color tint modifier (-1.0 to +1.0).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_foreground_color_tint: Option<f64>,
    /// Gradient fill specification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient_fill: Option<crate::GradientFillFormat>,

    // -- Border properties -------------------------------------------------
    /// Full border specification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<CellBorders>,

    // -- Protection properties ---------------------------------------------
    /// Whether the cell is locked for protection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    /// Whether the cell formula is hidden when protected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Quote prefix flag (ECMA-376 §18.8.1, quotePrefix attribute).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_prefix: Option<bool>,
}

/// Manual `Eq` impl: treats NaN-bit-identical f64 fields as equal via `to_bits()`.
impl Eq for CellFormat {}

impl std::hash::Hash for CellFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        // Helper: hash an Option<f64> by its bit pattern.
        fn hash_opt_f64<H: std::hash::Hasher>(v: &Option<f64>, state: &mut H) {
            match v {
                Some(f) => {
                    1u8.hash(state);
                    f.to_bits().hash(state);
                }
                None => 0u8.hash(state),
            }
        }

        self.font_family.hash(state);
        self.font_size.hash(state);
        self.font_color.hash(state);
        hash_opt_f64(&self.font_color_tint, state);
        self.bold.hash(state);
        self.italic.hash(state);
        self.underline_type.hash(state);
        self.strikethrough.hash(state);
        self.superscript.hash(state);
        self.subscript.hash(state);
        self.font_outline.hash(state);
        self.font_shadow.hash(state);
        self.font_theme.hash(state);
        self.font_charset.hash(state);
        self.font_family_type.hash(state);
        self.horizontal_align.hash(state);
        self.vertical_align.hash(state);
        self.wrap_text.hash(state);
        self.indent.hash(state);
        self.text_rotation.hash(state);
        self.shrink_to_fit.hash(state);
        self.reading_order.hash(state);
        self.auto_indent.hash(state);
        self.number_format.hash(state);
        self.background_color.hash(state);
        hash_opt_f64(&self.background_color_tint, state);
        self.pattern_type.hash(state);
        self.pattern_foreground_color.hash(state);
        hash_opt_f64(&self.pattern_foreground_color_tint, state);
        self.gradient_fill.hash(state);
        self.borders.hash(state);
        self.locked.hash(state);
        self.hidden.hash(state);
        self.quote_prefix.hash(state);
    }
}

// ---------------------------------------------------------------------------
// ResolvedCellFormat — dense representation for the API read path
// ---------------------------------------------------------------------------

/// Dense cell format for the API read path.
///
/// Mirrors [`CellFormat`] exactly but **does not** use `skip_serializing_if`,
/// so `None` fields serialize as JSON `null` rather than being omitted.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCellFormat {
    // -- Font properties ---------------------------------------------------
    pub font_family: Option<String>,
    pub font_size: Option<FontSize>,
    pub font_color: Option<String>,
    pub font_color_tint: Option<f64>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline_type: Option<UnderlineStyle>,
    pub strikethrough: Option<bool>,
    pub superscript: Option<bool>,
    pub subscript: Option<bool>,
    pub font_outline: Option<bool>,
    pub font_shadow: Option<bool>,
    pub font_theme: Option<String>,
    pub font_charset: Option<u32>,
    pub font_family_type: Option<u32>,

    // -- Alignment properties ----------------------------------------------
    pub horizontal_align: Option<OoxmlHorizontalAlign>,
    pub vertical_align: Option<CellVerticalAlign>,
    pub wrap_text: Option<bool>,
    pub indent: Option<u32>,
    pub text_rotation: Option<i32>,
    pub shrink_to_fit: Option<bool>,
    pub reading_order: Option<String>,
    pub auto_indent: Option<bool>,

    // -- Number format -----------------------------------------------------
    pub number_format: Option<String>,

    // -- Fill properties ---------------------------------------------------
    pub background_color: Option<String>,
    pub background_color_tint: Option<f64>,
    pub pattern_type: Option<OoxmlPatternType>,
    pub pattern_foreground_color: Option<String>,
    pub pattern_foreground_color_tint: Option<f64>,
    pub gradient_fill: Option<crate::GradientFillFormat>,

    // -- Border properties -------------------------------------------------
    pub borders: Option<CellBorders>,

    // -- Protection properties ---------------------------------------------
    pub locked: Option<bool>,
    pub hidden: Option<bool>,
    pub quote_prefix: Option<bool>,
}

impl From<CellFormat> for ResolvedCellFormat {
    fn from(cf: CellFormat) -> Self {
        Self {
            font_family: cf.font_family,
            font_size: cf.font_size,
            font_color: cf.font_color,
            font_color_tint: cf.font_color_tint,
            bold: cf.bold,
            italic: cf.italic,
            underline_type: cf.underline_type,
            strikethrough: cf.strikethrough,
            superscript: cf.superscript,
            subscript: cf.subscript,
            font_outline: cf.font_outline,
            font_shadow: cf.font_shadow,
            font_theme: cf.font_theme,
            font_charset: cf.font_charset,
            font_family_type: cf.font_family_type,
            horizontal_align: cf.horizontal_align,
            vertical_align: cf.vertical_align,
            wrap_text: cf.wrap_text,
            indent: cf.indent,
            text_rotation: cf.text_rotation,
            shrink_to_fit: cf.shrink_to_fit,
            reading_order: cf.reading_order,
            auto_indent: cf.auto_indent,
            number_format: cf.number_format,
            background_color: cf.background_color,
            background_color_tint: cf.background_color_tint,
            pattern_type: cf.pattern_type,
            pattern_foreground_color: cf.pattern_foreground_color,
            pattern_foreground_color_tint: cf.pattern_foreground_color_tint,
            gradient_fill: cf.gradient_fill,
            borders: cf.borders,
            locked: cf.locked,
            hidden: cf.hidden,
            quote_prefix: cf.quote_prefix,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Ensures `CellFormat` and `ResolvedCellFormat` have identical JSON key
    /// sets. If someone adds a field to one struct but not the other, this test
    /// will fail.
    #[test]
    fn resolved_cell_format_field_parity() {
        let cf = CellFormat {
            font_family: Some("Calibri".into()),
            font_size: Some(FontSize::from_millipoints(11000)),
            font_color: Some("#000000".into()),
            font_color_tint: Some(0.4),
            bold: Some(true),
            italic: Some(false),
            underline_type: Some(UnderlineStyle::Single),
            strikethrough: Some(false),
            superscript: Some(false),
            subscript: Some(false),
            font_outline: Some(false),
            font_shadow: Some(false),
            font_theme: Some("minor".into()),
            font_charset: Some(0),
            font_family_type: Some(2),
            horizontal_align: Some(OoxmlHorizontalAlign::Left),
            vertical_align: Some(CellVerticalAlign::Top),
            wrap_text: Some(false),
            indent: Some(0),
            text_rotation: Some(0),
            shrink_to_fit: Some(false),
            reading_order: Some("context".into()),
            auto_indent: Some(true),
            number_format: Some("0.00".into()),
            background_color: Some("#FFFFFF".into()),
            background_color_tint: Some(-0.25),
            pattern_type: Some(OoxmlPatternType::Solid),
            pattern_foreground_color: Some("#FFFFFF".into()),
            pattern_foreground_color_tint: Some(0.5),
            gradient_fill: Some(crate::GradientFillFormat {
                gradient_type: "linear".into(),
                degree: Some(90.0),
                center: None,
                stops: vec![],
            }),
            borders: Some(CellBorders::default()),
            locked: Some(true),
            hidden: Some(false),
            quote_prefix: Some(false),
        };

        let resolved: ResolvedCellFormat = cf.clone().into();

        let cf_json: serde_json::Value = serde_json::to_value(&cf).unwrap();
        let resolved_json: serde_json::Value = serde_json::to_value(&resolved).unwrap();

        let cf_keys: BTreeSet<&str> = cf_json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        let resolved_keys: BTreeSet<&str> = resolved_json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();

        assert_eq!(
            cf_keys,
            resolved_keys,
            "Field mismatch between CellFormat and ResolvedCellFormat.\n\
             Only in CellFormat: {:?}\n\
             Only in ResolvedCellFormat: {:?}",
            cf_keys.difference(&resolved_keys).collect::<Vec<_>>(),
            resolved_keys.difference(&cf_keys).collect::<Vec<_>>(),
        );

        // Guard against adding a field to CellFormat without populating it in this
        // test (skip_serializing_if would silently omit it, making both sides look equal).
        assert_eq!(
            cf_keys.len(),
            34,
            "Expected 34 CellFormat fields. If you added a field, update this count \
             AND add a Some(...) value above AND add it to ResolvedCellFormat.",
        );
    }
}
