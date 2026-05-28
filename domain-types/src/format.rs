use serde::{Deserialize, Serialize};

use crate::cell_format::{CellBorderSide, CellBorders, CellFormat, FontSize};

/// A fully-resolved cell format — the shared representation across parser, Yrs, and writer.
///
/// Replaces `ResolvedFormat` (import-only) and adds borders (currently dropped).
/// Colors are always resolved to "#RRGGBB" strings — no theme indices, no auto flag.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font: Option<FontFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<FillFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<BorderFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<AlignmentFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protection: Option<ProtectionFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quote_prefix: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivot_button: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFormat {
    /// Font family name (e.g. "Calibri", "Arial").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Font size in millipoints (11pt = 11_000).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
    /// Resolved RGB color as "#RRGGBB".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Raw tint modifier (-1.0 to +1.0) for font color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    /// Underline style: "single", "double", "singleAccounting", "doubleAccounting".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strikethrough: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superscript: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscript: Option<bool>,
    /// OOXML `<vertAlign>` token ("baseline", "superscript", "subscript").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condense: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extend: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charset: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<u32>,
    /// Font scheme: "major", "minor".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillFormat {
    /// Resolved RGB background color as "#RRGGBB".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    /// Raw tint modifier (-1.0 to +1.0) for background color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color_tint: Option<f64>,
    /// Pattern type: "solid", "gray125", etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_type: Option<String>,
    /// Resolved RGB pattern foreground color as "#RRGGBB".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_foreground_color: Option<String>,
    /// Raw tint modifier (-1.0 to +1.0) for pattern foreground color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern_foreground_color_tint: Option<f64>,
    /// Gradient fill specification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient_fill: Option<GradientFillFormat>,
}

/// Resolved gradient fill format with all colors as "#RRGGBB".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradientFillFormat {
    /// "linear" or "path".
    pub gradient_type: String,
    /// Angle in degrees for linear gradients (0-359).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub degree: Option<f64>,
    /// Center point for path gradients.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub center: Option<GradientCenter>,
    /// Color stops (at least 2).
    pub stops: Vec<GradientStopFormat>,
}

// Manual PartialEq/Eq/Hash using f64 bit representations for palette interning.
impl PartialEq for GradientFillFormat {
    fn eq(&self, other: &Self) -> bool {
        self.gradient_type == other.gradient_type
            && f64_opt_bits(self.degree) == f64_opt_bits(other.degree)
            && self.center == other.center
            && self.stops == other.stops
    }
}
impl Eq for GradientFillFormat {}
impl std::hash::Hash for GradientFillFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.gradient_type.hash(state);
        f64_opt_bits(self.degree).hash(state);
        self.center.hash(state);
        self.stops.hash(state);
    }
}

/// Center point for path (radial) gradients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientCenter {
    pub left: f64,
    pub top: f64,
}

impl PartialEq for GradientCenter {
    fn eq(&self, other: &Self) -> bool {
        self.left.to_bits() == other.left.to_bits() && self.top.to_bits() == other.top.to_bits()
    }
}
impl Eq for GradientCenter {}
impl std::hash::Hash for GradientCenter {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.left.to_bits().hash(state);
        self.top.to_bits().hash(state);
    }
}

/// A resolved gradient color stop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientStopFormat {
    /// Position along gradient (0.0 to 1.0).
    pub position: f64,
    /// Resolved color as "#RRGGBB".
    pub color: String,
}

impl PartialEq for GradientStopFormat {
    fn eq(&self, other: &Self) -> bool {
        self.position.to_bits() == other.position.to_bits() && self.color == other.color
    }
}
impl Eq for GradientStopFormat {}
impl std::hash::Hash for GradientStopFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.position.to_bits().hash(state);
        self.color.hash(state);
    }
}

fn f64_opt_bits(v: Option<f64>) -> Option<u64> {
    v.map(|f| f.to_bits())
}

