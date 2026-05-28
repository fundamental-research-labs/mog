use crate::write::xml_writer::XmlWriter;

use super::super::super::types::{ChartExRef, SLICER_GRAPHIC_DATA_URI, NS_CX, NS_CX1, NS_R};
use super::super::DrawingWriter;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_slicer(
        &self,
        w: &mut XmlWriter,
        name: &str,
        _r_id: &str,
        original_id: Option<u32>,
        object_id: &mut u32,
    ) {
        let id = original_id.unwrap_or(*object_id);
        *object_id += 1;

        w.start_element("mc:AlternateContent").end_attrs();

        // mc:Choice with a14 requirement
        w.start_element("mc:Choice")
            .attr("Requires", "a14")
            .end_attrs();

        // graphicFrame
        w.start_element("xdr:graphicFrame").end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvGraphicFramePr").end_attrs();
        {
            w.start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", name)
                .self_close();
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
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

        // Fallback (empty — non-a14 consumers see nothing)
        w.start_element("mc:Fallback").self_close();

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
            w.start_element("xdr:cNvGraphicFramePr").self_close();
        }
        w.end_element("xdr:nvGraphicFramePr");

        // Transform (zeroed — position comes from the anchor)
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

        // mc:Fallback — placeholder shape for older Excel versions
        w.start_element("mc:Fallback").end_attrs();
        {
            let el = w.start_element("xdr:sp");
            if let Some(ref m) = cx_ref.macro_name {
                el.attr("macro", m);
            }
            el.attr("textlink", "").end_attrs();

            // Non-visual shape properties
            w.start_element("xdr:nvSpPr").end_attrs();
            {
                w.start_element("xdr:cNvPr")
                    .attr_num("id", 0)
                    .attr("name", "")
                    .self_close();
                w.start_element("xdr:cNvSpPr").end_attrs();
                {
                    w.start_element("a:spLocks")
                        .attr("noTextEdit", "1")
                        .self_close();
                }
                w.end_element("xdr:cNvSpPr");
            }
            w.end_element("xdr:nvSpPr");

            // Shape properties with fallback geometry
            w.start_element("xdr:spPr").end_attrs();
            {
                w.start_element("a:xfrm").end_attrs();
                {
                    w.start_element("a:off")
                        .attr_num("x", cx_ref.fallback_off_x)
                        .attr_num("y", cx_ref.fallback_off_y)
                        .self_close();
                    w.start_element("a:ext")
                        .attr_num("cx", cx_ref.fallback_ext_cx)
                        .attr_num("cy", cx_ref.fallback_ext_cy)
                        .self_close();
                }
                w.end_element("a:xfrm");

                w.start_element("a:prstGeom")
                    .attr("prst", "rect")
                    .end_attrs();
                {
                    w.start_element("a:avLst").self_close();
                }
                w.end_element("a:prstGeom");

                // White fill with green border
                w.start_element("a:solidFill").end_attrs();
                {
                    w.start_element("a:prstClr")
                        .attr("val", "white")
                        .self_close();
                }
                w.end_element("a:solidFill");

                w.start_element("a:ln").attr_num("w", 1).end_attrs();
                {
                    w.start_element("a:solidFill").end_attrs();
                    {
                        w.start_element("a:prstClr")
                            .attr("val", "green")
                            .self_close();
                    }
                    w.end_element("a:solidFill");
                }
                w.end_element("a:ln");
            }
            w.end_element("xdr:spPr");

            // Fallback text body with warning message
            w.start_element("xdr:txBody").end_attrs();
            {
                w.start_element("a:bodyPr")
                    .attr("vertOverflow", "clip")
                    .attr("horzOverflow", "clip")
                    .self_close();
                w.start_element("a:lstStyle").self_close();
                w.start_element("a:p").end_attrs();
                {
                    w.start_element("a:r").end_attrs();
                    {
                        w.start_element("a:rPr")
                            .attr("lang", "en-US")
                            .attr_num("sz", 1100)
                            .self_close();
                        w.element_with_text(
                            "a:t",
                            "This chart isn\u{2019}t available in your version of Excel.\n\n\
                             Editing this shape or saving this workbook into a different file \
                             format will permanently break the chart.",
                        );
                    }
                    w.end_element("a:r");
                }
                w.end_element("a:p");
            }
            w.end_element("xdr:txBody");

            w.end_element("xdr:sp");
        }
        w.end_element("mc:Fallback");

        w.end_element("mc:AlternateContent");
    }
}
