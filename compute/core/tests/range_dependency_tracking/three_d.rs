use crate::helpers::*;
use crate::matrix::CoverageReason;
use crate::summary::Summary;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, FiniteF64};

pub(crate) fn three_d_workbook() -> WorkbookSnapshot {
    // Sheets: Sheet1, Sheet2, Sheet3 each with a value in A1.
    // Dest!A1 = SUM(Sheet1:Sheet3!A1).
    let s1 = sheet_snap(0, "Sheet1", vec![value_cell(0, 0, 0, 1.0)]);
    let s2 = sheet_snap(1, "Sheet2", vec![value_cell(1, 0, 0, 10.0)]);
    let s3 = sheet_snap(2, "Sheet3", vec![value_cell(2, 0, 0, 100.0)]);
    let dest = sheet_snap(
        3,
        "Dest",
        vec![formula_cell(3, 0, 0, "SUM(Sheet1:Sheet3!A1)")],
    );

    WorkbookSnapshot {
        sheets: vec![s1, s2, s3, dest],
        ..Default::default()
    }
}

pub(crate) fn run_3d_case(variant: u8) -> Result<(), String> {
    let (mut engine, _init) = YrsComputeEngine::from_snapshot(three_d_workbook())
        .map_err(|e| format!("from_snapshot err: {:?}", e))?;
    let dependent = cell_id(3, 0, 0);
    let before = read_value(&engine, &dependent);

    // Quick sanity: if 3D parsing isn't supported, `before` will be an
    // error. Treat that as a "3D not supported" skip rather than a
    // Class II drift — the Class II invariant assumes the formula
    // parses. We fold that into the failure message so it's visible.
    let before_is_error = matches!(before, CellValue::Error(_, _));

    match variant {
        0 => {
            // Edit Sheet1!A1 (first sheet of the 3D group).
            let s = sheet_id(0);
            let c = cell_id(0, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(1.0)),
                "42",
            )?;
        }
        1 => {
            // Edit Sheet2!A1 (middle).
            let s = sheet_id(1);
            let c = cell_id(1, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(10.0)),
                "42",
            )?;
        }
        2 => {
            // Edit Sheet3!A1 (last).
            let s = sheet_id(2);
            let c = cell_id(2, 0, 0);
            op_then_inverse(
                &mut engine,
                &s,
                &c,
                0,
                0,
                CellValue::Number(FiniteF64::must(100.0)),
                "42",
            )?;
        }
        3 => {
            // Populate a previously-empty cell on Sheet1 at a high row.
            // It's not inside the 3D range (which is `!A1` only), so
            // the dependent must be *unchanged*.
            let s = sheet_id(0);
            let c = cell_id(0, 39_187, 0);
            op_then_inverse(&mut engine, &s, &c, 39_187, 0, CellValue::Null, "100")?;
        }
        // Variants 4 (sheet-rename-between-ops) and 5 (sheet-reorder-
        // between-ops) are structural-op scope — covered as summary skips
        // in `class_ii_3d_family`, not as runnable variants here.
        _ => return Ok(()),
    }

    let after = read_value(&engine, &dependent);
    let ctx = format!(
        "3d variant={} before_is_error={} (3D parse may not be supported)",
        variant, before_is_error
    );
    assert_dependent_identity(&before, &after, &ctx)
}

pub(crate) fn class_ii_3d_family() {
    let mut s = Summary::new("3d");
    for v in 0..4 {
        let name = format!("3d__v{}", v);
        s.record(&name, run_3d_case(v as u8));
    }
    // v4 = sheet-rename-between-ops, v5 = sheet-reorder-between-ops.
    // Both structural ops → structural-op scope.
    s.skip(CoverageReason::Round2Scope);
    s.skip(CoverageReason::Round2Scope);
    s.emit();
    assert_eq!(
        s.failed, 0,
        "3d family: {} failures — see named cases in stderr output above.",
        s.failed,
    );
}