// Manual Eq + Hash for FontFormat (has f64 field: color_tint)
impl Eq for FontFormat {}
impl std::hash::Hash for FontFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.name.hash(state);
        self.size.hash(state);
        self.color.hash(state);
        f64_opt_bits(self.color_tint).hash(state);
        self.bold.hash(state);
        self.italic.hash(state);
        self.underline.hash(state);
        self.strikethrough.hash(state);
        self.superscript.hash(state);
        self.subscript.hash(state);
        self.vertical_align.hash(state);
        self.condense.hash(state);
        self.extend.hash(state);
        self.outline.hash(state);
        self.shadow.hash(state);
        self.charset.hash(state);
        self.family.hash(state);
        self.scheme.hash(state);
    }
}

// Manual Eq + Hash for FillFormat (has f64 fields: background_color_tint, pattern_foreground_color_tint)
impl Eq for FillFormat {}
impl std::hash::Hash for FillFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.background_color.hash(state);
        f64_opt_bits(self.background_color_tint).hash(state);
        self.pattern_type.hash(state);
        self.pattern_foreground_color.hash(state);
        f64_opt_bits(self.pattern_foreground_color_tint).hash(state);
        self.gradient_fill.hash(state);
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderFormat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top: Option<BorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bottom: Option<BorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<BorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<BorderSide>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal: Option<BorderSide>,
    /// Diagonal up line (bottom-left → top-right). `None` = attribute absent
    /// on the OOXML element; `Some(bool)` = attribute present with that value.
    /// Distinguishing absent from explicit `false` is required for round-trip
    /// fidelity (ECMA-376 CT_Border/@diagonalUp).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_up: Option<bool>,
    /// Diagonal down line (top-left → bottom-right). `None` = attribute absent
    /// on the OOXML element; `Some(bool)` = attribute present with that value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagonal_down: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderSide {
    /// Border style: "thin", "medium", "thick", "dashed", "dotted", "double",
    /// "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot",
    /// "mediumDashDotDot", "slantDashDot".
    pub style: String,
    /// Resolved RGB color as "#RRGGBB".
    pub color: Option<String>,
    /// Raw tint modifier (-1.0 to +1.0) for border color.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
}

// Manual Eq + Hash for BorderSide (has f64: color_tint)
impl Eq for BorderSide {}
impl std::hash::Hash for BorderSide {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.style.hash(state);
        self.color.hash(state);
        f64_opt_bits(self.color_tint).hash(state);
    }
}

// BorderFormat: all fields are Eq+Hash now (BorderSide, Option<bool>)
impl Eq for BorderFormat {}
impl std::hash::Hash for BorderFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.top.hash(state);
        self.bottom.hash(state);
        self.left.hash(state);
        self.right.hash(state);
        self.diagonal.hash(state);
        self.diagonal_up.hash(state);
        self.diagonal_down.hash(state);
    }
}

