//! Non-visual drawing property parsing shared by shapes, connectors, and frames.

use super::super::helpers::{decode_xml_entities, parse_u32};
use super::super::reader::attrs::{attr_value, parse_bool};
use super::super::reader::elements::{direct_child_slice, document_element};
use super::super::reader::raw::extract_ext_lst_raw;
use super::super::types::{Hyperlink, NonVisualProps};
use ooxml_types::drawings::StDrawingElementId;

/// Parse non-visual properties.
pub fn parse_nv_props(xml: &[u8]) -> NonVisualProps {
    let mut props = NonVisualProps::default();

    if let Some(element) = scoped_c_nv_pr(xml) {
        props.id = StDrawingElementId::new(
            attr_value(element, b"id=\"")
                .and_then(parse_u32)
                .unwrap_or(0),
        );

        props.name = attr_value(element, b"name=\"")
            .map(decode_xml_entities)
            .unwrap_or_default();

        props.descr = attr_value(element, b"descr=\"").map(decode_xml_entities);

        props.title = attr_value(element, b"title=\"").map(decode_xml_entities);

        props.hidden = attr_value(element, b"hidden=\"")
            .and_then(parse_bool)
            .unwrap_or(false);

        if let Some(hlink) = direct_child_slice(element, b"hlinkClick") {
            props.hlink_click = Some(parse_hyperlink(hlink));
        }

        if let Some(hlink) = direct_child_slice(element, b"hlinkHover") {
            props.hlink_hover = Some(parse_hyperlink(hlink));
        }

        props.ext_lst = extract_ext_lst_raw(element);
    }

    props
}

fn scoped_c_nv_pr(xml: &[u8]) -> Option<&[u8]> {
    let root = document_element(xml)?;
    let root_xml = root.full_slice(xml);
    if root.local_name == b"cNvPr" {
        Some(root_xml)
    } else {
        direct_child_slice(root_xml, b"cNvPr")
    }
}

/// Parse a hyperlink element (`hlinkClick` or `hlinkHover`).
///
/// `xml` starts at the opening `<` of the hyperlink tag. The `extLst` search is
/// scoped to this hyperlink element instead of sibling elements.
fn parse_hyperlink(xml: &[u8]) -> Hyperlink {
    let mut hlink = Hyperlink {
        r_id: attr_value(xml, b"r:id=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty()),
        action: attr_value(xml, b"action=\"")
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty()),
        tooltip: attr_value(xml, b"tooltip=\"")
            .map(decode_xml_entities)
            .filter(|s| !s.is_empty()),
        ..Default::default()
    };

    hlink.ext_lst = extract_ext_lst_raw(xml);

    hlink
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_visual_does_not_read_sibling_cnvpr() {
        let xml = br#"<xdr:nvSpPr><xdr:cNvPr id="1" name="Shape"/></xdr:nvSpPr><xdr:cNvPr id="2" name="Sibling"/>"#;
        let props = parse_nv_props(xml);

        assert_eq!(props.id, StDrawingElementId::new(1));
        assert_eq!(props.name, "Shape");
    }

    #[test]
    fn hyperlink_ext_lst_is_scoped_to_hyperlink() {
        let xml = br#"<xdr:cNvPr id="1" name="Shape"><a:hlinkClick r:id="rId1"><a:extLst><a:ext uri="click"/></a:extLst></a:hlinkClick></xdr:cNvPr><a:extLst><a:ext uri="sibling"/></a:extLst>"#;
        let props = parse_nv_props(xml);

        assert_eq!(
            props.hlink_click.as_ref().unwrap().r_id.as_deref(),
            Some("rId1")
        );
        assert!(
            props
                .hlink_click
                .as_ref()
                .unwrap()
                .ext_lst
                .as_deref()
                .unwrap()
                .contains("click")
        );
        assert!(
            !props
                .hlink_click
                .as_ref()
                .unwrap()
                .ext_lst
                .as_deref()
                .unwrap()
                .contains("sibling")
        );
    }
}
