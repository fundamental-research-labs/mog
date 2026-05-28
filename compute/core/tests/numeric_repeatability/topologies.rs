use cell_types::SheetPos;
use snapshot_types::WorkbookSnapshot;

use crate::support::fixtures::{formula_cell, one_sheet_snapshot, value_cell};

/// Chain of depth 10: A1 seeded; A2=A1+1, A3=A2+1, ..., A10=A9+1.
/// Root is A1; terminal dependent is A10.
pub(crate) fn chain_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = vec![value_cell(0, 0, seed)];
    for i in 1..10 {
        let prev = format!("A{}", i);
        cells.push(formula_cell(i as u32, 0, &format!("{}+1", prev)));
    }
    (one_sheet_snapshot(cells), SheetPos::new(9, 0))
}

/// Fan-in of 10 inputs: A1..A10 all seeded; B1=SUM(A1:A10).
pub(crate) fn fanin_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = Vec::with_capacity(11);
    for i in 0..10 {
        cells.push(value_cell(i as u32, 0, seed));
    }
    cells.push(formula_cell(0, 1, "SUM(A1:A10)"));
    (one_sheet_snapshot(cells), SheetPos::new(0, 1))
}

/// Diamond: A1 seeded; B1=A1*2, C1=A1*3, D1=B1+C1.
pub(crate) fn diamond_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let cells = vec![
        value_cell(0, 0, seed),
        formula_cell(0, 1, "A1*2"),
        formula_cell(0, 2, "A1*3"),
        formula_cell(0, 3, "B1+C1"),
    ];
    (one_sheet_snapshot(cells), SheetPos::new(0, 3))
}

/// Matrix-product-like dot product. `MMULT` is not registered in
/// compute-core today, so this keeps the equivalent SUMPRODUCT shape.
pub(crate) fn mmult_like_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let cells = vec![
        value_cell(0, 0, seed),
        value_cell(0, 1, seed),
        value_cell(0, 2, seed),
        value_cell(0, 3, seed),
        value_cell(0, 4, seed),
        value_cell(0, 5, seed),
        formula_cell(0, 6, "SUMPRODUCT(A1:C1, D1:F1)"),
    ];
    (one_sheet_snapshot(cells), SheetPos::new(0, 6))
}

/// SUMPRODUCT of 10 pairs. A1..A10 and B1..B10 are seeded; C1 is dependent.
pub(crate) fn sumproduct_snapshot(seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let mut cells = Vec::with_capacity(21);
    for i in 0..10 {
        cells.push(value_cell(i as u32, 0, seed));
        cells.push(value_cell(i as u32, 1, seed));
    }
    cells.push(formula_cell(0, 2, "SUMPRODUCT(A1:A10, B1:B10)"));
    (one_sheet_snapshot(cells), SheetPos::new(0, 2))
}

/// Mixed-type chain: A1 is integer-shaped, A2 is float, A3=A1+A2 promotes.
pub(crate) fn mixed_type_snapshot(int_seed: f64, float_seed: f64) -> (WorkbookSnapshot, SheetPos) {
    let cells = vec![
        value_cell(0, 0, int_seed),
        value_cell(1, 0, float_seed),
        formula_cell(2, 0, "A1+A2"),
    ];
    (one_sheet_snapshot(cells), SheetPos::new(2, 0))
}
