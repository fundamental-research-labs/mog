use cell_types::SheetId;
use value_types::CellValue;

use crate::snapshot::{CellChange, CellPosition, RecalcResult};

/// Merge `other` into `dest` in place, deduplicating `changed_cells` by
/// (sheet_id, position). `other`'s entries replace any existing entries
/// at the same position; remaining `other` entries are appended.
///
/// Used by `mutation_relocate_cells` to combine the source-clear and
/// target-write recalcs into one viewport-patch payload (filter viewport R5.3).
pub(super) fn merge_recalc_results(dest: &mut RecalcResult, other: RecalcResult) {
    use rustc_hash::FxHashSet;
    if other.changed_cells.is_empty()
        && other.projection_changes.is_empty()
        && other.errors.is_empty()
        && other.validation_annotations.is_empty()
    {
        return;
    }
    let dest_keys: FxHashSet<(String, u32, u32)> = dest
        .changed_cells
        .iter()
        .filter_map(|c| {
            c.position
                .as_ref()
                .map(|p| (c.sheet_id.clone(), p.row, p.col))
        })
        .collect();
    for change in other.changed_cells {
        let key = change
            .position
            .as_ref()
            .map(|p| (change.sheet_id.clone(), p.row, p.col));
        match key {
            Some(k) if dest_keys.contains(&k) => {} // target write wins
            _ => dest.changed_cells.push(change),
        }
    }
    dest.projection_changes.extend(other.projection_changes);
    dest.errors.extend(other.errors);
    dest.validation_annotations
        .extend(other.validation_annotations);
    // Preserve old_values from `other` only when not already present:
    // dest's pre-write snapshot (captured by the target-write pass) is
    // the authoritative read-before-write entry for any position we
    // touched twice.
    for (k, v) in other.old_values {
        dest.old_values.entry(k).or_insert(v);
    }
}

pub(super) fn synthetic_null_change(sheet_id: &SheetId, row: u32, col: u32) -> CellChange {
    CellChange {
        cell_id: String::new(),
        sheet_id: sheet_id.to_uuid_string(),
        position: Some(CellPosition { row, col }),
        value: CellValue::Null,
        display_text: None,
        old_display_text: None,
        old_formula: None,
        new_formula: None,
        number_format: None,
        format_idx: None,
        extra_flags: 0,
        old_value: None,
    }
}
