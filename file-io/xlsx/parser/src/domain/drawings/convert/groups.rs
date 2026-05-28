use super::dispatch::convert_drawing_content_with_outcome;
use super::outcome::{
    DrawingConversionOutcome, dedupe_relationship_ids, relationship_ids_for_graphic_frame,
    relationship_ids_for_non_visual,
};
use super::{read, write};

/// Convert a read-side `GroupShape` into a write-side `GroupShapeProps`.
pub fn group_shape_to_props(g: &read::GroupShape) -> write::GroupShapeProps {
    write::GroupShapeProps {
        original_id: Some(g.nv_grp_sp_pr.c_nv_pr.id.value()),
        name: g.nv_grp_sp_pr.c_nv_pr.name.clone(),
        description: g.nv_grp_sp_pr.c_nv_pr.descr.clone(),
        title: g.nv_grp_sp_pr.c_nv_pr.title.clone(),
        hidden: g.nv_grp_sp_pr.c_nv_pr.hidden,
        hlink_click: g.nv_grp_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: g.nv_grp_sp_pr.c_nv_pr.hlink_hover.clone(),

        group_locking: g.nv_grp_sp_pr.c_nv_grp_sp_pr.clone(),
        nv_ext_lst: g.nv_grp_sp_pr.c_nv_grp_sp_pr_ext_lst.clone(),

        transform: g.grp_sp_pr.xfrm.clone(),
        fill: g.grp_sp_pr.fill.clone(),
        effects: g.grp_sp_pr.effects.clone(),
        bw_mode: g.grp_sp_pr.bw_mode,
        scene3d: g.grp_sp_pr.scene3d.clone(),
        ext_lst: g.grp_sp_pr.ext_lst.clone(),

        children: g
            .children
            .iter()
            .filter_map(|c| convert_drawing_content_for_group(c))
            .collect(),
    }
}

fn convert_drawing_content_for_group(
    content: &read::DrawingContent,
) -> Option<write::DrawingObject> {
    convert_drawing_content_for_group_with_outcome(content).object
}

pub(super) fn convert_drawing_content_for_group_with_outcome(
    content: &read::DrawingContent,
) -> DrawingConversionOutcome {
    match content {
        read::DrawingContent::GraphicFrame(gf) => DrawingConversionOutcome::opaque(
            write::DrawingObject::GraphicFrame(write::OpaqueGraphicFrame {
                raw_xml: gf.graphic_xml.clone().unwrap_or_default(),
            }),
            relationship_ids_for_graphic_frame(gf),
        ),
        other => convert_drawing_content_with_outcome(other),
    }
}

pub(super) fn relationship_ids_for_group(group: &read::GroupShape) -> Vec<String> {
    let mut ids = relationship_ids_for_non_visual(&group.nv_grp_sp_pr.c_nv_pr);
    for child in &group.children {
        ids.extend(convert_drawing_content_for_group_with_outcome(child).relationship_ids);
    }
    dedupe_relationship_ids(ids)
}
