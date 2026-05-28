use super::*;

pub(super) fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(super) fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}
