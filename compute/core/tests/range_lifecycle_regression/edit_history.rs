use super::support::{as_f64, cell_at, cell_id, sheet_id, workbook_10_rows};
use compute_core::storage::engine::YrsComputeEngine;

#[test]
fn lifecycle_undo_edit() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);
    let a1 = cell_id(0, 0, 0);

    let pre_a1 = cell_at(&engine, &sid, 0, 0);
    let pre_sum = cell_at(&engine, &sid, 0, 1);
    assert_eq!(as_f64(&pre_a1), 1.0);
    assert!((as_f64(&pre_sum) - 55.0).abs() < 1e-9);

    engine
        .set_cell(&sid, a1, 0, 0, "100".into())
        .expect("set_cell");

    let mid_a1 = cell_at(&engine, &sid, 0, 0);
    assert_eq!(as_f64(&mid_a1), 100.0, "A1 should be 100 after edit");

    engine.undo().expect("undo");

    let post_a1 = cell_at(&engine, &sid, 0, 0);
    assert_eq!(
        as_f64(&post_a1),
        1.0,
        "A1 should revert to 1 after undo, got {:?}",
        post_a1
    );

    let post_sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&post_sum) - 55.0).abs() < 1e-9,
        "SUM should revert to 55 after undo, got {:?}",
        post_sum
    );
}

#[test]
fn lifecycle_redo_edit() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(workbook_10_rows()).expect("from_snapshot");
    let sid = sheet_id(0);
    let a1 = cell_id(0, 0, 0);

    engine
        .set_cell(&sid, a1, 0, 0, "100".into())
        .expect("set_cell");

    engine.undo().expect("undo");
    let post_undo = cell_at(&engine, &sid, 0, 0);
    assert_eq!(as_f64(&post_undo), 1.0, "A1 should be 1 after undo");

    engine.redo().expect("redo");

    let post_redo = cell_at(&engine, &sid, 0, 0);
    assert_eq!(
        as_f64(&post_redo),
        100.0,
        "A1 should be 100 after redo, got {:?}",
        post_redo
    );

    let sum = cell_at(&engine, &sid, 0, 1);
    assert!(
        (as_f64(&sum) - 154.0).abs() < 1e-9,
        "SUM should be 154 after redo, got {:?}",
        sum
    );
}
