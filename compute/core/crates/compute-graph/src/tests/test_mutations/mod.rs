use super::*;
use crate::RangeAccess;
use crate::positions::CellPosition;

fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn null_resolver() -> impl PositionResolver {
    |_: &CellId| -> Option<CellPosition> { None }
}

mod basic_edges;
mod builder_and_batch;
mod construction;
mod edge_stats;
mod external_precedents;
mod range_thresholds;
mod remove_cell;
mod replace_precedents;
mod sheet_range_cleanup;
mod volatile_and_clear;
