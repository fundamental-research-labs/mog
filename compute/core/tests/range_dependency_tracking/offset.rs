use crate::helpers::*;
use crate::summary::Summary;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, FiniteF64};

pub(crate) fn offset_workbook(n_initial: f64) -> WorkbookSnapshot {
    // Dest!A1 = SUM(OFFSET(SourceData!A1, 0, 0, N1, 1))
    // Dest!B1 = N1 (the size driver)
    // SourceData!A1:A20 populated with 1..20
    let mut src_cells = Vec::new();
    for r in 0..20 {
        src_cells.push(value_cell(0, r, 0, (r + 1) as f64));
    }

    let dest_cells = vec![
        value_cell(1, 0, 1, n_initial), // B1 = N
        formula_cell(1, 0, 0, "SUM(OFFSET(SourceData!A1,0,0,B1,1))"),
    ];

    WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "SourceData", src_cells),
            sheet_snap(1, "Dest", dest_cells),
        ],
        ..Default::default()
    }
}

/// Case: edit `n` (the size parameter), then revert. SUM must return to
/// the pre-op value. Additional subcases edit data cells inside / outside
/// the currently-sized window.
pub(crate) fn run_offset_case(variant: u8) -> Result<(), String> {
    let n_initial = 10.0;
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(offset_workbook(n_initial))
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dest = sheet_id(1);
    let source = sheet_id(0);
    let dependent = cell_id(1, 0, 0);

    let before = read_value(&engine, &dependent);

    match variant {
        0 => {
            // Change n from 10 → 15 (window grows), revert.
            let n_cell = cell_id(1, 0, 1);
            op_then_inverse(
                &mut engine,
                &dest,
                &n_cell,
                0,
                1,
                CellValue::Number(FiniteF64::must(n_initial)),
                "15",
            )?;
        }
        1 => {
            // Change n from 10 → 5 (window shrinks), revert.
            let n_cell = cell_id(1, 0, 1);
            op_then_inverse(
                &mut engine,
                &dest,
                &n_cell,
                0,
                1,
                CellValue::Number(FiniteF64::must(n_initial)),
                "5",
            )?;
        }
        2 => {
            // Edit a cell inside the window (A3=3 → A3=100 → A3=3).
            let c = cell_id(0, 2, 0);
            op_then_inverse(
                &mut engine,
                &source,
                &c,
                2,
                0,
                CellValue::Number(FiniteF64::must(3.0)),
                "100",
            )?;
        }
        3 => {
            // Edit a cell outside the current window but inside the
            // data range (A15=15 → A15=100 → A15=15).
            let c = cell_id(0, 14, 0);
            op_then_inverse(
                &mut engine,
                &source,
                &c,
                14,
                0,
                CellValue::Number(FiniteF64::must(15.0)),
                "100",
            )?;
        }
        4 => {
            // Grow n, then edit a cell that's now inside, then shrink
            // n back, then revert the data cell. The final revert must
            // restore the pre-op SUM even though the window shape
            // changed in between.
            let n_cell = cell_id(1, 0, 1);
            let c = cell_id(0, 12, 0);
            engine
                .set_cell(&dest, n_cell, 0, 1, "15".into())
                .map_err(|e| format!("grow n err: {:?}", e))?;
            engine
                .set_cell(&source, c, 12, 0, "100".into())
                .map_err(|e| format!("edit inside new window err: {:?}", e))?;
            engine
                .import_values(
                    &source,
                    vec![(12, 0, CellValue::Number(FiniteF64::must(13.0)), None)],
                )
                .map_err(|e| format!("revert edit err: {:?}", e))?;
            engine
                .import_values(
                    &dest,
                    vec![(0, 1, CellValue::Number(FiniteF64::must(n_initial)), None)],
                )
                .map_err(|e| format!("revert n err: {:?}", e))?;
        }
        5 => {
            // Far-outside write (row 39_187, col 0) inside the source
            // sheet — not in the OFFSET window. SUM must be unaffected
            // and remain identical pre/post.
            let c = cell_id(0, 39_187, 0);
            op_then_inverse(&mut engine, &source, &c, 39_187, 0, CellValue::Null, "100")?;
        }
        _ => return Ok(()),
    }

    let after = read_value(&engine, &dependent);
    assert_dependent_identity(&before, &after, &format!("offset variant={}", variant))
}

pub(crate) fn class_ii_offset_family() {
    let mut s = Summary::new("offset");
    for v in 0..6 {
        let name = format!("offset__v{}", v);
        s.record(&name, run_offset_case(v as u8));
    }
    s.emit();
    assert_eq!(
        s.failed, 0,
        "offset family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}
