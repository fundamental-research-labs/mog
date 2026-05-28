use crate::infra::xml::raw_xml_contains_relationship_attr;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::SlicerCacheDef;

use super::namespaces::{NS_MC, NS_X, NS_X14, NS_X15, NS_XR10};
use super::table_cache_ext::write_table_slicer_cache_ext;
use super::tabular::write_tabular_data;

/// Serialize a slicer cache definition to an `xl/slicerCaches/slicerCache{N}.xml` part.
///
/// Uses the x14 namespace as the default namespace (matching Excel's output).
/// For table-based slicers (x15 path): writes extLst with `x15:tableSlicerCache`.
/// For pivot-backed slicers (x14 path): writes `data/tabular` with items.
pub fn write_slicer_cache(cache: &SlicerCacheDef) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    w.start_element("slicerCacheDefinition")
        .attr("xmlns", NS_X14)
        .attr("xmlns:mc", NS_MC)
        .attr("mc:Ignorable", "x xr10")
        .attr("xmlns:x", NS_X)
        .attr("xmlns:xr10", NS_XR10);

    if cache.table_slicer_cache.is_some() {
        w.attr("xmlns:x15", NS_X15);
    }

    w.attr("name", &cache.name);

    if let Some(ref uid) = cache.uid {
        w.attr("xr10:uid", uid);
    }

    w.attr("sourceName", &cache.source_name).end_attrs();

    if !cache.pivot_tables.is_empty() {
        w.start_element("pivotTables").end_attrs();
        for pt in &cache.pivot_tables {
            w.start_element("pivotTable")
                .attr("tabId", &pt.tab_id.to_string())
                .attr("name", &pt.name)
                .self_close();
        }
        w.end_element("pivotTables");
    }

    if let Some(ref tabular) = cache.tabular_data {
        write_tabular_data(&mut w, tabular);
    }

    if let Some(ref tsc) = cache.table_slicer_cache {
        write_table_slicer_cache_ext(&mut w, tsc, cache.ext_lst.as_deref());
    }

    if cache.table_slicer_cache.is_none() {
        if let Some(ref ext_xml) = cache.ext_lst {
            if !raw_xml_contains_relationship_attr(ext_xml) {
                w.raw_str(ext_xml);
            }
        }
    }

    w.end_element("slicerCacheDefinition");
    w.finish()
}
