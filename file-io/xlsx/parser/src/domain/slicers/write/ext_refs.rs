use crate::write::xml_writer::XmlWriter;

use super::namespaces::{EXT_URI_SLICER_CACHES, EXT_URI_SLICER_LIST, NS_X14};

/// Write a worksheet extLst entry that references a slicer part.
///
/// The caller is responsible for wrapping this in an `<extLst>` container.
pub fn write_worksheet_slicer_ext(w: &mut XmlWriter, r_id: &str) {
    w.start_element("ext")
        .attr("uri", EXT_URI_SLICER_LIST)
        .attr("xmlns:x14", NS_X14)
        .end_attrs();

    w.start_element("x14:slicerList").end_attrs();
    w.start_element("x14:slicer")
        .attr("r:id", r_id)
        .self_close();
    w.end_element("x14:slicerList");

    w.end_element("ext");
}

/// Write a workbook extLst entry that references slicer caches.
///
/// The caller is responsible for wrapping this in an `<extLst>` container.
pub fn write_workbook_slicer_caches_ext(w: &mut XmlWriter, r_ids: &[&str]) {
    w.start_element("ext")
        .attr("uri", EXT_URI_SLICER_CACHES)
        .attr("xmlns:x14", NS_X14)
        .end_attrs();

    w.start_element("x14:slicerCaches").end_attrs();
    for r_id in r_ids {
        w.start_element("x14:slicerCache")
            .attr("r:id", r_id)
            .self_close();
    }
    w.end_element("x14:slicerCaches");

    w.end_element("ext");
}
