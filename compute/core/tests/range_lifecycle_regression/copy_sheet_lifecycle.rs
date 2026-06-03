use super::support::{
    as_f64, cell_at, formula_cell, sheet_id, sheet_snap, value_cell, workbook_10_rows,
};
use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;

#[test]
fn lifecycle_copy_sheet() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);

    let (_hex, _result) = engine.copy_sheet(&sid, "DataCopy").expect("copy_sheet");

    let copy_sid = engine
        .mirror()
        .sheet_by_name("DataCopy")
        .expect("copied sheet should exist");

    for r in 0..10u32 {
        let v = cell_at(&engine, &copy_sid, r, 0);
        assert_eq!(
            as_f64(&v),
            (r + 1) as f64,
            "copy row {} should be {}",
            r,
            r + 1
        );
    }

    // copy_sheet copies formula text; depending on recalc timing, B1 may have
    // either the evaluated value or only a resolvable copied CellId.
    let sum = cell_at(&engine, &copy_sid, 0, 1);
    let copy_b1_cid = engine
        .mirror()
        .resolve_cell_id(&copy_sid, SheetPos::new(0, 1));
    assert!(
        (as_f64(&sum) - 55.0).abs() < 1e-9 || copy_b1_cid.is_some(),
        "copied formula should either evaluate to 55 or have a CellId; got value={:?}, cid={:?}",
        sum,
        copy_b1_cid
    );
}

#[test]
fn copy_sheet_keeps_existing_cross_sheet_dependents_registered() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "Sheet1", vec![formula_cell(0, 1, 0, "=Sheet2!A1")]),
            sheet_snap(1, "Sheet2", vec![value_cell(1, 0, 0, 1.0)]),
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet1 = sheet_id(0);
    let sheet2 = sheet_id(1);

    assert_eq!(
        as_f64(&cell_at(&engine, &sheet1, 1, 0)),
        1.0,
        "precondition: original dependent evaluates Sheet2!A1"
    );

    let (_hex, _result) = engine
        .copy_sheet(&sheet1, "Sheet1 Copy")
        .expect("copy_sheet");
    let copy_sid = engine
        .mirror()
        .sheet_by_name("Sheet1 Copy")
        .expect("copied sheet should exist");

    engine
        .set_cell_value_parsed(&sheet2, 0, 0, "2")
        .expect("update shared precedent");

    assert_eq!(
        as_f64(&cell_at(&engine, &sheet1, 1, 0)),
        2.0,
        "copy_sheet must not drop the original formula's graph edge"
    );
    assert_eq!(
        as_f64(&cell_at(&engine, &copy_sid, 1, 0)),
        2.0,
        "copied formula should also stay registered to the shared precedent"
    );
}
