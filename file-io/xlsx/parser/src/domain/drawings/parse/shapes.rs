//! Shape parsing for spreadsheet drawings.

use super::super::reader::attrs::{attr_value, parse_bool};
use super::super::reader::elements::{direct_child_slice, document_element_slice};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{ShapePreset, SpreadsheetShape};
use super::non_visual::parse_nv_props;
use super::styling::{parse_shape_properties, parse_shape_style};
use super::text::parse_text_body;

/// Parse a shape element.
pub fn parse_shape(xml: &[u8], start: usize) -> Option<SpreadsheetShape> {
    let element = document_element_slice(&xml[start..])?;

    let mut shape = SpreadsheetShape::default();

    shape.macro_name = attr_value(element, b"macro=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ToOwned::to_owned);
    shape.textlink = attr_value(element, b"textlink=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ToOwned::to_owned);
    shape.f_locks_text = attr_value(element, b"fLocksText=\"").and_then(parse_bool);
    shape.f_published = attr_value(element, b"fPublished=\"").and_then(parse_bool);

    if let Some(nv_element) = direct_child_slice(element, b"nvSpPr") {
        shape.nv_sp_pr.c_nv_pr = parse_nv_props(nv_element);

        if let Some(cnv_slice) = direct_child_slice(nv_element, b"cNvSpPr") {
            shape.nv_sp_pr.tx_box = attr_value(cnv_slice, b"txBox=\"")
                .and_then(parse_bool)
                .unwrap_or(false);

            if let Some(locks_scope) = direct_child_slice(cnv_slice, b"spLocks") {
                shape.nv_sp_pr.has_sp_locks = true;
                shape.nv_sp_pr.c_nv_sp_pr = super::pictures::parse_picture_locking(locks_scope);
                shape.nv_sp_pr.no_change_aspect_explicit =
                    attr_value(locks_scope, b"noChangeAspect=\"").and_then(parse_bool);
            }

            shape.nv_sp_pr.c_nv_sp_pr_ext_lst = extract_ext_lst_raw(cnv_slice);
        }
    }

    if let Some(sp_pr) = direct_child_slice(element, b"spPr") {
        shape.sp_pr = parse_shape_properties(sp_pr);
    }

    if let Some(tx_body) = direct_child_slice(element, b"txBody") {
        shape.tx_body = parse_text_body(tx_body);
    }

    if let Some(style) = direct_child_slice(element, b"style") {
        shape.style = parse_shape_style(style);
    }

    Some(shape)
}

/// Parse shape preset from string, delegating to `ShapePreset::from_ooxml()`.
pub fn parse_shape_preset(bytes: &[u8]) -> Option<ShapePreset> {
    let s = std::str::from_utf8(bytes).ok()?;
    ShapePreset::from_ooxml(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shape_does_not_read_sibling_shape_properties() {
        let xml = br#"<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="1" name="Shape"/><xdr:cNvSpPr/></xdr:nvSpPr></xdr:sp><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr>"#;
        let shape = parse_shape(xml, 0).unwrap();

        assert!(shape.sp_pr.geometry.is_none());
    }

    #[test]
    fn shape_reads_direct_sp_pr_only() {
        let xml = br#"<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="1" name="Shape"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"/></xdr:spPr></xdr:sp>"#;
        let shape = parse_shape(xml, 0).unwrap();

        assert_eq!(
            shape
                .sp_pr
                .geometry
                .as_ref()
                .and_then(|geometry| match geometry {
                    ooxml_types::drawings::ShapeGeometry::Preset(preset) => Some(preset.prst),
                    _ => None,
                }),
            Some(ShapePreset::Rect)
        );
    }
}
