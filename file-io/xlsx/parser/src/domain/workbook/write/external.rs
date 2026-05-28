use crate::write::xml_writer::XmlWriter;

pub(super) fn write_external_references(w: &mut XmlWriter, external_reference_r_ids: &[String]) {
    if external_reference_r_ids.is_empty() {
        return;
    }

    w.start_element("externalReferences").end_attrs();
    for r_id in external_reference_r_ids {
        w.start_element("externalReference")
            .attr("r:id", r_id)
            .self_close();
    }
    w.end_element("externalReferences");
}
