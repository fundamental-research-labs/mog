use domain_types::domain::floating_object::{DiagramData as FobjDiagramData, FloatingObjectCommon};

use crate::domain::drawings::write::{DrawingAnchor, DrawingObject, SmartArtWriteData};

use super::anchors::{anchor_position_to_two_cell, anchor_to_legacy_position};

/// Convert a unified SmartArt floating object into a `DrawingAnchor`.
pub(super) fn convert_unified_smartart_to_anchor(
    common: &FloatingObjectCommon,
    sa_data: &FobjDiagramData,
) -> DrawingAnchor {
    let smartart_data = convert_unified_smartart(common, sa_data);
    let obj = DrawingObject::SmartArt(smartart_data);

    let position = anchor_to_legacy_position(&common.anchor);
    let anchor = anchor_position_to_two_cell(&position);
    DrawingAnchor::TwoCell(anchor, obj)
}

/// Convert unified SmartArt data into write-side `SmartArtWriteData`.
pub(super) fn convert_unified_smartart(
    common: &FloatingObjectCommon,
    sa_data: &FobjDiagramData,
) -> SmartArtWriteData {
    let def = &sa_data.definition;

    SmartArtWriteData {
        original_id: def.original_id,
        name: sa_data
            .category
            .map(|c| format!("{:?}", c))
            .unwrap_or_else(|| {
                if common.name.is_empty() {
                    "SmartArt".to_string()
                } else {
                    common.name.clone()
                }
            }),
        dm_rel_id: def.dm_rel_id.clone().unwrap_or_else(|| "rId1".to_string()),
        lo_rel_id: def.lo_rel_id.clone().unwrap_or_else(|| "rId2".to_string()),
        qs_rel_id: def.qs_rel_id.clone().unwrap_or_else(|| "rId3".to_string()),
        cs_rel_id: def.cs_rel_id.clone().unwrap_or_else(|| "rId4".to_string()),
        data_xml: def.data_xml.clone(),
        layout_xml: def.layout_xml.clone(),
        colors_xml: def.colors_xml.clone(),
        style_xml: def.style_xml.clone(),
        drawing_xml: def.drawing_xml.clone(),
    }
}
