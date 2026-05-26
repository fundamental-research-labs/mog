use crate::domain::content_types::write::{CT_PIVOT_CACHE, CT_PIVOT_TABLE, ContentTypesManager};
use crate::write::pivot_writer::PivotWriteData;
use crate::write::relationships::RelationshipManager;
use crate::write::{REL_PIVOT_CACHE, REL_PIVOT_TABLE};

// Writer-facing pivot package ownership helpers.
//
// Without a typed `RoundTripContext.pivot_package` sidecar, generated pivot data
// owns the legacy pivot package directories to avoid replaying stale unknown
// parts. With the sidecar, preservation is exact-path and exact-relationship:
// clean imported and orphan parts are replayed, generated/dirty/deleted parts
// replace only their proven paths, and API-created pivots remain generated.

pub(super) const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";

pub(super) fn writer_owns_package_parts(pivot_data: &PivotWriteData) -> bool {
    !pivot_data.pivot_table_entries.is_empty() || !pivot_data.pivot_cache_entries.is_empty()
}

pub(super) fn keep_sheet_relationship(
    pivot_data: &PivotWriteData,
    rel: &domain_types::OpcRelationship,
) -> bool {
    if rel.rel_type != REL_PIVOT_TABLE {
        return true;
    }
    if pivot_data.has_typed_package_contract {
        return pivot_data
            .preserved_pivot_table_entries
            .iter()
            .any(|entry| {
                entry.relationship_id == rel.id && entry.relationship_target == rel.target
            });
    }
    !writer_owns_package_parts(pivot_data)
}

pub(super) fn keep_workbook_relationship(
    pivot_data: &PivotWriteData,
    rel: &domain_types::OpcRelationship,
) -> bool {
    if rel.rel_type != REL_PIVOT_CACHE {
        return true;
    }
    if pivot_data.has_typed_package_contract {
        if pivot_data
            .preserved_workbook_cache_entries
            .iter()
            .any(|entry| entry.relationship_id == rel.id && entry.relationship_target == rel.target)
        {
            return true;
        }
        let target_path = normalize_workbook_relationship_target(&rel.target);
        return pivot_data.preserved_part_paths.contains(&target_path)
            && !pivot_data.generated_part_paths.contains(&target_path);
    }
    !writer_owns_package_parts(pivot_data)
}

pub(super) fn keep_content_type_override(
    pivot_data: &PivotWriteData,
    part_name: &str,
    content_type: &str,
) -> bool {
    if !is_pivot_content_type_override(part_name, content_type) {
        return true;
    }
    if pivot_data.has_typed_package_contract {
        let part_name = normalize_content_type_part_name(part_name);
        return pivot_data
            .preserved_content_type_part_names
            .contains(&part_name)
            && !pivot_data
                .generated_part_paths
                .contains(&normalize_part_path(part_name.as_str()));
    }
    !writer_owns_package_parts(pivot_data)
}

pub(super) fn keep_binary_blob(pivot_data: &PivotWriteData, path: &str) -> bool {
    if !is_managed_pivot_part_path(path) {
        return true;
    }
    if pivot_data.has_typed_package_contract {
        let path = normalize_part_path(path);
        return pivot_data.preserved_part_paths.contains(&path)
            && !pivot_data.generated_part_paths.contains(&path);
    }
    !writer_owns_package_parts(pivot_data)
}

pub(super) fn add_sheet_relationships(
    rels: &mut RelationshipManager,
    pivot_data: &PivotWriteData,
    sheet_idx: usize,
) -> Vec<String> {
    let mut r_ids = Vec::new();
    for entry in &pivot_data.preserved_pivot_table_entries {
        if entry.sheet_idx != sheet_idx {
            continue;
        }
        if rels.find_by_target(&entry.relationship_target).is_some() {
            continue;
        }
        if rels.get_by_id(&entry.relationship_id).is_none() {
            rels.add_with_id(
                &entry.relationship_id,
                REL_PIVOT_TABLE,
                &entry.relationship_target,
            );
        }
    }
    for entry in &pivot_data.pivot_table_entries {
        if entry.sheet_idx != sheet_idx {
            continue;
        }
        let target = format!("../pivotTables/pivotTable{}.xml", entry.global_idx);
        let r_id = rels
            .find_by_target(&target)
            .unwrap_or_else(|| rels.add(REL_PIVOT_TABLE, &target));
        r_ids.push(r_id);
    }
    r_ids
}

pub(super) fn preserved_sheet_relationship_ids(
    pivot_data: &PivotWriteData,
    sheet_idx: usize,
) -> Vec<String> {
    pivot_data
        .preserved_pivot_table_entries
        .iter()
        .filter(|entry| entry.sheet_idx == sheet_idx)
        .map(|entry| entry.relationship_id.clone())
        .collect()
}

pub(super) fn add_pivot_content_types(
    content_types: &mut ContentTypesManager,
    pivot_data: &PivotWriteData,
) {
    for entry in &pivot_data.pivot_table_entries {
        let path = format!("/xl/pivotTables/pivotTable{}.xml", entry.global_idx);
        if !content_types.has_override(&path) {
            content_types.add_pivot_table(entry.global_idx);
        }
    }
    for entry in &pivot_data.pivot_cache_entries {
        let def_path = format!(
            "/xl/pivotCache/pivotCacheDefinition{}.xml",
            entry.global_idx
        );
        if !content_types.has_override(&def_path) {
            content_types.add_pivot_cache(entry.global_idx);
        }
        let rec_path = format!("/xl/pivotCache/pivotCacheRecords{}.xml", entry.global_idx);
        if !content_types.has_override(&rec_path) {
            content_types.add_override(&rec_path, CT_PIVOT_CACHE_RECORDS);
        }
    }
}

fn is_managed_pivot_part_path(path: &str) -> bool {
    let path = path.trim_start_matches('/');
    path.starts_with("xl/pivotTables/") || path.starts_with("xl/pivotCache/")
}

fn is_pivot_content_type_override(part_name: &str, content_type: &str) -> bool {
    is_managed_pivot_part_path(part_name)
        || content_type == CT_PIVOT_TABLE
        || content_type == CT_PIVOT_CACHE
        || content_type == CT_PIVOT_CACHE_RECORDS
}

fn normalize_part_path(path: &str) -> String {
    path.trim_start_matches('/').to_string()
}

fn normalize_content_type_part_name(path: &str) -> String {
    format!("/{}", normalize_part_path(path))
}

fn normalize_workbook_relationship_target(target: &str) -> String {
    let target = target.trim_start_matches('/');
    if target.starts_with("xl/") {
        target.to_string()
    } else {
        format!("xl/{target}")
    }
}
