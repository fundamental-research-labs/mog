use super::support::{cell_uuid, sheet_uuid};
use cell_types::{CellId, SheetId};
use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use snapshot_types::WorkbookSnapshot;

pub(crate) fn sheet_id(sheet_idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(sheet_idx)).expect("sheet id")
}

pub(crate) fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("cell id")
}

pub(crate) fn init_snapshot(snapshot: WorkbookSnapshot) -> (ComputeCore, CellMirror) {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::new();
    core.init_from_snapshot(&mut mirror, snapshot).unwrap();
    (core, mirror)
}
