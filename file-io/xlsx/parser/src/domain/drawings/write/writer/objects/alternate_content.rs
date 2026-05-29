use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{
    ChartExRef, NS_CX, NS_CX1, NS_R, NS_TSLE, SLICER_GRAPHIC_DATA_URI, TIMELINE_GRAPHIC_DATA_URI,
};
use super::super::DrawingWriter;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_slicer(
        &self,
        w: &mut XmlWriter,
        name: &str,
        _r_id: &str,
        original_id: Option<u32>,
        macro_name: Option<&str>,
        nv_ext_lst: Option<&str>,
        object_id: &mut u32,
    ) {
        let id = original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("mc:AlternateContent").end_attrs();

        // mc:Choice with a14 requirement
        w.start_element("mc:Choice")
            .attr("Requires", "a14")
            .end_attrs();

        let graphic_frame = w.start_element("xdr:graphicFrame");
        if let Some(macro_name) = macro_name {
            graphic_frame.attr("macro", macro_name);
        }
        graphic_frame.end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", name);
            if let Some(nv_ext_lst) = nv_ext_lst {
                w.end_attrs();
                self.write_raw_xml(w, nv_ext_lst);
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", 0)
                .attr_num("y", 0)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", 0)
                .attr_num("cy", 0)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with slicer reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", SLICER_GRAPHIC_DATA_URI)
                .end_attrs();
            {
                w.start_element("sle:slicer")
                    .attr("name", name)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
        w.end_element("mc:Choice");
        w.end_element("mc:AlternateContent");
    }

    pub(in crate::domain::drawings::write::writer) fn write_timeline(
        &self,
        w: &mut XmlWriter,
        name: &str,
        original_id: Option<u32>,
        macro_name: Option<&str>,
        nv_ext_lst: Option<&str>,
        object_id: &mut u32,
    ) {
        let id = original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("mc:AlternateContent").end_attrs();
        w.start_element("mc:Choice")
            .attr("xmlns:tsle", NS_TSLE)
            .attr("Requires", "tsle")
            .end_attrs();

        let graphic_frame = w.start_element("xdr:graphicFrame");
        if let Some(macro_name) = macro_name {
            graphic_frame.attr("macro", macro_name);
        }
        graphic_frame.end_attrs();
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        w.start_element("xdr:cNvPr")
            .attr_num("id", id)
            .attr("name", name);
        if let Some(nv_ext_lst) = nv_ext_lst {
            w.end_attrs();
            self.write_raw_xml(w, nv_ext_lst);
            w.end_element("xdr:cNvPr");
        } else {
            w.self_close();
        }
        w.start_element("xdr:cNvGraphicFramePr").self_close();
        w.end_element("xdr:nvGraphicFramePr");

        w.start_element("xdr:xfrm").end_attrs();
        w.start_element("a:off")
            .attr_num("x", 0)
            .attr_num("y", 0)
            .self_close();
        w.start_element("a:ext")
            .attr_num("cx", 0)
            .attr_num("cy", 0)
            .self_close();
        w.end_element("xdr:xfrm");

        w.start_element("a:graphic").end_attrs();
        w.start_element("a:graphicData")
            .attr("uri", TIMELINE_GRAPHIC_DATA_URI)
            .end_attrs();
        w.start_element("tsle:timeslicer")
            .attr("name", name)
            .self_close();
        w.end_element("a:graphicData");
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
        w.end_element("mc:Choice");
        w.end_element("mc:AlternateContent");
    }

    /// Write a ChartEx anchor as `mc:AlternateContent` with `cx:chart` graphicFrame.
    ///
    /// Modern chart types (waterfall, treemap, sunburst, funnel, etc.) use the
    /// ChartEx format which requires mc:AlternateContent wrapping so that older
    /// Excel versions see a placeholder shape instead of crashing.
    pub(in crate::domain::drawings::write::writer) fn write_chart_ex(
        &self,
        w: &mut XmlWriter,
        cx_ref: &ChartExRef,
        object_id: &mut u32,
    ) {
        let _id = cx_ref.id;
        *object_id += 1;

        // mc:AlternateContent wrapper
        w.start_element("mc:AlternateContent").end_attrs();

        // mc:Choice — requires cx1 namespace for ChartEx
        w.start_element("mc:Choice")
            .attr("xmlns:cx1", NS_CX1)
            .attr("Requires", "cx1")
            .end_attrs();

        // graphicFrame
        {
            let el = w.start_element("xdr:graphicFrame");
            if let Some(ref m) = cx_ref.macro_name {
                el.attr("macro", m);
            }
            el.end_attrs();
        }

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", cx_ref.id)
                .attr("name", &cx_ref.name);
            if let Some(ref ext_lst) = cx_ref.nv_ext_lst {
                w.end_attrs();
                self.write_raw_xml(w, ext_lst);
                w.end_element("xdr:cNvPr");
            } else {
                w.self_close();
            }
            Self::write_cnv_graphic_frame_pr(
                w,
                &cx_ref.graphic_frame_locks,
                cx_ref.has_graphic_frame_locks,
                cx_ref.no_change_aspect_explicit,
                cx_ref.no_drilldown,
                &cx_ref.c_nv_graphic_frame_pr_ext_lst,
                self.suppress_unregistered_relationships,
            );
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform — preserve the typed graphic frame transform. For two-cell
        // anchors Excel also stores the position on the anchor itself.
        w.start_element("xdr:xfrm").end_attrs();
        {
            w.start_element("a:off")
                .attr_num("x", cx_ref.xfrm_off_x)
                .attr_num("y", cx_ref.xfrm_off_y)
                .self_close();
            w.start_element("a:ext")
                .attr_num("cx", cx_ref.xfrm_ext_cx)
                .attr_num("cy", cx_ref.xfrm_ext_cy)
                .self_close();
        }
        w.end_element("xdr:xfrm");

        // Graphic with ChartEx reference
        w.start_element("a:graphic").end_attrs();
        {
            w.start_element("a:graphicData")
                .attr("uri", NS_CX)
                .end_attrs();
            {
                w.start_element("cx:chart")
                    .attr("xmlns:cx", NS_CX)
                    .attr("xmlns:r", NS_R)
                    .attr("r:id", &cx_ref.r_id)
                    .self_close();
            }
            w.end_element("a:graphicData");
        }
        w.end_element("a:graphic");

        w.end_element("xdr:graphicFrame");
        w.end_element("mc:Choice");

        w.end_element("mc:AlternateContent");
    }
}