// DocumentFormat: all sub-types now implement Eq+Hash
impl Eq for DocumentFormat {}
impl std::hash::Hash for DocumentFormat {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.font.hash(state);
        self.fill.hash(state);
        self.border.hash(state);
        self.number_format.hash(state);
        self.alignment.hash(state);
        self.protection.hash(state);
        self.quote_prefix.hash(state);
        self.pivot_button.hash(state);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentFormat {
    /// Horizontal alignment: "left", "center", "right", "fill", "justify",
    /// "centerContinuous", "distributed", "general".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal: Option<String>,
    /// Vertical alignment in the kernel/API vocabulary: "top", "middle",
    /// "bottom", "justify", "distributed".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_text: Option<bool>,
    /// Text rotation in degrees (0-180), or 255 for stacked / vertical text.
    /// Negative values are normalized to the 0-180 range on parse. ECMA-376
    /// CT_CellAlignment/@textRotation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shrink_to_fit: Option<bool>,
    /// Auto-indent flag (ECMA-376 CT_CellAlignment/@autoIndent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_indent: Option<bool>,
    /// Reading order token: `"context"` (0), `"ltr"` (1), `"rtl"` (2).
    /// ECMA-376 CT_CellAlignment/@readingOrder — the stored attribute is an
    /// integer, but we carry the token string to stay consistent with the
    /// `CellFormat` contract.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reading_order: Option<String>,
    /// Relative indent adjustment. ECMA-376 CT_CellAlignment/@relativeIndent
    /// (xsd:int).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_indent: Option<i32>,
    /// Whether to justify the last line of a distributed / justified
    /// alignment. ECMA-376 CT_CellAlignment/@justifyLastLine.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub justify_last_line: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectionFormat {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}

// ---------------------------------------------------------------------------
// Conversion helpers: BorderSide <-> CellBorderSide
// ---------------------------------------------------------------------------

fn border_side_to_format(side: &CellBorderSide) -> BorderSide {
    BorderSide {
        style: side
            .style
            .map(|s| s.to_ooxml().to_string())
            .unwrap_or_default(),
        color: side.color.clone(),
        color_tint: side.color_tint,
    }
}

fn border_side_from_format(side: &BorderSide) -> CellBorderSide {
    CellBorderSide {
        style: parse_doc_token(
            &side.style,
            "BorderSide.style",
            ooxml_types::styles::BorderStyle::from_ooxml_token,
        ),
        color: side.color.clone(),
        color_tint: side.color_tint,
    }
}

/// Strict OOXML-token parse for DocumentFormat → CellFormat conversions.
/// On unknown input, logs the offending token with context and returns
/// `None` so the field is unset. The DocumentFormat side still carries
/// `String` at the user/API boundary; this helper is the strict conversion
/// seam between it and the typed CellFormat.
fn parse_doc_token<E>(
    token: &str,
    field: &'static str,
    parser: impl FnOnce(&str) -> Option<E>,
) -> Option<E> {
    match parser(token) {
        Some(e) => Some(e),
        None => {
            tracing::warn!(
                field = field,
                token = token,
                "unknown OOXML token on DocumentFormat → CellFormat conversion; dropping field"
            );
            None
        }
    }
}

// ---------------------------------------------------------------------------
// From<&DocumentFormat> for CellFormat
// ---------------------------------------------------------------------------

impl From<&DocumentFormat> for CellFormat {
    fn from(doc: &DocumentFormat) -> Self {
        let font = doc.font.as_ref();
        let fill = doc.fill.as_ref();
        let align = doc.alignment.as_ref();
        let prot = doc.protection.as_ref();
        let border = doc.border.as_ref();

        let borders = border.map(|b| CellBorders {
            top: b.top.as_ref().map(border_side_from_format),
            bottom: b.bottom.as_ref().map(border_side_from_format),
            left: b.left.as_ref().map(border_side_from_format),
            right: b.right.as_ref().map(border_side_from_format),
            diagonal: b.diagonal.as_ref().map(border_side_from_format),
            diagonal_up: b.diagonal_up,
            diagonal_down: b.diagonal_down,
            ..Default::default()
        });

        CellFormat {
            // Font
            font_family: font.and_then(|f| f.name.clone()),
            font_size: font.and_then(|f| f.size.map(FontSize::from_millipoints)),
            font_color: font.and_then(|f| f.color.clone()),
            font_color_tint: font.and_then(|f| f.color_tint),
            bold: font.and_then(|f| f.bold),
            italic: font.and_then(|f| f.italic),
            // DocumentFormat side still carries OOXML tokens as Strings; parse
            // them back to the typed enum used by CellFormat. Strict: unknown
            // tokens log and drop the field rather than silently defaulting.
            underline_type: font.and_then(|f| f.underline.as_deref()).and_then(|s| {
                parse_doc_token(
                    s,
                    "Font.underline",
                    ooxml_types::styles::UnderlineStyle::from_ooxml_token,
                )
            }),
            strikethrough: font.and_then(|f| f.strikethrough),
            superscript: font.and_then(|f| f.superscript),
            subscript: font.and_then(|f| f.subscript),
            font_charset: font.and_then(|f| f.charset),
            font_family_type: font.and_then(|f| f.family),
            font_theme: font.and_then(|f| f.scheme.clone()),

            // Fill
            background_color: fill.and_then(|f| f.background_color.clone()),
            background_color_tint: fill.and_then(|f| f.background_color_tint),
            pattern_type: fill.and_then(|f| f.pattern_type.as_deref()).and_then(|s| {
                parse_doc_token(
                    s,
                    "Fill.pattern_type",
                    ooxml_types::styles::PatternType::from_ooxml_token,
                )
            }),
            pattern_foreground_color: fill.and_then(|f| f.pattern_foreground_color.clone()),
            pattern_foreground_color_tint: fill.and_then(|f| f.pattern_foreground_color_tint),
            gradient_fill: fill.and_then(|f| f.gradient_fill.clone()),

            // Alignment
            horizontal_align: align.and_then(|a| a.horizontal.as_deref()).and_then(|s| {
                parse_doc_token(
                    s,
                    "Alignment.horizontal",
                    ooxml_types::styles::HorizontalAlign::from_ooxml_token,
                )
            }),
            vertical_align: align.and_then(|a| a.vertical.as_deref()).and_then(|s| {
                parse_doc_token(
                    s,
                    "Alignment.vertical",
                    crate::CellVerticalAlign::from_kernel_token,
                )
            }),
            wrap_text: align.and_then(|a| a.wrap_text),
            text_rotation: align.and_then(|a| a.rotation),
            indent: align.and_then(|a| a.indent),
            shrink_to_fit: align.and_then(|a| a.shrink_to_fit),
            reading_order: align.and_then(|a| a.reading_order.clone()),
            auto_indent: align.and_then(|a| a.auto_indent),

            // Number format
            number_format: doc.number_format.clone(),

            // Borders
            borders,

            // Protection
            locked: prot.and_then(|p| p.locked),
            hidden: prot.and_then(|p| p.hidden),
            quote_prefix: doc.quote_prefix,

            ..Default::default()
        }
    }
}

// ---------------------------------------------------------------------------
// From<&CellFormat> for DocumentFormat
// ---------------------------------------------------------------------------

impl From<&CellFormat> for DocumentFormat {
    fn from(cf: &CellFormat) -> Self {
        // Font: check if any font field is set
        let has_font = cf.font_family.is_some()
            || cf.font_size.is_some()
            || cf.font_color.is_some()
            || cf.bold.is_some()
            || cf.italic.is_some()
            || cf.underline_type.is_some()
            || cf.strikethrough.is_some()
            || cf.superscript.is_some()
            || cf.subscript.is_some()
            || cf.font_charset.is_some()
            || cf.font_family_type.is_some()
            || cf.font_theme.is_some();

        let font = if has_font {
            Some(FontFormat {
                name: cf.font_family.clone(),
                size: cf.font_size.map(|s| s.millipoints()),
                color: cf.font_color.clone(),
                color_tint: cf.font_color_tint,
                bold: cf.bold,
                italic: cf.italic,
                // Lower the typed enum back to its OOXML token for DocumentFormat.
                underline: cf.underline_type.map(|u| u.to_ooxml().to_string()),
                strikethrough: cf.strikethrough,
                superscript: cf.superscript,
                subscript: cf.subscript,
                vertical_align: if cf.superscript == Some(true) {
                    Some("superscript".to_string())
                } else if cf.subscript == Some(true) {
                    Some("subscript".to_string())
                } else {
                    None
                },
                condense: None,
                extend: None,
                outline: None,
                shadow: None,
                charset: cf.font_charset,
                family: cf.font_family_type,
                scheme: cf.font_theme.clone(),
            })
        } else {
            None
        };

        // Fill
        let has_fill = cf.background_color.is_some()
            || cf.pattern_type.is_some()
            || cf.pattern_foreground_color.is_some()
            || cf.gradient_fill.is_some();

        let fill = if has_fill {
            Some(FillFormat {
                background_color: cf.background_color.clone(),
                background_color_tint: cf.background_color_tint,
                pattern_type: cf.pattern_type.map(|p| p.to_ooxml().to_string()),
                pattern_foreground_color: cf.pattern_foreground_color.clone(),
                pattern_foreground_color_tint: cf.pattern_foreground_color_tint,
                gradient_fill: cf.gradient_fill.clone(),
            })
        } else {
            None
        };

        // Alignment
        let has_alignment = cf.horizontal_align.is_some()
            || cf.vertical_align.is_some()
            || cf.wrap_text.is_some()
            || cf.text_rotation.is_some()
            || cf.indent.is_some()
            || cf.shrink_to_fit.is_some()
            || cf.reading_order.is_some()
            || cf.auto_indent.is_some();

        let alignment = if has_alignment {
            Some(AlignmentFormat {
                horizontal: cf.horizontal_align.map(|h| h.to_ooxml().to_string()),
                vertical: cf.vertical_align.map(|v| v.to_kernel_token().to_string()),
                wrap_text: cf.wrap_text,
                rotation: cf.text_rotation,
                indent: cf.indent,
                shrink_to_fit: cf.shrink_to_fit,
                auto_indent: cf.auto_indent,
                reading_order: cf.reading_order.clone(),
                // CellFormat does not currently carry relative_indent or
                // justify_last_line — round-trip for those flows only through
                // the XLSX-import → DocumentFormat → XLSX-export path, not via
                // CellFormat. Leave as None here.
                relative_indent: None,
                justify_last_line: None,
            })
        } else {
            None
        };

        // Borders
        let border = cf.borders.as_ref().map(|b| BorderFormat {
            top: b.top.as_ref().map(border_side_to_format),
            bottom: b.bottom.as_ref().map(border_side_to_format),
            left: b.left.as_ref().map(border_side_to_format),
            right: b.right.as_ref().map(border_side_to_format),
            diagonal: b.diagonal.as_ref().map(border_side_to_format),
            diagonal_up: b.diagonal_up,
            diagonal_down: b.diagonal_down,
        });

        // Protection
        let has_protection = cf.locked.is_some() || cf.hidden.is_some();

        let protection = if has_protection {
            Some(ProtectionFormat {
                locked: cf.locked,
                hidden: cf.hidden,
            })
        } else {
            None
        };

        DocumentFormat {
            font,
            fill,
            border,
            number_format: cf.number_format.clone(),
            alignment,
            protection,
            quote_prefix: cf.quote_prefix,
            pivot_button: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_document_format_is_all_none() {
        let fmt = DocumentFormat::default();
        assert_eq!(fmt.font, None);
        assert_eq!(fmt.fill, None);
        assert_eq!(fmt.border, None);
        assert_eq!(fmt.number_format, None);
        assert_eq!(fmt.alignment, None);
        assert_eq!(fmt.protection, None);
        assert_eq!(fmt.quote_prefix, None);
        assert_eq!(fmt.pivot_button, None);
    }

    #[test]
    fn serialize_roundtrip() {
        let fmt = DocumentFormat {
            font: Some(FontFormat {
                name: Some("Calibri".into()),
                size: Some(11_000),
                bold: Some(true),
                color: Some("#FF0000".into()),
                ..Default::default()
            }),
            fill: Some(FillFormat {
                background_color: Some("#FFFFFF".into()),
                pattern_type: Some("solid".into()),
                gradient_fill: None,
                ..Default::default()
            }),
            border: Some(BorderFormat {
                top: Some(BorderSide {
                    style: "thin".into(),
                    color: Some("#000000".into()),
                    color_tint: None,
                }),
                diagonal_up: Some(true),
                diagonal_down: Some(true),
                ..Default::default()
            }),
            number_format: Some("0.00%".into()),
            alignment: Some(AlignmentFormat {
                horizontal: Some("center".into()),
                wrap_text: Some(true),
                ..Default::default()
            }),
            protection: Some(ProtectionFormat {
                locked: Some(true),
                hidden: Some(false),
            }),
            ..Default::default()
        };

        let json = serde_json::to_string(&fmt).unwrap();
        let deserialized: DocumentFormat = serde_json::from_str(&json).unwrap();
        assert_eq!(fmt, deserialized);
    }

    #[test]
    fn camel_case_serialization() {
        let fmt = DocumentFormat {
            number_format: Some("General".into()),
            alignment: Some(AlignmentFormat {
                wrap_text: Some(true),
                shrink_to_fit: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        };

        let json = serde_json::to_string(&fmt).unwrap();
        assert!(json.contains("numberFormat"));
        assert!(json.contains("wrapText"));
        assert!(json.contains("shrinkToFit"));
        assert!(!json.contains("number_format"));
        assert!(!json.contains("wrap_text"));
    }

    #[test]
    fn sparse_format_skips_none_fields() {
        let fmt = DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };

        let json = serde_json::to_value(&fmt).unwrap();
        // Only font should be present at top level (others are None and skipped or null)
        assert!(json.get("font").is_some());
    }

    #[test]
    fn diagonal_flags_preserve_absent_vs_explicit_false() {
        // None ≠ Some(false) ≠ Some(true) — each must round-trip distinct.
        let cases = [
            (None, None),
            (Some(false), None),
            (None, Some(false)),
            (Some(true), None),
            (None, Some(true)),
            (Some(false), Some(false)),
            (Some(true), Some(false)),
            (Some(false), Some(true)),
            (Some(true), Some(true)),
        ];
        for (up, down) in cases {
            let fmt = BorderFormat {
                diagonal_up: up,
                diagonal_down: down,
                ..Default::default()
            };
            let json = serde_json::to_string(&fmt).unwrap();
            let rt: BorderFormat = serde_json::from_str(&json).unwrap();
            assert_eq!(
                rt.diagonal_up, up,
                "diagonal_up lost for ({up:?}, {down:?})"
            );
            assert_eq!(
                rt.diagonal_down, down,
                "diagonal_down lost for ({up:?}, {down:?})"
            );
        }
    }

    #[test]
    fn border_diagonal_flags_skip_when_none() {
        let fmt = BorderFormat::default();
        let json: serde_json::Value = serde_json::to_value(&fmt).unwrap();
        let obj = json.as_object().unwrap();
        assert!(
            !obj.contains_key("diagonalUp"),
            "None diagonal_up should be skipped, got {json}"
        );
        assert!(
            !obj.contains_key("diagonalDown"),
            "None diagonal_down should be skipped, got {json}"
        );
    }

    #[test]
    fn border_diagonal_flags_serialize_explicit_false() {
        let fmt = BorderFormat {
            diagonal_up: Some(false),
            diagonal_down: Some(false),
            ..Default::default()
        };
        let json: serde_json::Value = serde_json::to_value(&fmt).unwrap();
        assert_eq!(json["diagonalUp"], serde_json::Value::Bool(false));
        assert_eq!(json["diagonalDown"], serde_json::Value::Bool(false));
    }

    #[test]
    fn alignment_format_round_trip_new_fields() {
        // textRotation=255 (stacked/vertical), readingOrder, shrinkToFit,
        // indent, relativeIndent, justifyLastLine — each preserved losslessly.
        let cases: Vec<AlignmentFormat> = vec![
            AlignmentFormat {
                rotation: Some(255), // stacked / vertical
                ..Default::default()
            },
            AlignmentFormat {
                rotation: Some(0),
                ..Default::default()
            },
            AlignmentFormat {
                rotation: Some(90),
                ..Default::default()
            },
            AlignmentFormat {
                reading_order: Some("context".into()),
                ..Default::default()
            },
            AlignmentFormat {
                reading_order: Some("ltr".into()),
                ..Default::default()
            },
            AlignmentFormat {
                reading_order: Some("rtl".into()),
                ..Default::default()
            },
            AlignmentFormat {
                shrink_to_fit: Some(true),
                ..Default::default()
            },
            AlignmentFormat {
                shrink_to_fit: Some(false),
                ..Default::default()
            },
            AlignmentFormat {
                indent: Some(3),
                ..Default::default()
            },
            AlignmentFormat {
                relative_indent: Some(-2),
                ..Default::default()
            },
            AlignmentFormat {
                justify_last_line: Some(true),
                ..Default::default()
            },
            AlignmentFormat {
                justify_last_line: Some(false),
                ..Default::default()
            },
        ];
        for fmt in cases {
            let json = serde_json::to_string(&fmt).unwrap();
            let rt: AlignmentFormat = serde_json::from_str(&json).unwrap();
            assert_eq!(rt, fmt, "AlignmentFormat round-trip failed: {json}");
        }
    }

    #[test]
    fn alignment_format_camel_case_for_new_fields() {
        let fmt = AlignmentFormat {
            reading_order: Some("rtl".into()),
            relative_indent: Some(1),
            justify_last_line: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&fmt).unwrap();
        assert!(json.contains("\"readingOrder\""));
        assert!(json.contains("\"relativeIndent\""));
        assert!(json.contains("\"justifyLastLine\""));
        assert!(!json.contains("reading_order"));
        assert!(!json.contains("relative_indent"));
        assert!(!json.contains("justify_last_line"));
    }
}
