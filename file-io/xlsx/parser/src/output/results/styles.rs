use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentOutput {
    /// Horizontal alignment (ECMA-376 ST_HorizontalAlignment). Serializes as
    /// OOXML tokens like `"left"`, `"center"`, `"right"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<HorizontalAlign>,
    /// Vertical alignment (ECMA-376 ST_VerticalAlignment). Serializes as
    /// OOXML tokens like `"top"`, `"center"`, `"bottom"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<VerticalAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    /// Text rotation (0-180, or 255 for stacked/vertical text per ECMA-376
    /// §18.8.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_rotation: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shrink_to_fit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_indent: Option<bool>,
    /// Relative indent adjustment (ECMA-376 CT_CellAlignment/@relativeIndent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_indent: Option<i32>,
    /// Whether to justify the last line (ECMA-376 CT_CellAlignment/@justifyLastLine).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub justify_last_line: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellProtectionOutput {
    pub locked: bool,
    pub hidden: bool,
}

use crate::domain::styles::types::{
    BorderDef, BorderSideDef, CellStyleDef, CellXfDef, ColorDef, FillDef, FontDef, Stylesheet,
};

/// Structured styles output matching the TS `ParsedStyles` interface.
/// Replaces the old `build_styles_json()` string approach with proper
/// serde camelCase serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylesOutput {
    pub number_formats: Vec<NumberFormatOutput>,
    pub fonts: Vec<FontOutput>,
    pub fills: Vec<FillOutput>,
    pub borders: Vec<BorderOutput>,
    pub cell_xfs: Vec<CellXfOutput>,
    pub cell_style_xfs: Vec<CellXfOutput>,
    pub cell_styles: Vec<CellStyleOutput>,
    /// Whether the `x14ac:knownFonts` attribute was set on the `<fonts>` element.
    /// Indicates the producing application verified all fonts are available.
    #[serde(skip_serializing_if = "is_false")]
    pub known_fonts: bool,
    /// Raw FontDef data for round-trip fidelity (preserves Option<bool> for bold/italic).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_fonts: Vec<FontDef>,
    /// Raw CellXfDef data for round-trip fidelity (preserves Option<bool> for apply* flags).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_cell_xfs: Vec<CellXfDef>,
    /// Raw CellXfDef data for round-trip fidelity (preserves Option<bool> for apply* flags).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_cell_style_xfs: Vec<CellXfDef>,
    /// Default table style name for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub default_table_style: Option<String>,
    /// Default pivot table style name for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub default_pivot_style: Option<String>,
    /// Raw DxfDef data for round-trip fidelity (differential formatting records).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_dxfs: Vec<crate::domain::styles::types::DxfDef>,
    /// Raw ColorsDef for round-trip fidelity (custom color palette).
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_colors: Option<crate::domain::styles::types::ColorsDef>,
    /// Raw TableStyleDef data for round-trip fidelity.
    /// Not serialized to TypeScript — used only by the write path.
    #[serde(skip)]
    pub raw_table_styles: Vec<crate::domain::styles::types::TableStyleDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NumberFormatOutput {
    pub id: u32,
    pub format_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indexed: Option<u32>,
    #[serde(skip_serializing_if = "is_false")]
    pub auto: bool,
    /// Original tint string for round-trip fidelity (preserves scientific notation).
    /// Not serialized to TypeScript — internal round-trip data only.
    #[serde(skip)]
    pub raw_tint: Option<String>,
}

