pub(super) fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

pub(super) fn pivot_cache_definition_path(global_idx: usize) -> String {
    normalize_part_path(&format!(
        "xl/pivotCache/pivotCacheDefinition{}.xml",
        global_idx
    ))
}

pub(super) fn pivot_cache_records_path(global_idx: usize) -> String {
    normalize_part_path(&format!(
        "xl/pivotCache/pivotCacheRecords{}.xml",
        global_idx
    ))
}

pub(super) fn pivot_cache_rels_path(global_idx: usize) -> String {
    normalize_part_path(&format!(
        "xl/pivotCache/_rels/pivotCacheDefinition{}.xml.rels",
        global_idx
    ))
}

pub(super) fn pivot_table_path(global_idx: usize) -> String {
    normalize_part_path(&format!("xl/pivotTables/pivotTable{}.xml", global_idx))
}

pub(super) fn pivot_table_rels_path(global_idx: usize) -> String {
    normalize_part_path(&format!(
        "xl/pivotTables/_rels/pivotTable{}.xml.rels",
        global_idx
    ))
}
