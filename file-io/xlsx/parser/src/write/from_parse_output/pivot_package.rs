use crate::write::REL_PIVOT_TABLE;
use crate::write::pivot_writer::PivotWriteData;
use crate::write::relationships::RelationshipManager;

// Writer-facing pivot package helpers. Pivots are generated from modeled
// `ParseOutput` state.

pub(super) fn add_sheet_relationships(
    rels: &mut RelationshipManager,
    pivot_data: &PivotWriteData,
    sheet_idx: usize,
) -> Vec<String> {
    let mut r_ids = Vec::new();
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
