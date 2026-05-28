use super::super::types::*;

/// Alignment attributes parsed via XmlRead derive, mapped to `AlignmentDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "alignment")]
pub(super) struct RawAlignment {
    #[xml(attr = "horizontal", enum)]
    pub(super) horizontal: Option<HorizontalAlign>,
    #[xml(attr = "vertical", enum)]
    pub(super) vertical: Option<VerticalAlign>,
    #[xml(attr = "wrapText", bool)]
    pub(super) wrap_text: Option<bool>,
    #[xml(attr = "textRotation", num)]
    pub(super) text_rotation: Option<u32>,
    #[xml(attr = "indent", num)]
    pub(super) indent: Option<u32>,
    #[xml(attr = "shrinkToFit", bool)]
    pub(super) shrink_to_fit: Option<bool>,
    #[xml(attr = "readingOrder", num)]
    pub(super) reading_order: Option<u32>,
    #[xml(attr = "relativeIndent", num)]
    pub(super) relative_indent: Option<i32>,
    #[xml(attr = "justifyLastLine", bool)]
    pub(super) justify_last_line: Option<bool>,
    #[xml(attr = "autoIndent", bool)]
    pub(super) auto_indent: Option<bool>,
}

impl From<RawAlignment> for AlignmentDef {
    fn from(r: RawAlignment) -> Self {
        AlignmentDef {
            horizontal: r.horizontal,
            vertical: r.vertical,
            wrap_text: r.wrap_text,
            text_rotation: r.text_rotation,
            indent: r.indent,
            shrink_to_fit: r.shrink_to_fit,
            reading_order: r.reading_order,
            relative_indent: r.relative_indent,
            justify_last_line: r.justify_last_line,
            auto_indent: r.auto_indent,
        }
    }
}

/// Protection attributes parsed via XmlRead derive, mapped to `ProtectionDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "protection")]
pub(super) struct RawProtection {
    #[xml(attr = "locked", bool)]
    pub(super) locked: Option<bool>,
    #[xml(attr = "hidden", bool)]
    pub(super) hidden: Option<bool>,
}

impl From<RawProtection> for ProtectionDef {
    fn from(r: RawProtection) -> Self {
        ProtectionDef {
            locked: r.locked,
            hidden: r.hidden,
        }
    }
}

/// CellXf opening-tag attributes parsed via XmlRead derive.
/// Child elements (alignment, protection, extLst) are handled separately.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "xf")]
pub(super) struct RawCellXfAttrs {
    #[xml(attr = "numFmtId", num)]
    pub(super) num_fmt_id: Option<u32>,
    #[xml(attr = "fontId", num)]
    pub(super) font_id: Option<u32>,
    #[xml(attr = "fillId", num)]
    pub(super) fill_id: Option<u32>,
    #[xml(attr = "borderId", num)]
    pub(super) border_id: Option<u32>,
    #[xml(attr = "applyNumberFormat", bool)]
    pub(super) apply_number_format: Option<bool>,
    #[xml(attr = "applyFont", bool)]
    pub(super) apply_font: Option<bool>,
    #[xml(attr = "applyFill", bool)]
    pub(super) apply_fill: Option<bool>,
    #[xml(attr = "applyBorder", bool)]
    pub(super) apply_border: Option<bool>,
    #[xml(attr = "xfId", num)]
    pub(super) xf_id: Option<u32>,
    #[xml(attr = "applyAlignment", bool)]
    pub(super) apply_alignment: Option<bool>,
    #[xml(attr = "applyProtection", bool)]
    pub(super) apply_protection: Option<bool>,
    #[xml(attr = "quotePrefix", bool)]
    pub(super) quote_prefix: Option<bool>,
    #[xml(attr = "pivotButton", bool)]
    pub(super) pivot_button: Option<bool>,
}

/// CellStyle attributes parsed via XmlRead derive, mapped to `CellStyleDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "cellStyle")]
pub(super) struct RawCellStyle {
    #[xml(attr = "name")]
    pub(super) name: Option<String>,
    #[xml(attr = "xfId", num)]
    pub(super) xf_id: Option<u32>,
    #[xml(attr = "builtinId", num)]
    pub(super) builtin_id: Option<u32>,
    #[xml(attr = "customBuiltin", bool)]
    pub(super) custom_builtin: Option<bool>,
    #[xml(attr = "iLevel", num)]
    pub(super) i_level: Option<u32>,
    #[xml(attr = "hidden", bool)]
    pub(super) hidden: Option<bool>,
    #[xml(attr = "xr:uid")]
    pub(super) xr_uid: Option<String>,
}

impl From<RawCellStyle> for CellStyleDef {
    fn from(r: RawCellStyle) -> Self {
        CellStyleDef {
            name: r.name,
            xf_id: r.xf_id.unwrap_or(0),
            builtin_id: r.builtin_id,
            custom_builtin: r.custom_builtin,
            i_level: r.i_level,
            hidden: r.hidden,
            ext_lst: None,
            xr_uid: r.xr_uid,
        }
    }
}

/// NumFmt attributes parsed via XmlRead derive, mapped to `NumberFormatDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "numFmt")]
pub(super) struct RawNumFmt {
    #[xml(attr = "numFmtId", num)]
    pub(super) id: Option<u32>,
    #[xml(attr = "formatCode")]
    pub(super) format_code: Option<String>,
}

/// TableStyleElement attributes parsed via XmlRead derive.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "tableStyleElement")]
pub(super) struct RawTableStyleElement {
    #[xml(attr = "type")]
    pub(super) style_type: Option<String>,
    #[xml(attr = "dxfId", num)]
    pub(super) dxf_id: Option<u32>,
    #[xml(attr = "size", num)]
    pub(super) size: Option<u32>,
}

/// TableStyle attributes parsed via XmlRead derive.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "tableStyle")]
pub(super) struct RawTableStyle {
    #[xml(attr = "name")]
    pub(super) name: Option<String>,
    #[xml(attr = "pivot", bool)]
    pub(super) pivot: Option<bool>,
    #[xml(attr = "table", bool)]
    pub(super) table: Option<bool>,
    #[xml(attr = "count", num)]
    pub(super) count: Option<u32>,
    #[xml(attr = "xr9:uid")]
    pub(super) xr_uid: Option<String>,
}
