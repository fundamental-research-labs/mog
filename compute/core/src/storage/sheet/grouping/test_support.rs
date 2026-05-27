use super::super::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .expect("add_sheet");
    (storage, sid)
}

pub(super) struct MockCellAccessor {
    pub(super) cells: std::collections::HashMap<(u32, u32), String>,
}
impl MockCellAccessor {
    pub(super) fn new() -> Self {
        Self {
            cells: std::collections::HashMap::new(),
        }
    }
    pub(super) fn set(&mut self, r: u32, c: u32, v: &str) {
        self.cells.insert((r, c), v.to_string());
    }
}
impl SubtotalsCellAccessor for MockCellAccessor {
    fn get_cell_value(&self, _: &SheetId, r: u32, c: u32) -> String {
        self.cells.get(&(r, c)).cloned().unwrap_or_default()
    }
    fn set_cell_value(&mut self, _: &SheetId, r: u32, c: u32, v: &str) {
        self.cells.insert((r, c), v.into());
    }
    fn insert_rows(&mut self, _: &SheetId, sr: u32, cnt: u32) {
        let mut n = std::collections::HashMap::new();
        for (&(r, c), v) in &self.cells {
            if r >= sr {
                n.insert((r + cnt, c), v.clone());
            } else {
                n.insert((r, c), v.clone());
            }
        }
        self.cells = n;
    }
    fn delete_rows(&mut self, _: &SheetId, sr: u32, cnt: u32) {
        let mut n = std::collections::HashMap::new();
        for (&(r, c), v) in &self.cells {
            if r >= sr + cnt {
                n.insert((r - cnt, c), v.clone());
            } else if r < sr {
                n.insert((r, c), v.clone());
            }
        }
        self.cells = n;
    }
    fn get_cell_raw_value(&self, _: &SheetId, r: u32, c: u32) -> String {
        self.cells.get(&(r, c)).cloned().unwrap_or_default()
    }
}
