use std::collections::HashMap;

use cell_types::{CellId, ColId, RowId, SheetId};
use workbook_types::{
    ExternalA1Cell, ExternalA1Range, ExternalAbsFlags, ExternalCellRef, ExternalNameRef,
    ExternalRangeAbsFlags, ExternalRangeRef, ExternalSheetKey, LinkId,
};

use crate::identity_formula::WorkbookLookup;

pub(super) fn cell(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(super) fn row(n: u128) -> RowId {
    RowId::from_raw(n)
}

pub(super) fn col(n: u128) -> ColId {
    ColId::from_raw(n)
}

pub(super) fn sheet(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn link(n: u128) -> LinkId {
    LinkId::from_raw(n)
}

pub(super) struct TestLookup {
    pub(super) formula_sheet: SheetId,
    pub(super) cells: HashMap<CellId, (SheetId, u32, u32)>,
    pub(super) rows: HashMap<RowId, (SheetId, u32)>,
    pub(super) cols: HashMap<ColId, (SheetId, u32)>,
    pub(super) sheet_names: HashMap<SheetId, String>,
}

impl TestLookup {
    pub(super) fn with_formula_sheet(formula_sheet: SheetId) -> Self {
        Self {
            formula_sheet,
            ..Self::default()
        }
    }
}

impl Default for TestLookup {
    fn default() -> Self {
        Self {
            formula_sheet: sheet(0),
            cells: HashMap::default(),
            rows: HashMap::default(),
            cols: HashMap::default(),
            sheet_names: HashMap::default(),
        }
    }
}

impl WorkbookLookup for TestLookup {
    fn cell_position(&self, id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.cells.get(id).copied()
    }

    fn row_index(&self, id: &RowId) -> Option<(SheetId, u32)> {
        self.rows.get(id).copied()
    }

    fn col_index(&self, id: &ColId) -> Option<(SheetId, u32)> {
        self.cols.get(id).copied()
    }

    fn sheet_name(&self, id: &SheetId) -> Option<&str> {
        self.sheet_names.get(id).map(String::as_str)
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

pub(super) fn external_cell_ref(n: u128) -> ExternalCellRef {
    ExternalCellRef {
        link_id: link(n),
        sheet: ExternalSheetKey::Name {
            name: "ExternalSheet".to_string(),
        },
        address: ExternalA1Cell { row: 1, col: 2 },
        abs: ExternalAbsFlags {
            row_abs: true,
            col_abs: false,
        },
    }
}

pub(super) fn external_range_ref(n: u128) -> ExternalRangeRef {
    ExternalRangeRef {
        link_id: link(n),
        sheet: ExternalSheetKey::Name {
            name: "ExternalSheet".to_string(),
        },
        address: ExternalA1Range {
            start: ExternalA1Cell { row: 1, col: 1 },
            end: ExternalA1Cell { row: 3, col: 2 },
        },
        abs: ExternalRangeAbsFlags {
            start: ExternalAbsFlags {
                row_abs: false,
                col_abs: false,
            },
            end: ExternalAbsFlags {
                row_abs: true,
                col_abs: true,
            },
        },
    }
}

pub(super) fn external_name_ref(n: u128) -> ExternalNameRef {
    ExternalNameRef {
        link_id: link(n),
        sheet: None,
        name: "Rates".to_string(),
    }
}
