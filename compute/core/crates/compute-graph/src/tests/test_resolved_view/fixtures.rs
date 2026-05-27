use super::*;

pub(super) fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(super) fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

// ─────────────────────────────────────────────────────────────────
// Helper: closure-based position resolver from a Vec
// ─────────────────────────────────────────────────────────────────

/// Build a closure-based `PositionResolver` from a position table.
///
/// Each entry is `(cell_id, sheet_id, row, col)`. The returned closure
/// resolves any `CellId` in the table to its `CellPosition`.
pub(super) fn make_resolver(
    positions: Vec<(CellId, SheetId, u32, u32)>,
) -> impl Fn(&CellId) -> Option<CellPosition> {
    move |cell: &CellId| -> Option<CellPosition> {
        positions
            .iter()
            .find(|(id, _, _, _)| id == cell)
            .map(|&(_, sheet, row, col)| CellPosition { sheet, row, col })
    }
}
