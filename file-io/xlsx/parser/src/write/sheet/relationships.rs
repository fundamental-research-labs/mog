use crate::write::xml_writer::XmlWriter;

pub(super) fn write_drawing(w: &mut XmlWriter, r_id: &Option<String>) {
    if let Some(r_id) = r_id {
        w.start_element("drawing").attr("r:id", r_id).self_close();
    }
}

pub(super) fn write_legacy_drawing(w: &mut XmlWriter, r_id: &Option<String>) {
    if let Some(r_id) = r_id {
        w.start_element("legacyDrawing")
            .attr("r:id", r_id)
            .self_close();
    }
}

pub(super) fn write_legacy_drawing_hf(w: &mut XmlWriter, r_id: &Option<String>) {
    if let Some(r_id) = r_id {
        w.start_element("legacyDrawingHF")
            .attr("r:id", r_id)
            .self_close();
    }
}

pub(super) fn write_pivot_table_definitions(w: &mut XmlWriter, r_ids: &[String]) {
    for r_id in r_ids {
        w.start_element("pivotTableDefinition")
            .attr("r:id", r_id)
            .self_close();
    }
}
