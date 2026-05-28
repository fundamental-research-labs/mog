use super::{read, write};

/// Populate a write-side `SmartArtWriteData` with raw XML parts from a read-side `SmartArtParts`.
pub fn populate_smartart_parts(
    write_data: &mut write::SmartArtWriteData,
    parts: &read::SmartArtParts,
) {
    write_data.data_xml = parts.data_xml.clone();
    write_data.layout_xml = parts.layout_xml.clone();
    write_data.colors_xml = parts.colors_xml.clone();
    write_data.style_xml = parts.style_xml.clone();
    write_data.drawing_xml = parts.drawing_xml.clone();
}

pub(super) fn smartart_to_write_data(sa: &read::SmartArtGraphicFrame) -> write::SmartArtWriteData {
    write::SmartArtWriteData {
        original_id: None,
        name: String::new(),
        dm_rel_id: sa.dm_rel_id.clone(),
        lo_rel_id: sa.lo_rel_id.clone(),
        qs_rel_id: sa.qs_rel_id.clone(),
        cs_rel_id: sa.cs_rel_id.clone(),
        data_xml: None,
        layout_xml: None,
        colors_xml: None,
        style_xml: None,
        drawing_xml: None,
    }
}
