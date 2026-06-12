use domain_types::domain::connections::QueryTable;
use domain_types::domain::table::TableSpec;

pub(super) fn table_ooxml_id_for_export(
    table: &TableSpec,
    fallback_global_idx: u32,
    used: &mut std::collections::HashSet<u32>,
) -> u32 {
    if table.id > 0 && used.insert(table.id) {
        return table.id;
    }
    let mut candidate = fallback_global_idx.max(1);
    loop {
        if used.insert(candidate) {
            return candidate;
        }
        candidate = candidate.saturating_add(1);
    }
}

pub(super) fn table_part_path_for_export(table: &TableSpec, fallback_global_idx: usize) -> String {
    table
        .table_part_path_hint
        .as_deref()
        .and_then(normalized_table_part_path)
        .unwrap_or_else(|| format!("xl/tables/table{fallback_global_idx}.xml"))
}

pub(super) fn worksheet_target_for_table_part(path: &str) -> String {
    path.strip_prefix("xl/")
        .map(|rest| format!("../{rest}"))
        .unwrap_or_else(|| path.to_string())
}

pub(super) fn query_table_part_path_for_export(
    query_table: &QueryTable,
    fallback_global_idx: usize,
) -> String {
    query_table
        .path_hint
        .as_deref()
        .and_then(normalized_query_table_part_path)
        .unwrap_or_else(|| format!("xl/queryTables/queryTable{fallback_global_idx}.xml"))
}

fn normalized_table_part_path(path: &str) -> Option<String> {
    let normalized = domain_types::normalize_package_path(path);
    (normalized.starts_with("xl/tables/table") && normalized.ends_with(".xml"))
        .then_some(normalized)
}

fn normalized_query_table_part_path(path: &str) -> Option<String> {
    let normalized = domain_types::normalize_package_path(path);
    (normalized.starts_with("xl/queryTables/queryTable") && normalized.ends_with(".xml"))
        .then_some(normalized)
}
