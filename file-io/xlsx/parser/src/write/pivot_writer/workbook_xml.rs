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

/// Build the workbook extension entry for Office 2010 pivot cache references.
pub fn build_x14_pivot_caches_ext_xml(cache_entries: &[(u32, String)]) -> String {
    if cache_entries.is_empty() {
        return String::new();
    }
    let mut xml = "<ext uri=\"{876F7934-8845-4945-9796-88D515C7AA90}\" xmlns:x14=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"><x14:pivotCaches>".to_string();
    for (cache_id, r_id) in cache_entries {
        xml.push_str(&format!(
            "<pivotCache cacheId=\"{}\" r:id=\"{}\"/>",
            cache_id, r_id,
        ));
    }
    xml.push_str("</x14:pivotCaches></ext>");
    xml
}

/// Build the workbook extension entry for Office 2013 timeline pivot cache refs.
pub fn build_x15_timeline_cache_pivot_caches_ext_xml(cache_entries: &[(u32, String)]) -> String {
    if cache_entries.is_empty() {
        return String::new();
    }
    let mut xml = "<ext uri=\"{A2CB5862-8E78-49c6-8D9D-AF26E26ADB89}\" xmlns:x15=\"http://schemas.microsoft.com/office/spreadsheetml/2010/11/main\"><x15:timelineCachePivotCaches>".to_string();
    for (cache_id, r_id) in cache_entries {
        xml.push_str(&format!(
            "<pivotCache cacheId=\"{}\" r:id=\"{}\"/>",
            cache_id, r_id,
        ));
    }
    xml.push_str("</x15:timelineCachePivotCaches></ext>");
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
