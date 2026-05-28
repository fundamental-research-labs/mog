use super::{read, write};
use ooxml_types::drawings as ooxml;

/// Convert a read-side `SpreadsheetPicture` into a write-side `ImageProps`.
pub fn picture_to_image_props(p: &read::SpreadsheetPicture) -> write::ImageProps {
    let xfrm = p.sp_pr.xfrm.as_ref();

    write::ImageProps {
        original_id: Some(p.nv_pic_pr.c_nv_pr.id.value()),
        name: p.nv_pic_pr.c_nv_pr.name.clone(),
        description: p.nv_pic_pr.c_nv_pr.descr.clone(),
        r_id: p.blip_fill.embed_id.clone().unwrap_or_default(),

        rotation: xfrm.and_then(|t| {
            if t.rot().value() != 0 {
                Some(t.rot().value())
            } else {
                None
            }
        }),
        offset_x: xfrm.map_or(0, |t| t.off_x()),
        offset_y: xfrm.map_or(0, |t| t.off_y()),
        extent_cx: xfrm.map_or(0, |t| t.ext_cx() as i64),
        extent_cy: xfrm.map_or(0, |t| t.ext_cy() as i64),
        flip_h: xfrm.map_or(false, |t| t.is_flip_h()),
        flip_v: xfrm.map_or(false, |t| t.is_flip_v()),

        source_rect: p.blip_fill.source_rect,
        src_rect_explicit: p.blip_fill.src_rect_explicit,
        blip_effects: p.blip_fill.effects.clone(),
        fill_mode: p.blip_fill.fill_mode.clone(),
        compression: p.blip_fill.compression,
        link_id: p.blip_fill.link_id.clone(),
        dpi: p.blip_fill.dpi,
        rot_with_shape: p.blip_fill.rot_with_shape,
        blip_ext_lst: p.blip_fill.ext_lst.clone(),

        locks: p.nv_pic_pr.locks.clone(),
        has_pic_locks: p.nv_pic_pr.has_pic_locks,
        prefer_relative_resize: p.nv_pic_pr.prefer_relative_resize,

        title: p.nv_pic_pr.c_nv_pr.title.clone(),
        hidden: p.nv_pic_pr.c_nv_pr.hidden,
        hlink_click: p.nv_pic_pr.c_nv_pr.hlink_click.clone(),
        hlink_hover: p.nv_pic_pr.c_nv_pr.hlink_hover.clone(),
        nv_ext_lst: p.nv_pic_pr.c_nv_pr.ext_lst.clone(),

        preset_geometry: p.sp_pr.geometry.as_ref().and_then(|g| match g {
            ooxml::ShapeGeometry::Preset(pg) => Some(pg.clone()),
            _ => None,
        }),
        fill: p.sp_pr.fill.clone(),
        outline: p.sp_pr.ln.clone(),
        effects: p.sp_pr.effects.clone(),
        bw_mode: p.sp_pr.bw_mode,
        scene3d: p.sp_pr.scene3d.clone(),
        sp3d: p.sp_pr.sp3d.clone(),
        sp_pr_ext_lst: p.sp_pr.ext_lst.clone(),

        style: p.style.clone(),
        macro_name: p.macro_name.clone(),
    }
}
