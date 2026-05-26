//! unified reference model — invariants #1, #2, #9 tests.
//!
//! Red tests: cross-sheet FullRow/FullCol/RowRange/ColRange refs must emit the
//! sheet prefix when the ref's sheet differs from the formula's sheet. Today
//! the prefix is silently dropped because (a) `row_index`/`col_index` return
//! `Option<u32>` (no sheet) and (b) the a1_display/r1c1_display arms for the
//! four row/col variants don't call `add_sheet_prefix` even if they knew.
//!
//! Green tests: same-sheet row/col refs omit the prefix (regression guard),
//! and cells remain round-trip correct under sheet rename.

use std::collections::HashMap;

use cell_types::{CellId, ColId, RowId, SheetId};
use compute_parser::to_a1_string;
use formula_types::{
    IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRowRangeRef, WorkbookLookup,
};

// ---------------------------------------------------------------------------
// Test harness — minimal WorkbookLookup-capable mock.
// ---------------------------------------------------------------------------

/// Minimal lookup that maps `CellId -> (SheetId, row, col)`, `RowId -> (SheetId, index)`,
/// `ColId -> (SheetId, index)`, and sheet-id → name.
///
/// Returns the full `(SheetId, u32)` tuple from `row_index`/`col_index` so that
/// `format_ref` can emit a sheet prefix when the referenced row/col's sheet
/// differs from the formula's sheet.
struct TestLookup {
    formula_sheet: SheetId,
    cell_positions: HashMap<CellId, (SheetId, u32, u32)>,
    /// Real storage of "which sheet does this RowId live on + what is its index".
    row_data: HashMap<RowId, (SheetId, u32)>,
    col_data: HashMap<ColId, (SheetId, u32)>,
    sheet_names: HashMap<SheetId, String>,
}

impl TestLookup {
    fn new(formula_sheet: SheetId) -> Self {
        Self {
            formula_sheet,
            cell_positions: HashMap::new(),
            row_data: HashMap::new(),
            col_data: HashMap::new(),
            sheet_names: HashMap::new(),
        }
    }

    fn with_sheet(mut self, id: SheetId, name: &str) -> Self {
        self.sheet_names.insert(id, name.to_string());
        self
    }

    fn with_cell(mut self, id: CellId, sheet: SheetId, row: u32, col: u32) -> Self {
        self.cell_positions.insert(id, (sheet, row, col));
        self
    }

    fn with_row(mut self, id: RowId, sheet: SheetId, row: u32) -> Self {
        self.row_data.insert(id, (sheet, row));
        self
    }

    fn with_col(mut self, id: ColId, sheet: SheetId, col: u32) -> Self {
        self.col_data.insert(id, (sheet, col));
        self
    }

    fn rename_sheet(&mut self, id: SheetId, new_name: &str) {
        self.sheet_names.insert(id, new_name.to_string());
    }
}

impl WorkbookLookup for TestLookup {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.cell_positions.get(cell_id).copied()
    }
    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.row_data.get(row_id).copied()
    }
    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.col_data.get(col_id).copied()
    }
    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.sheet_names.get(sheet_id).map(String::as_str)
    }
    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn sid(n: u128) -> SheetId {
    SheetId::from_raw(n)
}
fn cid(n: u128) -> CellId {
    CellId::from_raw(n)
}
fn rid(n: u128) -> RowId {
    RowId::from_raw(n)
}
fn coid(n: u128) -> ColId {
    ColId::from_raw(n)
}

fn make_formula(refs: Vec<IdentityFormulaRef>) -> IdentityFormula {
    IdentityFormula {
        template: "{0}".to_string(),
        refs,
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    }
}

// ===========================================================================
// Invariant #9 — cross-sheet full-row/col prefix (RED today, GREEN after PR 1)
// ===========================================================================

#[test]
fn full_row_ref_on_other_sheet_emits_prefix() {
    // Formula on Sheet1 references row 1 of Sheet2. Expected: =Sheet2!1:1
    // (simple-named sheets don't need quoting). Today: =1:1 — the cross-sheet
    // prefix is silently dropped.
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_sheet(sid(2), "Sheet2")
        .with_row(rid(10), sid(2), 0);

    let formula = make_formula(vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
        row_id: rid(10),
        absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!1:1");
}

#[test]
fn full_col_ref_on_other_sheet_emits_prefix() {
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_sheet(sid(2), "Sheet2")
        .with_col(coid(5), sid(2), 0);

    let formula = make_formula(vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
        col_id: coid(5),
        absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!A:A");
}

#[test]
fn row_range_ref_on_other_sheet_emits_prefix() {
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_sheet(sid(2), "Sheet2")
        .with_row(rid(10), sid(2), 0)
        .with_row(rid(11), sid(2), 2);

    let formula = make_formula(vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
        start_row_id: rid(10),
        end_row_id: rid(11),
        start_absolute: false,
        end_absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!1:3");
}

#[test]
fn col_range_ref_on_other_sheet_emits_prefix() {
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_sheet(sid(2), "Sheet2")
        .with_col(coid(5), sid(2), 0)
        .with_col(coid(6), sid(2), 2);

    let formula = make_formula(vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
        start_col_id: coid(5),
        end_col_id: coid(6),
        start_absolute: false,
        end_absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!A:C");
}

// ===========================================================================
// Regression guards (GREEN today, must STAY green).
// ===========================================================================

#[test]
fn full_row_ref_on_same_sheet_no_prefix() {
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_row(rid(10), sid(1), 0);

    let formula = make_formula(vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
        row_id: rid(10),
        absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=1:1");
}

#[test]
fn cell_on_own_sheet_does_not_double_qualify() {
    // Invariant #1.
    let lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_cell(cid(1), sid(1), 0, 0);

    let formula = make_formula(vec![IdentityFormulaRef::Cell(IdentityCellRef {
        id: cid(1),
        row_absolute: false,
        col_absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=A1");
}

#[test]
fn sheet_rename_propagates_without_template_mutation() {
    // Invariant #2.
    let mut lookup = TestLookup::new(sid(1))
        .with_sheet(sid(1), "Sheet1")
        .with_sheet(sid(2), "BalanceSheet")
        .with_cell(cid(1), sid(2), 0, 0);

    let formula = make_formula(vec![IdentityFormulaRef::Cell(IdentityCellRef {
        id: cid(1),
        row_absolute: false,
        col_absolute: false,
    })]);

    assert_eq!(to_a1_string(&formula, &lookup), "=BalanceSheet!A1");

    // IdentityFormula is not mutated — only the sheet name map changes.
    let stored_refs_before = formula.refs.clone();
    let stored_template_before = formula.template.clone();
    lookup.rename_sheet(sid(2), "Balances");
    assert_eq!(formula.refs, stored_refs_before);
    assert_eq!(formula.template, stored_template_before);
    assert_eq!(to_a1_string(&formula, &lookup), "=Balances!A1");
}

// ---------------------------------------------------------------------------
// Keep one import live so unused-import lints don't fire when the red tests
// above compile against the shim.
// ---------------------------------------------------------------------------
#[allow(dead_code)]
fn _keep_range_import_live() -> IdentityRangeRef {
    IdentityRangeRef {
        start_id: cid(0),
        end_id: cid(0),
        start_row_absolute: false,
        start_col_absolute: false,
        end_row_absolute: false,
        end_col_absolute: false,
    }
}
