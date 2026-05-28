use super::support::{as_f64, cell_at, cell_id, formula_cell, sheet_id, sheet_snap, value_cell};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::WorkbookSnapshot;

#[test]
fn lifecycle_cross_sheet_formula_survives_edit() {
    let snap = WorkbookSnapshot {
        sheets: vec![
            sheet_snap(
                0,
                "Data",
                vec![
                    value_cell(0, 0, 0, 10.0),
                    value_cell(0, 1, 0, 20.0),
                    value_cell(0, 2, 0, 30.0),
                ],
            ),
            sheet_snap(1, "Summary", vec![formula_cell(1, 0, 0, "SUM(Data!A1:A3)")]),
        ],
        ..Default::default()
    };

    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    let data_sid = sheet_id(0);
    let summary_sid = sheet_id(1);
    let a1 = cell_id(0, 0, 0);

    let pre_sum = cell_at(&engine, &summary_sid, 0, 0);
    assert!(
        (as_f64(&pre_sum) - 60.0).abs() < 1e-9,
        "SUM(Data!A1:A3) should be 60"
    );

    engine
        .set_cell(&data_sid, a1, 0, 0, "100".into())
        .expect("set_cell");

    let post_sum = cell_at(&engine, &summary_sid, 0, 0);
    assert!(
        (as_f64(&post_sum) - 150.0).abs() < 1e-9,
        "SUM should be 150 after edit, got {:?}",
        post_sum
    );

    engine.undo().expect("undo");
    let undo_sum = cell_at(&engine, &summary_sid, 0, 0);
    assert!(
        (as_f64(&undo_sum) - 60.0).abs() < 1e-9,
        "SUM should revert to 60 after undo, got {:?}",
        undo_sum
    );
}
