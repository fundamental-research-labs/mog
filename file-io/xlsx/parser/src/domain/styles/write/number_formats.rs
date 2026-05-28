use crate::domain::styles::types::NumberFormatDef;
use crate::write::xml_writer::XmlWriter;

pub(super) fn write_num_fmts(w: &mut XmlWriter, num_fmts: &[NumberFormatDef]) {
    w.start_element("numFmts")
        .attr_num("count", num_fmts.len())
        .end_attrs();

    for fmt in num_fmts {
        w.start_element("numFmt")
            .attr_num("numFmtId", fmt.id)
            .attr("formatCode", &fmt.format_code)
            .self_close();
    }

    w.end_element("numFmts");
}
