use crate::write::xml_writer::XmlWriter;

use super::SheetDef;
use super::attrs::sheet_state_to_xml_value;

/// Write sheets section.
pub(super) fn write_sheets(w: &mut XmlWriter, sheets: &[SheetDef]) {
    if sheets.is_empty() {
        w.start_element("sheets").end_attrs();
        w.start_element("sheet")
            .attr("name", "Sheet1")
            .attr_num("sheetId", 1)
            .attr("r:id", "rId1")
            .self_close();
        w.end_element("sheets");
        return;
    }

    w.start_element("sheets").end_attrs();

    for sheet in sheets {
        w.start_element("sheet")
            .attr("name", &sheet.name)
            .attr_num("sheetId", sheet.sheet_id);

        if let Some(state) = sheet_state_to_xml_value(sheet.state) {
            w.attr("state", state);
        }

        w.attr("r:id", &sheet.r_id).self_close();
    }

    w.end_element("sheets");
}
