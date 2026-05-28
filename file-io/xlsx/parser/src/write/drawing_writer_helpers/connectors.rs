use domain_types::domain::floating_object::{
    ConnectorData as FobjConnectorData, FloatingObjectCommon,
};

use crate::domain::drawings::write::{
    Connection, ConnectorProps, DrawingAnchor, DrawingLocking, DrawingObject, PresetGeometry,
    Transform2D,
};

use super::anchors::{anchor_position_to_two_cell, anchor_to_legacy_position};
use super::shapes::parse_shape_preset;

/// Convert a unified connector floating object into a `DrawingAnchor`.
pub(super) fn convert_unified_connector_to_anchor(
    common: &FloatingObjectCommon,
    conn_data: &FobjConnectorData,
) -> DrawingAnchor {
    let connector_props = convert_unified_connector(common, conn_data);
    let obj = DrawingObject::Connector(connector_props);

    let position = anchor_to_legacy_position(&common.anchor);
    let anchor = anchor_position_to_two_cell(&position);
    DrawingAnchor::TwoCell(anchor, obj)
}

/// Convert a unified connector into write-side `ConnectorProps`.
pub(super) fn convert_unified_connector(
    common: &FloatingObjectCommon,
    conn_data: &FobjConnectorData,
) -> ConnectorProps {
    if let Some(ref ooxml) = conn_data.ooxml {
        return crate::domain::drawings::write::convert::connector_to_props(&ooxml.connector);
    }

    let name = if common.name.is_empty() {
        "Connector".to_string()
    } else {
        common.name.clone()
    };

    let preset_geometry = Some(PresetGeometry {
        prst: parse_shape_preset(&conn_data.shape_type),
        av_list: Vec::new(),
    });

    let start_connection = conn_data.start_connection.as_ref().map(|ep| Connection {
        shape_id: ep.shape_id.parse::<u32>().unwrap_or(0),
        idx: ep.site_index as u32,
    });

    let end_connection = conn_data.end_connection.as_ref().map(|ep| Connection {
        shape_id: ep.shape_id.parse::<u32>().unwrap_or(0),
        idx: ep.site_index as u32,
    });

    ConnectorProps {
        original_id: None,
        name,
        description: None,
        title: None,
        hidden: false,
        hlink_click: None,
        hlink_hover: None,
        nv_ext_lst: None,
        start_connection,
        end_connection,
        locks: DrawingLocking::default(),
        transform: Transform2D::default(),
        preset_geometry,
        fill: None,
        outline: None,
        style: None,
        macro_name: None,
    }
}
