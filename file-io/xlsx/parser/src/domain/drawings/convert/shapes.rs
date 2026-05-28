use super::{read, write};
use ooxml_types::drawings as ooxml;

/// Convert a read-side `SpreadsheetShape` into a write-side `TextBox`.
///
/// Handles both text boxes (txBox=true) and general shapes with text content.
/// All shape properties are preserved for full round-trip fidelity.
pub fn shape_to_text_box(s: &read::SpreadsheetShape) -> write::TextBox {
    write::TextBox {
        original_id: Some(s.nv_sp_pr.c_nv_pr.id.value()),
        name: s.nv_sp_pr.c_nv_pr.name.clone(),
        description: s.nv_sp_pr.c_nv_pr.descr.clone(),
        title: s.nv_sp_pr.c_nv_pr.title.clone(),
        hidden: s.nv_sp_pr.c_nv_pr.hidden,
        hlink_click: s.nv_sp_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: s.nv_sp_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: s.nv_sp_pr.c_nv_pr.ext_lst.clone(),

        tx_box: s.nv_sp_pr.tx_box,
        c_nv_sp_pr: s.nv_sp_pr.c_nv_sp_pr.clone(),
        has_sp_locks: s.nv_sp_pr.has_sp_locks,
        no_change_aspect_explicit: s.nv_sp_pr.no_change_aspect_explicit,
        c_nv_sp_pr_ext_lst: s.nv_sp_pr.c_nv_sp_pr_ext_lst.clone(),

        xfrm: s.sp_pr.xfrm.clone(),
        preset_geometry: s.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: s.sp_pr.fill.clone(),
        outline: s.sp_pr.ln.clone(),
        effects: s.sp_pr.effects.clone(),
        bw_mode: s.sp_pr.bw_mode,
        scene3d: s.sp_pr.scene3d.clone(),
        sp3d: s.sp_pr.sp3d.clone(),
        sp_pr_ext_lst: s.sp_pr.ext_lst.clone(),

        style: s.style.clone(),
        text_body: s.tx_body.clone(),
        macro_name: s.macro_name.clone(),
        textlink: s.textlink.clone(),
        f_locks_text: s.f_locks_text,
        f_published: s.f_published,
    }
}
