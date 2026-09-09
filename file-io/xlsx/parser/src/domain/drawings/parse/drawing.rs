//! Top-level drawing document parsing.

use super::super::reader::elements::{direct_child_elements, document_element};
use super::super::reader::namespaces::root_namespace_attrs;
use super::super::types::{
    Anchor, Drawing, DrawingContent, McAlternateContent, OneCellAnchor, TwoCellAnchor,
};
use super::anchors::{
    parse_absolute_anchor_with_namespace_context, parse_one_cell_anchor_with_namespace_context,
    parse_two_cell_anchor_with_namespace_context,
};
use super::pictures::{merge_namespace_declarations, namespace_declarations};
use crate::infra::xml::{
    MC_DRAWING_MARKUP_SUPPORTED_NAMESPACES, resolve_mc_alternate_content_with_namespace_context,
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
    let namespaces = namespace_declarations(xml);

    if let Some(anchor) =
        parse_top_level_anchor(root_element.local_name, root, Some(root), &namespaces)
    {
        drawing.anchors.push(anchor);
        return drawing;
    }

    for child in direct_child_elements(root) {
        if let Some(anchor) = parse_top_level_anchor(
            child.local_name,
            child.full_slice(root),
            Some(root),
            &namespaces,
        ) {
            drawing.anchors.push(anchor);
        }
    }

    drawing
}

fn parse_top_level_anchor(
    local_name: &[u8],
    anchor_xml: &[u8],
    containing_xml: Option<&[u8]>,
    inherited_namespaces: &[(String, String)],
) -> Option<Anchor> {
    match local_name {
        b"twoCellAnchor" => {
            let mut anchor =
                parse_two_cell_anchor_with_namespace_context(anchor_xml, 0, inherited_namespaces)?;
            preserve_content_level_raw(&mut anchor, anchor_xml);
            Some(Anchor::TwoCell(anchor))
        }
        b"oneCellAnchor" => {
            let mut anchor =
                parse_one_cell_anchor_with_namespace_context(anchor_xml, 0, inherited_namespaces)?;
            preserve_one_cell_content_level_raw(&mut anchor, anchor_xml);
            Some(Anchor::OneCell(anchor))
        }
        b"absoluteAnchor" => {
            parse_absolute_anchor_with_namespace_context(anchor_xml, 0, inherited_namespaces)
                .map(Anchor::Absolute)
        }
        b"AlternateContent" => {
            parse_wrapped_anchor(anchor_xml, containing_xml, inherited_namespaces)
        }
        _ => None,
    }
}

