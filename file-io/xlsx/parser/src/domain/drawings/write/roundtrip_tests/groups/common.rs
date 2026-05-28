use crate::domain::drawings::write::DrawingWriter;
use crate::domain::drawings::write::convert::group_shape_to_props;
use crate::domain::drawings::write::types::{
    ClientData, ConnectorProps, DrawingAnchor, DrawingObject, EditAs, GroupShapeProps,
    GroupTransform2D, Transform2D, TwoCellAnchor,
};
use crate::domain::drawings::{Anchor, DrawingContent, parse_drawing};
use ooxml_types::drawings::DrawingLocking;

use super::super::common::default_anchors;

pub(super) fn minimal_group_props() -> GroupShapeProps {
    GroupShapeProps {
        original_id: None,
        name: "Group 1".to_string(),
        description: None,
        title: None,
        hidden: false,
        hlink_click: None,
        hlink_hover: None,
        group_locking: None,
        nv_ext_lst: None,
        transform: Some(GroupTransform2D {
            offset: Some((0, 0)),
            extent: Some((5000000, 3000000)),
            child_offset: Some((0, 0)),
            child_extent: Some((5000000, 3000000)),
            rotation: None,
            flip_h: None,
            flip_v: None,
        }),
        fill: None,
        effects: None,
        bw_mode: None,
        scene3d: None,
        ext_lst: None,
        children: vec![],
    }
}

pub(super) fn minimal_connector_props() -> ConnectorProps {
    ConnectorProps {
        original_id: None,
        name: "ChildConnector".into(),
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

pub(super) fn roundtrip_group(props: GroupShapeProps) -> (GroupShapeProps, GroupShapeProps) {
    let original = props.clone();

    let (from, to) = default_anchors();
    let anchor = DrawingAnchor::TwoCell(
        TwoCellAnchor {
            from,
            to,
            edit_as: Some(EditAs::TwoCell),
            client_data: ClientData::default(),
            ..Default::default()
        },
        DrawingObject::GroupShape(props),
    );
    let mut writer = DrawingWriter::new();
    writer.add_anchor(anchor);
    let xml = writer.to_xml();

    let drawing = parse_drawing(&xml);
    let group = match &drawing.anchors[0] {
        Anchor::TwoCell(a) => match &a.content {
            DrawingContent::GroupShape(g) => g.clone(),
            other => panic!("expected GroupShape, got {:?}", other),
        },
        other => panic!("expected TwoCell anchor, got {:?}", other),
    };

    let roundtripped = group_shape_to_props(&group);

    (original, roundtripped)
}
