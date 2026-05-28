use crate::write::xml_writer::XmlWriter;

use super::super::super::types::ConnectorProps;
use super::super::DrawingWriter;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_connector(
        &self,
        w: &mut XmlWriter,
        props: &ConnectorProps,
        object_id: &mut u32,
    ) {
        let id = props.original_id.unwrap_or(*object_id);
        *object_id += 1;

        // <xdr:cxnSp> with optional macro attribute
        w.start_element("xdr:cxnSp");
        if let Some(ref macro_name) = props.macro_name {
            w.attr("macro", macro_name);
        }
        w.end_attrs();

        // ---- Non-visual properties ----
        w.start_element("xdr:nvCxnSpPr").end_attrs();
        {
            // <xdr:cNvPr>
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

            // Check if we need child elements (hyperlinks, extLst)
            let has_children = props.hlink_click.is_some()
                || props.hlink_hover.is_some()
                || props.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();

                // <a:hlinkClick>
                if let Some(ref hlink) = props.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                // <a:hlinkHover>
                if let Some(ref hlink) = props.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = props.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }

                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }

            // <xdr:cNvCxnSpPr>
            let locks = &props.locks;
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
                || locks.ext_lst.is_some();
            let has_cxn_children =
                props.start_connection.is_some() || props.end_connection.is_some() || has_locks;
            if has_cxn_children {
                w.start_element("xdr:cNvCxnSpPr").end_attrs();

                // <a:cxnSpLocks> — only emit true values
                if has_locks {
                    w.start_element("a:cxnSpLocks");
                    if props.locks.no_grp {
                        w.attr_bool_if_true("noGrp", true);
                    }
                    if props.locks.no_select {
                        w.attr_bool_if_true("noSelect", true);
                    }
                    if props.locks.no_rot {
                        w.attr_bool_if_true("noRot", true);
                    }
                    if props.locks.no_change_aspect {
                        w.attr_bool_if_true("noChangeAspect", true);
                    }
                    if props.locks.no_move {
                        w.attr_bool_if_true("noMove", true);
                    }
                    if props.locks.no_resize {
                        w.attr_bool_if_true("noResize", true);
                    }
                    if props.locks.no_edit_points {
                        w.attr_bool_if_true("noEditPoints", true);
                    }
                    if props.locks.no_adjust_handles {
                        w.attr_bool_if_true("noAdjustHandles", true);
                    }
                    if props.locks.no_change_arrowheads {
                        w.attr_bool_if_true("noChangeArrowheads", true);
                    }
                    if props.locks.no_change_shape_type {
                        w.attr_bool_if_true("noChangeShapeType", true);
                    }
                    if let Some(ref ext) = props.locks.ext_lst {
                        w.end_attrs();
                        self.write_raw_xml(w, ext);
                        w.end_element("a:cxnSpLocks");
                    } else {
                        w.self_close();
                    }
                }

                // <a:stCxn>
                if let Some(ref cxn) = props.start_connection {
                    w.start_element("a:stCxn")
                        .attr_num("id", cxn.shape_id)
                        .attr_num("idx", cxn.idx)
                        .self_close();
                }

                // <a:endCxn>
                if let Some(ref cxn) = props.end_connection {
                    w.start_element("a:endCxn")
                        .attr_num("id", cxn.shape_id)
                        .attr_num("idx", cxn.idx)
                        .self_close();
                }

                w.end_element("xdr:cNvCxnSpPr");
            } else {
                w.start_element("xdr:cNvCxnSpPr").self_close();
            }
        }
        w.end_element("xdr:nvCxnSpPr");

        // ---- Shape properties ----
        w.start_element("xdr:spPr").end_attrs();
        {
            // Transform
            w.start_element("a:xfrm");
            if let Some(rot) = props.transform.rotation {
                w.attr_num("rot", rot);
            }
            if props.transform.is_flip_h() {
                w.attr_bool_if_true("flipH", true);
            }
            if props.transform.is_flip_v() {
                w.attr_bool_if_true("flipV", true);
            }
            w.end_attrs();
            {
                w.start_element("a:off")
                    .attr_num("x", props.transform.off_x())
                    .attr_num("y", props.transform.off_y())
                    .self_close();
                w.start_element("a:ext")
                    .attr_num("cx", props.transform.ext_cx())
                    .attr_num("cy", props.transform.ext_cy())
                    .self_close();
            }
            w.end_element("a:xfrm");

            // Preset geometry
            if let Some(ref pg) = props.preset_geometry {
                w.start_element("a:prstGeom")
                    .attr("prst", pg.prst.to_ooxml())
                    .end_attrs();
                Self::write_av_list(w, &pg.av_list);
                w.end_element("a:prstGeom");
            }

            // Fill
            if let Some(ref fill) = props.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = props.outline {
                self.write_ooxml_outline(w, outline);
            }
        }
        w.end_element("xdr:spPr");

        // ---- Style ----
        if let Some(ref style) = props.style {
            self.write_shape_style(w, style);
        }

        w.end_element("xdr:cxnSp");
    }

    // Write a group shape element (`<xdr:grpSp>`)
}
