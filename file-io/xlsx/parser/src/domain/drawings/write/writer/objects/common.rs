use crate::write::xml_writer::XmlWriter;

use super::super::DrawingWriter;

pub(super) fn write_raw_xml(
    w: &mut XmlWriter,
    raw_xml: &str,
    suppress_unregistered_relationships: bool,
) {
    if suppress_unregistered_relationships {
        DrawingWriter::write_raw_xml_if_relationship_safe(w, raw_xml);
    } else {
        w.raw_str(raw_xml);
    }
}
