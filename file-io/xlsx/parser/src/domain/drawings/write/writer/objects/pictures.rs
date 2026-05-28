use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{FillMode, ImageProps, ShapePreset};
use super::super::DrawingWriter;
use super::super::styling::{write_scene3d, write_shape3d};

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_picture(
        &self,
        w: &mut XmlWriter,
        image: &ImageProps,
        object_id: &mut u32,
    ) {
        let id = image.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:pic> with optional macro attribute
        w.start_element("xdr:pic");
        if let Some(ref macro_name) = image.macro_name {
            w.attr("macro", macro_name);
        }
        w.end_attrs();

        // ---- nvPicPr ----
        w.start_element("xdr:nvPicPr").end_attrs();
        {
            // cNvPr
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &image.name);
            if let Some(ref desc) = image.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = image.title {
                w.attr("title", title);
            }
            if image.hidden {
                w.attr("hidden", "1");
            }

            let has_children = image.hlink_click.is_some()
                || image.hlink_hover.is_some()
                || image.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = image.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = image.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = image.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // cNvPicPr
            let locks = &image.locks;
            let has_any_lock = locks.no_crop
                || locks.no_change_aspect
                || locks.no_grp
                || locks.no_select
                || locks.no_rot
                || locks.no_move
                || locks.no_resize
                || locks.no_edit_points
                || locks.no_adjust_handles
                || locks.no_change_arrowheads
                || locks.no_change_shape_type
                || locks.ext_lst.is_some();

            w.start_element("xdr:cNvPicPr");
            if let Some(false) = image.prefer_relative_resize {
                w.attr("preferRelativeResize", "0");
            }
            if has_any_lock || image.has_pic_locks {
                w.end_attrs();
                w.start_element("a:picLocks");
                if locks.no_crop {
                    w.attr("noCrop", "1");
                }
                if locks.no_change_aspect {
                    w.attr("noChangeAspect", "1");
                }
                if locks.no_grp {
                    w.attr("noGrp", "1");
                }
                if locks.no_select {
                    w.attr("noSelect", "1");
                }
                if locks.no_rot {
                    w.attr("noRot", "1");
                }
                if locks.no_move {
                    w.attr("noMove", "1");
                }
                if locks.no_resize {
                    w.attr("noResize", "1");
                }
                if locks.no_edit_points {
                    w.attr("noEditPoints", "1");
                }
                if locks.no_adjust_handles {
                    w.attr("noAdjustHandles", "1");
                }
                if locks.no_change_arrowheads {
                    w.attr("noChangeArrowheads", "1");
                }
                if locks.no_change_shape_type {
                    w.attr("noChangeShapeType", "1");
                }
                if let Some(ref ext) = locks.ext_lst {
                    w.end_attrs();
                    self.write_raw_xml(w, ext);
                    w.end_element("a:picLocks");
                } else {
                    w.self_close();
                }
                w.end_element("xdr:cNvPicPr");
            } else {
                w.self_close();
            }
        }
        w.end_element("xdr:nvPicPr");

        // ---- blipFill ----
        w.start_element("xdr:blipFill");
        if let Some(dpi) = image.dpi {
            w.attr_num("dpi", dpi);
        }
        if let Some(rot_ws) = image.rot_with_shape {
            w.attr("rotWithShape", if rot_ws { "1" } else { "0" });
        }
        w.end_attrs();
        {
            // <a:blip>
            let has_effects = !image.blip_effects.is_empty();
            let has_blip_ext = image.blip_ext_lst.is_some();
            w.start_element("a:blip");
            if !image.r_id.is_empty() {
                w.attr("r:embed", &image.r_id);
            }
            if let Some(ref link_id) = image.link_id {
                w.attr("r:link", link_id);
            }
            if let Some(ref comp) = image.compression {
                w.attr("cstate", comp.to_ooxml());
            }

            if has_effects || has_blip_ext {
                w.end_attrs();
                if has_effects {
                    self.write_blip_effects(w, &image.blip_effects);
                }
                if let Some(ref ext) = image.blip_ext_lst {
                    self.write_raw_xml(w, ext);
                }
                w.end_element("a:blip");
            } else {
                w.self_close();
            }

            // <a:srcRect> — only emit attributes that were explicitly present in the
            // original XML *or* have non-zero values. This avoids adding default zeros
            // for absent attributes (e.g. `<a:srcRect/>` stays empty, not `l="0" t="0" ...`).
            if let Some(ref rect) = image.source_rect {
                let e = image.src_rect_explicit;
                w.start_element("a:srcRect");
                if e & 1 != 0 || rect.left.value() != 0 {
                    w.attr_num("l", rect.left);
                }
                if e & 2 != 0 || rect.top.value() != 0 {
                    w.attr_num("t", rect.top);
                }
                if e & 4 != 0 || rect.right.value() != 0 {
                    w.attr_num("r", rect.right);
                }
                if e & 8 != 0 || rect.bottom.value() != 0 {
                    w.attr_num("b", rect.bottom);
                }
                w.self_close();
            }

            // Fill mode
            match &image.fill_mode {
                Some(FillMode::Tile(tile)) => {
                    w.start_element("a:tile");
                    if let Some(tx) = tile.tx {
                        w.attr_num("tx", tx);
                    }
                    if let Some(ty) = tile.ty {
                        w.attr_num("ty", ty);
                    }
                    if let Some(sx) = tile.sx {
                        w.attr_num("sx", sx);
                    }
                    if let Some(sy) = tile.sy {
                        w.attr_num("sy", sy);
                    }
                    w.attr("flip", tile.flip.to_ooxml());
                    if let Some(ref align) = tile.align {
                        w.attr("algn", align.to_ooxml());
                    }
                    w.self_close();
                }
                Some(FillMode::Stretch { fill_rect }) => {
                    if let Some(fr) = fill_rect {
                        w.start_element("a:stretch").end_attrs();
                        if fr.top.value() != 0
                            || fr.bottom.value() != 0
                            || fr.left.value() != 0
                            || fr.right.value() != 0
                        {
                            w.start_element("a:fillRect");
                            if fr.top.value() != 0 {
                                w.attr_num("t", fr.top);
                            }
                            if fr.bottom.value() != 0 {
                                w.attr_num("b", fr.bottom);
                            }
                            if fr.left.value() != 0 {
                                w.attr_num("l", fr.left);
                            }
                            if fr.right.value() != 0 {
                                w.attr_num("r", fr.right);
                            }
                            w.self_close();
                        } else {
                            w.start_element("a:fillRect").self_close();
                        }
                        w.end_element("a:stretch");
                    } else {
                        // <a:stretch/> with no fillRect child
                        w.start_element("a:stretch").self_close();
                    }
                }
                None => {
                    // No fill mode in parsed data — don't emit one
                }
            }
        }
        w.end_element("xdr:blipFill");

        // ---- spPr ----
        w.start_element("xdr:spPr");
        if let Some(ref bw) = image.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Transform
            w.start_element("a:xfrm");
            if let Some(rot) = image.rotation {
                w.attr_num("rot", rot);
            }
            if image.flip_h {
                w.attr("flipH", "1");
            }
            if image.flip_v {
                w.attr("flipV", "1");
            }
            w.end_attrs();
            w.start_element("a:off")
                .attr_num("x", image.offset_x)
                .attr_num("y", image.offset_y)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", image.extent_cx)
                .attr_num("cy", image.extent_cy)
                .self_close();
            w.end_element("a:xfrm");

            // Preset geometry
            let (prst, av_list) = match image.preset_geometry.as_ref() {
                Some(pg) => (pg.prst.to_ooxml(), pg.av_list.as_slice()),
                None => (ShapePreset::Rect.to_ooxml(), &[][..]),
            };
            w.start_element("a:prstGeom").attr("prst", prst).end_attrs();
            Self::write_av_list(w, av_list);
            w.end_element("a:prstGeom");

            // Fill (from ooxml DrawingFill)
            if let Some(ref fill) = image.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = image.outline {
                self.write_ooxml_outline(w, outline);
            }

            // Effect properties
            if let Some(ref ep) = image.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D (typed)
            if let Some(ref scene) = image.scene3d {
                write_scene3d(w, scene);
            }

            // Shape3D (typed)
            if let Some(ref sp3d) = image.sp3d {
                write_shape3d(w, sp3d);
            }
            // Extension list on spPr (opaque passthrough)
            if let Some(ref ext) = image.sp_pr_ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:spPr");

        // ---- style ----
        if let Some(ref style) = image.style {
            self.write_shape_style(w, style);
        }

        w.end_element("xdr:pic");
    }

    // Write a shape element
}
