/// Build the `<pivotCaches>` XML fragment for workbook.xml.
pub fn build_pivot_caches_xml(cache_entries: &[(u32, String)]) -> String {
    if cache_entries.is_empty() {
        return String::new();
    }
    let mut xml = "<pivotCaches>".to_string();
    for (cache_id, r_id) in cache_entries {
        xml.push_str(&format!(
            "<pivotCache cacheId=\"{}\" r:id=\"{}\"/>",
            cache_id, r_id,
        ));
    }
    xml.push_str("</pivotCaches>");
    xml
}

/// Build a rels file for a pivot cache definition → records relationship.
pub fn build_pivot_cache_rels_xml(records_path: &str) -> Vec<u8> {
    use crate::write::relationships::RelationshipManager;
    let mut rels = RelationshipManager::new();
    rels.add(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords",
        records_path,
    );
    rels.to_xml()
}
