use super::*;

pub(super) fn build_changed_position_index(
    changed_cells: &[CellChange],
    projection_changes: &[ProjectionChange],
) -> FxHashMap<(SheetId, u32), Vec<u32>> {
    let mut idx: FxHashMap<(SheetId, u32), Vec<u32>> = FxHashMap::default();
    for change in changed_cells {
        if let (Ok(sid), Some(pos)) = (
            SheetId::from_uuid_str(&change.sheet_id),
            change.position.as_ref(),
        ) {
            idx.entry((sid, pos.col)).or_default().push(pos.row);
        }
    }
    for change in projection_changes {
        if let Ok(sid) = SheetId::from_uuid_str(&change.sheet_id) {
            for cell in &change.projection_cells {
                idx.entry((sid, cell.col)).or_default().push(cell.row);
            }
        }
    }
    for rows in idx.values_mut() {
        rows.sort_unstable();
        rows.dedup();
    }
    idx
}