impl From<&ColorDef> for ColorOutput {
    fn from(c: &ColorDef) -> Self {
        fn parse_tint(t: &Option<String>) -> Option<f64> {
            t.as_deref().and_then(|s| s.parse::<f64>().ok())
        }
        match c {
            ColorDef::Theme { id, tint } => Self {
                rgb: None,
                theme: Some(*id),
                tint: parse_tint(tint),
                indexed: None,
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Rgb { val, tint } => Self {
                rgb: Some(val.clone()),
                theme: None,
                tint: parse_tint(tint),
                indexed: None,
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Indexed { id, tint } => Self {
                rgb: None,
                theme: None,
                tint: parse_tint(tint),
                indexed: Some(*id),
                auto: false,
                raw_tint: tint.clone(),
            },
            ColorDef::Auto { tint } => Self {
                rgb: None,
                theme: None,
                tint: parse_tint(tint),
                indexed: None,
                auto: true,
                raw_tint: tint.clone(),
            },
        }
    }
}

/// Serde helper: serialize an ooxml-types enum via `to_ooxml()`.
mod serde_ooxml_output {
    use serde::Serializer;

    pub mod opt_underline_style {
        use super::*;
        use crate::domain::styles::types::UnderlineStyle;

        pub fn serialize<S: Serializer>(
            val: &Option<UnderlineStyle>,
            ser: S,
        ) -> Result<S::Ok, S::Error> {
            match val {
                Some(u) => ser.serialize_str(u.to_ooxml()),
                None => ser.serialize_str("none"),
            }
        }
    }

    pub mod pattern_type {
        use super::*;
        use crate::domain::styles::types::PatternType;

        pub fn serialize<S: Serializer>(val: &PatternType, ser: S) -> Result<S::Ok, S::Error> {
            ser.serialize_str(val.to_ooxml())
        }
    }

    pub mod border_style {
        use super::*;
        use crate::domain::styles::types::BorderStyle;

        pub fn serialize<S: Serializer>(val: &BorderStyle, ser: S) -> Result<S::Ok, S::Error> {
            ser.serialize_str(val.to_ooxml())
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontOutput {
    pub name: String,
    pub size: f64,
    pub bold: bool,
    pub italic: bool,
    #[serde(serialize_with = "serde_ooxml_output::opt_underline_style::serialize")]
    pub underline: Option<UnderlineStyle>,
    pub strikethrough: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ColorOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condense: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extend: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
}

impl From<&FontDef> for FontOutput {
    fn from(f: &FontDef) -> Self {
        Self {
            name: f.name.clone().unwrap_or_default(),
            size: f.size.unwrap_or(0.0),
            bold: f.bold.unwrap_or(false),
            italic: f.italic.unwrap_or(false),
            underline: f.underline,
            strikethrough: f.strikethrough.unwrap_or(false),
            color: f.color.as_ref().map(ColorOutput::from),
            family: f.family,
            scheme: f.scheme.map(|s| s.to_ooxml().to_string()),
            vert_align: f.vert_align.map(|v| v.to_ooxml().to_string()),
            condense: f.condense,
            extend: f.extend,
            outline: f.outline,
            shadow: f.shadow,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillOutput {
    /// Fill type — "pattern" or "gradient"
    #[serde(rename = "type")]
    pub fill_type: String,
    #[serde(serialize_with = "serde_ooxml_output::pattern_type::serialize")]
    pub pattern_type: PatternType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg_color: Option<ColorOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<ColorOutput>,
    /// Gradient fill data (only present when fill_type == "gradient").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient: Option<GradientFillOutput>,
}

/// Gradient fill output for serialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientFillOutput {
    /// "linear" or "path".
    pub gradient_type: String,
    /// Angle in degrees for linear gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degree: Option<f64>,
    /// Color stops.
    pub stops: Vec<GradientStopOutput>,
    /// Fill-to rectangle boundaries for path gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<f64>,
}

/// A gradient color stop for output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientStopOutput {
    /// Position along gradient (0.0 to 1.0).
    pub position: f64,
    /// Color at this position.
    pub color: ColorOutput,
}

impl From<&FillDef> for FillOutput {
    fn from(f: &FillDef) -> Self {
        match f {
            FillDef::None => Self {
                fill_type: "pattern".to_string(),
                pattern_type: PatternType::None,
                fg_color: None,
                bg_color: None,
                gradient: None,
            },
            FillDef::Solid { fg_color } => Self {
                fill_type: "pattern".to_string(),
                pattern_type: PatternType::Solid,
                fg_color: Some(ColorOutput::from(fg_color)),
                bg_color: None,
                gradient: None,
            },
            FillDef::Pattern {
                pattern_type,
                fg_color,
                bg_color,
            } => Self {
                fill_type: "pattern".to_string(),
                pattern_type: pattern_type.unwrap_or(PatternType::None),
                fg_color: fg_color.as_ref().map(ColorOutput::from),
                bg_color: bg_color.as_ref().map(ColorOutput::from),
                gradient: None,
            },
            FillDef::Gradient {
                gradient_type,
                degree,
                stops,
                left,
                right,
                top,
                bottom,
            } => Self {
                fill_type: "gradient".to_string(),
                pattern_type: PatternType::None,
                fg_color: None,
                bg_color: None,
                gradient: Some(GradientFillOutput {
                    gradient_type: match gradient_type {
                        crate::domain::styles::types::GradientType::Linear => "linear".to_string(),
                        crate::domain::styles::types::GradientType::Path => "path".to_string(),
                    },
                    degree: *degree,
                    stops: stops
                        .iter()
                        .map(|s| GradientStopOutput {
                            position: s.position,
                            color: ColorOutput::from(&s.color),
                        })
                        .collect(),
                    left: *left,
                    right: *right,
                    top: *top,
                    bottom: *bottom,
                }),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderSideOutput {
    #[serde(serialize_with = "serde_ooxml_output::border_style::serialize")]
    pub style: crate::domain::styles::types::BorderStyle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<ColorOutput>,
}

impl From<&BorderSideDef> for BorderSideOutput {
    fn from(s: &BorderSideDef) -> Self {
        Self {
            style: s.style,
            color: s.color.as_ref().map(ColorOutput::from),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSideOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal: Option<BorderSideOutput>,
    /// `None` = `@diagonalUp` absent on the OOXML element; `Some(bool)` =
    /// explicit attribute value. Distinguishing absent from `Some(false)`
    /// is required for styles-blob round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_up: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_down: Option<bool>,
}

impl From<&BorderDef> for BorderOutput {
    fn from(b: &BorderDef) -> Self {
        Self {
            left: b.left.as_ref().map(BorderSideOutput::from),
            right: b.right.as_ref().map(BorderSideOutput::from),
            top: b.top.as_ref().map(BorderSideOutput::from),
            bottom: b.bottom.as_ref().map(BorderSideOutput::from),
            diagonal: b.diagonal.as_ref().map(BorderSideOutput::from),
            diagonal_up: b.diagonal_up,
            diagonal_down: b.diagonal_down,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellXfOutput {
    /// TS expects `numFmtId`, not `numberFormatId`
    #[serde(rename = "numFmtId")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_number_format: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_font: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_fill: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_border: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xf_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_alignment: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<AlignmentOutput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_protection: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection: Option<CellProtectionOutput>,
    #[serde(skip_serializing_if = "is_false")]
    pub quote_prefix: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub pivot_button: bool,
}

impl From<&CellXfDef> for CellXfOutput {
    fn from(xf: &CellXfDef) -> Self {
        Self {
            number_format_id: xf.num_fmt_id,
            font_id: xf.font_id,
            fill_id: xf.fill_id,
            border_id: xf.border_id,
            apply_number_format: xf.apply_number_format,
            apply_font: xf.apply_font,
            apply_fill: xf.apply_fill,
            apply_border: xf.apply_border,
            xf_id: xf.xf_id,
            apply_alignment: xf.apply_alignment,
            alignment: xf.alignment.as_ref().map(|a| AlignmentOutput {
                horizontal: a.horizontal,
                vertical: a.vertical,
                // Preserve `Some(false)` as well as `Some(true)` — collapsing
                // explicit-false to absent loses the inheritance override.
                wrap_text: a.wrap_text,
                text_rotation: a.text_rotation.map(|v| v as u16),
                indent: a.indent,
                shrink_to_fit: a.shrink_to_fit,
                reading_order: a.reading_order,
                auto_indent: a.auto_indent,
                relative_indent: a.relative_indent,
                justify_last_line: a.justify_last_line,
            }),
            apply_protection: xf.apply_protection,
            protection: xf.protection.as_ref().map(|p| CellProtectionOutput {
                locked: p.locked.unwrap_or(true),
                hidden: p.hidden.unwrap_or(false),
            }),
            quote_prefix: xf.quote_prefix,
            pivot_button: xf.pivot_button,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellStyleOutput {
    pub name: Option<String>,
    pub xf_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_builtin: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
    /// Revision UID (xr:uid attribute) for co-authoring / revision tracking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
}

impl From<&CellStyleDef> for CellStyleOutput {
    fn from(cs: &CellStyleDef) -> Self {
        Self {
            name: cs.name.clone(),
            xf_id: cs.xf_id,
            builtin_id: cs.builtin_id,
            custom_builtin: cs.custom_builtin,
            i_level: cs.i_level,
            hidden: cs.hidden,
            xr_uid: cs.xr_uid.clone(),
        }
    }
}

impl From<&Stylesheet> for StylesOutput {
    fn from(s: &Stylesheet) -> Self {
        Self {
            number_formats: s
                .num_fmts
                .iter()
                .map(|nf| NumberFormatOutput {
                    id: nf.id,
                    format_code: nf.format_code.clone(),
                })
                .collect(),
            fonts: s.fonts.iter().map(FontOutput::from).collect(),
            fills: s.fills.iter().map(FillOutput::from).collect(),
            borders: s.borders.iter().map(BorderOutput::from).collect(),
            cell_xfs: s.cell_xfs.iter().map(CellXfOutput::from).collect(),
            cell_style_xfs: s.cell_style_xfs.iter().map(CellXfOutput::from).collect(),
            cell_styles: s.cell_styles.iter().map(CellStyleOutput::from).collect(),
            // known_fonts is parsed separately from the <fonts> element attribute,
            // not from Stylesheet. Default to false here; caller sets it explicitly.
            known_fonts: false,
            raw_fonts: Vec::new(),
            raw_cell_xfs: Vec::new(),
            raw_cell_style_xfs: Vec::new(),
            default_table_style: s.default_table_style.clone(),
            default_pivot_style: s.default_pivot_style.clone(),
            raw_dxfs: s.dxfs.clone(),
            raw_colors: s.colors.clone(),
            raw_table_styles: s.table_styles.clone(),
        }
    }
}

// =============================================================================
// Print Settings Conversion
// =============================================================================
