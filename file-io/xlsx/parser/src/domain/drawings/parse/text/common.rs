use super::super::super::helpers::{extract_attr_value_in_element, parse_u32};
use super::super::super::reader::elements::{
    direct_child_elements, direct_child_slice, document_element_slice,
};
use super::super::super::types::{ExtensionList, Fill, SolidFill, TextSpacing};
use super::super::styling::{parse_color, parse_fill};

pub(super) fn parse_direct_fill_choice(xml: &[u8]) -> Option<Fill> {
    direct_child_elements(xml).find_map(|child| {
        let child_xml = child.full_slice(xml);
        match child.local_name {
            b"noFill" => Some(Fill::NoFill),
            b"solidFill" => Some(Fill::Solid(SolidFill {
                color: parse_color(child_xml),
            })),
            b"gradFill" | b"pattFill" => parse_fill(child_xml),
            _ => None,
        }
    })
}

/// Parse text spacing from an element containing `<a:spcPct>` or `<a:spcPts>`.
pub(super) fn parse_text_spacing(xml: &[u8]) -> Option<TextSpacing> {
    if let Some(spc_pct) = direct_child_slice(xml, b"spcPct") {
        let val = extract_attr_value_in_element(spc_pct, b"val=\"").and_then(|v| parse_u32(v))?;
        return Some(TextSpacing::Percent(val));
    }
    if let Some(spc_pts) = direct_child_slice(xml, b"spcPts") {
        let val = extract_attr_value_in_element(spc_pts, b"val=\"").and_then(|v| parse_u32(v))?;
        return Some(TextSpacing::Points(val));
    }
    None
}

/// Parse an extension list, capturing the raw XML for roundtrip.
pub(in crate::domain::drawings::parse) fn parse_ext_lst(xml: &[u8]) -> Option<ExtensionList> {
    let element = document_element_slice(xml)?;
    let raw = String::from_utf8_lossy(element).into_owned();
    Some(ExtensionList { raw_xml: Some(raw) })
}
