use super::super::{CellChange, CellChangeKind};
use cell_types::{CellId, SheetId};

pub(super) fn assert_cell_change_base(
    actual: &CellChange,
    sheet_id: SheetId,
    cell_id: CellId,
    kind: CellChangeKind,
) {
    assert_eq!(actual.sheet_id, sheet_id, "sheet_id mismatch");
    assert_eq!(actual.cell_id, cell_id, "cell_id mismatch");
    assert_eq!(actual.kind, kind, "kind mismatch");
}

pub(super) fn contains_cell_change(
    changes: &[CellChange],
    sheet_id: SheetId,
    cell_id: CellId,
    kind: CellChangeKind,
) -> bool {
    changes
        .iter()
        .any(|c| c.sheet_id == sheet_id && c.cell_id == cell_id && c.kind == kind)
}
