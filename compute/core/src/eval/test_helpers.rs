//! Shared test helpers for eval tests.

use super::*;
use crate::cells::CellStore;
use crate::eval_bridge::EvalContext;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::*;
use formula_types::*;
use value_types::*;

// -----------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------

/// Sheet UUID used in tests (deterministic).
pub(super) const TEST_SHEET_UUID: &str = "00000000-0000-0000-0000-000000000001";

/// Cell UUID from row/col: 00000000-0000-0000-0000-00000000RRCC
pub(super) fn cell_uuid(row: u32, col: u32) -> String {
    format!("00000000-0000-0000-0000-0000{:04x}{:04x}", row, col)
}

/// Build a simple cell_store with one sheet and a 5x5 grid.
/// Values: Number(row * 10 + col) for simplicity.
pub(super) fn test_store() -> (CellStore, SheetId) {
    let mut cells = Vec::new();
    for r in 0..5u32 {
        for c in 0..5u32 {
            cells.push(CellData {
                cell_id: cell_uuid(r, c),
                row: r,
                col: c,
                value: CellValue::number((r * 10 + c) as f64),
                formula: None,
                identity_formula: None,
                array_ref: None,
            });
        }
    }
    let snapshot = WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: TEST_SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let cell_store = CellStore::from_snapshot(snapshot).unwrap();
    let sheet_id = cell_store.sheet_by_name("Sheet1").unwrap();
    (cell_store, sheet_id)
}

pub(super) fn eval(node: &ASTNode, ctx: &EvalContext<'_>) -> CellValue {
    super::context::traits::sync_block_on(Evaluator::evaluate(node, ctx, ctx)).unwrap()
}

/// Build a EvalContext from the test cell_store.
pub(super) fn cell_id_at(row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(row, col)).unwrap()
}

pub(super) fn make_ctx<'a>(cell_store: &'a CellStore, sheet_id: SheetId) -> EvalContext<'a> {
    EvalContext::new(cell_store, cell_id_at(0, 0), sheet_id)
}

pub(super) fn binop(op: BinOp, left: ASTNode, right: ASTNode) -> ASTNode {
    ASTNode::BinaryOp {
        op,
        left: Box::new(left),
        right: Box::new(right),
    }
}

pub(super) fn func(name: &str, args: Vec<ASTNode>) -> ASTNode {
    ASTNode::Function {
        name: name.to_string().into(),
        args,
    }
}

pub(super) fn ident(name: &str) -> ASTNode {
    ASTNode::Identifier(name.to_string())
}

/// Build a cell store with one sheet, a 5x5 grid, and the given named ranges.
pub(super) fn test_store_with_named_ranges(
    named_ranges: Vec<NamedRangeDef>,
) -> (CellStore, SheetId) {
    let mut cells = Vec::new();
    for r in 0..5u32 {
        for c in 0..5u32 {
            cells.push(CellData {
                cell_id: cell_uuid(r, c),
                row: r,
                col: c,
                value: CellValue::number((r * 10 + c) as f64),
                formula: None,
                identity_formula: None,
                array_ref: None,
            });
        }
    }
    let snapshot = WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: TEST_SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        named_ranges,
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    };
    let cell_store = CellStore::from_snapshot(snapshot).unwrap();
    let sheet_id = cell_store.sheet_by_name("Sheet1").unwrap();
    (cell_store, sheet_id)
}
