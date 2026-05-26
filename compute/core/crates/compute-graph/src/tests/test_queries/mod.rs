use super::*;
use crate::RangeAccess;
use crate::positions::CellPosition;

fn null_resolver(_: &CellId) -> Option<CellPosition> {
    None
}

fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

mod affected_cells;
mod integration;
mod levels;
mod lookups;
mod missing_pos;
mod range_aware;
mod range_deps;