fn parse_wrapped_anchor(
    mc_xml: &[u8],
    containing_xml: Option<&[u8]>,
    inherited_namespaces: &[(String, String)],
) -> Option<Anchor> {
    let raw_xml = std::str::from_utf8(mc_xml).ok()?.to_string();
    let branch = resolve_mc_alternate_content_with_namespace_context(
        mc_xml,
        containing_xml,
        MC_DRAWING_MARKUP_SUPPORTED_NAMESPACES,
    )?;
    let branch_xml = &mc_xml[branch.start..branch.end];
    let mut branch_namespaces = inherited_namespaces.to_vec();
    merge_namespace_declarations(&mut branch_namespaces, namespace_declarations(mc_xml));
    let wrapper_name: &[u8] = if branch.is_choice {
        b"Choice"
    } else {
        b"Fallback"
    };
    if let Some(wrapper) = direct_child_elements(mc_xml).find(|child| {
        child.local_name == wrapper_name && branch.start >= child.start && branch.end <= child.end
    }) {
        merge_namespace_declarations(
            &mut branch_namespaces,
            namespace_declarations(wrapper.full_slice(mc_xml)),
        );
    }
    merge_namespace_declarations(&mut branch_namespaces, namespace_declarations(branch_xml));

    if let Some(child) = document_element(branch_xml) {
        let anchor_xml = child.full_slice(branch_xml);
        match child.local_name {
            b"twoCellAnchor" => {
                let mut anchor = parse_two_cell_anchor_with_namespace_context(
                    anchor_xml,
                    0,
                    &branch_namespaces,
                )?;
                anchor.mc_alternate_content = Some(McAlternateContent {
                    raw_xml: raw_xml.clone(),
                });
                return Some(Anchor::TwoCell(anchor));
            }
            b"oneCellAnchor" => {
                let mut anchor = parse_one_cell_anchor_with_namespace_context(
                    anchor_xml,
                    0,
                    &branch_namespaces,
                )?;
                anchor.mc_alternate_content = Some(McAlternateContent {
                    raw_xml: raw_xml.clone(),
                });
                return Some(Anchor::OneCell(anchor));
            }
            b"absoluteAnchor" => {
                return parse_absolute_anchor_with_namespace_context(
                    anchor_xml,
                    0,
                    &branch_namespaces,
                )
                .map(Anchor::Absolute);
            }
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

    #[test]
    fn parses_a14_alternate_content_shape_anchor() {
        let xml = br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><xdr:twoCellAnchor><xdr:from><xdr:col>5</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:to><xdr:col>7</xdr:col><xdr:row>6</xdr:row></xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="7169" name="Button 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:sp><xdr:clientData fPrintsWithSheet="0"/></xdr:twoCellAnchor></mc:Choice><mc:Fallback/></mc:AlternateContent></xdr:wsDr>"#;
        let drawing = parse_drawing(xml);

        assert_eq!(drawing.anchors.len(), 1);
        let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
            panic!("expected two cell anchor");
        };
        assert_eq!(anchor.from.col, 5);
        assert_eq!(anchor.to.col, 7);
        assert!(matches!(anchor.content, DrawingContent::Shape(_)));
        assert!(anchor.mc_alternate_content.is_some());
    }

    #[test]
    fn carries_drawing_root_namespace_to_detached_blip_effect() {
        let xml = br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:vendor="urn:vendor">
            <xdr:oneCellAnchor>
                <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
                <xdr:ext cx="10" cy="20"/>
                <xdr:pic>
                    <xdr:nvPicPr><xdr:cNvPr id="1" name="Picture"/><xdr:cNvPicPr/></xdr:nvPicPr>
                    <xdr:blipFill><a:blip><vendor:futureEffect><vendor:payload/></vendor:futureEffect></a:blip></xdr:blipFill>
                    <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
                </xdr:pic>
                <xdr:clientData/>
            </xdr:oneCellAnchor>
        </xdr:wsDr>"#;

        let drawing = parse_drawing(xml);
        let Anchor::OneCell(anchor) = &drawing.anchors[0] else {
            panic!("expected one-cell picture anchor");
        };
        let DrawingContent::Picture(picture) = &anchor.content else {
            panic!("expected picture content");
        };
        let ooxml_types::drawings::BlipEffect::RawXml(raw) = &picture.blip_fill.effects[0] else {
            panic!("expected unknown effect to remain raw");
        };
        let effect_start = raw.find("<vendor:futureEffect").expect("raw effect");
        let effect_open_end = raw[effect_start..]
            .find('>')
            .map(|offset| effect_start + offset)
            .expect("raw effect opening tag");
        assert!(raw[effect_start..=effect_open_end].contains(r#"xmlns:vendor="urn:vendor""#));
    }

    #[test]
    fn carries_alternate_content_namespace_to_detached_blip_effect() {
        let xml = br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
            <mc:AlternateContent>
                <mc:Choice Requires="unsupported" xmlns:unsupported="urn:unsupported" xmlns:vendor="urn:first-choice-vendor">
                    <xdr:oneCellAnchor/>
                </mc:Choice>
                <mc:Choice Requires="a14" xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" xmlns:vendor="urn:choice-vendor">
                    <xdr:twoCellAnchor>
                        <xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
                        <xdr:to><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
                        <xdr:pic>
                            <xdr:nvPicPr><xdr:cNvPr id="1" name="Picture"/><xdr:cNvPicPr/></xdr:nvPicPr>
                            <xdr:blipFill><a:blip><vendor:futureEffect><vendor:payload/></vendor:futureEffect></a:blip></xdr:blipFill>
                            <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
                        </xdr:pic>
                        <xdr:clientData/>
                    </xdr:twoCellAnchor>
                </mc:Choice>
                <mc:Fallback/>
            </mc:AlternateContent>
        </xdr:wsDr>"#;

        let drawing = parse_drawing(xml);
        let Anchor::TwoCell(anchor) = &drawing.anchors[0] else {
            panic!("expected selected choice anchor");
        };
        let DrawingContent::Picture(picture) = &anchor.content else {
            panic!("expected picture content");
        };
        let ooxml_types::drawings::BlipEffect::RawXml(raw) = &picture.blip_fill.effects[0] else {
            panic!("expected unknown effect to remain raw");
        };
        let effect_start = raw.find("<vendor:futureEffect").expect("raw effect");
        let effect_open_end = raw[effect_start..]
            .find('>')
            .map(|offset| effect_start + offset)
            .expect("raw effect opening tag");
        assert!(
            raw[effect_start..=effect_open_end].contains(r#"xmlns:vendor="urn:choice-vendor""#)
        );
    }
}
