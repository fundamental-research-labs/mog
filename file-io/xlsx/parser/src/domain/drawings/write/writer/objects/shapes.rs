use crate::write::xml_writer::XmlWriter;

use super::super::super::types::ShapeProps;
use super::super::DrawingWriter;

impl DrawingWriter {
    pub(in crate::domain::drawings::write::writer) fn write_shape(
        &self,
        w: &mut XmlWriter,
        shape: &ShapeProps,
        object_id: &mut u32,
    ) {
        let id = shape.original_id.unwrap_or(*object_id);
        *object_id += 1;

        let el = w.start_element("xdr:sp");
        if let Some(ref m) = shape.macro_name {
            el.attr("macro", m);
        }
        if let Some(ref tl) = shape.textlink {
            el.attr("textlink", tl);
        }
        el.end_attrs();

        // Non-visual properties
        w.start_element("xdr:nvSpPr").end_attrs();
        {
            let cnv = w
                .start_element("xdr:cNvPr")
                .attr_num("id", id)
                .attr("name", &shape.name);
            if let Some(ref ext) = shape.nv_ext_lst {
                cnv.end_attrs();
                self.write_raw_xml(w, ext);
                w.end_element("xdr:cNvPr");
            } else {
                cnv.self_close();
            }

            {
                let cnv_sp = w.start_element("xdr:cNvSpPr");
                if shape.tx_box {
                    cnv_sp.attr_bool("txBox", true);
                }
                cnv_sp.self_close();
            }
        }
        w.end_element("xdr:nvSpPr");

        // Shape properties
        w.start_element("xdr:spPr").end_attrs();
        {
            // Transform
            if let Some(ref xfrm) = shape.xfrm {
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
            w.start_element("a:prstGeom")
                .attr("prst", shape.preset.to_ooxml())
                .end_attrs();
            w.start_element("a:avLst").self_close();
            w.end_element("a:prstGeom");

            // Fill
            if let Some(ref fill) = shape.fill {
                self.write_ooxml_fill(w, fill);
            }

            // Outline
            if let Some(ref outline) = shape.outline {
                self.write_ooxml_outline(w, outline);
            }
        }
        w.end_element("xdr:spPr");

        // Style
        if let Some(ref style) = shape.style {
            self.write_shape_style(w, style);
        }

        // Text body if present
        if let Some(ref text) = shape.text {
            self.write_text_body(w, text, true, None);
        }

        w.end_element("xdr:sp");
    }

    // Write a chart reference
}
