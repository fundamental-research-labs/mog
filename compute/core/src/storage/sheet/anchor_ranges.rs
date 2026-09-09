//! Shared identity maintenance for metadata ranges during axis deletion.
use crate::cells::CellStore;
use cell_types::{CellId, SheetId, SheetPos};

/// Resolve surviving corners before the deleted axis identities disappear.
#[allow(clippy::too_many_arguments)]
pub(super) fn reanchor_corners(
    start_id: CellId,
    end_id: CellId,
    cell_store: &mut CellStore,
    sheet_id: SheetId,
    at: u32,
    count: u32,
    rows: bool,
) -> Option<(CellId, CellId)> {
    let (mut sr, mut sc) = cell_store.get_sheet(&sheet_id)?.cell_position(&start_id)?;
    let (mut er, mut ec) = cell_store.get_sheet(&sheet_id)?.cell_position(&end_id)?;
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
    Some((
        cell_store.ensure_identity_at(&sheet_id, SheetPos::new(sr, sc))?,
        cell_store.ensure_identity_at(&sheet_id, SheetPos::new(er, ec))?,
    ))
}
