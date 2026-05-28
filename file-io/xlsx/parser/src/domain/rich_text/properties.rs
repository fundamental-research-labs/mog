//! Rich text property parsing.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_f64_attr, parse_string_attr, parse_u8_attr,
};

use super::types::{Color, FontProperties, RunProperties, UnderlineStyle, VerticalAlign};

impl Color {
    /// Parse a color from XML element bytes.
    ///
    /// Expects bytes starting with `<color` and ending with `>` or `/>`.
    pub fn parse(xml: &[u8]) -> Self {
        let mut color = Color::default();

        if let Some(rgb) = parse_string_attr(xml, b"rgb=\"") {
            color.rgb = Some(rgb);
        }

        if let Some(theme) = parse_u8_attr(xml, b"theme=\"") {
            color.theme = Some(theme);
        }

        if let Some(tint) = parse_f64_attr(xml, b"tint=\"") {
            color.tint = Some(tint);
        }

        if let Some(indexed) = parse_u8_attr(xml, b"indexed=\"") {
            color.indexed = Some(indexed);
        }

        color.auto = parse_bool_attr(xml, b"auto=\"");

        color
    }
}

impl FontProperties {
    /// Parse font properties from run properties XML.
    ///
    /// Looks for: `<rFont>`, `<sz>`, `<color>`, `<charset>`, `<family>`, `<scheme>`.
    pub fn parse(xml: &[u8]) -> Self {
        let mut font = FontProperties::default();

        if let Some(name_start) = find_tag_simd(xml, b"rFont", 0) {
            let name_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
            if let Some(val) = parse_string_attr(&xml[name_start..name_end], b"val=\"") {
                font.name = Some(val);
            }
        }

        if let Some(sz_start) = find_tag_simd(xml, b"sz", 0) {
            let sz_end = find_gt_simd(xml, sz_start).unwrap_or(xml.len());
            if let Some(val) = parse_f64_attr(&xml[sz_start..sz_end], b"val=\"") {
                font.size = Some(val);
            }
        }

        if let Some(color_start) = find_tag_simd(xml, b"color", 0) {
            let color_end = find_gt_simd(xml, color_start).unwrap_or(xml.len());
            let color = Color::parse(&xml[color_start..=color_end]);
            if !color.is_empty() {
                font.color = Some(color);
            }
        }

        if let Some(charset_start) = find_tag_simd(xml, b"charset", 0) {
            let charset_end = find_gt_simd(xml, charset_start).unwrap_or(xml.len());
            if let Some(val) = parse_u8_attr(&xml[charset_start..charset_end], b"val=\"") {
                font.charset = Some(val);
            }
        }

        if let Some(family_start) = find_tag_simd(xml, b"family", 0) {
            let family_end = find_gt_simd(xml, family_start).unwrap_or(xml.len());
            if let Some(val) = parse_u8_attr(&xml[family_start..family_end], b"val=\"") {
                font.family = Some(val);
            }
        }

        if let Some(scheme_start) = find_tag_simd(xml, b"scheme", 0) {
            let scheme_end = find_gt_simd(xml, scheme_start).unwrap_or(xml.len());
            if let Some(val) = parse_string_attr(&xml[scheme_start..scheme_end], b"val=\"") {
                font.scheme = Some(val);
            }
        }

        font
    }
}

impl RunProperties {
    /// Parse run properties from `<rPr>...</rPr>` XML bytes.
    pub fn parse(xml: &[u8]) -> Self {
        let mut props = RunProperties::default();

        let rpr_start = match find_tag_simd(xml, b"rPr", 0) {
            Some(pos) => pos,
            None => return props,
        };

        let rpr_end = find_closing_tag(xml, b"rPr", rpr_start).unwrap_or(xml.len());
        let rpr_content = &xml[rpr_start..rpr_end];

        props.bold = parse_boolean_run_property(rpr_content, b"b");
        props.italic = parse_boolean_run_property(rpr_content, b"i");
        props.strikethrough = find_tag_simd(rpr_content, b"strike", 0).is_some();
        props.outline = find_tag_simd(rpr_content, b"outline", 0).is_some();
        props.shadow = find_tag_simd(rpr_content, b"shadow", 0).is_some();
        props.condense = find_tag_simd(rpr_content, b"condense", 0).is_some();
        props.extend = find_tag_simd(rpr_content, b"extend", 0).is_some();

        if let Some(u_start) = find_tag_simd(rpr_content, b"u", 0) {
            let u_end = find_gt_simd(rpr_content, u_start).unwrap_or(rpr_content.len());
            let u_content = &rpr_content[u_start..=u_end];
            let val = parse_string_attr(u_content, b"val=\"");
            props.underline = UnderlineStyle::from_str(val.as_deref());
        }

        if let Some(va_start) = find_tag_simd(rpr_content, b"vertAlign", 0) {
            let va_end = find_gt_simd(rpr_content, va_start).unwrap_or(rpr_content.len());
            if let Some(val) = parse_string_attr(&rpr_content[va_start..va_end], b"val=\"") {
                props.vert_align = VerticalAlign::from_str(&val);
            }
        }

        props.font = FontProperties::parse(rpr_content);

        props
    }
}

fn parse_boolean_run_property(xml: &[u8], tag: &[u8]) -> bool {
    find_tag_simd(xml, tag, 0)
        .map(|p| {
            let el_end = find_gt_simd(xml, p).map(|g| g + 1).unwrap_or(xml.len());
            parse_bool_attr_with_default(&xml[p..el_end], b"val=\"", true)
        })
        .unwrap_or(false)
}
