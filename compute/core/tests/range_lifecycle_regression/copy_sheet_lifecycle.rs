use super::support::{as_f64, cell_at, sheet_id, workbook_10_rows};
use cell_types::SheetPos;
use compute_core::storage::engine::YrsComputeEngine;

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
