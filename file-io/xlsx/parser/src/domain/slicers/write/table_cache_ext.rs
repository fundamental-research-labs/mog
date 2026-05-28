use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::{SlicerCrossFilter, SlicerSortOrder, TableSlicerCache};

use super::attrs::{cross_filter_str, sort_order_str};
use super::namespaces::EXT_URI_TABLE_SLICER_CACHE;

pub(super) fn write_table_slicer_cache_ext(w: &mut XmlWriter, tsc: &TableSlicerCache) {
    w.start_element("extLst").end_attrs();
    w.start_element("x:ext")
        .attr("uri", EXT_URI_TABLE_SLICER_CACHE)
        .end_attrs();

    w.start_element("x15:tableSlicerCache")
        .attr("tableId", &tsc.table_id.to_string())
        .attr("column", &tsc.column.to_string());

    if tsc.sort_order != SlicerSortOrder::Ascending {
        w.attr("sortOrder", sort_order_str(tsc.sort_order));
    }
    if tsc.custom_list_sort {
        w.attr("customListSort", "1");
    }
    if tsc.cross_filter != SlicerCrossFilter::ShowItemsWithDataAtTop {
        w.attr("crossFilter", cross_filter_str(tsc.cross_filter));
    }

    w.self_close();

    w.end_element("x:ext");
    w.end_element("extLst");
}
