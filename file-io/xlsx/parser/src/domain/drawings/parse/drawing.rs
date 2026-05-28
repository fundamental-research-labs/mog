//! Top-level drawing document parsing.

use super::super::reader::elements::{direct_child_elements, document_element};
use super::super::reader::namespaces::root_namespace_attrs;
use super::super::types::{
    Anchor, Drawing, DrawingContent, McAlternateContent, OneCellAnchor, TwoCellAnchor,
};
use super::anchors::{parse_absolute_anchor, parse_one_cell_anchor, parse_two_cell_anchor};
use crate::infra::xml::{
    MC_SUPPORTED_NAMESPACES, resolve_mc_alternate_content_with_namespace_context,
};

/// Parse a drawing XML file.
///
/// The public entry point stays stable, but the scan itself is part of the
/// parse layer: it walks only document-root direct children so nested anchors or
/// fallback objects cannot be mistaken for top-level drawing objects.
pub fn parse_drawing(xml: &[u8]) -> Drawing {
    let mut drawing = Drawing {
        root_namespace_attrs: root_namespace_attrs(xml),
        ..Drawing::default()
    };

    let Some(root_element) = document_element(xml) else {
        return drawing;
    };
    let root = root_element.full_slice(xml);

    if let Some(anchor) = parse_top_level_anchor(root_element.local_name, root, Some(root)) {
        drawing.anchors.push(anchor);
        return drawing;
    }

    for child in direct_child_elements(root) {
        if let Some(anchor) =
            parse_top_level_anchor(child.local_name, child.full_slice(root), Some(root))
        {
            drawing.anchors.push(anchor);
        }
    }

    drawing
}

fn parse_top_level_anchor(
    local_name: &[u8],
    anchor_xml: &[u8],
    containing_xml: Option<&[u8]>,
) -> Option<Anchor> {
    match local_name {
        b"twoCellAnchor" => {
            let mut anchor = parse_two_cell_anchor(anchor_xml, 0)?;
            preserve_content_level_raw(&mut anchor, anchor_xml);
            Some(Anchor::TwoCell(anchor))
        }
        b"oneCellAnchor" => {
            let mut anchor = parse_one_cell_anchor(anchor_xml, 0)?;
            preserve_one_cell_content_level_raw(&mut anchor, anchor_xml);
            Some(Anchor::OneCell(anchor))
        }
        b"absoluteAnchor" => parse_absolute_anchor(anchor_xml, 0).map(Anchor::Absolute),
        b"AlternateContent" => parse_wrapped_anchor(anchor_xml, containing_xml),
        _ => None,
    }
}

fn parse_wrapped_anchor(mc_xml: &[u8], containing_xml: Option<&[u8]>) -> Option<Anchor> {
    let raw_xml = std::str::from_utf8(mc_xml).ok()?.to_string();
    let branch = resolve_mc_alternate_content_with_namespace_context(
        mc_xml,
        containing_xml,
        MC_SUPPORTED_NAMESPACES,
    )?;
    let branch_xml = &mc_xml[branch.start..branch.end];

    for child in direct_child_elements(branch_xml) {
        let anchor_xml = child.full_slice(branch_xml);
        match child.local_name {
            b"twoCellAnchor" => {
                let mut anchor = parse_two_cell_anchor(anchor_xml, 0)?;
                anchor.mc_alternate_content = Some(McAlternateContent {
                    raw_xml: raw_xml.clone(),
                });
                return Some(Anchor::TwoCell(anchor));
            }
            b"oneCellAnchor" => {
                let mut anchor = parse_one_cell_anchor(anchor_xml, 0)?;
                anchor.mc_alternate_content = Some(McAlternateContent {
                    raw_xml: raw_xml.clone(),
                });
                return Some(Anchor::OneCell(anchor));
            }
            b"absoluteAnchor" => return parse_absolute_anchor(anchor_xml, 0).map(Anchor::Absolute),
            _ => {}
        }
    }

    None
}

fn preserve_content_level_raw(anchor: &mut TwoCellAnchor, anchor_xml: &[u8]) {
    if content_contains_raw_alternate_content(&anchor.content)
        && let Ok(raw_xml) = std::str::from_utf8(anchor_xml)
    {
        anchor.mc_alternate_content = Some(McAlternateContent {
            raw_xml: raw_xml.to_string(),
        });
    }
}

fn preserve_one_cell_content_level_raw(anchor: &mut OneCellAnchor, anchor_xml: &[u8]) {
    if content_contains_raw_alternate_content(&anchor.content)
        && let Ok(raw_xml) = std::str::from_utf8(anchor_xml)
    {
        anchor.mc_alternate_content = Some(McAlternateContent {
            raw_xml: raw_xml.to_string(),
        });
    }
}

fn content_contains_raw_alternate_content(content: &DrawingContent) -> bool {
    matches!(content, DrawingContent::GraphicFrame(gf)
        if gf.graphic_xml.as_ref().is_some_and(|xml| xml.contains("AlternateContent")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_root_direct_anchors_after_xml_declaration() {
        let xml = br#"<?xml version="1.0"?><xdr:wsDr><xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:ext cx="10" cy="20"/><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>"#;
        let drawing = parse_drawing(xml);

        assert_eq!(drawing.anchors.len(), 1);
        assert!(matches!(drawing.anchors[0], Anchor::OneCell(_)));
    }

    #[test]
    fn preserves_alternate_content_wrapping_one_cell_anchor() {
        let xml = br#"<xdr:wsDr><mc:AlternateContent><mc:Choice Requires="x15"><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:ext cx="10" cy="20"/><xdr:clientData/></xdr:oneCellAnchor></mc:Choice><mc:Fallback><xdr:oneCellAnchor><xdr:from><xdr:col>9</xdr:col><xdr:row>9</xdr:row></xdr:from><xdr:ext cx="1" cy="1"/><xdr:clientData/></xdr:oneCellAnchor></mc:Fallback></mc:AlternateContent></xdr:wsDr>"#;
        let drawing = parse_drawing(xml);

        assert_eq!(drawing.anchors.len(), 1);
        let Anchor::OneCell(anchor) = &drawing.anchors[0] else {
            panic!("expected one cell anchor");
        };
        assert_eq!(anchor.from.col, 1);
        assert!(anchor.mc_alternate_content.is_some());
    }
}
