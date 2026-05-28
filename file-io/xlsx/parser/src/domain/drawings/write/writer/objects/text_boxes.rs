use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{ShapePreset, TextBox};
use super::super::DrawingWriter;
use super::super::styling::{write_scene3d, write_shape3d};

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_text_box(
        &self,
        w: &mut XmlWriter,
        text_box: &TextBox,
        object_id: &mut u32,
    ) {
        let id = text_box.original_id.unwrap_or(*object_id);
        *object_id += 1;

        let el = w.start_element("xdr:sp");
        if let Some(ref m) = text_box.macro_name {
            el.attr("macro", m);
        }
        if let Some(ref tl) = text_box.textlink {
            el.attr("textlink", tl);
        }
        if let Some(true) = text_box.f_locks_text {
            el.attr("fLocksText", "1");
        } else if let Some(false) = text_box.f_locks_text {
            el.attr("fLocksText", "0");
        }
        if let Some(true) = text_box.f_published {
            el.attr("fPublished", "1");
        }
        el.end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvSpPr").end_attrs();
        {
            // cNvPr
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &text_box.name);
            if let Some(ref desc) = text_box.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = text_box.title {
                w.attr("title", title);
            }
            if text_box.hidden {
                w.attr("hidden", "1");
            }

            let has_children = text_box.hlink_click.is_some()
                || text_box.hlink_hover.is_some()
                || text_box.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = text_box.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = text_box.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = text_box.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // cNvSpPr
            let locks = &text_box.c_nv_sp_pr;
            let has_locks = locks.no_grp
                || locks.no_select
                || locks.no_rot
                || locks.no_change_aspect
                || locks.no_move
                || locks.no_resize
                || locks.no_edit_points
                || locks.no_adjust_handles
                || locks.no_change_arrowheads
                || locks.no_change_shape_type
                || locks.no_text_edit
                || locks.ext_lst.is_some();
            let has_ext = text_box.c_nv_sp_pr_ext_lst.is_some();

            w.start_element("xdr:cNvSpPr");
            if text_box.tx_box {
                w.attr_bool("txBox", true);
            }
            if has_locks || text_box.has_sp_locks || has_ext {
                w.end_attrs();
                if has_locks || text_box.has_sp_locks {
                    w.start_element("a:spLocks");
                    if locks.no_grp {
                        w.attr("noGrp", "1");
                    }
                    if locks.no_select {
                        w.attr("noSelect", "1");
                    }
                    if locks.no_rot {
                        w.attr("noRot", "1");
                    }
                    // Use explicit Option<bool> for noChangeAspect to preserve "0" values
                    match text_box.no_change_aspect_explicit {
                        Some(true) => {
                            w.attr("noChangeAspect", "1");
                        }
                        Some(false) => {
                            w.attr("noChangeAspect", "0");
                        }
                        None => {
                            if locks.no_change_aspect {
                                w.attr("noChangeAspect", "1");
                            }
                        }
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
                    if locks.no_text_edit {
                        w.attr("noTextEdit", "1");
                    }
                    if let Some(ref ext) = locks.ext_lst {
                        w.end_attrs();
                        self.write_raw_xml(w, ext);
                        w.end_element("a:spLocks");
                    } else {
                        w.self_close();
                    }
                }
                if let Some(ref ext) = text_box.c_nv_sp_pr_ext_lst {
                    self.write_raw_xml(w, ext);
                }
                w.end_element("xdr:cNvSpPr");
            } else {
                w.self_close();
            }
        }
        w.end_element("xdr:nvSpPr");

        // Shape properties
        w.start_element("xdr:spPr");
        if let Some(ref bw) = text_box.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Transform
            if let Some(ref xfrm) = text_box.xfrm {
                w.start_element("a:xfrm");
                if xfrm.rot().value() != 0 {
                    w.attr_num("rot", xfrm.rot().value());
                }
                if xfrm.is_flip_h() {
                    w.attr("flipH", "1");
                }
                if xfrm.is_flip_v() {
                    w.attr("flipV", "1");
                }
                w.end_attrs();
                w.start_element("a:off")
                    .attr_num("x", xfrm.off_x())
                    .attr_num("y", xfrm.off_y())
                    .self_close();
                w.start_element("a:ext")
                    .attr_num("cx", xfrm.ext_cx())
                    .attr_num("cy", xfrm.ext_cy())
                    .self_close();
                w.end_element("a:xfrm");
            }

            // Preset geometry
            let (prst, av_list) = match text_box.preset_geometry.as_ref() {
                Some(pg) => (pg.prst, pg.av_list.as_slice()),
                None => (ShapePreset::Rect, &[][..]),
            };
            w.start_element("a:prstGeom")
                .attr("prst", prst.to_ooxml())
                .end_attrs();
            Self::write_av_list(w, av_list);
            w.end_element("a:prstGeom");

            // Fill
            if let Some(ref fill) = text_box.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = text_box.outline {
                self.write_ooxml_outline(w, outline);
            }

            // Effects
            if let Some(ref ep) = text_box.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D
            if let Some(ref scene) = text_box.scene3d {
                write_scene3d(w, scene);
            }

            // Shape3D
            if let Some(ref sp3d) = text_box.sp3d {
                write_shape3d(w, sp3d);
            }

            // Extension list on spPr
            if let Some(ref ext) = text_box.sp_pr_ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:spPr");

        // Style
        if let Some(ref style) = text_box.style {
            self.write_shape_style(w, style);
        }

        // Text body - imported shapes may intentionally omit txBody. Generated
        // API text boxes use TextBox::from_plain, which supplies a minimal body.
        if let Some(ref tb) = text_box.text_body {
            self.write_text_body_full(w, tb);
        }

        w.end_element("xdr:sp");
    }

    // Write a connector element (`<xdr:cxnSp>`)
}
