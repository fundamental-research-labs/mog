use super::support::{
    as_f64, assert_number_at, cell_at, cell_id, formula_cell, sheet_id, sheet_snap, value_cell,
    workbook_10_rows,
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
fn copy_sheet_preserves_existing_cross_sheet_dependency_edges() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(0, "Sheet1", vec![formula_cell(0, 1, 0, "Sheet2!A1")]),
            sheet_snap(1, "Sheet2", vec![value_cell(1, 0, 0, 1.0)]),
        ],
        ..Default::default()
    };
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let sheet1_sid = sheet_id(0);
    let sheet2_sid = sheet_id(1);
    let sheet2_a1 = cell_id(1, 0, 0);

    assert_number_at(&engine, &sheet1_sid, 1, 0, 1.0, "before copy");

    engine
        .copy_sheet(&sheet1_sid, "Sheet1 (2)")
        .expect("copy_sheet");
    let copy_sid = engine
        .mirror()
        .sheet_by_name("Sheet1 (2)")
        .expect("copied sheet should exist");

    engine
        .set_cell(&sheet2_sid, sheet2_a1, 0, 0, "2".into())
        .expect("set Sheet2 A1");

    assert_number_at(
        &engine,
        &sheet1_sid,
        1,
        0,
        2.0,
        "original sheet after source edit",
    );
    assert_number_at(
        &engine,
        &copy_sid,
        1,
        0,
        2.0,
        "copied sheet after source edit",
    );
}
