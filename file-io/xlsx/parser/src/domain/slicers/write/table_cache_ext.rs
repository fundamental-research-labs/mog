use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::raw_xml_contains_relationship_attr;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::{SlicerCrossFilter, SlicerSortOrder, TableSlicerCache};

use super::attrs::{cross_filter_str, sort_order_str};
use super::namespaces::EXT_URI_TABLE_SLICER_CACHE;

pub(super) fn write_table_slicer_cache_ext(
    w: &mut XmlWriter,
    tsc: &TableSlicerCache,
    source_ext_lst: Option<&str>,
) {
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

    if let Some(ref ext_lst) = tsc.ext_lst {
        if !raw_xml_contains_relationship_attr(ext_lst) {
            w.end_attrs();
            w.raw_str(ext_lst);
            w.end_element("x15:tableSlicerCache");
        } else {
            w.self_close();
        }
    } else {
        w.self_close();
    }

    w.end_element("x:ext");
    write_unknown_root_exts(w, source_ext_lst);
    w.end_element("extLst");
}

fn write_unknown_root_exts(w: &mut XmlWriter, source_ext_lst: Option<&str>) {
    let Some(ext_lst) = source_ext_lst else {
        return;
    };
    if raw_xml_contains_relationship_attr(ext_lst) {
        return;
    }

    for ext in extract_ext_entries(ext_lst.as_bytes()) {
        if !ext.contains("tableSlicerCache") {
            w.raw_str(&ext);
        }
    }
}

fn extract_ext_entries(xml: &[u8]) -> Vec<String> {
    let mut entries = Vec::new();
    let mut pos = 0;

    while let Some(ext_start) = find_tag_simd(xml, b"ext", pos) {
        let elem_end = find_gt_simd(xml, ext_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let ext_end = if elem_end > ext_start && xml[elem_end - 2] == b'/' {
            elem_end
        } else {
            find_closing_tag(xml, b"ext", elem_end)
                .and_then(|close_start| find_gt_simd(xml, close_start).map(|end| end + 1))
                .unwrap_or(elem_end)
        };

        if let Ok(raw) = std::str::from_utf8(&xml[ext_start..ext_end]) {
            entries.push(raw.to_string());
        }
        pos = ext_end;
    }

    entries
}
