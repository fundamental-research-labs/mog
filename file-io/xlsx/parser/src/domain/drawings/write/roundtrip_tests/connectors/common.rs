use crate::domain::drawings::write::DrawingWriter;
use crate::domain::drawings::write::convert::connector_to_props;
use crate::domain::drawings::write::types::{
    ConnectorProps, DrawingColor, Outline, StyleRef, Transform2D,
};
use crate::domain::drawings::{Anchor, DrawingContent, SpreadsheetConnector, parse_drawing};
use ooxml_types::drawings::{DrawingLocking, LineFill};

use super::super::common::default_anchors;

pub(super) fn minimal_props() -> ConnectorProps {
    ConnectorProps {
        original_id: None,
        name: "TestConnector".into(),
        description: None,
        title: None,
        hidden: false,
        hlink_click: None,
        hlink_hover: None,
        nv_ext_lst: None,
        start_connection: None,
        end_connection: None,
        locks: DrawingLocking::default(),
        transform: Transform2D::default(),
        preset_geometry: None,
        fill: None,
        outline: None,
        style: None,
        macro_name: None,
    }
}

pub(super) fn roundtrip(props: ConnectorProps) -> (ConnectorProps, ConnectorProps) {
    let (from, to) = default_anchors();

    let mut writer = DrawingWriter::new();
    writer.add_connector(from, to, props.clone());
    let xml_bytes = writer.to_xml();

    let connector = extract_connector(&xml_bytes);
    let rt_props = connector_to_props(&connector);

    (props, rt_props)
}

fn extract_connector(xml: &[u8]) -> SpreadsheetConnector {
    let drawing = parse_drawing(xml);
    for anchor in &drawing.anchors {
        let content = match anchor {
            Anchor::TwoCell(a) => &a.content,
            Anchor::OneCell(a) => &a.content,
            Anchor::Absolute(a) => &a.content,
        };
        if let DrawingContent::Connector(c) = content {
            return c.clone();
        }
    }
    panic!("No connector found in parsed drawing XML");
}

pub(super) fn outline_color_rgb(outline: &Outline) -> Option<&str> {
    outline.fill.as_ref().and_then(|f| match f {
        LineFill::Solid(sf) => match &sf.color {
            DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
            _ => None,
        },
        _ => None,
    })
}

pub(super) fn style_ref_color_rgb(sr: &StyleRef) -> Option<&str> {
    sr.color.as_ref().and_then(|c| match c {
        DrawingColor::SrgbClr { val, .. } => Some(val.as_str()),
        _ => None,
    })
}
