use crate::write::xml_writer::XmlWriter;

pub(super) fn write_raw_section(w: &mut XmlWriter, xml: &Option<String>) {
    if let Some(xml) = xml {
        w.raw_str(xml);
    }
}
