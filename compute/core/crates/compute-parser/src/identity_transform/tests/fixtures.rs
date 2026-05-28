use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use cell_types::{CellId, ColId, RowId, SheetId};

use crate::IdentityResolver;

/// Mock resolver for tests. Creates CellIds/RowIds/ColIds on the fly
/// using simple deterministic counters. Uses interior mutability so that
/// `get_or_create_cell_id(&self)` can allocate new IDs.
pub(super) struct MockResolver {
    sheet: SheetId,
    next_cell_id: Cell<u128>,
    cell_ids: RefCell<HashMap<(SheetId, u32, u32), CellId>>,
    row_ids: HashMap<(SheetId, u32), RowId>,
    col_ids: HashMap<(SheetId, u32), ColId>,
    sheets: HashMap<String, SheetId>,
}

impl MockResolver {
    pub(super) fn new() -> Self {
        let sheet = SheetId::from_raw(1);
        let mut row_ids = HashMap::new();
        let mut col_ids = HashMap::new();
        // Pre-populate dense row/col IDs (rows 0-999, cols 0-25).
        for r in 0..1000 {
            row_ids.insert((sheet, r), RowId::from_raw(1000 + u128::from(r)));
        }
        for c in 0..26 {
            col_ids.insert((sheet, c), ColId::from_raw(2000 + u128::from(c)));
        }
        Self {
            sheet,
            next_cell_id: Cell::new(100),
            cell_ids: RefCell::new(HashMap::new()),
            row_ids,
            col_ids,
            sheets: HashMap::new(),
        }
    }

    /// Add a second sheet to the resolver for cross-sheet tests.
    pub(super) fn add_sheet(&mut self, name: &str, id: u128) {
        let sheet_id = SheetId::from_raw(id);
        self.sheets.insert(name.to_string(), sheet_id);
        // Populate row/col IDs for the new sheet as well.
        for r in 0..1000 {
            self.row_ids.insert(
                (sheet_id, r),
                RowId::from_raw(id * 10000 + 1000 + u128::from(r)),
            );
        }
        for c in 0..26 {
            self.col_ids.insert(
                (sheet_id, c),
                ColId::from_raw(id * 10000 + 2000 + u128::from(c)),
            );
        }
    }
}

impl IdentityResolver for MockResolver {
    fn get_or_create_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> CellId {
        let mut cell_ids = self.cell_ids.borrow_mut();
        *cell_ids.entry((*sheet, row, col)).or_insert_with(|| {
            let id = CellId::from_raw(self.next_cell_id.get());
            self.next_cell_id.set(self.next_cell_id.get() + 1);
            id
        })
    }

    fn get_row_id(&self, sheet: &SheetId, row: u32) -> Option<RowId> {
        self.row_ids.get(&(*sheet, row)).copied()
    }

    fn get_col_id(&self, sheet: &SheetId, col: u32) -> Option<ColId> {
        self.col_ids.get(&(*sheet, col)).copied()
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        self.sheets.get(name).copied()
    }

    fn current_sheet(&self) -> SheetId {
        self.sheet
    }
}

// ── Basic cell reference tests ──────────────────────────────────
