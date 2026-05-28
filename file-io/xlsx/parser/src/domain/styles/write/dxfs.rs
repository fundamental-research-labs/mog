use crate::domain::styles::types::DxfDef;
use crate::write::xml_writer::XmlWriter;

use super::borders::write_border;
use super::fills::write_fill;
use super::fonts::write_font_inner;
use super::xfs::{write_alignment_inner, write_protection};

pub(super) fn write_dxfs(w: &mut XmlWriter, dxfs: &[DxfDef]) {
    w.start_element("dxfs").attr_num("count", dxfs.len());

    if dxfs.is_empty() {
        w.self_close();
        return;
    }

    w.end_attrs();

    for dxf in dxfs {
        w.start_element("dxf").end_attrs();

        if let Some(ref font) = dxf.font {
            write_font_inner(w, font, true);
        }
        if let Some(ref num_fmt) = dxf.num_fmt {
            w.start_element("numFmt")
                .attr_num("numFmtId", num_fmt.id)
                .attr("formatCode", &num_fmt.format_code)
                .self_close();
        }
        if let Some(ref fill) = dxf.fill {
            write_fill(w, fill);
        }
        if let Some(ref align) = dxf.alignment {
            write_alignment_inner(w, align, true);
        }
        if let Some(ref border) = dxf.border {
            write_border(w, border);
        }
        if let Some(ref prot) = dxf.protection {
            write_protection(w, prot);
        }
        if let Some(ref ext_lst) = dxf.ext_lst
            && let Some(ref raw) = ext_lst.raw_xml
            && !crate::infra::xml::raw_xml_contains_relationship_attr(raw)
        {
            w.raw(raw.as_bytes());
        }

        w.end_element("dxf");
    }

    w.end_element("dxfs");
}
