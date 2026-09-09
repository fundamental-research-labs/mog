use cell_types::SheetId;

use crate::cells::cell_store::CellStore;

pub(super) fn make_store() -> (CellStore, SheetId) {
    crate::cells::test_helpers::fresh_store_with_sheet(100, 10)
}
