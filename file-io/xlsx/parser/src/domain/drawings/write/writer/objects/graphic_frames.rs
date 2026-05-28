use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{ChartRef, NS_C, OpaqueGraphicFrame};
use super::super::DrawingWriter;
use super::common::write_raw_xml;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_chart(
        &self,
        w: &mut XmlWriter,
        chart: &ChartRef,
        object_id: &mut u32,
    ) {
        let id = chart.original_id.unwrap_or(*object_id);
        *object_id += 1;

        {
            let el = w.start_element("xdr:graphicFrame");
            // Only emit macro="" when the original had it (Some("") preserves it).
            if let Some(ref m) = chart.macro_name {
                el.attr("macro", m);
            }
            el.end_attrs();
        }

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &chart.name);
            if let Some(ref descr) = chart.descr {
                w.attr("descr", descr);
            }
            if let Some(ref title) = chart.title {
                w.attr("title", title);
            }
            if chart.hidden {
                w.attr("hidden", "1");
            }

            let has_children = chart.hlink_click.is_some()
                || chart.hlink_hover.is_some()
                || chart.nv_ext_lst.is_some();
            if has_children {
                w.end_attrs();
                if let Some(ref hlink) = chart.hlink_click {
                    self.write_hyperlink(w, "a:hlinkClick", hlink);
                }
                if let Some(ref hlink) = chart.hlink_hover {
                    self.write_hyperlink(w, "a:hlinkHover", hlink);
                }
                if let Some(ref ext_lst) = chart.nv_ext_lst {
                    self.write_raw_xml(w, ext_lst);
                }
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }
            Self::write_cnv_graphic_frame_pr(
                w,
                &chart.graphic_frame_locks,
                chart.has_graphic_frame_locks,
                chart.no_change_aspect_explicit,
                chart.no_drilldown,
                &chart.c_nv_graphic_frame_pr_ext_lst,
                self.suppress_unregistered_relationships,
            );
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform — preserve original values for round-trip fidelity
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", chart.xfrm_off_x)
                .attr_num("y", chart.xfrm_off_y)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", chart.xfrm_ext_cx)
                .attr_num("cy", chart.xfrm_ext_cy)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with chart reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", NS_C)
                .end_attrs();
            {
                w.start_element("c:chart")
                    .attr("xmlns:c", NS_C)
                    .attr("r:id", &chart.r_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
    }

    /// Write `<xdr:cNvGraphicFramePr>` with optional `<a:graphicFrameLocks>` child.
    ///
    /// When `has_locks_element` is true, emits `<a:graphicFrameLocks/>` even if all
    /// attributes are default/false (round-trip fidelity for Excel-generated files).
    /// `no_change_aspect_explicit` preserves explicit `noChangeAspect="0"` from the original.
    pub(in crate::domain::drawings::write::writer) fn write_cnv_graphic_frame_pr(
        w: &mut XmlWriter,
        locks: &ooxml_types::drawings::DrawingLocking,
        has_locks_element: bool,
        no_change_aspect_explicit: Option<bool>,
        no_drilldown: bool,
        ext_lst: &Option<String>,
        suppress_unregistered_relationships: bool,
    ) {
        let has_lock_attrs = locks.no_grp
            || locks.no_select
            || locks.no_change_aspect
            || locks.no_move
            || locks.no_resize
            || no_drilldown
            || no_change_aspect_explicit.is_some()
            || locks.ext_lst.is_some();
        // Emit the element if any attributes are set OR if the element was present
        // in the original XML (even with no attributes, e.g. `<a:graphicFrameLocks/>`).
        let emit_locks = has_lock_attrs || has_locks_element;
        let has_children = emit_locks || ext_lst.is_some();

        if !has_children {
            w.start_element("xdr:cNvGraphicFramePr").self_close();
            return;
        }

        w.start_element("xdr:cNvGraphicFramePr").end_attrs();

        if emit_locks {
            w.start_element("a:graphicFrameLocks");
            if locks.no_grp {
                w.attr("noGrp", "1");
            }
            if no_drilldown {
                w.attr("noDrilldown", "1");
            }
            if locks.no_select {
                w.attr("noSelect", "1");
            }
            // Use explicit Option<bool> for noChangeAspect to preserve "0" values
            match no_change_aspect_explicit {
                Some(true) => {
                    w.attr("noChangeAspect", "1");
                }
                Some(false) => {
                    w.attr("noChangeAspect", "0");
                }
                None => {
                    // Fall back to the bool from DrawingLocking
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
            if let Some(ref lock_ext) = locks.ext_lst {
                w.end_attrs();
                write_raw_xml(w, lock_ext, suppress_unregistered_relationships);
                w.end_element("a:graphicFrameLocks");
            } else {
                w.self_close();
            }
        }

        if let Some(ext) = ext_lst {
            write_raw_xml(w, ext, suppress_unregistered_relationships);
        }

        w.end_element("xdr:cNvGraphicFramePr");
    }

    /// Write an opaque graphic frame verbatim
    pub(in crate::domain::drawings::write::writer) fn write_graphic_frame(
        &self,
        w: &mut XmlWriter,
        gf: &OpaqueGraphicFrame,
    ) {
        self.write_raw_xml(w, &gf.raw_xml);
    }
}
