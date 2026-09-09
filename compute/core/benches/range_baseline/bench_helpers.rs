use super::support::{cell_uuid, sheet_uuid};
use cell_types::{CellId, SheetId};
use compute_core::cells::CellStore;
use compute_core::scheduler::ComputeCore;
use snapshot_types::WorkbookSnapshot;

pub(crate) fn sheet_id(sheet_idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(sheet_idx)).expect("sheet id")
}

pub(crate) fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("cell id")
}

pub(crate) fn init_snapshot(snapshot: WorkbookSnapshot) -> (ComputeCore, CellStore) {
    let mut core = ComputeCore::new();
    let mut cell_store = CellStore::new();
    core.init_from_snapshot(&mut cell_store, snapshot).unwrap();
    (core, cell_store)
}
