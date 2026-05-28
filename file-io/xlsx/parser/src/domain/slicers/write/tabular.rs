use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::{SlicerCrossFilter, SlicerSortOrder, SlicerTabularData};

use super::attrs::{cross_filter_str, sort_order_str};

pub(super) fn write_tabular_data(w: &mut XmlWriter, data: &SlicerTabularData) {
    w.start_element("data").end_attrs();

    w.start_element("tabular")
        .attr("pivotCacheId", &data.pivot_cache_id.to_string());

    if data.sort_order != SlicerSortOrder::Ascending {
        w.attr("sortOrder", sort_order_str(data.sort_order));
    }
    if data.custom_list_sort {
        w.attr("customListSort", "1");
    }
    if data.show_missing {
        w.attr("showMissing", "1");
    }
    if data.cross_filter != SlicerCrossFilter::ShowItemsWithDataAtTop {
        w.attr("crossFilter", cross_filter_str(data.cross_filter));
    }

    w.end_attrs();

    if !data.items.is_empty() {
        w.start_element("items")
            .attr("count", &data.items.len().to_string())
            .end_attrs();

        for item in &data.items {
            w.start_element("i").attr("x", &item.x.to_string());
            if item.s {
                w.attr("s", "1");
            }
            if item.nd {
                w.attr("nd", "1");
            }
            w.self_close();
        }

        w.end_element("items");
    }

    w.end_element("tabular");
    w.end_element("data");
}
