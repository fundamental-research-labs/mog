use cell_types::SheetId;

use crate::mirror::cell_mirror::CellMirror;

pub(super) fn make_mirror() -> (CellMirror, SheetId) {
    crate::mirror::test_helpers::fresh_mirror_with_sheet(100, 10)
}
