//! Drawing object dispatch.
//!
//! The precedence here is a contract: later parsers may contain child elements
//! whose names look like other drawing objects, so object-kind selection must be
//! made before handing a scoped slice to the typed parser.

use super::super::reader::attrs::attr_value;
use super::super::reader::elements::direct_child;
use super::super::reader::elements::direct_child_elements;
use super::super::reader::raw::{
    contains_graphic_frame, direct_alternate_content_raw, extract_element_raw_string,
    relationship_ids_in_raw,
};
use super::super::types::{DrawingContent, SpreadsheetGraphicFrame};
use super::connectors::parse_connector;
use super::graphic_frames::{
    parse_graphic_frame_nv, parse_graphic_frame_xfrm, parse_smartart_graphic_frame,
};
use super::groups::parse_group_shape;
use super::pictures::parse_picture;
use super::shapes::parse_shape;
use domain_types::domain::drawings::OpaqueDrawingContent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DispatchKind {
    Picture,
    GroupShape,
    AlternateContentGraphicFrame,
    Shape,
    Connector,
    ContentPart,
    SmartArtGraphicFrame,
    ChartGraphicFrame,
    SlicerGraphicFrame,
    OpaqueGraphicFrame,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Preservation {
    Typed,
    OpaqueRawXml,
    Unsupported(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrawingParseResult {
    pub(crate) kind: DispatchKind,
    pub(crate) preservation: Preservation,
    pub(crate) relationship_ids: Vec<String>,
}

impl DrawingParseResult {
    fn typed(kind: DispatchKind) -> Self {
        Self {
            kind,
            preservation: Preservation::Typed,
            relationship_ids: Vec::new(),
        }
    }

    fn opaque(kind: DispatchKind, relationship_ids: Vec<String>) -> Self {
        Self {
            kind,
            preservation: Preservation::OpaqueRawXml,
            relationship_ids,
        }
    }

    fn unsupported(reason: &'static str) -> Self {
        Self {
            kind: DispatchKind::Unknown,
            preservation: Preservation::Unsupported(reason),
            relationship_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DispatchedContent {
    pub(crate) content: DrawingContent,
    pub(crate) result: DrawingParseResult,
}

/// Parse drawing content using the contract dispatch precedence.
pub(crate) fn dispatch_drawing_content(xml: &[u8]) -> DispatchedContent {
    if let Some(pic_child) = direct_child(xml, b"pic") {
        if let Some(pic) = parse_picture(pic_child.full_slice(xml), 0) {
            return DispatchedContent {
                content: DrawingContent::Picture(pic),
                result: DrawingParseResult::typed(DispatchKind::Picture),
            };
        }
    }

    if let Some(group_child) = direct_child(xml, b"grpSp") {
        if let Some(group) = parse_group_shape(group_child.full_slice(xml), 0) {
            return DispatchedContent {
                content: DrawingContent::GroupShape(group),
                result: DrawingParseResult::typed(DispatchKind::GroupShape),
            };
        }
    }

    if let Some(raw_xml) = direct_alternate_content_raw(xml) {
        if contains_graphic_frame(raw_xml.as_bytes()) {
            let gf_xml = raw_xml.as_bytes();
            let gf =
                super::super::reader::elements::first_descendant_slice(gf_xml, b"graphicFrame");
            let nv = gf.map(parse_graphic_frame_nv).unwrap_or_default();
            let xfrm = gf.map(parse_graphic_frame_xfrm).unwrap_or_default();
            let relationship_ids = relationship_ids_in_raw(&raw_xml);
            return DispatchedContent {
                content: DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                    nv_graphic_frame_pr: nv,
                    xfrm,
                    graphic_xml: Some(raw_xml),
                    ..Default::default()
                }),
                result: DrawingParseResult::opaque(
                    DispatchKind::AlternateContentGraphicFrame,
                    relationship_ids,
                ),
            };
        }
    }

    if let Some(shape_child) = direct_child(xml, b"sp") {
        if let Some(shape) = parse_shape(shape_child.full_slice(xml), 0) {
            return DispatchedContent {
                content: DrawingContent::Shape(shape),
                result: DrawingParseResult::typed(DispatchKind::Shape),
            };
        }
    }

    if let Some(connector_child) = direct_child(xml, b"cxnSp") {
        if let Some(connector) = parse_connector(connector_child.full_slice(xml), 0) {
            return DispatchedContent {
                content: DrawingContent::Connector(connector),
                result: DrawingParseResult::typed(DispatchKind::Connector),
            };
        }
    }

    if let Some(content_part_child) = direct_child(xml, b"contentPart") {
        let content_part_xml = content_part_child.full_slice(xml);
        if let Some(r_id) = attr_value(content_part_xml, b"id=\"")
            .or_else(|| attr_value(content_part_xml, b"r:id=\""))
        {
            let r_id = String::from_utf8_lossy(r_id).into_owned();
            return DispatchedContent {
                content: DrawingContent::ContentPart(ooxml_types::drawings::ContentPartRef {
                    r_id: r_id.clone(),
                }),
                result: DrawingParseResult {
                    kind: DispatchKind::ContentPart,
                    preservation: Preservation::Typed,
                    relationship_ids: vec![r_id],
                },
            };
        }
    }

    if let Some(gf_child) = direct_child(xml, b"graphicFrame") {
        let gf_start = gf_child.start;
        if let Some(smartart) = parse_smartart_graphic_frame(xml, gf_start) {
            return DispatchedContent {
                content: DrawingContent::SmartArt(smartart),
                result: DrawingParseResult::typed(DispatchKind::SmartArtGraphicFrame),
            };
        }

        if let Some((raw_xml, _)) = extract_element_raw_string(xml, b"graphicFrame", gf_start) {
            let element = raw_xml.as_bytes();
            let macro_name =
                attr_value(element, b"macro=\"").map(|v| String::from_utf8_lossy(v).into_owned());
            let relationship_ids = relationship_ids_in_raw(&raw_xml);
            let kind = classify_direct_graphic_frame(&raw_xml);
            return DispatchedContent {
                content: DrawingContent::GraphicFrame(SpreadsheetGraphicFrame {
                    nv_graphic_frame_pr: parse_graphic_frame_nv(element),
                    xfrm: parse_graphic_frame_xfrm(element),
                    graphic_xml: Some(raw_xml),
                    macro_name,
                    ..Default::default()
                }),
                result: DrawingParseResult::opaque(kind, relationship_ids),
            };
        }
    }

    if let Some(opaque) = first_opaque_object_choice(xml) {
        let relationship_ids = opaque.relationship_ids.clone();
        return DispatchedContent {
            content: DrawingContent::OpaqueUnknown(opaque),
            result: DrawingParseResult::opaque(DispatchKind::Unknown, relationship_ids),
        };
    }

    DispatchedContent {
        content: DrawingContent::Unknown,
        result: DrawingParseResult::unsupported("no supported drawing object child"),
    }
}

pub(crate) fn parse_drawing_content(xml: &[u8]) -> DrawingContent {
    let dispatched = dispatch_drawing_content(xml);
    let _diagnostics = &dispatched.result;
    dispatched.content
}

fn classify_direct_graphic_frame(raw_xml: &str) -> DispatchKind {
    const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    if raw_xml.contains(CHART_URI) {
        return DispatchKind::ChartGraphicFrame;
    }

    if raw_xml.contains("/slicer")
        || raw_xml.contains("/slicers")
        || raw_xml.contains(":slicer")
        || raw_xml.contains("timeslicer")
    {
        return DispatchKind::SlicerGraphicFrame;
    }

    DispatchKind::OpaqueGraphicFrame
}

pub(crate) fn opaque_content_from_element(
    element: &[u8],
    local_name: &[u8],
) -> Option<OpaqueDrawingContent> {
    let raw_xml = std::str::from_utf8(element).ok()?.to_string();
    Some(OpaqueDrawingContent {
        relationship_ids: relationship_ids_in_raw(&raw_xml),
        kind_hint: Some(String::from_utf8_lossy(local_name).into_owned()),
        raw_xml,
    })
}

fn first_opaque_object_choice(xml: &[u8]) -> Option<OpaqueDrawingContent> {
    const ANCHOR_INFRA: &[&[u8]] = &[b"from", b"to", b"pos", b"ext", b"clientData"];

    for child in direct_child_elements(xml) {
        if ANCHOR_INFRA.contains(&child.local_name) {
            continue;
        }
        return opaque_content_from_element(child.full_slice(xml), child.local_name);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_shape_precedes_child_shape() {
        let xml = br#"<xdr:twoCellAnchor><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr><xdr:grpSpPr/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Child"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp></xdr:grpSp></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(dispatched.result.kind, DispatchKind::GroupShape);
        assert!(matches!(dispatched.content, DrawingContent::GroupShape(_)));
    }

    #[test]
    fn group_shape_precedes_nested_picture() {
        let xml = br#"<xdr:twoCellAnchor><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="1" name="Group"/></xdr:nvGrpSpPr><xdr:grpSpPr/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr/></xdr:pic></xdr:grpSp></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(dispatched.result.kind, DispatchKind::GroupShape);
        assert!(matches!(dispatched.content, DrawingContent::GroupShape(_)));
    }

    #[test]
    fn alternate_content_graphic_frame_precedes_fallback_shape() {
        let xml = br#"<xdr:twoCellAnchor><mc:AlternateContent><mc:Choice Requires="cx1"><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="3" name="ChartEx"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="rId5"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice><mc:Fallback><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="4" name="Fallback"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp></mc:Fallback></mc:AlternateContent></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(
            dispatched.result.kind,
            DispatchKind::AlternateContentGraphicFrame
        );
        assert_eq!(dispatched.result.relationship_ids, ["rId5"]);
        assert!(matches!(
            dispatched.content,
            DrawingContent::GraphicFrame(_)
        ));
    }

    #[test]
    fn regular_direct_shape_precedes_direct_connector() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:sp>
                <xdr:nvSpPr><xdr:cNvPr id="2" name="Shape"/><xdr:cNvSpPr/></xdr:nvSpPr>
                <xdr:spPr/>
            </xdr:sp>
            <xdr:cxnSp>
                <xdr:nvCxnSpPr><xdr:cNvPr id="3" name="Connector"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>
                <xdr:spPr/>
            </xdr:cxnSp>
        </xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);

        assert_eq!(dispatched.result.kind, DispatchKind::Shape);
        assert!(matches!(dispatched.content, DrawingContent::Shape(_)));
    }

    #[test]
    fn smartart_direct_graphic_frame_is_typed_before_opaque() {
        let xml = br#"<xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="SmartArt"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rId1" r:lo="rId2" r:qs="rId3" r:cs="rId4"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(dispatched.result.kind, DispatchKind::SmartArtGraphicFrame);
        assert!(matches!(dispatched.content, DrawingContent::SmartArt(_)));
    }

    #[test]
    fn direct_chart_graphic_frame_is_classified_with_relationships() {
        let xml = br#"<xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="6" name="Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId8"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(dispatched.result.kind, DispatchKind::ChartGraphicFrame);
        assert_eq!(dispatched.result.relationship_ids, ["rId8"]);
        assert!(matches!(
            dispatched.content,
            DrawingContent::GraphicFrame(_)
        ));
    }

    #[test]
    fn direct_slicer_like_graphic_frame_is_classified_opaque() {
        let xml = br#"<xdr:twoCellAnchor><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="7" name="Slicer"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2010/slicer"><sle:slicer r:id="rId9" r:embed="rIdMedia"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);
        assert_eq!(dispatched.result.kind, DispatchKind::SlicerGraphicFrame);
        assert_eq!(dispatched.result.preservation, Preservation::OpaqueRawXml);
        assert_eq!(dispatched.result.relationship_ids, ["rId9", "rIdMedia"]);
    }

    #[test]
    fn direct_opaque_graphic_frame_preserves_raw_metadata_and_relationships() {
        let xml = br#"<xdr:twoCellAnchor><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="8" name="Opaque"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm rot="60000" flipH="1"><a:off x="10" y="20"/><a:ext cx="30" cy="40"/></xdr:xfrm><a:graphic><a:graphicData uri="urn:custom"><custom:item r:id="rId10"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#;
        let dispatched = dispatch_drawing_content(xml);

        assert_eq!(dispatched.result.kind, DispatchKind::OpaqueGraphicFrame);
        assert_eq!(dispatched.result.preservation, Preservation::OpaqueRawXml);
        assert_eq!(dispatched.result.relationship_ids, ["rId10"]);
        let DrawingContent::GraphicFrame(frame) = dispatched.content else {
            panic!("expected graphic frame");
        };
        assert_eq!(frame.nv_graphic_frame_pr.c_nv_pr.name, "Opaque");
        assert_eq!(
            frame.xfrm.rotation,
            Some(ooxml_types::drawings::StAngle::new(60000))
        );
        assert_eq!(frame.xfrm.flip_h, Some(true));
        assert_eq!(frame.xfrm.offset, Some((10, 20)));
        assert_eq!(frame.xfrm.extent, Some((30, 40)));
        assert_eq!(frame.macro_name.as_deref(), Some(""));
        assert!(
            frame
                .graphic_xml
                .as_deref()
                .is_some_and(|xml| xml.contains("custom:item"))
        );
    }

    #[test]
    fn unsupported_direct_object_choice_preserves_raw_xml_and_relationships() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>0</xdr:col></xdr:from>
            <xdr:to><xdr:col>1</xdr:col></xdr:to>
            <xdr:contentPart r:id="rIdContent"/>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;

        let dispatched = dispatch_drawing_content(xml);

        assert_eq!(dispatched.result.kind, DispatchKind::ContentPart);
        assert_eq!(dispatched.result.relationship_ids, ["rIdContent"]);
    }

    #[test]
    fn unexpected_direct_object_preserves_raw_xml_and_relationships() {
        let xml = br#"<xdr:twoCellAnchor>
            <xdr:from><xdr:col>0</xdr:col></xdr:from>
            <vendor:widget r:id="rIdWidget"><vendor:data r:embed="rIdData"/></vendor:widget>
            <xdr:clientData/>
        </xdr:twoCellAnchor>"#;

        let dispatched = dispatch_drawing_content(xml);

        assert_eq!(dispatched.result.kind, DispatchKind::Unknown);
        assert_eq!(dispatched.result.preservation, Preservation::OpaqueRawXml);
        assert_eq!(dispatched.result.relationship_ids, ["rIdWidget", "rIdData"]);
        let DrawingContent::OpaqueUnknown(opaque) = dispatched.content else {
            panic!("expected opaque unknown content");
        };
        assert_eq!(opaque.kind_hint.as_deref(), Some("widget"));
        assert!(opaque.raw_xml.contains("vendor:widget"));
    }
}
