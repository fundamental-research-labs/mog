use crate::write::xml_writer::XmlWriter;

use super::super::super::types::GroupShapeProps;
use super::super::DrawingWriter;
use super::super::styling::write_scene3d;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_group_shape(
        &self,
        w: &mut XmlWriter,
        props: &GroupShapeProps,
        object_id: &mut u32,
    ) {
        let id = props.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:grpSp>
        w.start_element("xdr:grpSp").end_attrs();

        // ---- nvGrpSpPr ----
        w.start_element("xdr:nvGrpSpPr").end_attrs();
        {
            // <xdr:cNvPr> — same pattern as write_connector
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &props.name);
            if let Some(ref desc) = props.description {
                w.attr("descr", desc);
            }
            if let Some(ref title) = props.title {
                w.attr("title", title);
            }
            if props.hidden {
                w.attr("hidden", "1");
            }

            let has_hlinks = props.hlink_click.is_some() || props.hlink_hover.is_some();
            if has_hlinks {
                w.end_attrs();
                if let Some(ref hlink) = props.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = props.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // <xdr:cNvGrpSpPr>
            let has_locks = props.group_locking.as_ref().is_some_and(|l| l.has_any());
            let has_nv_ext = props.nv_ext_lst.is_some();
            if has_locks || has_nv_ext {
                w.start_element("xdr:cNvGrpSpPr").end_attrs();

                // <a:grpSpLocks>
                if let Some(ref locks) = props.group_locking {
                    if locks.has_any() {
                        w.start_element("a:grpSpLocks");
                        if locks.no_grp {
                            w.attr("noGrp", "1");
                        }
                        if locks.no_ungrp {
                            w.attr("noUngrp", "1");
                        }
                        if locks.no_select {
                            w.attr("noSelect", "1");
                        }
                        if locks.no_rot {
                            w.attr("noRot", "1");
                        }
                        if locks.no_change_aspect {
                            w.attr("noChangeAspect", "1");
                        }
                        if locks.no_move {
                            w.attr("noMove", "1");
                        }
                        if locks.no_resize {
                            w.attr("noResize", "1");
                        }
                        if let Some(ref ext) = locks.ext_lst {
                            w.end_attrs();
                            self.write_raw_xml(w, ext);
                            w.end_element("a:grpSpLocks");
                        } else {
                            w.self_close();
                        }
                    }
                }

                // opaque cNvGrpSpPr extLst
                if let Some(ref ext) = props.nv_ext_lst {
                    self.write_raw_xml(w, ext);
                }

                w.end_element("xdr:cNvGrpSpPr");
            } else {
                w.start_element("xdr:cNvGrpSpPr").self_close();
            }
        }
        w.end_element("xdr:nvGrpSpPr");

        // ---- grpSpPr ----
        w.start_element("xdr:grpSpPr");
        if let Some(ref bw) = props.bw_mode {
            w.attr("bwMode", bw.to_ooxml());
        }
        w.end_attrs();
        {
            // Group transform (CT_GroupTransform2D)
            if let Some(ref xfrm) = props.transform {
                w.start_element("a:xfrm");
                if let Some(rot) = xfrm.rotation {
                    w.attr_num("rot", rot);
                }
                if let Some(true) = xfrm.flip_h {
                    w.attr("flipH", "1");
                }
                if let Some(true) = xfrm.flip_v {
                    w.attr("flipV", "1");
                }
                w.end_attrs();

                if let Some((x, y)) = xfrm.offset {
                    w.start_element("a:off")
                        .attr_num("x", x)
                        .attr_num("y", y)
                        .self_close();
                }
                if let Some((cx, cy)) = xfrm.extent {
                    w.start_element("a:ext")
                        .attr_num("cx", cx)
                        .attr_num("cy", cy)
                        .self_close();
                }
                if let Some((x, y)) = xfrm.child_offset {
                    w.start_element("a:chOff")
                        .attr_num("x", x)
                        .attr_num("y", y)
                        .self_close();
                }
                if let Some((cx, cy)) = xfrm.child_extent {
                    w.start_element("a:chExt")
                        .attr_num("cx", cx)
                        .attr_num("cy", cy)
                        .self_close();
                }

                w.end_element("a:xfrm");
            }

            // Typed fill (same writer as shapes/pictures)
            if let Some(ref fill) = props.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Typed effect properties (same writer as shapes/pictures)
            if let Some(ref ep) = props.effects {
                self.write_effect_properties(w, ep);
            }

            // Scene3D (typed)
            if let Some(ref scene) = props.scene3d {
                write_scene3d(w, scene);
            }

            // Opaque extLst
            if let Some(ref ext) = props.ext_lst {
                self.write_raw_xml(w, ext);
            }
        }
        w.end_element("xdr:grpSpPr");

        // ---- Children ----
        for child in &props.children {
            self.write_object(w, child, object_id);
        }

        w.end_element("xdr:grpSp");
    }
}
