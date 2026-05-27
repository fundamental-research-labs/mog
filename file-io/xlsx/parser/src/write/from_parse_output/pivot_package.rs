use crate::write::REL_PIVOT_TABLE;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::relationships::RelationshipManager;

// Writer-facing pivot package ownership helpers.
//
// Without a typed `RoundTripContext.pivot_package` sidecar, generated pivot data
// owns the legacy pivot package directories to avoid replaying stale unknown
// parts. With the sidecar, preservation is exact-path and exact-relationship:
// clean imported and orphan parts are replayed, generated/dirty/deleted parts
// replace only their proven paths, and API-created pivots remain generated.

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
