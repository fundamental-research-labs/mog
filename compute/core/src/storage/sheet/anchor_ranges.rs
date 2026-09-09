//! Shared identity maintenance for metadata ranges during axis deletion.
use crate::mirror::CellMirror;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::identity::GridIndex;

/// Resolve surviving corners before the deleted axis identities disappear.
#[allow(clippy::too_many_arguments)]
pub(super) fn reanchor_corners(
    start_id: CellId,
    end_id: CellId,
    grid: &mut GridIndex,
    mirror: &mut CellMirror,
    sheet_id: SheetId,
    at: u32,
    count: u32,
    rows: bool,
) -> Option<(CellId, CellId)> {
    let (mut sr, mut sc) = grid.cell_position(&start_id)?;
    let (mut er, mut ec) = grid.cell_position(&end_id)?;
    let (start, end) = if rows {
        (&mut sr, &mut er)
    } else {
        (&mut sc, &mut ec)
    };
    if *start > *end {
        return None;
    }
    let deleted_end = at.saturating_add(count);
    if *start >= at && *end < deleted_end {
        return None;
    }
    if *start >= at && *start < deleted_end {
        *start = deleted_end;
    }
    if *end >= at && *end < deleted_end {
        *end = at.checked_sub(1)?;
    }
    let mut ensure = |row, col| {
        let pos = SheetPos::new(row, col);
        if grid.cell_id_at(row, col).is_none() {
            if let Some(id) = mirror.resolve_cell_id(&sheet_id, pos) {
                grid.register_cell(id, row, col);
            }
            crate::storage::cells::values::maybe_register_virtual_cell_id(
                mirror, &sheet_id, grid, row, col,
            );
        }
        let id = grid.ensure_cell_id(row, col);
        mirror.register_identity_position(sheet_id, pos, id);
        id
    };
    Some((ensure(sr, sc), ensure(er, ec)))
}
