use crate::domain::drawings::write::types::{DrawingObject, OpaqueGraphicFrame};

use super::common::{minimal_connector_props, minimal_group_props, roundtrip_group};

#[test]
fn roundtrip_group_with_connector_child() {
    let mut props = minimal_group_props();
    props
        .children
        .push(DrawingObject::Connector(minimal_connector_props()));

    let (_, roundtripped) = roundtrip_group(props);
    assert_eq!(roundtripped.children.len(), 1);
    match &roundtripped.children[0] {
        DrawingObject::Connector(_c) => {}
        other => panic!("expected Connector child, got {:?}", other),
    }
}

#[test]
fn roundtrip_group_multiple_children() {
    let mut props = minimal_group_props();
    props.name = "Multi-child Group".to_string();

    let mut c1 = minimal_connector_props();
    c1.name = "Connector A".to_string();
    let mut c2 = minimal_connector_props();
    c2.name = "Connector B".to_string();
    props.children.push(DrawingObject::Connector(c1));
    props.children.push(DrawingObject::Connector(c2));

    let (_, roundtripped) = roundtrip_group(props);
    assert_eq!(roundtripped.name, "Multi-child Group");
    let connectors: Vec<_> = roundtripped
        .children
        .iter()
        .filter_map(|c| match c {
            DrawingObject::Connector(cp) => Some(cp),
            _ => None,
        })
        .collect();
    assert_eq!(connectors.len(), 2);
}

#[test]
fn roundtrip_group_with_graphic_frame() {
    let mut props = minimal_group_props();
    let gf_xml = r#"<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>"#;
    props
        .children
        .push(DrawingObject::GraphicFrame(OpaqueGraphicFrame {
            raw_xml: gf_xml.to_string(),
        }));

    let (_, roundtripped) = roundtrip_group(props);
    assert_eq!(roundtripped.children.len(), 1);
    match &roundtripped.children[0] {
        DrawingObject::GraphicFrame(gf) => {
            assert!(gf.raw_xml.contains("Chart 1"));
        }
        other => panic!("expected GraphicFrame child, got {:?}", other),
    }
}
