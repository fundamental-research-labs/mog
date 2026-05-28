use crate::write::xml_writer::XmlWriter;

use super::TableStyleInfo;

pub(crate) fn write_table_style_info_xml(style: &TableStyleInfo, w: &mut XmlWriter) {
    let elem = w.start_element("tableStyleInfo");
    if let Some(name) = &style.name {
        elem.attr("name", name);
    }
    elem.attr_bool("showFirstColumn", style.show_first_column)
        .attr_bool("showLastColumn", style.show_last_column)
        .attr_bool("showRowStripes", style.show_row_stripes)
        .attr_bool("showColumnStripes", style.show_column_stripes)
        .self_close();
}

/// Create a default `TableStyleInfo` for the write path (uses "TableStyleMedium2").
pub fn default_table_style_info() -> TableStyleInfo {
    TableStyleInfo::new("TableStyleMedium2")
}
